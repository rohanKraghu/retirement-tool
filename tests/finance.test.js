/*
 * finance.test.js — run with:  node tests/finance.test.js
 *
 * Every expected value below was worked out BY HAND first (the derivation is
 * written above each assertion) and only then compared against the code. That
 * ordering matters: a test that just records whatever the code printed proves
 * nothing. Where a value is irrational, the hand derivation is carried to ten
 * significant figures and the tolerance is set accordingly.
 */
'use strict';

var F = require('../assets/finance.js');

var passed = 0, failed = 0, currentSection = '';

function section(name) {
  currentSection = name;
  console.log('\n── ' + name + ' ' + '─'.repeat(Math.max(0, 62 - name.length)));
}

function ok(label, actual, expected, tol) {
  var t = tol == null ? 1e-9 : tol;
  var good = (expected === Infinity)
    ? actual === Infinity
    : Math.abs(actual - expected) <= t;
  if (good) {
    passed++;
    console.log('  PASS  ' + label);
    console.log('          expected ' + fmt(expected) + '   got ' + fmt(actual));
  } else {
    failed++;
    console.log('  FAIL  ' + label);
    console.log('          expected ' + fmt(expected) + '   got ' + fmt(actual)
      + '   (diff ' + fmt(actual - expected) + ', tolerance ' + t + ')');
  }
}

function okBool(label, actual, expected) {
  if (actual === expected) { passed++; console.log('  PASS  ' + label + '  (' + expected + ')'); }
  else { failed++; console.log('  FAIL  ' + label + '  expected ' + expected + ', got ' + actual); }
}

function fmt(v) {
  if (v === Infinity) return 'Infinity';
  if (!isFinite(v)) return String(v);
  return (Math.abs(v) >= 1e-6 && Math.abs(v) < 1e15)
    ? v.toFixed(Math.abs(v) >= 1000 ? 4 : 10).replace(/0+$/, '').replace(/\.$/, '')
    : v.toExponential(6);
}

// =====================================================================
section('1. Rate conversion: annual -> monthly');
// =====================================================================
/*
 * HAND COMPUTATION
 * We insist that an "annual return" is an EFFECTIVE annual rate, so twelve
 * monthly periods must compound to exactly one annual period.
 *
 * Pick i = 0.01 (1% a month) and compute the annual rate it implies:
 *   1.01^2  = 1.0201
 *   1.01^4  = 1.0201^2         = 1.04060401
 *   1.01^8  = 1.04060401^2     = 1.0828567056280801
 *   1.01^12 = 1.01^8 * 1.01^4  = 1.0828567056280801 * 1.04060401
 *           = 1.0828567056281 + 0.0433142682251 + 0.0006497140234 + 0.0000043422554
 *           = 1.1268250301320
 * So an effective annual rate of 0.1268250301320 must map back to exactly 0.01.
 */
var ANNUAL_FOR_1PCT_MONTH = 0.1268250301320;
ok('monthlyRate(12.68250301320%) = 0.01 exactly',
   F.monthlyRate(ANNUAL_FOR_1PCT_MONTH), 0.01, 1e-13);

// And the round trip: (1 + monthlyRate(r))^12 must be exactly (1 + r).
ok('(1 + monthlyRate(7%))^12 = 1.07',
   Math.pow(1 + F.monthlyRate(0.07), 12), 1.07, 1e-14);

// The naive shortcut r/12 would be WRONG. 0.07/12 = 0.00583333...; compounded
// twelve times that gives 1.0722900800...  — a 0.229 percentage-point error
// every single year. This assertion documents that we do NOT do that.
ok('monthlyRate(7%) is NOT 0.07/12 (difference is real)',
   Math.abs(F.monthlyRate(0.07) - 0.07 / 12) > 1e-5 ? 1 : 0, 1, 0);

ok('monthlyRate(0%) = 0', F.monthlyRate(0), 0, 0);

// =====================================================================
section('2. Real rate: Fisher, not subtraction');
// =====================================================================
/*
 * HAND COMPUTATION
 *   r_real = (1 + 0.07) / (1 + 0.03) - 1 = 1.07 / 1.03 - 1
 *   1.07 / 1.03: 1.03 * 1.0388349514563 = 1.07 (check: 1.03 * 1.0388349514563
 *                = 1.0388349514563 + 0.0311650485437 = 1.07000000000000)
 *   => r_real = 0.0388349514563  (3.88349514563%), NOT 0.04.
 */
