/*!
 * finance.js — retirement / compound-interest math.
 *
 * Pure functions, no dependencies, no I/O. Runs in the browser (window.Finance)
 * and in Node (module.exports) so the same code the page uses is the code the
 * tests check.
 *
 * ---------------------------------------------------------------------------
 * CONVENTIONS (stated once, used everywhere)
 * ---------------------------------------------------------------------------
 * 1. "Annual return" and "annual inflation" are EFFECTIVE ANNUAL rates.
 *    A 7% return means a balance multiplies by exactly 1.07 over one year.
 *    The monthly rate is therefore i = (1 + r)^(1/12) - 1, NOT r/12.
 *    (r/12 would quietly turn 7% into 7.229% a year. That is the sort of
 *    silent error this tool exists to avoid.)
 *
 * 2. Contributions are periodic (monthly) and their timing is EXPLICIT:
 *      timing 'end'   -> ordinary annuity: interest is credited first, then
 *                        the contribution lands. This is the default, and it
 *                        matches how a payroll deferral actually behaves.
 *      timing 'begin' -> annuity-due: the contribution lands first and earns
 *                        interest for that same period. Worth exactly one
 *                        extra period of growth: FV_begin = FV_end * (1 + i).
 *
 * 3. Real (inflation-adjusted) values are obtained by DEFLATING, never by
 *    subtracting rates:
 *      real = nominal / (1 + f)^years
 *    and the exact real rate of return is the Fisher relation
 *      r_real = (1 + r_nominal) / (1 + f) - 1
 *    The common "just subtract" shortcut (r - f) is only an approximation and
 *    is never used here except where the UI explicitly labels it as one.
 *
 * 4. Withdrawals in retirement are modelled in REAL terms: a constant
 *    purchasing power each month, which is what "I need $40,000 a year to
 *    live on" actually means. Simulating a constant real withdrawal against a
 *    real return is algebraically identical to simulating an
 *    inflation-escalating nominal withdrawal against a nominal return — see
 *    the proof in README.md — so nothing is lost and the arithmetic is
 *    cleaner. Withdrawals are taken at the START of each month (you need the
 *    money to live on before the month happens), i.e. an annuity-due.
 */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();            // Node / tests
  } else {
    root.Finance = factory();              // Browser
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Rates smaller than this in magnitude are treated as exactly zero, so the
  // annuity formulas (which divide by i) fall back to their linear limits.
  var EPS = 1e-12;
  // Dollar amounts below this are treated as zero (floating-point dust).
  var CENT_EPS = 1e-9;

  // ---------------------------------------------------------------------
  // Rate helpers
  // ---------------------------------------------------------------------

  /**
   * Effective monthly rate from an effective annual rate.
   * (1 + monthly)^12 === 1 + annual, exactly.
   */
  function monthlyRate(annualRate) {
    if (Math.abs(annualRate) < EPS) return 0;
    return Math.pow(1 + annualRate, 1 / 12) - 1;
  }

  /**
   * Exact (Fisher) real rate of return. NOT nominal - inflation.
   * 7% nominal with 3% inflation is 3.8835% real, not 4%.
   */
  function realRate(nominalAnnualRate, annualInflation) {
    return (1 + nominalAnnualRate) / (1 + annualInflation) - 1;
  }

  /** Convert a nominal dollar amount `years` in the future to today's dollars. */
  function deflate(nominalAmount, annualInflation, years) {
    return nominalAmount / Math.pow(1 + annualInflation, years);
  }

  // ---------------------------------------------------------------------
  // Core annuity mathematics
  // ---------------------------------------------------------------------

  /**
   * Future value of a present sum plus a level periodic payment.
   *
   *   timing 'end'   FV = PV(1+i)^n + PMT * [((1+i)^n - 1) / i]
   *   timing 'begin' FV = PV(1+i)^n + PMT * [((1+i)^n - 1) / i] * (1+i)
   *   i = 0          FV = PV + PMT * n        (both timings)
   *
   * @param {number} pv      starting balance
   * @param {number} pmt     payment per period
   * @param {number} i       rate per period (decimal, e.g. 0.01 for 1%)
   * @param {number} n       number of periods (>= 0)
   * @param {string} [timing] 'end' (default) or 'begin'
   */
  function fvAnnuity(pv, pmt, i, n, timing) {
    if (n <= 0) return pv;                       // no time has passed
    if (Math.abs(i) < EPS) return pv + pmt * n;  // zero-rate limit
    var growth = Math.pow(1 + i, n);
    var annuityFactor = (growth - 1) / i;
    if (timing === 'begin') annuityFactor *= (1 + i);
    return pv * growth + pmt * annuityFactor;
  }

  /**
   * Level payment that exactly exhausts `pv` over `n` periods at rate `i`.
   * The inverse of fvAnnuity's annuity part, solved for PMT.
   *
   *   timing 'end'   PMT = PV * i / (1 - (1+i)^-n)
   *   timing 'begin' PMT = PV * i / [(1 - (1+i)^-n) * (1+i)]
   *   i = 0          PMT = PV / n
   */
  function pmtForPV(pv, i, n, timing) {
    if (n <= 0) return 0;
    if (Math.abs(i) < EPS) return pv / n;
    var denom = 1 - Math.pow(1 + i, -n);
    if (timing === 'begin') denom *= (1 + i);
    return pv * i / denom;
  }

  // ---------------------------------------------------------------------
  // Employer match
  // ---------------------------------------------------------------------

  /**
   * Employer match on a monthly contribution.
   * @param {number} contribution     your own monthly contribution
   * @param {number} matchPercent     percent of YOUR contribution the employer adds (e.g. 50)
   * @param {number} matchCapMonthly  dollar cap on the match per month; 0 = uncapped
   */
  function employerMatch(contribution, matchPercent, matchCapMonthly) {
    if (!matchPercent || contribution <= 0) return 0;
    var raw = contribution * (matchPercent / 100);
    if (matchCapMonthly > 0) return Math.min(raw, matchCapMonthly);
    return raw;
  }

  // ---------------------------------------------------------------------
  // Accumulation: from today to the retirement date
  // ---------------------------------------------------------------------

  /**
   * Month-by-month accumulation, aggregated into one row per year.
   *
   * Simulating month by month (rather than only using the closed form) lets us
   * support optional contribution escalation and report the
   * contributions-vs-growth split at every point. The test suite asserts that
   * this simulation agrees with fvAnnuity() to within a rounding error when
   * escalation is off — two independent methods, same answer.
   *
   * @param {Object} o
   * @param {number} o.currentAge
   * @param {number} o.retirementAge
   * @param {number} o.currentSavings
   * @param {number} o.monthlyContribution
   * @param {number} o.annualReturn        effective annual, decimal
   * @param {number} o.annualInflation     effective annual, decimal
   * @param {number} [o.matchPercent]
   * @param {number} [o.matchCapMonthly]
   * @param {boolean} [o.escalateWithInflation] raise the contribution each year with inflation
   * @param {string} [o.timing] 'end' (default) or 'begin'
   */
  function buildAccumulation(o) {
    var timing = o.timing === 'begin' ? 'begin' : 'end';
    var years = Math.max(0, o.retirementAge - o.currentAge);
    var i = monthlyRate(o.annualReturn);
    var f = o.annualInflation || 0;
    var escalate = !!o.escalateWithInflation;

    var balance = o.currentSavings;
    var ownToDate = 0;
    var matchToDate = 0;

    // Row 0 = today, before any contribution or growth.
    var rows = [{
      year: 0,
      age: o.currentAge,
      ownContributions: 0,
      employerMatch: 0,
      principal: o.currentSavings,             // starting balance + everything paid in
      growth: 0,
      balanceNominal: balance,
      balanceReal: balance                     // today's dollars are already today's dollars
    }];

    for (var y = 0; y < years; y++) {
      // Contribution for this whole year. If escalation is on, it keeps pace
      // with inflation so its purchasing power stays constant.
      var contrib = o.monthlyContribution * (escalate ? Math.pow(1 + f, y) : 1);
      var match = employerMatch(contrib, o.matchPercent || 0, o.matchCapMonthly || 0);
      var deposit = contrib + match;

      for (var m = 0; m < 12; m++) {
        if (timing === 'begin') {
          balance = (balance + deposit) * (1 + i);
        } else {
          balance = balance * (1 + i) + deposit;
        }
        ownToDate += contrib;
        matchToDate += match;
      }

      var elapsed = y + 1;
      var principal = o.currentSavings + ownToDate + matchToDate;
      rows.push({
        year: elapsed,
        age: o.currentAge + elapsed,
        ownContributions: ownToDate,
        employerMatch: matchToDate,
        principal: principal,
        growth: balance - principal,
        balanceNominal: balance,
        balanceReal: deflate(balance, f, elapsed)
      });
    }

    var last = rows[rows.length - 1];
    var totalPrincipal = o.currentSavings + ownToDate + matchToDate;

    return {
      rows: rows,
      years: years,
      months: years * 12,
      monthlyReturnRate: i,
      timing: timing,
      startingBalance: o.currentSavings,
      totalOwnContributions: ownToDate,
      totalEmployerMatch: matchToDate,
      totalPrincipal: totalPrincipal,
      totalGrowth: last.balanceNominal - totalPrincipal,
      balanceNominal: last.balanceNominal,
      balanceReal: last.balanceReal
    };
  }

  // ---------------------------------------------------------------------
  // Drawdown: spending the money in retirement
  // ---------------------------------------------------------------------

  /**
   * How long does a pot last if you take a constant real withdrawal?
   *
   * Everything here is in TODAY'S dollars against the REAL rate of return, so
   * the withdrawal automatically keeps pace with inflation.
   *
   * @returns {{years:number, depleted:boolean, rows:Array, monthsFull:number}}
   *          `years` is fractional: a final partial month counts as the
   *          fraction of a full withdrawal the remaining balance could cover.
   *          `depleted:false` means it survived the whole `maxYears` horizon.
   */
  function yearsMoneyLasts(realBalance, realAnnualWithdrawal, realAnnualReturn, maxYears) {
    var horizon = maxYears == null ? 60 : maxYears;
    var rows = [{ year: 0, balanceReal: realBalance, withdrawnReal: 0 }];

    if (realAnnualWithdrawal <= 0) {
      // Taking nothing out: it never runs out.
      return { years: Infinity, depleted: false, rows: rows, monthsFull: Infinity };
    }
    if (realBalance <= CENT_EPS) {
      return { years: 0, depleted: true, rows: rows, monthsFull: 0 };
    }

    var i = monthlyRate(realAnnualReturn);
    var w = realAnnualWithdrawal / 12;
    var balance = realBalance;
    var withdrawn = 0;
    var months = 0;            // whole months of full withdrawals survived
    var partial = 0;           // fraction of one final month the remainder covers
    var maxMonths = Math.round(horizon * 12);
    var depleted = false;

    while (months < maxMonths) {
      if (balance <= CENT_EPS) { depleted = true; break; }   // exactly exhausted
      if (balance < w) {                                     // one last partial month
        partial = balance / w;
        withdrawn += balance;
        balance = 0;
        depleted = true;
        break;
      }
      balance = (balance - w) * (1 + i);                     // withdraw, then grow
      withdrawn += w;
      months += 1;
      if (months % 12 === 0) {
        rows.push({ year: months / 12, balanceReal: Math.max(0, balance), withdrawnReal: withdrawn });
      }
    }

    var years = depleted ? (months + partial) / 12 : horizon;
    // Close the schedule on the exact end point — but only if the yearly loop
    // did not already land there, or the chart draws two labels on top of
    // each other a few days apart.
    if (Math.abs(rows[rows.length - 1].year - years) > 1e-9) {
      rows.push({
        year: years,
        balanceReal: depleted ? 0 : Math.max(0, balance),
        withdrawnReal: withdrawn
      });
    }
    return { years: years, depleted: depleted, rows: rows, monthsFull: months };
  }

  /**
   * The level real annual withdrawal that exactly exhausts the pot over
   * `years`, taken at the start of each month (annuity-due).
   */
  function sustainableAnnualWithdrawal(realBalance, realAnnualReturn, years) {
    var n = Math.round(years * 12);
    if (n <= 0 || realBalance <= 0) return 0;
    var i = monthlyRate(realAnnualReturn);
    return pmtForPV(realBalance, i, n, 'begin') * 12;
  }

  // ---------------------------------------------------------------------
  // Whole-plan orchestration
  // ---------------------------------------------------------------------

  /** Validate user input; returns an array of plain-language problems. */
  function validate(o) {
    var errs = [];
    var num = function (v) { return typeof v === 'number' && isFinite(v); };
    if (!num(o.currentAge) || o.currentAge < 0 || o.currentAge > 120) {
      errs.push('Current age must be a number between 0 and 120.');
    }
    if (!num(o.retirementAge) || o.retirementAge < 0 || o.retirementAge > 120) {
      errs.push('Retirement age must be a number between 0 and 120.');
    }
    if (num(o.currentAge) && num(o.retirementAge) && o.retirementAge < o.currentAge) {
      errs.push('Retirement age cannot be earlier than your current age.');
    }
    if (!num(o.currentSavings) || o.currentSavings < 0) {
      errs.push('Current savings cannot be negative.');
    }
    if (!num(o.monthlyContribution) || o.monthlyContribution < 0) {
      errs.push('Monthly contribution cannot be negative.');
    }
    if (!num(o.annualReturn) || o.annualReturn <= -1) {
      errs.push('Expected annual return must be greater than -100%.');
    }
    if (!num(o.annualInflation) || o.annualInflation <= -1) {
      errs.push('Expected inflation must be greater than -100%.');
    }
    return errs;
  }

  /**
   * Run a full plan: accumulation, then the requested drawdown question.
   *
   * @param {Object} o accumulation inputs (see buildAccumulation) plus:
   * @param {string} [o.withdrawalMode] 'duration' (how long does it last, given
   *        a target spend) or 'amount' (what can I spend, given a target span)
   * @param {number} [o.targetAnnualWithdrawal] today's dollars per year
   * @param {number} [o.targetYears] years the money should last
   * @param {number} [o.retirementReturn] annual nominal return during retirement;
   *        defaults to the accumulation return
   */
  function project(o) {
    var errors = validate(o);
    if (errors.length) return { errors: errors };

    var acc = buildAccumulation(o);
    var f = o.annualInflation || 0;
    var retReturn = (typeof o.retirementReturn === 'number' && isFinite(o.retirementReturn))
      ? o.retirementReturn : o.annualReturn;
    var realRetReturn = realRate(retReturn, f);

    var drawdown = null;
    if (o.withdrawalMode === 'amount') {
      var targetYears = Math.max(0, o.targetYears || 0);
      var sustainable = sustainableAnnualWithdrawal(acc.balanceReal, realRetReturn, targetYears);
      drawdown = {
        mode: 'amount',
        targetYears: targetYears,
        annualWithdrawalReal: sustainable,
        monthlyWithdrawalReal: sustainable / 12,
        // What that same purchasing power costs in the dollars of the first
        // year of retirement — useful context, clearly labelled in the UI.
        annualWithdrawalNominalAtRetirement: sustainable * Math.pow(1 + f, acc.years),
        realAnnualReturn: realRetReturn,
        schedule: yearsMoneyLasts(acc.balanceReal, sustainable, realRetReturn, Math.max(targetYears, 1))
      };
    } else {
      var target = Math.max(0, o.targetAnnualWithdrawal || 0);
      var lasted = yearsMoneyLasts(acc.balanceReal, target, realRetReturn, 60);
      drawdown = {
        mode: 'duration',
        annualWithdrawalReal: target,
        monthlyWithdrawalReal: target / 12,
        annualWithdrawalNominalAtRetirement: target * Math.pow(1 + f, acc.years),
        realAnnualReturn: realRetReturn,
        yearsLasted: lasted.years,
        depleted: lasted.depleted,
        ageWhenGone: lasted.depleted ? o.retirementAge + lasted.years : null,
        schedule: lasted
      };
    }

    return {
      errors: [],
      input: o,
      accumulation: acc,
      drawdown: drawdown,
      realAnnualReturnAccumulation: realRate(o.annualReturn, f)
    };
  }

  /**
   * The same plan under several different return assumptions.
   * This is the "one number is not a promise" view.
   *
   * @param {Object} o    the plan
   * @param {number[]} deltas percentage-point offsets, e.g. [-3, -1.5, 0, 1.5]
   */
  function sensitivity(o, deltas) {
    var offsets = deltas || [-3, -1.5, 0, 1.5];
    return offsets.map(function (d) {
      // Clamp at 0%: a plan is not made honest by projecting a negative return
      // for 30 straight years, and the point of the row is the spread.
      var rate = Math.max(0, o.annualReturn + d / 100);
      var variant = Object.assign({}, o, { annualReturn: rate, retirementReturn: rate });
      var acc = buildAccumulation(variant);
      return {
        delta: d,
        annualReturn: rate,
        isBaseline: d === 0,
        balanceNominal: acc.balanceNominal,
        balanceReal: acc.balanceReal,
        totalPrincipal: acc.totalPrincipal,
        totalGrowth: acc.totalGrowth
      };
    });
  }

  return {
    EPS: EPS,
    monthlyRate: monthlyRate,
    realRate: realRate,
    deflate: deflate,
    fvAnnuity: fvAnnuity,
    pmtForPV: pmtForPV,
    employerMatch: employerMatch,
    buildAccumulation: buildAccumulation,
    yearsMoneyLasts: yearsMoneyLasts,
    sustainableAnnualWithdrawal: sustainableAnnualWithdrawal,
    sensitivity: sensitivity,
    validate: validate,
    project: project
  };
});
