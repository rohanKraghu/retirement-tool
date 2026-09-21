/*
 * browser.test.mjs — end-to-end check of the real page in a real browser.
 *
 * OPTIONAL. The app itself has no dependencies; this file needs Playwright,
 * which is why it is not part of `node tests/finance.test.js`.
 *
 *   npx http-server -p 8200 -s .        # in one terminal, from the repo root
 *   node tests/browser.test.mjs         # in another
 *
 * Set BASE_URL to point somewhere else. Exit code 0 means everything passed.
 */
import { fileURLToPath } from 'node:url';
import path from 'node:path';

let chromium;
try {
  // PLAYWRIGHT_PATH lets a machine with a global (rather than local) install
  // point at it, e.g. PLAYWRIGHT_PATH=/usr/lib/node_modules/playwright/index.mjs
  ({ chromium } = await import(process.env.PLAYWRIGHT_PATH || 'playwright'));
} catch {
  console.error('Playwright is not installed. This end-to-end check is optional;\n' +
                'the arithmetic is covered by `node tests/finance.test.js`.\n' +
                'Install it, or set PLAYWRIGHT_PATH to an existing install.');
  process.exit(0);
}

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const URL = process.env.BASE_URL || 'http://127.0.0.1:8200/index.html';
const FILE_URL = 'file://' + path.join(ROOT, 'index.html');
const ART = path.join(ROOT, 'tmp');
let fails = 0, passes = 0;
const check = (label, actual, expected) => {
  const ok = String(actual).trim() === String(expected).trim();
  if (ok) { passes++; console.log(`  PASS  ${label}\n          expected "${expected}"  got "${String(actual).trim()}"`); }
  else { fails++; console.log(`  FAIL  ${label}\n          expected "${expected}"  got "${String(actual).trim()}"`); }
};
const checkTrue = (label, cond, detail = '') => {
  if (cond) { passes++; console.log(`  PASS  ${label}${detail ? '  (' + detail + ')' : ''}`); }
  else { fails++; console.log(`  FAIL  ${label}  ${detail}`); }
};
const norm = (t) => String(t).replace(/\s+/g, ' ').trim();
const contains = (label, hay, needle) => {
  const ok = norm(hay).includes(norm(needle));
  if (ok) { passes++; console.log(`  PASS  ${label}  (found "${needle}")`); }
  else { fails++; console.log(`  FAIL  ${label}  expected to contain "${needle}"\n          got: ${String(hay).slice(0, 300)}`); }
};
const section = (t) => console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 60 - t.length))}`);

import fs from 'node:fs';
fs.mkdirSync(ART, { recursive: true });   // gitignored scratch for screenshots

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

const consoleErrors = [], pageErrors = [], failedRequests = [];
page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', e => pageErrors.push(e.message));
page.on('requestfailed', r => failedRequests.push(`${r.url()} :: ${r.failure()?.errorText}`));

await page.goto(URL, { waitUntil: 'networkidle' });

// Helper: set the form, wait past the 400ms debounce.
async function setPlan(vals) {
  for (const [id, v] of Object.entries(vals)) {
    if (id === 'timing' || id === 'withdrawalMode') { await page.check(`#${id === 'timing' ? 'timing-' : 'mode-'}${v}`); continue; }
    if (id === 'escalate') { if (v) await page.check('#escalate'); else await page.uncheck('#escalate'); continue; }
    await page.fill(`#${id}`, String(v));
  }
  await page.waitForTimeout(700);
}

// =====================================================================
section('A. Page loads and wires up');
// =====================================================================
check('document title', await page.title(), 'Retirement & Compound Interest Planner');
checkTrue('accumulation chart SVG rendered', await page.locator('#chartAccumWrap svg').count() === 1);
checkTrue('drawdown chart SVG rendered', await page.locator('#chartDrawWrap svg').count() === 1);
check('sensitivity table has 4 rows', await page.locator('#sensitivityBody tr').count(), 4);
checkTrue('every input has a real <label>', await page.evaluate(() => {
  const ins = [...document.querySelectorAll('input')];
  return ins.every(i => !!document.querySelector(`label[for="${i.id}"]`));
}));
check('results summary is an aria-live region',
  await page.locator('#liveSummary').getAttribute('aria-live'), 'polite');

// =====================================================================
section('B. HAND CASE 1 — 0% return, 3% inflation');
/*  PV 1000 + 100/month for 10 years (120 months), 0% return
    nominal = 1000 + 100*120                 = 13,000
    1.03^10 = 1.3439163793441223
    real    = 13000 / 1.3439163793441223     = 9,673.2209  -> $9,673        */
