# Retirement & Compound Interest Planner

A single-page retirement projection tool built for **Numeraldo**, a numeracy
nonprofit running financial-literacy workshops for seniors, teenagers and
first-time banking participants.

Most retirement calculators show you one big number. This one shows you the same
number twice — once as it would appear on a statement, and once in today's money
— because the second figure is the one that tells you what you can actually buy.
It also refuses to present a single return assumption as a forecast: every plan
is shown at four different return assumptions side by side.

**It is educational material, not financial advice.**

---

## Who it is for

Workshop attendees, many of them in their seventies, working through Roth IRA and
general retirement planning with a facilitator — and then taking a printed copy
home. That shaped the whole build:

| Requirement | How it is met |
|---|---|
| Readable without glasses-hunting | 18px default type; a four-step text-size control that scales the **entire** layout, chart labels included |
| Usable without a mouse | Every control keyboard-operable; the charts are focusable and readable with arrow keys |
| Usable with a screen reader | Real `<label>` for every input, `aria-live` on the plain-language summary, `aria-invalid` on bad fields, `<title>`/`<desc>` on every chart |
| Works on a phone | Single-column below 62rem, 44px minimum tap targets, no horizontal scrolling at 390px |
| Goes home on paper | A print stylesheet that drops the controls, keeps the inputs and every number, and repeats the disclaimer |
| Works in a church hall with no wifi | No webfonts, no CDN, no network calls of any kind after the page is open |
| Keeps nothing | All arithmetic client-side. Nothing is sent anywhere. The only storage is `localStorage` on the user's own device, and every access is wrapped in `try`/`catch` |

---

## Running it

Open `index.html`. That is the whole procedure — no build step, no server, no
dependencies, no npm install.

```
retirement-tool/
├── index.html              the page
├── assets/
│   ├── finance.js          all the mathematics (pure functions, no DOM)
│   ├── app.js              form handling, rendering, hand-written SVG charts
│   └── styles.css          screen, dark-mode and print styles
├── tests/
│   ├── finance.test.js     77 assertions against hand-computed values
│   └── browser.test.mjs    91 end-to-end checks in a real browser (optional)
├── README.md
└── .gitignore
```

`finance.js` is a UMD module: the browser gets `window.Finance`, Node gets
`module.exports`. The tests therefore exercise exactly the code the page runs.

### Running the tests

```sh
node tests/finance.test.js
```

Exit code 0 on success, no dependencies required. Every expected value in that
file was worked out by hand first — the derivation is written in a comment above
each assertion — and only then compared against the code.

### Running the browser checks (optional)

`tests/browser.test.mjs` drives the real page in a real browser: it types into
the form, reads the rendered output back, and checks it against the same
hand-computed figures. It also covers the things unit tests cannot — console
errors, horizontal overflow at 390px, contrast ratios, keyboard operation of the
charts, the print stylesheet, dark mode, and running from `file://` with the
network switched off.

This one needs Playwright, which is why it is kept separate from the arithmetic
tests and out of the app itself:

```sh
npx http-server -p 8200 -s .      # terminal 1, from the repo root
node tests/browser.test.mjs       # terminal 2
```

If Playwright is not installed the script says so and exits 0 rather than
failing. `PLAYWRIGHT_PATH=/path/to/playwright/index.mjs` points it at a global
install; `BASE_URL` points it at a different address.

---

## The mathematics

### 1. Rates are effective annual rates

A "7% return" here means the balance multiplies by exactly **1.07** over a year.
The monthly rate is therefore

```
i = (1 + r)^(1/12) − 1
```

**not** `r / 12`. Dividing by twelve and compounding monthly turns a stated 7%
into an actual 7.229% a year — a silent 0.23-point gift that compounds into a
large error over thirty years. The test suite pins this down: twelve monthly
periods must compound to exactly `1 + r`.

### 2. Future value of the accumulation phase

Standard future value of a present sum plus an annuity, over `n` months:

```
timing = end of month   (ordinary annuity, the default)
  FV = PV(1+i)^n  +  PMT · [ ((1+i)^n − 1) / i ]

timing = start of month (annuity-due)
  FV = PV(1+i)^n  +  PMT · [ ((1+i)^n − 1) / i ] · (1+i)

i = 0 (both timings)
  FV = PV + PMT·n
```

**Contribution timing is an explicit, user-visible choice**, because it is worth
one whole extra period of growth and most calculators never say which they use.
The default is **end of month**: it is the cautious assumption and it matches how
a payroll deferral actually behaves. Choosing start-of-month multiplies the
annuity term by `(1+i)` — no more, no less.

The page also runs a month-by-month simulation (needed for the contributions /
growth split and for optional inflation-linked contributions). The test suite
asserts that the simulation and the closed form agree to within 1e-6, which is a
genuine cross-check: two independent methods, one answer.

### 3. Employer match

```
match = min( contribution × matchPercent/100 , monthlyCap )     cap > 0
match =      contribution × matchPercent/100                    cap = 0
```

Added to the monthly deposit and tracked separately, so the year-by-year table
can show your money and your employer's money in different columns. Defaults to
zero, with a note in the form that individual IRAs (including Roth IRAs) have no
employer match — the workshop's main subject.

### 4. Real (inflation-adjusted) values

Future dollars are converted to today's dollars by **deflating**:

```
real = nominal / (1 + f)^years
```

The exact real rate of return is the Fisher relation:

```
r_real = (1 + r) / (1 + f) − 1
```

Not `r − f`. At 7% with 3% inflation the exact answer is **3.8835%**, not 4% —
the shortcut overstates the real return by 0.117 points every year. The
approximation is never used anywhere in the calculation. (The one place the page
mentions subtraction at all, it is labelled as an approximation in prose.)

### 5. The withdrawal phase

Withdrawals are modelled in **real terms**: a constant purchasing power each
month, which is what "I need $40,000 a year to live on" actually means. The
withdrawal is taken at the **start** of each month — you need the money before
the month happens — so it is an annuity-due.

This is equivalent to the nominal picture, exactly. Writing `Bₖ` for the nominal
balance and `wₖ = W(1+f)^(k/12)` for an inflation-escalating nominal withdrawal:

```
B(k+1) = (Bk − wk)(1 + i)

divide both sides by (1+f)^((k+1)/12), and write bk = Bk/(1+f)^(k/12):

b(k+1) = (bk − W) · (1+i)/(1+f) = (bk − W)(1 + i_real)
```

So simulating a constant real withdrawal against the real rate gives identical
answers to simulating an escalating nominal withdrawal against the nominal rate.
Nothing is lost, and the arithmetic stays legible.

**"How long will it last?"** — month-by-month simulation. A final month the
balance can only partly cover counts as that fraction of a month, so the answer
is continuous rather than jumping in whole months. If the withdrawal is smaller
than the real return earns, the pot never depletes and the tool says so instead
of printing a misleading number.

**"What can I spend?"** — the level annuity-due payment that exactly exhausts the
pot over `n` months:

```
PMT = PV · i / [ (1 − (1+i)^(−n)) · (1+i) ]
PMT = PV / n                                    when i = 0
```

The two are inverses, and the tests check the round trip: a withdrawal sized to
last 30 years, fed back into the simulation, lasts 30 years.

### 6. Sensitivity

The same plan recomputed at `r − 3`, `r − 1.5`, `r`, `r + 1.5` percentage points,
clamped at 0%. You contribute identical dollars in every row; only the guess
changes. The point is the spread, not any one row.

---

## Judgment calls worth knowing about

These are decisions where a defensible alternative exists. They are listed here
rather than buried, because the tool's whole argument is that assumptions should
be visible.

1. **Effective annual rates, monthly compounding.** Some calculators treat the
   entered rate as a nominal APR and divide by 12. That produces bigger, more
   flattering numbers. Treating it as an effective annual rate is the honest
   reading of "6% a year".
2. **End-of-month contributions by default.** The cautious choice. Exposed as a
   radio button so nobody has to guess which one they got.
3. **Contributions are fixed in dollar terms unless you tick the box.** Someone
   contributing $500/month for 25 years is contributing less real money every
   year. The default reflects what most people actually do; the checkbox models
   the better behaviour, and the form says what the difference means.
4. **A separate return assumption for retirement, defaulting lower (5% vs 6%).**
   Portfolios usually get more conservative after retirement. Two return fields
   is one more input than the brief called for, but assuming a 40-year-old's
   growth rate for a 90-year-old is the kind of quiet optimism this tool exists
   to argue against. Set both to the same number to disable it.
5. **The sensitivity floor is clamped at 0%.** A plan is not made honest by
   projecting a *negative* return for thirty straight years; it just produces a
   number nobody can act on.
6. **The "never runs out" horizon is 60 years.** Beyond that the projection is
   meaningless for a human lifespan, so the tool reports "does not run out"
   rather than a spuriously precise figure.
7. **Withdrawals are inflation-indexed by default**, and inputs are in today's
   dollars. This is the interpretation that matches how people talk about
   retirement income, but it is a modelling choice, and the first-year nominal
   equivalent is shown alongside so the choice is visible.

---

## What this deliberately does not model

Stated on the page as well as here, because omissions matter as much as formulas:

- **Sequence-of-returns risk.** Real returns are not a constant. A bad run of
  years just after you retire does far more damage than the same years later, and
  no fixed-rate model can show that. This is the single largest limitation.
- Taxes of any kind, contribution limits, required minimum distributions.
- Fees and expense ratios (which come straight off the return).
- Social Security, pensions, annuities, home equity.
- Healthcare and long-term-care costs.
- Any variation in contributions beyond a flat inflation link.

A fixed return assumption is a simplification, not a forecast. The sensitivity
table exists to make that unmissable.

---

## Accessibility and privacy notes

- Colour is never the only carrier of meaning: both charts have a legend, direct
  labels on the data ends, a dashed line style for the real-value series, and a
  full data table underneath.
- The chart palette was validated for colour-vision deficiency in both light and
  dark modes (worst adjacent-pair CVD ΔE 24.7 light / 26.8 dark, normal-vision
  ΔE 33.6 / 31.8, both series above 3:1 against their surface).
- Body text, hints, table cells and buttons all measured at 6:1 or better against
  their backgrounds — comfortably past the WCAG AA 4.5:1 minimum.
- `localStorage` remembers your figures and your text-size choice **on your
  device only**. Every read and write is wrapped in `try`/`catch`, so private
  browsing or blocked storage degrades to "does not remember", never to an error.
- There is no analytics, no telemetry, no external request of any kind.

---

## Licence

Made for Numeraldo's workshops. Educational use only. Not financial, tax or legal
advice.