ok('realRate(7%, 3%) = 0.0388349514563 (Fisher)',
   F.realRate(0.07, 0.03), 0.0388349514563, 1e-12);
ok('naive 7% - 3% = 4% overstates the real return by 0.116 points',
   0.04 - F.realRate(0.07, 0.03), 0.0011650485437, 1e-12);
ok('realRate(r, 0) = r', F.realRate(0.07, 0), 0.07, 1e-15);

// =====================================================================
section('3. fvAnnuity — clean hand-computable periods');
// =====================================================================
/*
 * HAND COMPUTATION — i = 1% per period, n = 3, PMT = 100, PV = 0.
 * END of period (ordinary annuity), stepping month by month:
 *   after 1:   0 * 1.01 + 100 = 100
 *   after 2: 100 * 1.01 + 100 = 201
 *   after 3: 201 * 1.01 + 100 = 303.01
 * Closed form: 100 * (1.01^3 - 1)/0.01 = 100 * (1.030301 - 1)/0.01
 *            = 100 * 3.0301 = 303.01   (agrees)
 */
ok('FV end-of-period, pv=0 pmt=100 i=1% n=3 -> 303.01',
   F.fvAnnuity(0, 100, 0.01, 3, 'end'), 303.01, 1e-10);
/*
 * BEGIN of period (annuity-due), stepping month by month:
 *   after 1: (  0 + 100) * 1.01 = 101
 *   after 2: (101 + 100) * 1.01 = 203.01
 *   after 3: (203.01 + 100) * 1.01 = 306.0401
 * Closed form: 303.01 * 1.01 = 306.0401   (agrees)
 */
ok('FV begin-of-period, same inputs -> 306.0401',
   F.fvAnnuity(0, 100, 0.01, 3, 'begin'), 306.0401, 1e-10);
/*
 * With a starting balance: PV = 1000.
 *   1000 * 1.01^3 = 1000 * 1.030301 = 1030.301
 *   plus the annuity 303.01  =>  1333.311
 */
ok('FV with pv=1000 -> 1333.311',
   F.fvAnnuity(1000, 100, 0.01, 3, 'end'), 1333.311, 1e-9);

// Timing relationship is exactly one extra period of growth.
ok('FV_begin = FV_end * (1 + i) for the annuity portion',
   F.fvAnnuity(0, 100, 0.01, 3, 'begin'),
   F.fvAnnuity(0, 100, 0.01, 3, 'end') * 1.01, 1e-10);

// =====================================================================
section('4. EDGE CASE — 0% return');
// =====================================================================
/*
 * HAND COMPUTATION
 * Nothing grows, so the balance is just what you put in:
 *   PV 1000 + 100/month for 10 years (120 months) = 1000 + 12000 = 13000
 */
ok('0% return: 1000 + 100 x 120 = 13000',
   F.fvAnnuity(1000, 100, 0, 120, 'end'), 13000, 1e-12);
ok('0% return, timing makes no difference',
   F.fvAnnuity(1000, 100, 0, 120, 'begin'), 13000, 1e-12);

var zeroPlan = F.buildAccumulation({
  currentAge: 55, retirementAge: 65, currentSavings: 1000,
  monthlyContribution: 100, annualReturn: 0, annualInflation: 0
});
ok('buildAccumulation with 0% return and 0% inflation -> 13000 nominal',
   zeroPlan.balanceNominal, 13000, 1e-9);
ok('...and growth is exactly 0', zeroPlan.totalGrowth, 0, 1e-9);

/*
 * HAND COMPUTATION — same plan, but 3% inflation. Deflate over 10 years:
 *   1.03^2  = 1.0609
 *   1.03^4  = 1.0609^2  = 1.12550881
 *   1.03^8  = 1.12550881^2 = 1.2667700813876161
 *   1.03^10 = 1.03^8 * 1.03^2 = 1.2667700813876161 * 1.0609 = 1.3439163793441223
 *   real = 13000 / 1.3439163793441223
 *   1 / 1.3439163793441223 = 0.7440939146  (check: 1.3439163793 * 0.7440939146
 *                                           = 0.99999999997)
 *   real = 13000 * 0.7440939146 = 9673.2208898
 * Note this is NOT 13000 - 30% = 9100. Deflation compounds too.
 */
var zeroPlanInfl = F.buildAccumulation({
  currentAge: 55, retirementAge: 65, currentSavings: 1000,
  monthlyContribution: 100, annualReturn: 0, annualInflation: 0.03
});
ok('0% return + 3% inflation: real value = 9673.2208898',
   zeroPlanInfl.balanceReal, 9673.2208898, 1e-4);