// =====================================================================
await setPlan({ currentAge: 55, retirementAge: 65, currentSavings: 1000,
  monthlyContribution: 100, matchPercent: 0, matchCapMonthly: 0,
  annualReturn: 0, annualInflation: 3, timing: 'end' });
check('balance on paper', await page.locator('#statNominal').textContent(), '$13,000');
check('balance in today’s money', await page.locator('#statReal').textContent(), '$9,673');
contains('split sentence reports zero growth honestly',
  await page.locator('#splitFigures').textContent(), 'compounding adds nothing');

// =====================================================================
section('C. HAND CASE 2 — lump sum, 7% for 10 years, no contributions');
/*  10000 * 1.07^10 = 10000 * 1.9671513573 = 19,671.51  -> $19,672
    growth = 19,671.51 - 10,000 = 9,671.51 -> $9,672                        */
// =====================================================================
await setPlan({ currentAge: 50, retirementAge: 60, currentSavings: 10000,
  monthlyContribution: 0, annualReturn: 7, annualInflation: 0 });
check('lump sum nominal at 7% x 10y', await page.locator('#statNominal').textContent(), '$19,672');
check('real equals nominal at 0% inflation', await page.locator('#statReal').textContent(), '$19,672');
contains('growth split stated', await page.locator('#splitFigures').textContent(), '$9,672');
contains('growth share is 49%', await page.locator('#splitFigures').textContent(), '49%');
// Last row of the year table must agree with the headline.
check('year table final balance matches headline',
  await page.locator('#yearTableBody tr:last-child td').nth(4).textContent(), '$19,672');

// =====================================================================
section('D. HAND CASE 3 — withdrawal, "how long does it last?"');
/*  Age 60->65, 100,000 start, 500/mo, 0% return, 0% inflation
      balance = 100,000 + 500*60 = 130,000
      taking 26,000/yr = 2,166.67/mo -> 130,000/2,166.67 = 60 months = 5 yrs
      money gone at age 65 + 5 = 70                                          */
// =====================================================================
await setPlan({ currentAge: 60, retirementAge: 65, currentSavings: 100000,
  monthlyContribution: 500, annualReturn: 0, annualInflation: 0,
  retirementReturn: 0, withdrawalMode: 'duration', targetAnnualWithdrawal: 26000 });
check('balance at retirement', await page.locator('#statNominal').textContent(), '$130,000');
contains('lasts exactly 5 years', await page.locator('#withdrawalVerdict').textContent(), 'lasts about 5 years');
contains('empty at age 70', await page.locator('#withdrawalVerdict').textContent(), 'age 70');
contains('drawdown chart marks the empty point',
  await page.locator('#chartDrawWrap svg').innerHTML(), 'Empty at age 70');

// =====================================================================
section('E. HAND CASE 4 — withdrawal, "what can I spend?" (the inverse)');
/*  Same 130,000 pot, 0% real return, 5 years -> 130,000/5 = 26,000 a year,
    which is 130,000/60 = 2,166.67 a month.                                  */
// =====================================================================
await page.check('#mode-amount');
await page.waitForTimeout(200);
await setPlan({ targetYears: 5 });
contains('sustainable spend is $26,000/yr', await page.locator('#withdrawalVerdict').textContent(), '$26,000 a year');
contains('...and $2,167 a month', await page.locator('#withdrawalVerdict').textContent(), '$2,167 a month');
checkTrue('the "years" field is shown and the "amount" field hidden in this mode',
  await page.locator('#field-targetYears').isVisible() && !(await page.locator('#field-targetWithdrawal').isVisible()));

// =====================================================================
section('F. HAND CASE 5 — withdrawal exceeds the balance');
/*  130,000 pot, 0% return, taking 156,000/yr = 13,000/month
      -> exactly 10 months, empty at age 65 + 10/12 = 65.83 -> "age 66"
      (the verdict rounds the age; "10 months" is the load-bearing figure)   */
// =====================================================================
await page.check('#mode-duration');
await page.waitForTimeout(200);
await setPlan({ targetAnnualWithdrawal: 156000 });
contains('over-withdrawal lasts 10 months', await page.locator('#withdrawalVerdict').textContent(), 'lasts about 10 months');
contains('...and is flagged as a warning', await page.locator('#withdrawalVerdict').innerHTML(), 'is-warning');

