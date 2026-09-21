/*!
 * app.js — user interface for the Numeraldo retirement planner.
 *
 * All arithmetic lives in finance.js. This file only reads the form, asks
 * finance.js for an answer, and paints it. No network, no dependencies.
 * Charts are hand-written inline SVG.
 */
(function () {
  'use strict';

  var F = window.Finance;
  if (!F) { return; }

  // =====================================================================
  // Formatting
  // =====================================================================

  var money0 = new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD',
    minimumFractionDigits: 0, maximumFractionDigits: 0
  });

  /** Whole dollars. Anything below a dollar reads as "$0", which is honest. */
  function money(v) {
    if (!isFinite(v)) return '—';
    return money0.format(Math.round(v));
  }

  /** Compact form for chart axes, where space is tight. */
  function moneyAxis(v) {
    var a = Math.abs(v);
    if (a >= 1e9) return '$' + trim(v / 1e9) + 'B';
    if (a >= 1e6) return '$' + trim(v / 1e6) + 'M';
    if (a >= 1e3) return '$' + trim(v / 1e3) + 'K';
    return '$' + Math.round(v);
  }
  function trim(n) {
    var s = n.toFixed(n < 10 ? 1 : 0);
    return s.replace(/\.0$/, '');
  }

  /** Rates are stored as decimals and shown as percentages. */
  function pct(v) {
    var s = (v * 100).toFixed(2).replace(/0$/, '').replace(/\.0?$/, '');
    return s + '%';
  }

  /** "24 years and 7 months" — plainer than "24.6 years". */
  function yearsText(v) {
    if (!isFinite(v)) return 'indefinitely';
    var whole = Math.floor(v + 1e-9);
    var months = Math.round((v - whole) * 12);
    if (months === 12) { whole += 1; months = 0; }
    var parts = [];
    if (whole > 0) parts.push(whole + (whole === 1 ? ' year' : ' years'));
    if (months > 0) parts.push(months + (months === 1 ? ' month' : ' months'));
    if (!parts.length) return 'less than a month';
    return parts.join(' and ');
  }

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  var $ = function (id) { return document.getElementById(id); };

  // =====================================================================
  // Reading the form
  // =====================================================================

  var DEFAULTS = {
    currentAge: 55, retirementAge: 67, currentSavings: 25000,
    monthlyContribution: 500, matchPercent: 0, matchCapMonthly: 0,
    escalate: false, annualReturn: 6, annualInflation: 2.5,
    timing: 'end', withdrawalMode: 'duration',
    targetAnnualWithdrawal: 30000, targetYears: 30, retirementReturn: 5
  };

  var NUMBER_FIELDS = ['currentAge', 'retirementAge', 'currentSavings',
    'monthlyContribution', 'matchPercent', 'matchCapMonthly', 'annualReturn',
    'annualInflation', 'targetAnnualWithdrawal', 'targetYears', 'retirementReturn'];

  function num(id) {
    var el = $(id);
    var v = parseFloat(el.value);
    return isFinite(v) ? v : NaN;
  }

  function radioValue(name) {
    var el = document.querySelector('input[name="' + name + '"]:checked');
    return el ? el.value : null;
  }

  /** Form values -> the shape finance.js expects (rates as decimals). */
  function readForm() {
    return {
      currentAge: num('currentAge'),
      retirementAge: num('retirementAge'),
      currentSavings: num('currentSavings'),
      monthlyContribution: num('monthlyContribution'),
      matchPercent: num('matchPercent') || 0,
      matchCapMonthly: num('matchCapMonthly') || 0,
      escalateWithInflation: $('escalate').checked,
      annualReturn: num('annualReturn') / 100,
      annualInflation: num('annualInflation') / 100,
      retirementReturn: num('retirementReturn') / 100,
      timing: radioValue('timing') || 'end',
      withdrawalMode: radioValue('withdrawalMode') || 'duration',
      targetAnnualWithdrawal: num('targetAnnualWithdrawal') || 0,
      targetYears: num('targetYears') || 0
    };
  }

  // =====================================================================
  // Saving the form — on this device only, and never fatal if unavailable
  // =====================================================================

  var STORE_KEY = 'numeraldo.retirement.v1';

  function saveForm() {
    try {
      var data = {};
      NUMBER_FIELDS.forEach(function (id) { data[id] = $(id).value; });
      data.escalate = $('escalate').checked;
      data.timing = radioValue('timing');
      data.withdrawalMode = radioValue('withdrawalMode');
      window.localStorage.setItem(STORE_KEY, JSON.stringify(data));
      return true;
    } catch (e) {
      // Private browsing, blocked cookies, full quota — all fine. The tool
      // works perfectly well without remembering anything.
      return false;
    }
  }

  function loadForm() {
    var raw;
    try { raw = window.localStorage.getItem(STORE_KEY); } catch (e) { return false; }
    if (!raw) return false;
    try {
      var data = JSON.parse(raw);
      NUMBER_FIELDS.forEach(function (id) {
        if (typeof data[id] === 'string' && data[id] !== '') $(id).value = data[id];
      });
      if (typeof data.escalate === 'boolean') $('escalate').checked = data.escalate;
      if (data.timing) { var t = $('timing-' + data.timing); if (t) t.checked = true; }
      if (data.withdrawalMode) { var m = $('mode-' + data.withdrawalMode); if (m) m.checked = true; }
      return true;
    } catch (e) { return false; }
  }

  function clearSaved() {
    try { window.localStorage.removeItem(STORE_KEY); } catch (e) { /* nothing to do */ }
  }

  // =====================================================================
  // Chart helpers
  // =====================================================================

  /*
   * Chart geometry is recomputed before every draw. Two reasons:
   *  - The viewBox is sized to the container's pixel width, so the SVG renders
   *    at roughly 1:1. A fixed 760-unit viewBox squeezed into a 325px phone
   *    column renders 13-unit axis labels at 5.6px, which this audience
   *    cannot read.
   *  - Every dimension is a multiple of the chart font size, which follows the
   *    page's text-size control. Turning the text up turns the chart up too.
   */
  var VB_W = 760, VB_H = 330, CFS = 13, NARROW = false;
  var M = { top: 18, right: 100, bottom: 46, left: 80 };
  var PLOT_W = 580, PLOT_H = 266;

  function setGeometry(wrap) {
    var rootPx = parseFloat(getComputedStyle(document.documentElement).fontSize) || 18;
    VB_W = Math.max(320, Math.min(900, Math.round(wrap.clientWidth || 760)));
    CFS = Math.max(11, Math.round(13 * rootPx / 18));
    NARROW = VB_W < 520;
    M = {
      top:    Math.round(CFS * 2.4),
      right:  Math.round(CFS * (NARROW ? 4.6 : 9.0)),
      bottom: Math.round(CFS * 3.4),
      left:   Math.round(CFS * (NARROW ? 4.3 : 4.8))
    };
    VB_H = Math.max(240, Math.round(VB_W * (NARROW ? 0.84 : 0.44)));
    PLOT_W = VB_W - M.left - M.right;
    PLOT_H = VB_H - M.top - M.bottom;
  }

  /**
   * Choose a readable y axis: pick a round gridline step near max/4, then set
   * the axis top to the next whole multiple of it. Rounding the top up to the
   * next power of ten instead (527,207 -> $1M) would waste half the plot and
   * flatten the very curve the chart exists to show.
   */
  function niceStep(raw) {
    if (!(raw > 0)) return 1;
    var base = Math.pow(10, Math.floor(Math.log10(raw)));
    var n = raw / base;
    var mult = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
    return mult * base;
  }

  /** @returns {{max:number, ticks:number[]}} */
  function niceAxis(maxValue, targetIntervals) {
    var target = targetIntervals || 4;
    if (!(maxValue > 0)) return { max: 1, ticks: [0, 1] };
    var step = niceStep(maxValue / target);
    var max = Math.ceil(maxValue / step - 1e-9) * step;
    var ticks = [];
    for (var v = 0; v <= max + step * 1e-9; v += step) ticks.push(v);
    return { max: max, ticks: ticks };
  }

  /**
   * Evenly spaced x labels that always include the first and last value.
   * If the final label would land on top of its neighbour, it replaces it
   * rather than being squeezed in beside it.
   */
  function pickXTicks(values, target) {
    var n = values.length;
    if (n <= target) return values.map(function (v, i) { return i; });
    var stride = Math.ceil((n - 1) / (target - 1));
    var idx = [];
    for (var i = 0; i < n; i += stride) idx.push(i);
    var last = idx[idx.length - 1];
    if (last !== n - 1) {
      if ((n - 1) - last < stride * 0.6) idx[idx.length - 1] = n - 1;
      else idx.push(n - 1);
    }
    return idx;
  }

  function path(points) {
    return points.map(function (p, i) {
      return (i ? 'L' : 'M') + p[0].toFixed(2) + ' ' + p[1].toFixed(2);
    }).join(' ');
  }

  /** Shared axis furniture for both charts. */
  function axisMarkup(xIdx, xLabels, yTicks, yMax, xTitle, yTitle) {
    var out = '';
    var tick = ' font-size="' + CFS + '"';
    var title = ' font-size="' + (CFS + 1) + '"';
    yTicks.forEach(function (t) {
      var y = M.top + PLOT_H - (t / yMax) * PLOT_H;
      out += '<line class="chart-grid" x1="' + M.left + '" y1="' + y.toFixed(1) +
             '" x2="' + (M.left + PLOT_W) + '" y2="' + y.toFixed(1) + '"/>';
      out += '<text class="chart-tick"' + tick + ' x="' + (M.left - 8) + '" y="' +
             (y + CFS * 0.35).toFixed(1) + '" text-anchor="end">' + esc(moneyAxis(t)) + '</text>';
    });
    xIdx.forEach(function (i) {
      var x = xLabels.x(i);
      out += '<text class="chart-tick"' + tick + ' x="' + x.toFixed(1) + '" y="' +
             (M.top + PLOT_H + CFS * 1.5).toFixed(1) +
             '" text-anchor="middle">' + esc(xLabels.label(i)) + '</text>';
    });
    out += '<line class="chart-axis" x1="' + M.left + '" y1="' + (M.top + PLOT_H) +
           '" x2="' + (M.left + PLOT_W) + '" y2="' + (M.top + PLOT_H) + '"/>';
    out += '<text class="chart-axis-title"' + title + ' x="' + (M.left + PLOT_W / 2) +
           '" y="' + (VB_H - 4) + '" text-anchor="middle">' + esc(xTitle) + '</text>';
    // Anchored to the left edge of the viewBox, never to the axis: a long
    // title anchored at the axis runs off the left of a narrow chart.
    out += '<text class="chart-axis-title"' + title + ' x="2" y="' +
           (M.top - CFS * 1.05).toFixed(1) + '" text-anchor="start">' + esc(yTitle) + '</text>';
    return out;
  }

  function emptyChart(wrap, message) {
    wrap.querySelectorAll('svg').forEach(function (n) { n.remove(); });
    var p = wrap.querySelector('.chart-empty');
    if (!p) {
      p = document.createElement('p');
      p.className = 'chart-empty card-note';
      wrap.appendChild(p);
    }
    p.textContent = message;
  }
  function clearEmpty(wrap) {
    var p = wrap.querySelector('.chart-empty');
    if (p) p.remove();
  }

  // =====================================================================
  // Chart 1 — accumulation: money in, growth on top, real value as a line
  // =====================================================================

  function renderAccumChart(acc, inflation) {
    var wrap = $('chartAccumWrap');
    var rows = acc.rows;

    setGeometry(wrap);
    if (rows.length < 2) {
      emptyChart(wrap, 'There is nothing to chart yet — your retirement age is the same as your age today, so no time passes.');
      $('chartCaption').textContent = '';
      return;
    }
    clearEmpty(wrap);

    var yAxis = niceAxis(rows[rows.length - 1].balanceNominal, NARROW ? 3 : 4);
    var yMax = yAxis.max, yTicks = yAxis.ticks;
    var n = rows.length;
    var X = function (i) { return M.left + (n === 1 ? 0 : (i / (n - 1)) * PLOT_W); };
    var Y = function (v) { return M.top + PLOT_H - (Math.max(0, v) / yMax) * PLOT_H; };

    var putIn = [], total = [], real = [];
    rows.forEach(function (r, i) {
      putIn.push([X(i), Y(r.principal)]);
      total.push([X(i), Y(r.balanceNominal)]);
      real.push([X(i), Y(r.balanceReal)]);
    });

    var base = M.top + PLOT_H;
    // Band 1: everything you paid in (starting balance + contributions + match).
    var areaPutIn = path(putIn) + ' L' + X(n - 1).toFixed(2) + ' ' + base +
                    ' L' + X(0).toFixed(2) + ' ' + base + ' Z';
    // Band 2: the growth sitting on top of it.
    var areaGrowth = path(total) + ' ' +
                     putIn.slice().reverse().map(function (p, i) {
                       return 'L' + p[0].toFixed(2) + ' ' + p[1].toFixed(2);
                     }).join(' ') + ' Z';

    var titleId = 'accum-title', descId = 'accum-desc';
    var svg = '<svg viewBox="0 0 ' + VB_W + ' ' + VB_H + '" role="img" tabindex="0" ' +
      'aria-labelledby="' + titleId + ' ' + descId + '" preserveAspectRatio="xMidYMid meet">' +
      '<title id="' + titleId + '">Your balance from age ' + rows[0].age + ' to age ' +
        rows[n - 1].age + '</title>' +
      '<desc id="' + descId + '">A stacked area chart. The lower blue band is the money you ' +
        'pay in, the orange band on top is investment growth, and the dashed line is what ' +
        'the balance would be worth in today’s money. The same figures appear in the ' +
        'year-by-year table below.</desc>';

    svg += axisMarkup(pickXTicks(rows, NARROW ? 5 : 7),
      { x: X, label: function (i) { return String(rows[i].age); } },
      yTicks, yMax, 'Your age', 'Balance');

    svg += '<path d="' + areaPutIn + '" fill="var(--series-put-in)" fill-opacity="0.92"/>';
    svg += '<path d="' + areaGrowth + '" fill="var(--series-growth)" fill-opacity="0.92"/>';
    // 2px surface-coloured gap between the stacked bands, per the mark spec.
    svg += '<path d="' + path(putIn) + '" fill="none" stroke="var(--surface)" stroke-width="2"/>';
    // The honest line: real (inflation-adjusted) balance.
    svg += '<path d="' + path(real) + '" fill="none" stroke="var(--surface)" stroke-width="4.5" stroke-opacity="0.85"/>';
    svg += '<path d="' + path(real) + '" fill="none" stroke="var(--ink)" stroke-width="2.5" ' +
           'stroke-dasharray="7 5" stroke-linecap="round"/>';

    // Direct labels at the right edge, so the two ends are readable without
    // chasing the legend.
    var lastTotal = total[n - 1], lastReal = real[n - 1];
    var sep = Math.abs(lastTotal[1] - lastReal[1]) < CFS * 1.6 ? CFS * 0.8 : 0;
    var eLab = ' font-size="' + (CFS + 1) + '"', eTick = ' font-size="' + CFS + '"';
    svg += '<text class="chart-endlabel"' + eLab + ' x="' + (lastTotal[0] + 7) + '" y="' +
           (lastTotal[1] - 4 - sep).toFixed(1) + '" fill="var(--series-growth)">' +
           esc(moneyAxis(rows[n - 1].balanceNominal)) + '</text>';
    svg += '<text class="chart-endlabel"' + eLab + ' x="' + (lastReal[0] + 7) + '" y="' +
           (lastReal[1] + CFS + 3 + sep).toFixed(1) + '" fill="var(--ink)">' +
           esc(moneyAxis(rows[n - 1].balanceReal)) + '</text>';
    // The wordy half of the direct label only fits on a wide chart; on a phone
    // the legend and the tap-to-read tooltip carry it instead.
    if (!NARROW) {
      svg += '<text class="chart-tick"' + eTick + ' x="' + (lastTotal[0] + 7) + '" y="' +
             (lastTotal[1] + CFS - 3 - sep).toFixed(1) + '">on paper</text>';
      svg += '<text class="chart-tick"' + eTick + ' x="' + (lastReal[0] + 7) + '" y="' +
             (lastReal[1] + CFS * 2 + 4 + sep).toFixed(1) + '">in today’s money</text>';
    }

    // Hover / keyboard read-out layer.
    svg += '<g id="accumCursor" opacity="0">' +
      '<line y1="' + M.top + '" y2="' + base + '" stroke="var(--ink)" stroke-width="1.5" stroke-dasharray="3 3"/>' +
      '<circle r="6" fill="var(--series-growth)" stroke="var(--surface)" stroke-width="2"/>' +
      '<circle r="6" fill="var(--ink)" stroke="var(--surface)" stroke-width="2"/>' +
      '</g>';
    svg += '<rect id="accumHit" x="' + M.left + '" y="' + M.top + '" width="' + PLOT_W +
           '" height="' + PLOT_H + '" fill="transparent"/>';
    svg += '</svg>';

    wrap.querySelectorAll('svg').forEach(function (nSvg) { nSvg.remove(); });
    wrap.insertAdjacentHTML('afterbegin', svg);

    attachCursor({
      wrap: wrap,
      vbW: VB_W,
      tip: $('chartAccumTip'),
      count: n,
      xOf: X,
      cursorId: 'accumCursor',
      hitId: 'accumHit',
      points: function (i) { return [total[i], real[i]]; },
      content: function (i) {
        var r = rows[i];
        return '<b>Age ' + r.age + '</b><br>' +
          'On paper: <b>' + money(r.balanceNominal) + '</b><br>' +
          'In today’s money: <b>' + money(r.balanceReal) + '</b><br>' +
          'You put in: <b>' + money(r.principal) + '</b><br>' +
          'Growth: <b>' + money(r.growth) + '</b>';
      },
      announce: function (i) {
        var r = rows[i];
        return 'Age ' + r.age + ': ' + money(r.balanceNominal) + ' on paper, ' +
               money(r.balanceReal) + ' in today’s money.';
      }
    });

    $('chartCaption').textContent =
      'The blue and orange bands stack up to the balance a statement would show. ' +
      'The dashed line is what that balance would actually buy, at ' +
      pct(inflation) + ' inflation a year.';
  }

  // =====================================================================
  // Chart 2 — drawdown: what happens once you start spending it
  // =====================================================================

  function renderDrawdownChart(result) {
    var wrap = $('chartDrawWrap');
    var dd = result.drawdown;
    var sched = dd.schedule;
    var startAge = result.input.retirementAge;

    setGeometry(wrap);
    var rows = sched.rows.filter(function (r) { return r.year <= 41; });
    if (rows.length < 2 || dd.annualWithdrawalReal <= 0) {
      emptyChart(wrap, dd.annualWithdrawalReal > 0
        ? 'There is no balance left to chart.'
        : 'Set an amount you want to take out each year and the chart will appear here.');
      return;
    }
    clearEmpty(wrap);

    var drawAxis = niceAxis(Math.max.apply(null, rows.map(function (r) { return r.balanceReal; })),
                            NARROW ? 3 : 4);
    var yMax = drawAxis.max, yTicks = drawAxis.ticks;
    var lastYear = rows[rows.length - 1].year;
    var X = function (yr) { return M.left + (lastYear <= 0 ? 0 : (yr / lastYear) * PLOT_W); };
    var Y = function (v) { return M.top + PLOT_H - (Math.max(0, v) / yMax) * PLOT_H; };
    var pts = rows.map(function (r) { return [X(r.year), Y(r.balanceReal)]; });
    var base = M.top + PLOT_H;

    var titleId = 'draw-title', descId = 'draw-desc';
    var svg = '<svg viewBox="0 0 ' + VB_W + ' ' + VB_H + '" role="img" tabindex="0" ' +
      'aria-labelledby="' + titleId + ' ' + descId + '" preserveAspectRatio="xMidYMid meet">' +
      '<title id="' + titleId + '">What is left each year after you start taking money out</title>' +
      '<desc id="' + descId + '">A line chart of the remaining balance in today’s money, ' +
      'starting at age ' + startAge + '. ' +
      (sched.depleted ? 'It reaches zero after ' + yearsText(sched.years) + '.'
                      : 'It does not run out within the years shown.') + '</desc>';

    svg += axisMarkup(pickXTicks(rows, NARROW ? 5 : 7),
      { x: function (i) { return X(rows[i].year); },
        label: function (i) { return String(Math.round(startAge + rows[i].year)); } },
      yTicks, yMax, 'Your age',
      NARROW ? 'Left in the pot' : 'Left in the pot (today’s money)');

    svg += '<path d="' + path(pts) + ' L' + pts[pts.length - 1][0].toFixed(2) + ' ' + base +
           ' L' + pts[0][0].toFixed(2) + ' ' + base + ' Z" fill="var(--series-put-in)" fill-opacity="0.18"/>';
    svg += '<path d="' + path(pts) + '" fill="none" stroke="var(--series-put-in)" ' +
           'stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>';

    if (sched.depleted) {
      var zx = X(sched.years), zy = Y(0);
      svg += '<circle cx="' + zx.toFixed(1) + '" cy="' + zy + '" r="7" fill="var(--critical)" ' +
             'stroke="var(--surface)" stroke-width="2"/>';
      var anchor = zx > M.left + PLOT_W * 0.6 ? 'end' : 'start';
      var dx = anchor === 'end' ? -12 : 12;
      svg += '<text class="chart-endlabel" font-size="' + (CFS + 1) + '" x="' + (zx + dx).toFixed(1) +
             '" y="' + (zy - CFS) + '" text-anchor="' + anchor + '" fill="var(--critical)">Empty at age ' +
             Math.round(startAge + sched.years) + '</text>';
    } else {
      var lx = pts[pts.length - 1][0], ly = pts[pts.length - 1][1];
      svg += '<text class="chart-endlabel" font-size="' + (CFS + 1) + '" x="' + (lx + 7) + '" y="' +
             (ly + CFS * 0.35).toFixed(1) + '" fill="var(--series-put-in)">' +
             esc(moneyAxis(rows[rows.length - 1].balanceReal)) + '</text>';
      if (!NARROW) {
        svg += '<text class="chart-tick" font-size="' + CFS + '" x="' + (lx + 7) + '" y="' +
               (ly + CFS * 1.7).toFixed(1) + '">still left</text>';
      }
    }

    svg += '<g id="drawCursor" opacity="0">' +
      '<line y1="' + M.top + '" y2="' + base + '" stroke="var(--ink)" stroke-width="1.5" stroke-dasharray="3 3"/>' +
      '<circle r="6" fill="var(--series-put-in)" stroke="var(--surface)" stroke-width="2"/>' +
      '</g>';
    svg += '<rect id="drawHit" x="' + M.left + '" y="' + M.top + '" width="' + PLOT_W +
           '" height="' + PLOT_H + '" fill="transparent"/>';
    svg += '</svg>';

    wrap.querySelectorAll('svg').forEach(function (nSvg) { nSvg.remove(); });
    wrap.insertAdjacentHTML('afterbegin', svg);

    attachCursor({
      wrap: wrap,
      vbW: VB_W,
      tip: $('chartDrawTip'),
      count: rows.length,
      xOf: function (i) { return X(rows[i].year); },
      cursorId: 'drawCursor',
      hitId: 'drawHit',
      points: function (i) { return [pts[i]]; },
      content: function (i) {
        return '<b>Age ' + Math.round(startAge + rows[i].year) + '</b><br>' +
          'Left in the pot: <b>' + money(rows[i].balanceReal) + '</b><br>' +
          'Taken out so far: <b>' + money(rows[i].withdrawnReal) + '</b>';
      },
      announce: function (i) {
        return 'Age ' + Math.round(startAge + rows[i].year) + ': ' +
               money(rows[i].balanceReal) + ' left.';
      }
    });
  }

  // =====================================================================
  // Shared hover / keyboard cursor for both charts
  // =====================================================================

  function attachCursor(cfg) {
    var svg = cfg.wrap.querySelector('svg');
    var hit = svg.querySelector('#' + cfg.hitId);
    var cursor = svg.querySelector('#' + cfg.cursorId);
    var line = cursor.querySelector('line');
    var dots = cursor.querySelectorAll('circle');
    var active = -1;

    function show(i) {
      if (i < 0 || i >= cfg.count) return;
      active = i;
      var x = cfg.xOf(i);
      line.setAttribute('x1', x); line.setAttribute('x2', x);
      var pts = cfg.points(i);
      dots.forEach(function (d, k) {
        if (pts[k]) {
          d.setAttribute('cx', pts[k][0]); d.setAttribute('cy', pts[k][1]);
          d.style.display = '';
        } else { d.style.display = 'none'; }
      });
      cursor.setAttribute('opacity', '1');

      var rect = svg.getBoundingClientRect();
      var scale = rect.width / cfg.vbW;
      cfg.tip.innerHTML = cfg.content(i);
      cfg.tip.hidden = false;
      // Keep the tooltip inside the chart box on narrow screens.
      var left = Math.min(Math.max(x * scale, 60), rect.width - 60);
      cfg.tip.style.left = left + 'px';
      cfg.tip.style.top = (pts[0][1] * scale) + 'px';
    }

    function hide() {
      cursor.setAttribute('opacity', '0');
      cfg.tip.hidden = true;
      active = -1;
    }

    function indexFromEvent(ev) {
      var rect = svg.getBoundingClientRect();
      var px = (ev.clientX - rect.left) / (rect.width / cfg.vbW);
      var best = 0, bestD = Infinity;
      for (var i = 0; i < cfg.count; i++) {
        var d = Math.abs(cfg.xOf(i) - px);
        if (d < bestD) { bestD = d; best = i; }
      }
      return best;
    }

    hit.addEventListener('mousemove', function (ev) { show(indexFromEvent(ev)); });
    hit.addEventListener('mouseleave', hide);
    hit.addEventListener('touchstart', function (ev) {
      if (ev.touches[0]) show(indexFromEvent(ev.touches[0]));
    }, { passive: true });
    hit.addEventListener('touchmove', function (ev) {
      if (ev.touches[0]) show(indexFromEvent(ev.touches[0]));
    }, { passive: true });

    svg.addEventListener('focus', function () { if (active < 0) show(cfg.count - 1); });
    svg.addEventListener('blur', hide);
    svg.addEventListener('keydown', function (ev) {
      var step = (ev.key === 'ArrowRight') ? 1 : (ev.key === 'ArrowLeft') ? -1 : 0;
      if (ev.key === 'Home') { show(0); ev.preventDefault(); return; }
      if (ev.key === 'End') { show(cfg.count - 1); ev.preventDefault(); return; }
      if (ev.key === 'Escape') { hide(); return; }
      if (!step) return;
      ev.preventDefault();
      var next = active < 0 ? (step > 0 ? 0 : cfg.count - 1) : active + step;
      show(Math.min(Math.max(next, 0), cfg.count - 1));
    });
  }

  // =====================================================================
  // Painting the results
  // =====================================================================

  function renderSplit(acc) {
    var bar = $('splitBar');
    var total = acc.balanceNominal;
    var principal = acc.totalPrincipal;
    var growth = Math.max(0, acc.totalGrowth);
    var pPct = total > 0 ? (principal / total) * 100 : 100;
    var gPct = Math.max(0, 100 - pPct);

    bar.innerHTML =
      '<div class="split-seg put-in" style="width:' + pPct.toFixed(2) + '%"><span>' +
        (pPct > 18 ? Math.round(pPct) + '%' : '') + '</span></div>' +
      '<div class="split-seg growth" style="width:' + gPct.toFixed(2) + '%"><span>' +
        (gPct > 18 ? Math.round(gPct) + '%' : '') + '</span></div>';

    var parts = [];
    parts.push('You (and your employer) put in <strong>' + money(principal) + '</strong>');
    parts.push('growth added <strong>' + money(growth) + '</strong>');
    var sentence = parts.join('; ') + '.';
    if (total > 0 && growth > 0) {
      sentence += ' That means <strong>' + Math.round(gPct) + '%</strong> of your final balance is money you never had to earn. ';
      if (principal > 0) {
        sentence += 'Every dollar you put in became <strong>$' + (total / principal).toFixed(2) + '</strong>.';
      }
    } else if (growth <= 0) {
      sentence += ' At this return assumption, compounding adds nothing — the balance is only what was paid in.';
    }
    $('splitFigures').innerHTML = sentence;
  }

  function renderSensitivity(input) {
    var rows = F.sensitivity(input, [-3, -1.5, 0, 1.5]);
    $('sensitivityBody').innerHTML = rows.map(function (r) {
      return '<tr class="' + (r.isBaseline ? 'is-baseline' : '') + '">' +
        '<th scope="row" style="text-align:left">' + pct(r.annualReturn) +
          (r.isBaseline ? ' <span style="font-weight:400">(your assumption)</span>' : '') + '</th>' +
        '<td>' + money(r.balanceNominal) + '</td>' +
        '<td>' + money(r.balanceReal) + '</td>' +
        '<td>' + money(Math.max(0, r.totalGrowth)) + '</td>' +
        '</tr>';
    }).join('');
  }

  function renderYearTable(acc) {
    var thisYear = new Date().getFullYear();
    $('yearTableBody').innerHTML = acc.rows.map(function (r, i) {
      var isLast = i === acc.rows.length - 1 && acc.rows.length > 1;
      return '<tr class="' + (isLast ? 'is-retirement' : '') + '">' +
        '<th scope="row" style="text-align:left">' + r.age + (isLast ? ' (retire)' : '') + '</th>' +
        '<td>' + (thisYear + r.year) + '</td>' +
        '<td>' + money(r.ownContributions) + '</td>' +
        '<td>' + money(r.employerMatch) + '</td>' +
        '<td>' + money(r.growth) + '</td>' +
        '<td>' + money(r.balanceNominal) + '</td>' +
        '<td>' + money(r.balanceReal) + '</td>' +
        '</tr>';
    }).join('');
  }

  function renderWithdrawal(result) {
    var dd = result.drawdown;
    var box = $('withdrawalVerdict');
    var startAge = result.input.retirementAge;
    var html = '';

    if (dd.mode === 'duration') {
      if (dd.annualWithdrawalReal <= 0) {
        html = '<div class="verdict"><p class="verdict-headline">No withdrawals set</p>' +
          '<p>Enter the amount you would like to take out each year to see how long it lasts.</p></div>';
      } else if (!dd.depleted) {
        html = '<div class="verdict is-good"><p class="verdict-headline">It does not run out within 60 years</p>' +
          '<p>Taking <strong>' + money(dd.annualWithdrawalReal) + '</strong> a year (in today’s money) ' +
          'is less than the pot earns at ' + pct(dd.realAnnualReturn) + ' after inflation, so the balance ' +
          'holds up over any realistic retirement. That is a comfortable position — but it depends ' +
          'entirely on the return assumption holding.</p></div>';
      } else {
        var runsOut = startAge + dd.yearsLasted;
        var comfortable = dd.yearsLasted >= 30;
        html = '<div class="verdict ' + (comfortable ? 'is-good' : 'is-warning') + '">' +
          '<p class="verdict-headline">It lasts about ' + yearsText(dd.yearsLasted) + '</p>' +
          '<p>Taking <strong>' + money(dd.annualWithdrawalReal) + '</strong> a year in today’s money ' +
          '(rising with inflation, so it keeps buying the same amount), the pot would be empty at around ' +
          '<strong>age ' + Math.round(runsOut) + '</strong>.' +
          (comfortable ? '' : ' That may be sooner than you need it to last — try a smaller withdrawal, ' +
            'a later retirement age, or a larger monthly contribution and watch this number move.') +
          '</p></div>';
      }
    } else {
      if (dd.annualWithdrawalReal <= 0) {
        html = '<div class="verdict"><p class="verdict-headline">Nothing to draw on</p>' +
          '<p>With no balance at retirement there is nothing to withdraw.</p></div>';
      } else {
        html = '<div class="verdict is-good">' +
          '<p class="verdict-headline">You could take about ' + money(dd.annualWithdrawalReal) + ' a year</p>' +
          '<p>That is <strong>' + money(dd.monthlyWithdrawalReal) + ' a month</strong> in today’s money, ' +
          'for <strong>' + dd.targetYears + ' years</strong>, ending with nothing left. The dollar amount ' +
          'you actually withdraw rises each year with inflation so its purchasing power stays the same: ' +
          'in your first year of retirement that would be about <strong>' +
          money(dd.annualWithdrawalNominalAtRetirement) + '</strong>.</p></div>';
      }
    }
    box.innerHTML = html;

    var note = 'During retirement this assumes a ' + pct(result.input.retirementReturn) +
      ' return and ' + pct(result.input.annualInflation) + ' inflation, which is ' +
      pct(dd.realAnnualReturn) + ' after inflation. Withdrawals are taken at the start of each month. ' +
      'A real retirement is bumpier than this: a bad run of years early on does more damage than the ' +
      'same years later, and this model cannot show that.';
    $('drawdownNote').textContent = note;
  }

  function renderAssumptions(input, acc) {
    var items = [
      ['Age today', input.currentAge],
      ['Retirement age', input.retirementAge],
      ['Years of saving', acc.years],
      ['Starting balance', money(input.currentSavings)],
      ['Added each month', money(input.monthlyContribution) +
        (input.escalateWithInflation ? ' (rising with inflation)' : ' (fixed)')],
      ['Employer match', input.matchPercent > 0
        ? input.matchPercent + '% of your contribution' +
          (input.matchCapMonthly > 0 ? ', capped at ' + money(input.matchCapMonthly) + '/month' : '')
        : 'None'],
      ['Return before retirement', pct(input.annualReturn) + ' a year'],
      ['Return during retirement', pct(input.retirementReturn) + ' a year'],
      ['Inflation', pct(input.annualInflation) + ' a year'],
      ['Return after inflation', pct(F.realRate(input.annualReturn, input.annualInflation)) + ' a year'],
      ['Contributions land', input.timing === 'begin' ? 'At the start of each month' : 'At the end of each month'],
      ['Compounding', 'Monthly']
    ];
    // The form itself is hidden when printing, so the retirement-spending
    // question has to be restated here or the handout loses it.
    if (input.withdrawalMode === 'amount') {
      items.push(['Question asked', 'What can I spend?']);
      items.push(['Money must last', input.targetYears + ' years from retirement']);
    } else {
      items.push(['Question asked', 'How long will it last?']);
      items.push(['Planned withdrawal', money(input.targetAnnualWithdrawal) +
        ' a year, in today\u2019s money']);
    }
    $('assumptionsList').innerHTML = items.map(function (it) {
      return '<dt>' + esc(it[0]) + '</dt><dd>' + it[1] + '</dd>';
    }).join('');

    $('methodNote').textContent =
      'Method: the balance is compounded monthly at a rate of (1 + annual return) to the power of 1/12, ' +
      'so a ' + pct(input.annualReturn) + ' annual return means exactly ' + pct(input.annualReturn) +
      ' over a year — not the slightly higher figure you get by dividing by 12. Today’s-money ' +
      'figures divide the balance by (1 + inflation) raised to the number of years, which is the correct ' +
      'way round; subtracting inflation from the return is only an approximation and is not used here.';
  }

  function renderSummary(result) {
    var acc = result.accumulation, dd = result.drawdown, inp = result.input;
    var s = '';

    if (acc.years === 0) {
      s = 'You are retiring today, so there is no time for growth: you start with ' +
          money(acc.balanceNominal) + '. ';
    } else {
      s = 'Saving ' + money(inp.monthlyContribution) + ' a month from age ' + inp.currentAge +
          ' to age ' + inp.retirementAge + ' at ' + pct(inp.annualReturn) + ' a year, you could retire ' +
          'with about ' + money(acc.balanceNominal) + ' on paper. With inflation at ' +
          pct(inp.annualInflation) + ', that would buy roughly what ' + money(acc.balanceReal) +
          ' buys today. ';
    }

    if (dd.mode === 'duration' && dd.annualWithdrawalReal > 0) {
      s += dd.depleted
        ? 'Taking ' + money(dd.annualWithdrawalReal) + ' a year would make it last about ' +
          yearsText(dd.yearsLasted) + ', running out around age ' + Math.round(inp.retirementAge + dd.yearsLasted) + '.'
        : 'Taking ' + money(dd.annualWithdrawalReal) + ' a year, it would not run out within 60 years.';
    } else if (dd.mode === 'amount' && dd.annualWithdrawalReal > 0) {
      s += 'To make it last ' + dd.targetYears + ' years you could spend about ' +
           money(dd.annualWithdrawalReal) + ' a year in today’s money.';
    }
    s += ' These are illustrations, not promises.';
    $('liveSummary').textContent = s;
  }

  // =====================================================================
  // Main render
  // =====================================================================

  function markInvalid(errors) {
    var map = {
      'Current age': 'currentAge', 'Retirement age': 'retirementAge',
      'Current savings': 'currentSavings', 'Monthly contribution': 'monthlyContribution',
      'Expected annual return': 'annualReturn', 'Expected inflation': 'annualInflation'
    };
    NUMBER_FIELDS.forEach(function (id) { $(id).removeAttribute('aria-invalid'); });
    errors.forEach(function (msg) {
      Object.keys(map).forEach(function (k) {
        if (msg.indexOf(k) === 0) $(map[k]).setAttribute('aria-invalid', 'true');
      });
      if (msg.indexOf('Retirement age cannot') === 0) {
        $('retirementAge').setAttribute('aria-invalid', 'true');
      }
    });
  }

  function render() {
    var input = readForm();
    var result = F.project(input);
    var errBox = $('errors');

    if (result.errors && result.errors.length) {
      errBox.innerHTML = '<strong>Please check these boxes:</strong><ul>' +
        result.errors.map(function (e) { return '<li>' + esc(e) + '</li>'; }).join('') + '</ul>';
      markInvalid(result.errors);
      $('liveSummary').textContent = 'Some of your numbers need fixing before results can be shown: ' +
        result.errors.join(' ');
      return;
    }

    errBox.innerHTML = '';
    markInvalid([]);

    var acc = result.accumulation;
    $('statReal').textContent = money(acc.balanceReal);
    $('statRealSub').textContent = acc.years === 0
      ? 'You are retiring today, so this is simply what you have.'
      : 'After ' + acc.years + ' years of ' + pct(input.annualInflation) + ' inflation.';
    $('statNominal').textContent = money(acc.balanceNominal);
    $('statNominalSub').textContent = acc.years === 0
      ? 'Same figure — no time has passed.'
      : 'The bigger number. It is real dollars, but each one buys less than a dollar does today.';

    renderSplit(acc);
    renderAccumChart(acc, input.annualInflation);
    renderWithdrawal(result);
    renderDrawdownChart(result);
    renderSensitivity(input);
    renderYearTable(acc);
    renderAssumptions(input, acc);
    renderSummary(result);
  }

  // Debounced so the live region is not read out on every keystroke.
  var timer = null;
  function scheduleRender() {
    window.clearTimeout(timer);
    timer = window.setTimeout(function () { render(); saveForm(); }, 400);
  }

  // =====================================================================
  // Controls
  // =====================================================================

  var SIZES = { 1: '16px', 2: '18px', 3: '21px', 4: '25px' };
  var SIZE_NAMES = { 1: 'Standard', 2: 'Large', 3: 'Larger', 4: 'Largest' };

  function applyTextSize(size, announce) {
    document.documentElement.style.setProperty('--base-font', SIZES[size] || SIZES[2]);
    document.querySelectorAll('.text-size-btn').forEach(function (b) {
      b.setAttribute('aria-pressed', String(b.dataset.size === String(size)));
      b.setAttribute('aria-label', 'Text size: ' + SIZE_NAMES[b.dataset.size]);
    });
    try { window.localStorage.setItem(STORE_KEY + '.textsize', String(size)); } catch (e) {}
    if (announce) $('text-size-status').textContent = 'Text size: ' + SIZE_NAMES[size];
    // Charts are sized in viewBox units, but the tooltip position is in pixels.
    window.setTimeout(render, 0);
  }

  function applyTheme(theme) {
    if (theme === 'light' || theme === 'dark') {
      document.documentElement.setAttribute('data-theme', theme);
    } else {
      document.documentElement.removeAttribute('data-theme');
    }
    try { window.localStorage.setItem(STORE_KEY + '.theme', theme || 'auto'); } catch (e) {}
  }

  function currentTheme() {
    return document.documentElement.getAttribute('data-theme') ||
      (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  }

  function syncWithdrawalMode() {
    var mode = radioValue('withdrawalMode');
    $('field-targetWithdrawal').hidden = (mode !== 'duration');
    $('field-targetYears').hidden = (mode !== 'amount');
  }

  function init() {
    // Restore saved text size and theme first so the page does not visibly jump.
    var savedSize = null, savedTheme = null;
    try {
      savedSize = window.localStorage.getItem(STORE_KEY + '.textsize');
      savedTheme = window.localStorage.getItem(STORE_KEY + '.theme');
    } catch (e) { /* storage unavailable — carry on with defaults */ }
    applyTextSize(savedSize || 2, false);
    if (savedTheme && savedTheme !== 'auto') applyTheme(savedTheme);

    var restored = loadForm();
    syncWithdrawalMode();
    render();

    $('storageNote').textContent = restored
      ? 'Your numbers were remembered from last time. They are stored only in this browser, on this device.'
      : 'Your numbers are saved in this browser only, on this device. Nothing is sent anywhere.';

    $('planForm').addEventListener('input', function (ev) {
      if (ev.target.name === 'withdrawalMode') syncWithdrawalMode();
      scheduleRender();
    });
    $('planForm').addEventListener('change', function (ev) {
      if (ev.target.name === 'withdrawalMode') syncWithdrawalMode();
      scheduleRender();
    });
    // Submitting would reload the page and lose nothing but time.
    $('planForm').addEventListener('submit', function (ev) { ev.preventDefault(); render(); });

    document.querySelectorAll('.text-size-btn').forEach(function (b) {
      b.addEventListener('click', function () { applyTextSize(b.dataset.size, true); });
    });

    $('themeToggle').addEventListener('click', function () {
      applyTheme(currentTheme() === 'dark' ? 'light' : 'dark');
      window.setTimeout(render, 0);
    });

    $('printBtn').addEventListener('click', function () { window.print(); });

    $('resetBtn').addEventListener('click', function () {
      NUMBER_FIELDS.forEach(function (id) { $(id).value = String(DEFAULTS[id]); });
      $('escalate').checked = DEFAULTS.escalate;
      $('timing-' + DEFAULTS.timing).checked = true;
      $('mode-' + DEFAULTS.withdrawalMode).checked = true;
      clearSaved();
      syncWithdrawalMode();
      render();
      $('currentAge').focus();
    });

    // Redraw on resize so tooltip positioning and label spacing stay right.
    var rTimer = null;
    window.addEventListener('resize', function () {
      window.clearTimeout(rTimer);
      rTimer = window.setTimeout(render, 200);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