ok('nominal is unchanged at 13000', zeroPlanInfl.balanceNominal, 13000, 1e-9);

// =====================================================================
section('5. EDGE CASE — no contributions (lump sum only)');
// =====================================================================
/*
 * HAND COMPUTATION — 10000 at 7% for 10 years, nothing added.
 *   1.07^2  = 1.1449
 *   1.07^4  = 1.1449^2 = 1.31079601
 *   1.07^8  = 1.31079601^2
 *           = 1.31^2 + 2(1.31)(0.00079601) + 0.00079601^2
 *           = 1.7161 + 0.0020855462 + 0.0000006336 = 1.7181861798
 *   1.07^10 = 1.7181861798 * 1.1449
 *           = 1.7181861798 + 0.1718186180 + 0.0687274472
 *             + 0.0068727447 + 0.0015463676
 *           = 1.9671513573
 *   FV = 10000 * 1.9671513573 = 19671.513573
 */
var noContrib = F.buildAccumulation({
  currentAge: 50, retirementAge: 60, currentSavings: 10000,
  monthlyContribution: 0, annualReturn: 0.07, annualInflation: 0
});
ok('10000 at 7% for 10 years, no contributions -> 19671.513573',
   noContrib.balanceNominal, 19671.513573, 1e-5);
ok('own contributions are 0', noContrib.totalOwnContributions, 0, 0);
ok('growth = 19671.513573 - 10000 = 9671.513573',
   noContrib.totalGrowth, 9671.513573, 1e-5);

// Monthly compounding of an effective annual rate must reproduce the annual
// figure exactly — that is the whole point of using (1+r)^(1/12).
ok('monthly compounding reproduces 1.07^10 exactly',
   noContrib.balanceNominal, 10000 * Math.pow(1.07, 10), 1e-7);

// =====================================================================
section('6. EDGE CASE — retirement age equals current age');
// =====================================================================
/*
 * HAND COMPUTATION: zero months elapse, so nothing is contributed and nothing
 * grows. The answer must be exactly the starting balance, in both nominal and
 * real terms (deflating by (1+f)^0 = 1 changes nothing).
 */
var sameAge = F.buildAccumulation({
  currentAge: 67, retirementAge: 67, currentSavings: 250000,
  monthlyContribution: 900, annualReturn: 0.06, annualInflation: 0.025
});
ok('retire today: nominal = starting balance', sameAge.balanceNominal, 250000, 0);
ok('retire today: real = starting balance', sameAge.balanceReal, 250000, 0);
ok('retire today: nothing contributed', sameAge.totalOwnContributions, 0, 0);
ok('retire today: no growth', sameAge.totalGrowth, 0, 0);
ok('retire today: one table row (today only)', sameAge.rows.length, 1, 0);
ok('fvAnnuity with n = 0 returns pv', F.fvAnnuity(250000, 900, 0.005, 0, 'end'), 250000, 0);
// A negative span must not silently produce a number.
ok('retirementAge < currentAge is rejected',
   F.validate({ currentAge: 70, retirementAge: 65, currentSavings: 0,
                monthlyContribution: 0, annualReturn: 0.05, annualInflation: 0.02 }).length, 1, 0);

// =====================================================================
section('7. Simulation vs closed form (two independent methods)');
// =====================================================================
/*
 * buildAccumulation walks month by month; fvAnnuity uses the closed-form
 * future-value-of-annuity expression. They share no code path, so agreement is
 * real evidence. Plan: age 40 -> 65, 25000 start, 500/month, 7%.
 *   n = 25 * 12 = 300 months, i = 1.07^(1/12) - 1
 */
var plan = {
  currentAge: 40, retirementAge: 65, currentSavings: 25000,
  monthlyContribution: 500, annualReturn: 0.07, annualInflation: 0.025
};
var sim = F.buildAccumulation(plan);
var closed = F.fvAnnuity(25000, 500, F.monthlyRate(0.07), 300, 'end');
ok('month-by-month simulation = closed-form FV (end-of-period)',
   sim.balanceNominal, closed, 1e-6);

var simBegin = F.buildAccumulation(Object.assign({}, plan, { timing: 'begin' }));
var closedBegin = F.fvAnnuity(25000, 500, F.monthlyRate(0.07), 300, 'begin');
ok('...and for begin-of-period too', simBegin.balanceNominal, closedBegin, 1e-6);
okBool('begin-of-period beats end-of-period', simBegin.balanceNominal > sim.balanceNominal, true);