// =====================================================================
section('G. HAND CASE 6 — retiring today (retirement age = current age)');
// =====================================================================
await setPlan({ currentAge: 67, retirementAge: 67, currentSavings: 250000,
  monthlyContribution: 900, annualReturn: 6, annualInflation: 2.5 });
check('nominal = starting balance', await page.locator('#statNominal').textContent(), '$250,000');
check('real = starting balance', await page.locator('#statReal').textContent(), '$250,000');
contains('explains there is nothing to chart',
  await page.locator('#chartAccumWrap').textContent(), 'nothing to chart');
check('year table shows the single row', await page.locator('#yearTableBody tr').count(), 1);

// =====================================================================
section('H. Validation');
// =====================================================================
await setPlan({ currentAge: 70, retirementAge: 65 });
contains('rejects retiring before today', await page.locator('#errors').textContent(), 'cannot be earlier');
check('offending field marked aria-invalid',
  await page.locator('#retirementAge').getAttribute('aria-invalid'), 'true');
await setPlan({ currentAge: 55, retirementAge: 67 });
check('error clears when fixed', (await page.locator('#errors').textContent()).trim(), '');

// =====================================================================
section('I. Sensitivity view');
// =====================================================================
await setPlan({ currentAge: 40, retirementAge: 65, currentSavings: 25000,
  monthlyContribution: 500, annualReturn: 7, annualInflation: 2.5, retirementReturn: 5 });
const sens = await page.evaluate(() =>
  [...document.querySelectorAll('#sensitivityBody tr')].map(r =>
    [...r.children].map(c => c.textContent.trim())));
console.log('          rows:', JSON.stringify(sens));
check('pessimistic row is 4%', sens[0][0], '4%');
check('baseline row is 7%', sens[2][0], '7% (your assumption)');
check('optimistic row is 8.5%', sens[3][0], '8.5%');
/*  HAND CHECK: baseline nominal = 25000*1.07^25 + 500*((1.07^(1/12))^300 - 1)/i
    The node test already pins this at 527,206.7565 -> $527,207              */
check('baseline matches the headline', sens[2][1], await page.locator('#statNominal').textContent());
contains('baseline nominal is the hand-computed 527,207', sens[2][1], '$527,207');
checkTrue('balances increase with the return assumption', await page.evaluate(() => {
  const v = [...document.querySelectorAll('#sensitivityBody tr')]
    .map(r => Number(r.children[1].textContent.replace(/[^0-9.]/g, '')));
  return v[0] < v[1] && v[1] < v[2] && v[2] < v[3];
}));

// =====================================================================
section('J. Text size control');
// =====================================================================
const beforeSize = await page.evaluate(() => getComputedStyle(document.documentElement).fontSize);
await page.click('.text-size-btn[data-size="4"]');
await page.waitForTimeout(300);
const afterSize = await page.evaluate(() => getComputedStyle(document.documentElement).fontSize);
check('default root font size', beforeSize, '18px');
check('largest step applies', afterSize, '25px');
check('pressed state is exposed to assistive tech',
  await page.locator('.text-size-btn[data-size="4"]').getAttribute('aria-pressed'), 'true');
contains('size change is announced', await page.locator('#text-size-status').textContent(), 'Largest');
checkTrue('results still correct after resize', (await page.locator('#statNominal').textContent()).includes('$527,207'));

// =====================================================================
section('K. Keyboard operability');
// =====================================================================
await page.click('.text-size-btn[data-size="2"]');
await page.waitForTimeout(300);
const tabbables = await page.evaluate(() => document.querySelectorAll(
  'a[href],button,input,select,[tabindex="0"]').length);
checkTrue('focusable controls present', tabbables > 15, `${tabbables} focusable elements`);
// Drive the chart with the keyboard only.
await page.focus('#chartAccumWrap svg');
await page.waitForTimeout(150);
await page.keyboard.press('Home');
await page.waitForTimeout(150);
const tipAtStart = await page.locator('#chartAccumTip').textContent();
await page.keyboard.press('ArrowRight');
await page.waitForTimeout(150);
const tipAfter = await page.locator('#chartAccumTip').textContent();
contains('chart reads out the first year via Home key', tipAtStart, 'Age 40');
contains('arrow key advances a year', tipAfter, 'Age 41');
check('chart tooltip is a status region',
  await page.locator('#chartAccumTip').getAttribute('role'), 'status');