// Real value must equal nominal deflated by cumulative inflation — and, since
// deflation and compounding are both exponential, equal to compounding the
// exact real rate. Two routes to the same number.
ok('real = nominal / 1.025^25',
   sim.balanceReal, sim.balanceNominal / Math.pow(1.025, 25), 1e-7);
ok('lump-sum portion in real terms = PV * (1.07/1.025)^25',
   F.deflate(25000 * Math.pow(1.07, 25), 0.025, 25),
   25000 * Math.pow(F.realRate(0.07, 0.025) + 1, 25), 1e-6);

// The contributions/growth split must be exhaustive — no dollars invented,
// none lost.
ok('principal + growth = balance',
   sim.totalPrincipal + sim.totalGrowth, sim.balanceNominal, 1e-6);
/*
 * HAND COMPUTATION of principal: 25000 + 500 * 300 = 25000 + 150000 = 175000
 */
ok('principal = 25000 + 500 x 300 = 175000', sim.totalPrincipal, 175000, 1e-9);

// =====================================================================
section('8. Employer match');
// =====================================================================
/*
 * HAND COMPUTATION
 *   50% match on 500/month, uncapped      -> 250
 *   50% match on 500/month, capped at 200 -> min(250, 200) = 200
 *   0% match                              -> 0
 */
ok('50% of 500, uncapped', F.employerMatch(500, 50, 0), 250, 0);
ok('50% of 500, capped at 200', F.employerMatch(500, 50, 200), 200, 0);
ok('no match configured', F.employerMatch(500, 0, 0), 0, 0);
ok('no contribution, no match', F.employerMatch(0, 100, 0), 0, 0);

/*
 * HAND COMPUTATION — 0% return so the match arithmetic is visible:
 *   200/month of your own + 100/month match (50%) for 10 years (120 months)
 *   = 24000 own + 12000 match = 36000, plus 0 starting balance.
 */
var matched = F.buildAccumulation({
  currentAge: 30, retirementAge: 40, currentSavings: 0,
  monthlyContribution: 200, annualReturn: 0, annualInflation: 0,
  matchPercent: 50, matchCapMonthly: 0
});
ok('match: own contributions total 24000', matched.totalOwnContributions, 24000, 1e-9);
ok('match: employer total 12000', matched.totalEmployerMatch, 12000, 1e-9);
ok('match: balance 36000 at 0% return', matched.balanceNominal, 36000, 1e-9);

// =====================================================================
section('9. Contributions that rise with inflation');
// =====================================================================
/*
 * HAND COMPUTATION — 100/month, 2% inflation, 2 years, 0% return.
 *   Year 1: 100.00 x 12 = 1200
 *   Year 2: 100 x 1.02 = 102.00; 102 x 12 = 1224
 *   Total  = 2424 (and with a 0% return the balance is exactly that)
 */
var escalated = F.buildAccumulation({
  currentAge: 30, retirementAge: 32, currentSavings: 0,
  monthlyContribution: 100, annualReturn: 0, annualInflation: 0.02,
  escalateWithInflation: true
});
ok('escalating contributions: 1200 + 1224 = 2424',
   escalated.balanceNominal, 2424, 1e-9);
/*
 * And its real value: 2424 / 1.02^2 = 2424 / 1.0404 = 2329.8731257...
 *   1.0404 * 2329.87 = 2424.00... (check: 1.0404 * 2329.8731 = 2423.99999)
 */
ok('...real value 2424 / 1.0404 = 2329.8731257',
   escalated.balanceReal, 2329.8731257, 1e-5);

// =====================================================================
section('10. Sustainable withdrawal (level payment)');
// =====================================================================
/*
 * HAND COMPUTATION — annuity-due, PV = 1000, i = 1%/period, n = 3.
 * The three payments (start of each period) must have a present value of 1000:
 *   W * (1 + 1/1.01 + 1/1.01^2)
 *   1/1.01     = 0.9900990099
 *   1/1.01^2   = 0.9802960494
 *   sum        = 2.9703950593
 *   W = 1000 / 2.9703950593 = 336.655551
 *   (check: 2.9703950593 * 336 = 998.0527399; remainder 1.9472601;
 *           1.9472601 / 2.9703950593 = 0.655560 -> W = 336.65556)
 */