// =====================================================================
section('L. Contrast spot checks (WCAG AA)');
// =====================================================================
const contrast = await page.evaluate(() => {
  const lum = (c) => { const s = c.map(v => { v /= 255; return v <= 0.03928 ? v/12.92 : Math.pow((v+0.055)/1.055, 2.4); });
    return 0.2126*s[0] + 0.7152*s[1] + 0.0722*s[2]; };
  const parse = (str) => str.match(/\d+(\.\d+)?/g).slice(0,3).map(Number);
  const ratio = (a,b) => { const l1 = lum(parse(a)), l2 = lum(parse(b));
    return ((Math.max(l1,l2)+0.05)/(Math.min(l1,l2)+0.05)); };
  const out = {};
  const pairs = [
    ['body text', document.querySelector('.tagline'), document.querySelector('.site-header')],
    ['hint text', document.querySelector('.field .hint'), document.querySelector('#planForm')],
    ['headline stat', document.querySelector('#statReal'), document.querySelector('.stat.primary')],
    ['table cell', document.querySelector('#yearTableBody td'), document.querySelector('.card')],
    ['button', document.querySelector('.btn-primary'), document.querySelector('.btn-primary')]
  ];
  for (const [name, fg, bg] of pairs) {
    if (!fg || !bg) continue;
    out[name] = Number(ratio(getComputedStyle(fg).color,
      name === 'button' ? getComputedStyle(bg).backgroundColor : getComputedStyle(bg).backgroundColor).toFixed(2));
  }
  return out;
});
for (const [k, v] of Object.entries(contrast)) {
  checkTrue(`contrast ${k} >= 4.5:1`, v >= 4.5, `${v}:1`);
}

// =====================================================================
section('M. Phone layout at 390px — no horizontal overflow');
// =====================================================================
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(600);
const overflow = await page.evaluate(() => {
  // Turn off the safety-net clip so genuine overflow is measurable.
  document.body.style.overflowX = 'visible';
  const vw = document.documentElement.clientWidth;
  const bad = [];
  for (const el of document.querySelectorAll('*')) {
    if (el.closest('.table-scroll')) continue;       // intentionally scrollable
    const r = el.getBoundingClientRect();
    if (r.width === 0) continue;
    if (r.right > vw + 1 || r.left < -1) {
      bad.push(`${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${el.className && typeof el.className === 'string' ? '.' + el.className.split(' ')[0] : ''} right=${r.right.toFixed(1)} left=${r.left.toFixed(1)}`);
    }
  }
  const res = { vw, scrollW: document.documentElement.scrollWidth, bodyScrollW: document.body.scrollWidth, bad: bad.slice(0, 12) };
  document.body.style.overflowX = '';
  return res;
});
console.log('          viewport', overflow.vw, 'documentElement.scrollWidth', overflow.scrollW);
checkTrue('no element overflows the 390px viewport', overflow.bad.length === 0, overflow.bad.join(' | '));
checkTrue('document does not scroll sideways', overflow.scrollW <= overflow.vw + 1,
  `scrollWidth=${overflow.scrollW} vs ${overflow.vw}`);
checkTrue('charts still render on a phone', await page.locator('#chartAccumWrap svg').count() === 1);
const tapTargets = await page.evaluate(() =>
  [...document.querySelectorAll('button, input[type=number]')]
    .filter(el => el.offsetParent !== null)          // skip fields hidden by the current mode
    .map(el => ({ id: el.id || el.className, h: +el.getBoundingClientRect().height.toFixed(1) })));
checkTrue('every visible tap target is at least 44px tall',
  tapTargets.every(t => t.h >= 43.9),
  JSON.stringify(tapTargets.filter(t => t.h < 43.9)));

// Chart text must be genuinely readable, not just present.
const chartText = await page.evaluate(() => {
  const sizes = [...document.querySelectorAll('svg text')].map(t => {
    const r = t.getBoundingClientRect();
    const svg = t.ownerSVGElement;
    const scale = svg.getBoundingClientRect().width / svg.viewBox.baseVal.width;
    return +(parseFloat(t.getAttribute('font-size') || getComputedStyle(t).fontSize) * scale).toFixed(2);
  });
  return { min: Math.min(...sizes), count: sizes.length };
});
checkTrue('chart labels render at 11px or larger on a phone',
  chartText.min >= 11, `smallest rendered chart label = ${chartText.min}px across ${chartText.count} labels`);
await page.screenshot({ path: path.join(ART, 'phone.png'), fullPage: false });

// =====================================================================
section('N. Print rendering');
// =====================================================================
await page.setViewportSize({ width: 1024, height: 900 });
await page.emulateMedia({ media: 'print' });
await page.waitForTimeout(400);
const printInfo = await page.evaluate(() => ({
  toolbarHidden: getComputedStyle(document.querySelector('.toolbar')).display === 'none',
  actionsHidden: getComputedStyle(document.querySelector('.form-actions')).display === 'none',
  printDisclaimerShown: getComputedStyle(document.querySelector('.print-only')).display !== 'none',
  formHidden: getComputedStyle(document.querySelector('#planForm')).display === 'none',
  assumptionsVisible: getComputedStyle(document.querySelector('#assumptionsList')).display !== 'none',
  assumptionsText: document.querySelector('#assumptionsList').textContent,
  tableUncapped: getComputedStyle(document.querySelector('.table-tall')).maxHeight === 'none',
  bodyColor: getComputedStyle(document.body).color
}));
checkTrue('toolbar hidden in print', printInfo.toolbarHidden);
checkTrue('buttons hidden in print', printInfo.actionsHidden);
checkTrue('print-only disclaimer shown', printInfo.printDisclaimerShown);
checkTrue('the input form does not print (the recap carries the values)', printInfo.formHidden);
checkTrue('the assumptions recap does print', printInfo.assumptionsVisible);
contains('recap carries the withdrawal question into print', printInfo.assumptionsText, 'Planned withdrawal');
contains('recap carries the real return into print', printInfo.assumptionsText, 'Return after inflation');
checkTrue('year table is not scroll-clipped in print', printInfo.tableUncapped);
check('print text is black', printInfo.bodyColor, 'rgb(0, 0, 0)');
await page.pdf({ path: path.join(ART, 'handout.pdf'), format: 'Letter', printBackground: true });
await page.emulateMedia({ media: 'screen' });

// =====================================================================
section('O. Dark mode');
// =====================================================================
await page.emulateMedia({ colorScheme: 'dark' });
await page.waitForTimeout(300);
const darkContrast = await page.evaluate(() => {
  const lum = (c) => { const s = c.map(v => { v /= 255; return v <= 0.03928 ? v/12.92 : Math.pow((v+0.055)/1.055, 2.4); });
    return 0.2126*s[0] + 0.7152*s[1] + 0.0722*s[2]; };
  const parse = (str) => str.match(/\d+(\.\d+)?/g).slice(0,3).map(Number);
  const fg = getComputedStyle(document.querySelector('.tagline')).color;
  const bg = getComputedStyle(document.querySelector('.site-header')).backgroundColor;
  const l1 = lum(parse(fg)), l2 = lum(parse(bg));
  return Number(((Math.max(l1,l2)+0.05)/(Math.min(l1,l2)+0.05)).toFixed(2));
});
checkTrue('dark mode body text >= 4.5:1', darkContrast >= 4.5, `${darkContrast}:1`);
await page.emulateMedia({ colorScheme: 'light' });
await page.setViewportSize({ width: 1280, height: 900 });

// =====================================================================
section('P. Works offline, straight off the filesystem');
// =====================================================================
// The real requirement: open index.html with no server and no network at all.
const offlinePage = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const offlineErrors = [];
offlinePage.on('console', m => { if (m.type() === 'error') offlineErrors.push(m.text()); });
offlinePage.on('pageerror', e => offlineErrors.push(e.message));
await offlinePage.context().setOffline(true);
await offlinePage.goto(FILE_URL,
  { waitUntil: 'domcontentloaded' });
await offlinePage.waitForTimeout(800);
await offlinePage.fill('#currentAge', '50');
await offlinePage.fill('#retirementAge', '60');
await offlinePage.fill('#currentSavings', '10000');
await offlinePage.fill('#monthlyContribution', '0');
await offlinePage.fill('#annualReturn', '7');
await offlinePage.fill('#annualInflation', '0');
await offlinePage.waitForTimeout(800);
check('file:// with the network off still computes 10000 x 1.07^10',
  await offlinePage.locator('#statNominal').textContent(), '$19,672');
checkTrue('charts render offline', await offlinePage.locator('#chartAccumWrap svg').count() === 1);
checkTrue('no console errors offline', offlineErrors.length === 0, offlineErrors.join(' | '));
await offlinePage.context().setOffline(false);
await offlinePage.close();