ok('pmtForPV annuity-due, pv=1000 i=1% n=3 -> 336.655551',
   F.pmtForPV(1000, 0.01, 3, 'begin'), 336.655551, 1e-5);
/*
 * Ordinary annuity for the same pot is smaller per payment... no: it is LARGER,
 * because each payment is deferred a period and so the pot has longer to earn.
 *   W_end = W_begin * 1.01 = 336.655551 * 1.01 = 340.022107
 */
ok('pmtForPV end-of-period = begin * 1.01',
   F.pmtForPV(1000, 0.01, 3, 'end'), 340.022107, 1e-5);

/*
 * HAND COMPUTATION — 0% real return, 300000 over 25 years.
 *   25 years x 12 = 300 monthly withdrawals
 *   300000 / 300 = 1000/month = 12000/year, exactly.
 */
ok('0% real return: 300000 over 25 years -> 12000/year',
   F.sustainableAnnualWithdrawal(300000, 0, 25), 12000, 1e-9);

// Round trip: a withdrawal sized to last N years must, when simulated, last
// exactly N years. Different code paths (closed form vs. month-by-month loop).
var W = F.sustainableAnnualWithdrawal(500000, 0.04, 30);
var lasted = F.yearsMoneyLasts(500000, W, 0.04, 60);
ok('round trip: sustainable withdrawal for 30 years lasts 30 years',
   lasted.years, 30, 1e-6);
okBool('...and is reported as depleted at the end', lasted.depleted, true);

// =====================================================================
section('11. EDGE CASE — withdrawal exceeds the balance');
// =====================================================================
/*
 * HAND COMPUTATION — 100,000 pot, 120,000/year (= 10,000/month), 0% return.
 * Withdrawals happen at the START of the month:
 *   month  1: 100000 -> 90000
 *   ...
 *   month 10:  10000 ->     0
 * Ten full withdrawals, then nothing. 10 / 12 = 0.8333333333 years.
 */
var overdraw = F.yearsMoneyLasts(100000, 120000, 0, 60);
ok('100000 pot, 120000/yr, 0% return -> 10/12 years', overdraw.years, 10 / 12, 1e-12);
okBool('...depleted', overdraw.depleted, true);

/*
 * HAND COMPUTATION — a final PARTIAL month. 95,000 pot, 10,000/month, 0%.
 *   Nine full withdrawals take it to 5,000. The tenth month can only cover
 *   5,000 of the 10,000 needed = half a month.
 *   (9 + 0.5) / 12 = 9.5 / 12 = 0.7916666667 years.
 */
var partial = F.yearsMoneyLasts(95000, 120000, 0, 60);
ok('95000 pot: 9 full months + a half month -> 9.5/12 years',
   partial.years, 9.5 / 12, 1e-12);
okBool('...depleted', partial.depleted, true);

/*
 * HAND COMPUTATION — the whole pot is exactly one month's spending.
 *   1000 pot, 12000/year = 1000/month, 0% return -> exactly 1/12 of a year.
 */
ok('one month of money -> 1/12 year', F.yearsMoneyLasts(1000, 12000, 0, 60).years, 1 / 12, 1e-12);

/* An empty pot with a positive withdrawal lasts no time at all. */
var empty = F.yearsMoneyLasts(0, 40000, 0.04, 60);
ok('empty pot -> 0 years', empty.years, 0, 0);
okBool('...depleted immediately', empty.depleted, true);

/* Withdrawing nothing never runs out. */
var never = F.yearsMoneyLasts(500000, 0, 0.04, 60);
ok('no withdrawal -> lasts forever', never.years, Infinity);
okBool('...not depleted', never.depleted, false);

/*
 * HAND COMPUTATION — withdrawing less than the real return earns means the pot
 * grows and survives the horizon. 1,000,000 at 4% real earns ~40,000/yr;
 * taking 20,000 must survive the full 60-year horizon.
 */
var sustainableForever = F.yearsMoneyLasts(1000000, 20000, 0.04, 60);
ok('under-spending survives the 60-year horizon', sustainableForever.years, 60, 0);
okBool('...and is not flagged as depleted', sustainableForever.depleted, false);

/*
 * REGRESSION: the schedule must close on the exact depletion point ONCE.
 * An earlier version pushed both the last whole-month row and the fractional
 * end row, producing two entries a few days apart — which drew two x-axis
 * labels on top of each other. Nothing here may be within a day of anything
 * else, and the final row must sit exactly at the reported end.
 */