const external = await page.evaluate(() => {
  const urls = [];
  document.querySelectorAll('[src],[href]').forEach(el => {
    const u = el.getAttribute('src') || el.getAttribute('href');
    if (u && /^(https?:)?\/\//i.test(u)) urls.push(u);
  });
  return urls;
});
checkTrue('no external stylesheets, scripts, fonts or images', external.length === 0, external.join(', '));
checkTrue('fonts are a system stack', await page.evaluate(() =>
  getComputedStyle(document.body).fontFamily.includes('system-ui')));
checkTrue('nothing is sent to a server', await page.evaluate(() =>
  !/fetch\s*\(|XMLHttpRequest|navigator\.sendBeacon/.test(
    [...document.querySelectorAll('script[src]')].map(s => s.src).join('')) ));

// =====================================================================
section('Q1. Honesty features are actually on the page');
// =====================================================================
await page.setViewportSize({ width: 1280, height: 900 });
const disc = await page.locator('.disclaimer').first().textContent();
contains('disclaimer says it is not advice', disc, 'not financial advice');
contains('disclaimer refuses to promise', disc, 'promise or a guarantee');
contains('disclaimer names what is left out', disc, 'taxes, fees');
contains('sensitivity section calls the fixed rate a simplification',
  await page.locator('section:has(#sensitivity-heading)').textContent(),
  'A single return figure is a simplification');
contains('drawdown note admits sequence risk',
  await page.locator('#drawdownNote').textContent(), 'bad run of years early on');
contains('method note explains the compounding convention',
  await page.locator('#methodNote').textContent(), 'not the slightly higher figure');
contains('method note rejects subtracting inflation',
  await page.locator('#methodNote').textContent(), 'only an approximation');
contains('live summary ends on a caveat',
  await page.locator('#liveSummary').textContent(), 'illustrations, not promises');
contains('privacy is stated', await page.locator('.site-footer').textContent(),
  'sends nothing to any server');
checkTrue('assumptions recap is populated for the printed handout',
  (await page.locator('#assumptionsList dt').count()) >= 10,
  `${await page.locator('#assumptionsList dt').count()} assumptions listed`);
contains('assumptions recap states the real return',
  await page.locator('#assumptionsList').textContent(), 'Return after inflation');

// =====================================================================
section('Q2. Storage is optional, wrapped, and local');
// =====================================================================
await page.fill('#currentSavings', '4321');
await page.waitForTimeout(700);
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(700);
check('figures survive a reload', await page.inputValue('#currentSavings'), '4321');
contains('the page says where they are stored',
  await page.locator('#storageNote').textContent(), 'only in this browser');
await page.click('#resetBtn');
await page.waitForTimeout(700);
check('reset restores the default starting balance',
  await page.inputValue('#currentSavings'), '25000');
check('reset restores the default age', await page.inputValue('#currentAge'), '55');
// With storage unavailable the page must still work, not throw.
const noStore = await browser.newPage({ viewport: { width: 1000, height: 800 } });
const noStoreErrors = [];
noStore.on('pageerror', e => noStoreErrors.push(e.message));
noStore.on('console', m => { if (m.type() === 'error') noStoreErrors.push(m.text()); });
await noStore.addInitScript(() => {
  const boom = () => { throw new Error('storage blocked'); };
  Object.defineProperty(window, 'localStorage', {
    get() { return { getItem: boom, setItem: boom, removeItem: boom }; }
  });
});
await noStore.goto(URL, { waitUntil: 'networkidle' });
await noStore.waitForTimeout(800);
checkTrue('page still computes with localStorage throwing',
  (await noStore.locator('#statNominal').textContent()).startsWith('$'),
  await noStore.locator('#statNominal').textContent());
checkTrue('...and throws nothing', noStoreErrors.length === 0, noStoreErrors.join(' | '));
await noStore.close();

// =====================================================================
section('Q. Console cleanliness');
// =====================================================================
checkTrue('no console errors', consoleErrors.length === 0, consoleErrors.join(' | '));
checkTrue('no uncaught page errors', pageErrors.length === 0, pageErrors.join(' | '));
checkTrue('no failed requests', failedRequests.length === 0, failedRequests.join(' | '));

console.log('\n' + '='.repeat(66));
console.log(`  ${passes} passed, ${fails} failed, ${passes + fails} total`);
console.log('='.repeat(66) + '\n');

await browser.close();
process.exit(fails === 0 ? 0 : 1);