var sched = F.yearsMoneyLasts(284370, 35000, 0.0244, 60);
var minGap = Infinity;
for (var si = 1; si < sched.rows.length; si++) {
  minGap = Math.min(minGap, sched.rows[si].year - sched.rows[si - 1].year);
}
okBool('no two schedule rows closer than a week apart', minGap > 1 / 52, true);
okBool('schedule rows are strictly increasing in time', minGap > 0, true);
ok('schedule ends exactly at the reported depletion year',
   sched.rows[sched.rows.length - 1].year, sched.years, 1e-12);
ok('schedule ends at zero', sched.rows[sched.rows.length - 1].balanceReal, 0, 0);
/*
 * And a schedule that does NOT deplete must still close on the horizon with
 * the balance that is actually left, not with a zero.
 */
var survives = F.yearsMoneyLasts(1000000, 20000, 0.04, 30);
ok('surviving schedule ends at the horizon',
   survives.rows[survives.rows.length - 1].year, 30, 1e-12);
okBool('surviving schedule still has money in the final row',
   survives.rows[survives.rows.length - 1].balanceReal > 1000000, true);

// =====================================================================
section('12. End-to-end project() and sensitivity');
// =====================================================================
/*
 * HAND COMPUTATION — a 0%-return, 0%-inflation plan so every number is
 * checkable by arithmetic alone:
 *   Age 60 -> 65 (5 years, 60 months), 100,000 start, 500/month.
 *   Balance   = 100000 + 500 * 60 = 130000, nominal and real (0% inflation).
 *   Taking 26,000/year = 2166.666../month: 130000 / 2166.666.. = 60 months
 *   = exactly 5 years.
 */
var e2e = F.project({
  currentAge: 60, retirementAge: 65, currentSavings: 100000,
  monthlyContribution: 500, annualReturn: 0, annualInflation: 0,
  withdrawalMode: 'duration', targetAnnualWithdrawal: 26000
});
ok('project(): balance 130000 nominal', e2e.accumulation.balanceNominal, 130000, 1e-9);
ok('project(): balance 130000 real', e2e.accumulation.balanceReal, 130000, 1e-9);
ok('project(): 26000/yr lasts exactly 5 years', e2e.drawdown.yearsLasted, 5, 1e-9);
ok('project(): money gone at age 70', e2e.drawdown.ageWhenGone, 70, 1e-9);

/*
 * The 'amount' mode is the inverse question: over those same 5 years, with a
 * 0% real return, the sustainable spend is 130000 / 5 = 26000/year.
 */
var e2eAmount = F.project({
  currentAge: 60, retirementAge: 65, currentSavings: 100000,
  monthlyContribution: 500, annualReturn: 0, annualInflation: 0,
  withdrawalMode: 'amount', targetYears: 5
});
ok('project(): sustainable spend over 5 years = 26000/yr',
   e2eAmount.drawdown.annualWithdrawalReal, 26000, 1e-9);

// Sensitivity: rows must be ordered and the baseline must match the plan.
var sens = F.sensitivity(plan, [-3, -1.5, 0, 1.5]);
ok('sensitivity returns 4 rows', sens.length, 4, 0);
ok('sensitivity baseline matches the plan exactly',
   sens[2].balanceNominal, sim.balanceNominal, 1e-9);
okBool('sensitivity is monotonically increasing in the return assumption',
   sens[0].balanceNominal < sens[1].balanceNominal
   && sens[1].balanceNominal < sens[2].balanceNominal
   && sens[2].balanceNominal < sens[3].balanceNominal, true);
/*
 * HAND COMPUTATION — the pessimistic row is 7% - 3% = 4%. Principal is
 * unchanged at 175000 regardless of the return, since you contribute the same
 * dollars either way.
 */
ok('pessimistic row uses 4%', sens[0].annualReturn, 0.04, 1e-15);
ok('principal is identical across all return assumptions',
   sens[0].totalPrincipal, sens[3].totalPrincipal, 1e-9);
// A return assumption cannot be pushed below 0% by the offset.
var clamped = F.sensitivity(Object.assign({}, plan, { annualReturn: 0.01 }), [-3, 0]);
ok('return assumption is clamped at 0%', clamped[0].annualReturn, 0, 0);

// =====================================================================
console.log('\n' + '='.repeat(66));
console.log('  ' + passed + ' passed, ' + failed + ' failed, ' + (passed + failed) + ' total');
console.log('='.repeat(66) + '\n');
process.exit(failed === 0 ? 0 : 1);
