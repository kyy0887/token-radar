/* Launch Radar - pre-token protocol intelligence. Renders only from window.RADAR. */
(function () {
  'use strict';

  var radar = window.RADAR || null;
  if (!radar || !Array.isArray(radar.rows)) radar = null;

  function el(tag, props) {
    var node = document.createElement(tag);
    if (props) {
      for (var key in props) {
        if (!Object.prototype.hasOwnProperty.call(props, key)) continue;
        var value = props[key];
        if (key === 'class') node.className = value;
        else if (key === 'text') node.textContent = value;
        else if (key === 'dataset') { for (var d in value) node.dataset[d] = value[d]; }
        else if (key.slice(0, 2) === 'on' && typeof value === 'function') node.addEventListener(key.slice(2), value);
        else if (value !== null && value !== undefined) node.setAttribute(key, value);
      }
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined || child === false) continue;
      if (Array.isArray(child)) { for (var j = 0; j < child.length; j++) if (child[j]) node.appendChild(child[j]); }
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  function usd(n) {
    if (typeof n !== 'number' || !isFinite(n)) return '\u2014';
    var neg = n < 0 ? '-' : '';
    var a = Math.abs(n);
    if (a >= 1e9) return neg + '$' + (a / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return neg + '$' + (a / 1e6).toFixed(1) + 'M';
    if (a >= 1e3) return neg + '$' + Math.round(a / 1e3) + 'K';
    return neg + '$' + Math.round(a);
  }

  function round1(n) { return Math.round(n * 10) / 10; }

  function pct(n) {
    if (typeof n !== 'number' || !isFinite(n)) return '\u2014';
    return (n >= 0 ? '+' : '') + round1(n) + '%';
  }

  function odds(p) {
    if (typeof p !== 'number' || !isFinite(p)) return '\u2014';
    var v = p * 100;
    if (v >= 10) return Math.round(v) + '%';
    if (v >= 1) return v.toFixed(1) + '%';
    return v.toFixed(2) + '%';
  }

  function age(d) {
    if (typeof d !== 'number' || !isFinite(d) || d < 0) return '\u2014';
    if (d < 1000) return Math.round(d) + 'd';
    return round1(d / 365).toFixed(1) + 'y';
  }

  function mult(n) {
    if (typeof n !== 'number' || !isFinite(n)) return '\u2014';
    return '\u00d7' + (Math.round(n * 100) / 100).toFixed(2);
  }

  function money(n) {
    if (typeof n !== 'number' || !isFinite(n)) return '\u2014';
    var v = Math.round(Math.abs(n));
    var neg = n < 0 && v > 0 ? '-' : '';
    return neg + '$' + v.toLocaleString('en-US');
  }

  function dash() { return '\u2014'; }

  var K = (radar && radar.farm) || {
    farmer_share: 0.045,
    eligible_tvl_share: 0.12,
    months: 9.5,
    fixed_cost_usd: 27,
    tbill_rate: 0.043,
    risk_haircut: 0.35,
    hours: 6,
    labour_usd_per_hour: 25,
    odds_margin: 1.35,
  };

  var state = {
    query: '',
    verdict: '',
    category: '',
    chain: '',
    tvlBand: '',
    sortKey: 'implied',
    sortDir: 'desc',
    depositIdx: 1,
    share: K.farmer_share,
    filtered: false,
  };

  var DEPOSITS = [1000, 5000, 25000];

  /** One deposit scenario re-derived at the current farmer share, from the build's own scenario row. */
  function farmAt(row, idx) {
    var base = row.farm.scenarios[idx] || row.farm.default;
    var scale = state.share / K.farmer_share;
    var allocation = base.allocation_usd * scale;
    var gross = base.gross_expected_usd * scale;
    var fixed = base.fixed_cost_usd;
    var opp = base.opp_cost_usd;
    var net = gross - fixed - opp;
    var risk = net - K.risk_haircut * gross;
    var perHour = risk / K.hours;
    var breakOdds = allocation > 0 ? ((fixed + opp) / (allocation * (1 - K.risk_haircut))) * 100 : 100;
    var breakFdv = row.launch_p > 0 && allocation > 0
      ? ((fixed + opp) * row.fdv_usd) / (row.launch_p * allocation * (1 - K.risk_haircut))
      : Infinity;
    var verdict = risk <= 0 ? 'SKIP'
      : (perHour >= K.labour_usd_per_hour && breakOdds * K.odds_margin <= 100 ? 'FARM' : 'MARGINAL');
    return {
      deposit: base.deposit_usd,
      campaign: base.campaign_tvl_usd,
      sharePct: base.share_pct,
      allocation: allocation,
      gross: gross,
      fixed: fixed,
      opp: opp,
      net: net,
      risk: risk,
      perHour: perHour,
      roi: base.deposit_usd > 0 ? (risk / base.deposit_usd) * 100 : 0,
      breakOdds: breakOdds,
      breakFdv: breakFdv,
      verdict: verdict,
    };
  }

  /* Boot self-check: the page must reproduce the build's own net and verdict at default inputs. */
  var checkOk = true;
  if (radar) {
    for (var ci = 0; ci < radar.rows.length; ci++) {
      var r0 = radar.rows[ci];
      var def = r0.farm.scenarios[1];
      if (!def) { checkOk = false; break; }
      var mine = farmAt(r0, 1);
      var tol = Math.max(1, Math.abs(def.risk_adj_usd) * 0.01);
      if (Math.abs(mine.risk - def.risk_adj_usd) > tol || mine.verdict !== r0.farm.verdict) { checkOk = false; break; }
    }
  }

  var maxImplied = 1;
  if (radar) {
    for (var i = 0; i < radar.rows.length; i++) {
      if (radar.rows[i].implied_value_usd > maxImplied) maxImplied = radar.rows[i].implied_value_usd;
    }
  }

  var view = [];

  function setText(id, value) { var n = document.getElementById(id); if (n) n.textContent = value; }

  function renderHeader() {
    if (!radar) return;
    var c = radar.counts || {};
    setText('t-asof', radar.as_of);
    setText('t-protos', String((c.pre_token || 0) + (c.token || 0) + (c.derivative || 0) + (c.excluded || 0) + (c.uncertain || 0)));
    setText('t-watch', (c.watchlist_on_board || 0) + '/' + radar.watchlist_size);
    setText('t-model', radar.model_version);
    setText('t-floor2', usd(radar.floor_usd));
    setText('t-model2', radar.model_version);
    var src = document.getElementById('t-source');
    if (src && radar.source) src.textContent = String(radar.source).split(/\s+/).slice(0, 2).join(' ');

    setText('kpi-count', String(radar.board_size));
    setText('kpi-count-note', (c.watchlist_on_board || 0) + ' of ' + radar.watchlist_size +
      ' watchlist slugs, plus ' + radar.early_size + ' early-stage below ' + usd(radar.floor_usd));

    var total = c.total_implied || 0;
    setText('kpi-implied', usd(total));
    setText('kpi-implied-note', 'FDV \u00d7 odds, summed over ' + radar.board_size + ' rows');

    var abl = (radar.fit && radar.fit.ablation) || [];
    var ship = null;
    var flat = abl[0];
    for (var a = 0; a < abl.length; a++) if (abl[a].priced) ship = abl[a];
    if (ship && flat) {
      setText('kpi-mae', ship.mae_dex.toFixed(3) + ' dex');
      setText('kpi-mae-note', 'flat multiple ' + flat.mae_dex.toFixed(3) + ' \u00b7 ' +
        Math.round((1 - ship.mae_dex / flat.mae_dex) * 100) + '% lower, leave-one-out n=' + radar.fit.n_live);
    }

    if (radar.coverage) {
      setText('kpi-cover', Math.round(radar.coverage.cover80 * 100) + '%');
      setText('kpi-cover-note', 'inside P10\u2013P90 \u00b7 P25\u2013P75 ' +
        Math.round(radar.coverage.cover50 * 100) + '% \u00b7 n=' + radar.coverage.n);
    }

    if (radar.launch) {
      setText('kpi-odds', radar.launch.auc.toFixed(3));
      setText('kpi-odds-note', 'out-of-fold AUC \u00b7 Brier skill ' +
        (radar.launch.brier_skill * 100).toFixed(1) + '% \u00b7 n=' + radar.launch.n);
    }

    var tally = { FARM: 0, MARGINAL: 0, SKIP: 0 };
    for (var t = 0; t < radar.rows.length; t++) tally[farmAt(radar.rows[t], state.depositIdx).verdict] += 1;
    setText('kpi-farm', String(tally.FARM));
    setText('kpi-farm-note', tally.MARGINAL + ' marginal \u00b7 ' + tally.SKIP + ' skip at ' +
      money(DEPOSITS[state.depositIdx]) + ' deposit');

    renderAccounting();
  }

  function renderAccounting() {
    var bar = document.getElementById('acc-bar');
    var legend = document.getElementById('acc-legend');
    if (!bar || !legend || !radar || !radar.accounting) return;
    var total = 0;
    for (var t = 0; t < radar.accounting.length; t++) total += radar.accounting[t].n;
    setText('acc-total', total.toLocaleString('en-US') + ' protocols, every one accounted');
    var colors = {
      pre_token: 'var(--green)',
      token: 'var(--blue)',
      derivative: 'var(--violet)',
      excluded: 'var(--muted)',
      uncertain: 'var(--amber)',
    };
    for (var i = 0; i < radar.accounting.length; i++) {
      var seg = radar.accounting[i];
      if (seg.n === 0) continue;
      bar.appendChild(el('span', {
        class: 'acc-seg',
        style: 'width:' + seg.pct.toFixed(2) + '%;background:' + (colors[seg.key] || 'var(--muted)'),
        title: seg.label + ': ' + seg.n + ' (' + seg.pct.toFixed(1) + '%)',
      }));
    }
    for (var k = 0; k < radar.accounting.length; k++) {
      var g = radar.accounting[k];
      legend.appendChild(el('li', { class: 'acc-item' },
        el('i', { class: 'acc-sw', style: 'background:' + (colors[g.key] || 'var(--muted)'), 'aria-hidden': 'true' }),
        el('span', { class: 'acc-name', text: g.label }),
        el('b', { class: 'acc-n', text: String(g.n) }),
        el('span', { class: 'acc-p', text: '(' + g.pct.toFixed(1) + '%)' })));
    }
  }

  function populateSelects() {
    if (!radar) return;
    var cat = document.getElementById('category');
    var chain = document.getElementById('chain');
    var seenC = {};
    var seenH = [];

    radar.rows.forEach(function (r) {
      if (r.category && !seenC[r.category]) {
        seenC[r.category] = true;
        if (cat) cat.appendChild(el('option', { value: r.category, text: r.category }));
      }
      (r.chains || []).forEach(function (c) { if (seenH.indexOf(c) < 0) seenH.push(c); });
    });
    seenH.sort();
    if (chain) seenH.forEach(function (c) { chain.appendChild(el('option', { value: c, text: c })); });
  }

  function tvlMatch(tvl) {
    if (!state.tvlBand) return true;
    var parts = state.tvlBand.split('-');
    var lo = Number(parts[0]) * 1e6;
    var hi = Number(parts[1]) * 1e6;
    return tvl >= lo && tvl < hi;
  }

  function rowMatches(row) {
    if (state.verdict && farmAt(row, state.depositIdx).verdict !== state.verdict) return false;
    if (state.category && row.category !== state.category) return false;
    if (state.chain && (row.chains || []).indexOf(state.chain) < 0) return false;
    if (!tvlMatch(row.tvl_usd)) return false;
    var q = state.query.trim().toLowerCase();
    if (q) {
      var hay = [row.name, row.slug, row.category || '', (row.chains || []).join(' ')].join(' ').toLowerCase();
      if (hay.indexOf(q) < 0) return false;
    }
    return true;
  }

  function sortValue(row) {
    var key = state.sortKey;
    if (key === 'tvl') return row.tvl_usd;
    if (key === 'change') return row.change_7d === null || row.change_7d === undefined ? -1e9 : row.change_7d;
    if (key === 'age') return row.age_days === null || row.age_days === undefined ? -1 : row.age_days;
    if (key === 'odds') return row.launch_p;
    if (key === 'fdv') return row.fdv_usd;
    if (key === 'implied') return row.implied_value_usd;
    if (key === 'net') return farmAt(row, state.depositIdx).risk;
    if (key === 'hour') return farmAt(row, state.depositIdx).perHour;
    if (key === 'verdict') {
      var order = { SKIP: 0, MARGINAL: 1, FARM: 2 };
      return order[farmAt(row, state.depositIdx).verdict];
    }
    if (key === 'name') return row.name.toLowerCase();
    return -row.rank;
  }

  function sortView(rows) {
    var dir = state.sortDir === 'asc' ? 1 : -1;
    var copy = rows.slice();
    copy.sort(function (a, b) {
      var va = sortValue(a);
      var vb = sortValue(b);
      if (va < vb) return -dir;
      if (va > vb) return dir;
      return a.rank - b.rank;
    });
    return copy;
  }

  function verdictClass(v) {
    return v === 'FARM' ? 'is-farm' : v === 'MARGINAL' ? 'is-marginal' : 'is-skip';
  }

  function renderBoard() {
    var body = document.getElementById('board-body');
    if (!body) return;
    while (body.firstChild) body.removeChild(body.firstChild);
    if (!radar) { showEmpty('no-data'); return; }

    var matched = radar.rows.filter(rowMatches);
    view = sortView(matched);
    state.filtered = !!(state.verdict || state.category || state.chain || state.tvlBand || state.query.trim());
    hideEmpty();

    if (view.length === 0) {
      showEmpty('empty');
      renderSegment(0, 0, state.depositIdx);
      return;
    }
    var sumImplied = 0;
    for (var i = 0; i < view.length; i++) {
      sumImplied += view[i].implied_value_usd;
      body.appendChild(boardRow(view[i], i));
    }
    renderCount(view.length);
    renderSegment(view.length, sumImplied, state.depositIdx);
  }

  function boardRow(row, idx) {
    var change = row.change_7d;
    var changeClass = change === null || change === undefined ? 'chg-flat' : change >= 0 ? 'chg-pos' : 'chg-neg';
    var changeArrow = change === null || change === undefined ? '' : change >= 0 ? '\u25b2 ' : '\u25bc ';
    var f = farmAt(row, state.depositIdx);
    var barWidth = Math.max(2, Math.round((row.implied_value_usd / maxImplied) * 100));
    var bar = el('div', { class: 'impl-bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + barWidth + '%' }));
    var rankText = state.filtered ? String(idx + 1) : String(row.rank);

    return el('tr', {
      class: 'rowlink',
      tabindex: '0',
      role: 'button',
      'aria-label': 'Open ' + row.name + ' dossier',
      dataset: { slug: row.slug },
      onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(row.slug); } },
    },
      el('td', { class: 'num' }, el('span', { class: 'rank' + (idx < 3 ? ' rank-top' : ''), text: rankText })),
      el('td', null,
        el('div', { class: 'name-cell' },
          el('span', { class: 'proto-name', text: row.name || row.slug }),
          el('span', { class: 'proto-cat', text: (row.category || 'Uncategorised') + ' \u00b7 ' + ((row.chains || [])[0] || 'no chain') }))),
      el('td', { class: 'num tvl-cell', text: usd(row.tvl_usd) }),
      el('td', { class: 'num ' + changeClass }, changeArrow + pct(change)),
      el('td', { class: 'num', text: age(row.age_days) }),
      el('td', { class: 'num odds-cell', text: odds(row.launch_p) }),
      el('td', { class: 'num fdv-cell', text: usd(row.fdv_usd) }),
      el('td', { class: 'impl-cell' },
        el('span', { class: 'impl-value', text: usd(row.implied_value_usd) }),
        bar),
      el('td', { class: 'num range-cell', text: usd(row.low_value_usd) + '\u2013' + usd(row.high_value_usd) }),
      el('td', null, el('span', { class: 'badge ' + verdictClass(f.verdict), text: f.verdict })),
      el('td', { class: 'num ' + (f.risk >= 0 ? 'chg-pos' : 'chg-neg'), text: money(f.risk) }),
      el('td', { class: 'num ' + (f.perHour >= 0 ? 'chg-pos' : 'chg-neg'), text: money(f.perHour) + '/h' }));
  }

  function renderCount(shown) {
    var n = document.getElementById('count');
    if (!n || !radar) return;
    var parts = ['Showing ' + shown + ' of ' + radar.board_size + ' board rows'];
    if (state.verdict) parts.push(state.verdict);
    if (state.category) parts.push(state.category);
    if (state.chain) parts.push(state.chain);
    if (state.tvlBand) parts.push('TVL band ' + state.tvlBand);
    if (state.query.trim()) parts.push('\u201c' + state.query.trim() + '\u201d');
    parts.push((radar.counts.watchlist_on_board || 0) + '/' + radar.watchlist_size + ' watchlist covered');
    n.textContent = parts.join(' \u00b7 ');
  }

  function labelOfSort() {
    var map = {
      implied: 'implied value',
      odds: 'launch odds',
      net: 'net after fees',
      hour: 'net per hour',
      tvl: 'TVL',
      age: 'age without a token',
      name: 'name',
      verdict: 'verdict',
      fdv: 'FDV if launched',
      change: '7D change',
    };
    return map[state.sortKey] || state.sortKey;
  }

  function renderSegment(shown, implied) {
    var seg = document.getElementById('segment');
    if (!seg) return;
    if (!state.verdict && !state.category && !state.chain && !state.tvlBand) {
      seg.hidden = true;
      seg.textContent = '';
      return;
    }
    seg.hidden = false;
    seg.textContent = '';
    seg.appendChild(el('span', { class: 'seg-chip', text: 'FILTERED: ' + (state.verdict || 'all verdicts') }));
    seg.appendChild(el('span', { class: 'seg-item' }, el('b', { text: String(shown) }), ' matching protocols'));
    seg.appendChild(el('span', { class: 'seg-item' }, el('b', { text: usd(implied) }), ' aggregate implied value'));
    seg.appendChild(el('span', { class: 'seg-item' }, el('b', { text: money(DEPOSITS[state.depositIdx]) }), ' deposit'));
    seg.appendChild(el('span', { class: 'seg-item' }, el('b', { text: (state.share * 100).toFixed(1) + '%' }), ' farmer share'));
    seg.appendChild(el('span', { class: 'seg-item', text: 'sorted by ' + labelOfSort() }));
  }

  function renderLive() {
    var body = document.getElementById('live-body');
    if (!body || !radar) return;
    while (body.firstChild) body.removeChild(body.firstChild);
    var q = state.query.trim().toLowerCase();
    var rows = (radar.live || []).filter(function (r) {
      if (state.category && r.category !== state.category) return false;
      if (q) {
        var hay = [r.name, r.slug, r.category || '', (r.chains || []).join(' ')].join(' ').toLowerCase();
        if (hay.indexOf(q) < 0) return false;
      }
      return true;
    });
    var i;
    for (i = 0; i < rows.length; i++) {
      var r = rows[i];
      var ch = r.change_7d;
      var cls = ch === null || ch === undefined ? 'chg-flat' : ch >= 0 ? 'chg-pos' : 'chg-neg';
      body.appendChild(el('tr', null,
        el('td', null, el('div', { class: 'name-cell' },
          el('span', { class: 'proto-name', text: r.name }),
          el('span', { class: 'proto-cat', text: r.slug }))),
        el('td', { text: r.category || dash() }),
        el('td', { class: 'num', text: usd(r.tvl_usd) }),
        el('td', { class: 'num', text: usd(r.mcap_usd) }),
        el('td', { class: 'num ' + cls }, pct(ch))));
    }
    if (rows.length === 0) {
      body.appendChild(el('tr', null, el('td', { colspan: '5', class: 'live-note', text: 'No live-token protocol matches that filter.' })));
    }
  }

  function showEmpty(id) {
    var table = document.getElementById('board-table');
    var panel = document.getElementById(id);
    if (table) table.hidden = true;
    if (panel) panel.hidden = false;
    if (id === 'empty') setText('count', 'Showing 0 of ' + (radar ? radar.rows.length : 0) + ' \u00b7 nothing matches the current filters');
  }

  function hideEmpty() {
    var table = document.getElementById('board-table');
    if (table) table.hidden = false;
    var ids = ['empty', 'no-data'];
    for (var i = 0; i < ids.length; i++) {
      var p = document.getElementById(ids[i]);
      if (p) p.hidden = true;
    }
  }

  var currentIndex = -1;

  function openDetail(slug) {
    if (!radar) return;
    var idx = -1;
    for (var i = 0; i < view.length; i++) if (view[i].slug === slug) { idx = i; break; }
    if (idx < 0) return;
    currentIndex = idx;
    renderDetail(view[idx]);
    var dialog = document.getElementById('detail');
    if (dialog && !dialog.open) dialog.showModal();
  }

  function kv(label, value, note) {
    var out = el('div', { class: 'kv' },
      el('span', { class: 'kv-k', text: label }),
      el('span', { class: 'kv-v', text: String(value) }));
    if (note) out.appendChild(el('span', { class: 'kv-n', text: note }));
    return out;
  }

  function renderDetail(row) {
    setText('detail-name', row.name || row.slug);
    var f = farmAt(row, state.depositIdx);
    var onWatch = (radar.watchlist || []).indexOf(row.slug) >= 0;
    setText('detail-meta', (row.category || 'Uncategorised') + ' \u00b7 ' + ((row.chains || [])[0] || 'no chain') +
      ' \u00b7 rank #' + row.rank + ' of ' + radar.board_size + ' \u00b7 pre-token candidate \u00b7 ' +
      (onWatch ? 'watchlist' : 'early stage'));
    setText('detail-value', usd(row.implied_value_usd));
    setText('detail-ratio', mult(row.model.multiple) + ' TVL at ' + odds(row.launch_p) + ' odds');

    var body = document.getElementById('detail-body');
    if (!body) return;
    while (body.firstChild) body.removeChild(body.firstChild);
    var left = el('div', { class: 'detail-col' }, summaryBlock(row, f), whyBlock(row));
    var right = el('div', { class: 'detail-col' }, farmBlock(row));
    body.appendChild(left);
    body.appendChild(right);
  }

  function summaryBlock(row, f) {
    var grid = el('div', { class: 'kv-grid' });
    grid.appendChild(kv('Current TVL', usd(row.tvl_usd)));
    grid.appendChild(kv('7-day movement', pct(row.change_7d)));
    grid.appendChild(kv('Age', age(row.age_days)));
    grid.appendChild(kv('Without a token', age(row.age_days), 'since DefiLlama listing'));
    grid.appendChild(kv('FDV if launched', usd(row.fdv_usd), 'P25 ' + usd(row.fdv_p25_usd) + ' / P75 ' + usd(row.fdv_p75_usd)));
    grid.appendChild(kv('Launch odds, 12m', odds(row.launch_p), 'out-of-fold calibrated'));
    grid.appendChild(kv('Implied value', usd(row.implied_value_usd), 'FDV \u00d7 odds'));
    grid.appendChild(kv('P25 \u2013 P75', usd(row.low_value_usd) + ' \u2013 ' + usd(row.high_value_usd), '80% band, odds applied'));
    grid.appendChild(kv('Farm verdict', f.verdict, money(f.deposit) + ' at ' + (state.share * 100).toFixed(1) + '%'));
    grid.appendChild(kv('Net after fees', money(f.risk), 'risk-adjusted'));
    grid.appendChild(kv('Net per hour', money(f.perHour) + '/h', K.hours + ' hours of work'));
    grid.appendChild(kv('Break-even odds', f.breakOdds >= 100 ? 'never' : odds(f.breakOdds / 100), 'at this FDV'));
    return el('div', { class: 'detail-section' },
      el('p', { class: 'detail-sec-label', text: 'Valuation summary' }), grid);
  }

  /** The decomposition the model actually performed: TVL, category level, size shift, then odds. */
  function whyBlock(row) {
    var fit = radar.fit;
    var key = String(row.category || 'uncategorised').trim().toLowerCase();
    var catLog = fit.log_by_category[key] !== undefined ? fit.log_by_category[key] : fit.log_global;
    var catMul = Math.pow(10, catLog);
    var sizeMul = row.model.multiple / catMul;
    var scale = Math.max(row.fdv_usd, 1);
    var steps = [
      { label: 'TVL', text: usd(row.tvl_usd), bar: row.tvl_usd },
      { label: '\u00d7 category level', text: mult(catMul), bar: row.tvl_usd * catMul },
      { label: '\u00d7 size shift', text: mult(sizeMul), bar: row.fdv_usd },
      { label: '= FDV if launched', text: usd(row.fdv_usd), bar: row.fdv_usd, total: true },
      { label: '\u00d7 launch odds', text: odds(row.launch_p), bar: row.fdv_usd * row.launch_p },
      { label: '= implied value', text: usd(row.implied_value_usd), bar: row.implied_value_usd, total: true },
    ];
    var box = el('div', { class: 'calc-rows' });
    steps.forEach(function (st) {
      box.appendChild(el('div', { class: 'calc-row' + (st.total ? ' is-total' : '') },
        el('span', { class: 'calc-label', text: st.label }),
        el('span', { class: 'calc-bar' }, el('i', { style: 'width:' + Math.max(1, Math.round((st.bar / scale) * 100)) + '%' })),
        el('span', { class: 'calc-val', text: st.text })));
    });

    var peers = row.model.category_n;
    var line = 'FDV = ' + usd(row.tvl_usd) + ' \u00d7 ' + catMul.toFixed(3) + ' (' + peers + ' peer' +
      (peers === 1 ? '' : 's') + ', shrunk k=' + fit.prior_k + ') \u00d7 ' + sizeMul.toFixed(3) +
      ' (size, log TVL ' + Math.log10(row.tvl_usd).toFixed(2) + ' against ' + fit.mean_log_tvl.toFixed(2) +
      ') = ' + usd(row.fdv_usd) + '. Implied = FDV \u00d7 ' + odds(row.launch_p) +
      ' odds = ' + usd(row.implied_value_usd) + '.';

    var pushes = el('ul', { class: 'why-list' });
    pushes.appendChild(el('li', { text: 'TVL of ' + usd(row.tvl_usd) + ' is the book being priced, and it is the model\u2019s only size input.' }));
    if (catMul > 1) {
      pushes.appendChild(el('li', { text: 'Its category pays ' + catMul.toFixed(2) + '\u00d7 market cap per dollar of TVL across ' + peers + ' priced peer(s), above the 1\u00d7 reference.' }));
    } else {
      pushes.appendChild(el('li', { text: 'Its category pays only ' + catMul.toFixed(2) + '\u00d7 market cap per dollar of TVL across ' + peers + ' priced peer(s), below the 1\u00d7 reference: a thinner book earns less.' }));
    }
    if (row.launch_p >= 0.25) {
      pushes.appendChild(el('li', { text: 'Odds of ' + odds(row.launch_p) + ' are close to the snapshot\u2019s best, so most of the FDV survives the probability cut.' }));
    } else {
      pushes.appendChild(el('li', { text: 'Odds of ' + odds(row.launch_p) + ' cut the FDV by ' + Math.round((1 - row.launch_p) * 100) + '%: the ranking is mostly a bet on the token appearing.' }));
    }
    if (row.model.multiple !== undefined) {
      pushes.appendChild(el('li', { text: 'Size then scales the level: the fitted slope is ' + fit.size_slope.toFixed(2) + ' dex of multiple per decade of TVL, which lands this book at ' + mult(row.model.multiple) + '.' }));
    }

    var assumptions = el('ul', { class: 'why-list why-list-muted' });
    [
      'The multiple comes from this snapshot\u2019s own live-token peers; a market re-rating moves every row together.',
      'Odds are a prevalence model over labelled snapshot records, not a catalyst model: no announcement data is used.',
      'The band is the category\u2019s leave-one-out spread, so it widens where peers disagree and narrows where they agree.',
      'No protocol name is special-cased and no coefficient is typed in; a new snapshot refits everything.',
    ].forEach(function (t) { assumptions.appendChild(el('li', { text: t })); });

    return el('div', { class: 'detail-section' },
      el('p', { class: 'detail-sec-label', text: 'Why this value' }),
      box,
      el('p', { class: 'calc-note', text: line }),
      el('div', { class: 'why-cols' },
        el('div', null, el('h4', { class: 'why-h', text: 'What pushes it' }), pushes),
        el('div', null, el('h4', { class: 'why-h', text: 'What would break it' }), assumptions)));
  }

  function econRow(label, value, cls) {
    return el('div', { class: 'econ-row' + (cls ? ' ' + cls : '') },
      el('span', { text: label }), el('b', { text: value }));
  }

  function farmBlock(row) {
    var f = farmAt(row, state.depositIdx);

    var tabs = el('div', { class: 'dep-tabs', role: 'group', 'aria-label': 'Deposit scenario' });
    DEPOSITS.forEach(function (d, i) {
      tabs.appendChild(el('button', {
        type: 'button',
        class: 'dep-tab' + (i === state.depositIdx ? ' is-active' : ''),
        'aria-pressed': String(i === state.depositIdx),
        text: money(d),
        onclick: function () { setDeposit(i); },
      }));
    });

    var shareInput = el('input', {
      id: 'share',
      class: 'share-range',
      type: 'range',
      min: '10',
      max: '120',
      step: '5',
      value: String(Math.round(state.share * 1000)),
      oninput: function (e) {
        state.share = Number(e.target.value) / 1000;
        renderBoard();
        renderDetail(row);
      },
    });

    var scenario = el('div', { class: 'scenario' },
      el('div', { class: 'scen-row' }, el('span', { class: 'scen-k', text: 'Deposit' }), tabs),
      el('label', { class: 'scen-row', for: 'share' },
        el('span', { class: 'scen-k', text: 'Farmer share' }),
        shareInput,
        el('span', { class: 'scen-v', text: (state.share * 100).toFixed(1) + '%' })));

    var econ = el('div', { class: 'econ' },
      econRow('Campaign TVL', usd(f.campaign)),
      econRow('Your share', f.sharePct.toFixed(4) + '%'),
      econRow('Expected allocation', money(f.allocation)),
      econRow('Gross expected value', money(f.gross)),
      econRow('Gas and operational', '-' + money(f.fixed)),
      econRow('Foregone T-bill yield', '-' + money(f.opp)),
      econRow('Risk haircut ' + Math.round(K.risk_haircut * 100) + '%', '-' + money(f.gross * K.risk_haircut), 'is-muted'),
      econRow('Net risk-adjusted', money(f.risk), f.risk >= 0 ? 'is-net chg-pos' : 'is-net chg-neg'),
      econRow('Net per hour', money(f.perHour) + '/h', f.perHour >= 0 ? 'is-net chg-pos' : 'is-net chg-neg'),
      econRow('Net ROI', f.roi.toFixed(1) + '%'),
      econRow('Break-even odds', f.breakOdds >= 100 ? 'never' : odds(f.breakOdds / 100)),
      econRow('Break-even FDV', isFinite(f.breakFdv) ? usd(f.breakFdv) : 'never'));

    var plan = (row.farm && ((row.farm.plans && row.farm.plans[state.depositIdx]) || row.farm.plan)) || [];
    var table = el('table', { class: 'farm-table' },
      el('thead', null, el('tr', null,
        el('th', { class: 'num', text: 'Step' }),
        el('th', { text: 'Action' }),
        el('th', { text: 'When' }),
        el('th', { text: 'Cost' }),
        el('th', { text: 'Time' }))),
      el('tbody', null, plan.map(function (st) {
        return el('tr', null,
          el('td', { class: 'farm-n num', text: String(st.step) }),
          el('td', { class: 'farm-step' }, st.action, el('span', { class: 'status ' + (st.status === 'verified' ? 'is-verified' : 'is-unverified'), text: st.status })),
          el('td', { class: 'farm-when', text: st.when }),
          el('td', { class: 'farm-cost', text: st.cost }),
          el('td', { class: 'farm-time', text: st.time }));
      })));

    var risk = el('p', { class: 'calc-note risk' },
      el('b', { text: 'Key risk: ' }),
      (row.farm && row.farm.risk ? row.farm.risk : 'The plan pays only if the token arrives and the allocation is not diluted past this estimate.'));

    return el('div', { class: 'detail-section' },
      el('p', { class: 'detail-sec-label', text: 'Farm plan' }),
      scenario,
      el('div', { class: 'farm-grid' }, econ, el('div', { class: 'farm-actions' }, table)),
      risk,
      el('p', { class: 'calc-note muted', text: 'Estimates, not income. The verdict requires net per hour at or above $' +
        K.labour_usd_per_hour + ' and break-even odds at least ' + K.odds_margin + '\u00d7 the modelled odds; ' +
        'anything else positive is MARGINAL, and a negative net is SKIP.' }));
  }

  function setDeposit(i) {
    state.depositIdx = i;
    var tabs = document.querySelectorAll('#dep-tabs [data-dep]');
    for (var k = 0; k < tabs.length; k++) {
      var isOn = Number(tabs[k].dataset.dep) === i;
      tabs[k].classList.toggle('is-active', isOn);
      tabs[k].setAttribute('aria-pressed', String(isOn));
    }
    renderHeader();
    renderBoard();
    var dlg = document.getElementById('detail');
    if (dlg && dlg.open && currentIndex >= 0 && view[currentIndex]) renderDetail(view[currentIndex]);
  }

  function renderSortHeads() {
    var heads = document.querySelectorAll('#board-table th.sortable');
    for (var i = 0; i < heads.length; i++) {
      var th = heads[i];
      var arrow = th.querySelector('.sort-arrow');
      if (arrow) th.removeChild(arrow);
      if (th.dataset.key === state.sortKey) {
        th.classList.add('is-sorted');
        th.setAttribute('aria-sort', state.sortDir === 'asc' ? 'ascending' : 'descending');
        th.appendChild(el('span', { class: 'sort-arrow', text: state.sortDir === 'asc' ? '\u25b4' : '\u25be', 'aria-hidden': 'true' }));
      } else {
        th.classList.remove('is-sorted');
        th.setAttribute('aria-sort', 'none');
      }
    }
  }

  function renderFit() {
    if (!radar || !radar.fit) return;
    var f = radar.fit;
    function num(n, d) { return (typeof n === 'number' && isFinite(n)) ? n.toFixed(d) : '\u2014'; }

    setText('res-sub', f.n_live + ' live-token peers priced \u00b7 ' + f.n_categories + ' categories \u00b7 prior k=' +
      f.prior_k + ' \u00b7 band z=' + num(f.band_z, 2));

    var body = document.getElementById('ablation-body');
    if (body) {
      f.ablation.forEach(function (r) {
        body.appendChild(el('tr', { class: r.priced ? 'is-kept' : 'is-refused' },
          el('td', { text: r.name }),
          el('td', { class: 'num', text: num(r.mae_dex, 3) }),
          el('td', { class: 'num', text: r.delta_dex > 0 ? '+' + num(r.delta_dex, 3) : num(r.delta_dex, 3) })));
      });
    }

    var cover = document.getElementById('cover-body');
    if (cover && radar.coverage) {
      var rows = [
        ['P25\u2013P75', radar.coverage.cover50, 0.50],
        ['P10\u2013P90', radar.coverage.cover80, 0.80],
      ];
      rows.forEach(function (r) {
        cover.appendChild(el('tr', null,
          el('td', { text: r[0] }),
          el('td', { class: 'num', text: Math.round(r[1] * 100) + '%' }),
          el('td', { class: 'num', text: Math.round(r[2] * 100) + '%' })));
      });
    }

    var calib = document.getElementById('calib-body');
    if (calib && radar.launch && radar.launch.bins) {
      radar.launch.bins.forEach(function (b) {
        calib.appendChild(el('tr', null,
          el('td', { text: (b.lo * 100).toFixed(0) + '\u2013' + (b.hi * 100).toFixed(0) + '%' }),
          el('td', { class: 'num', text: (b.observed * 100).toFixed(1) + '%' }),
          el('td', { class: 'num', text: String(b.n) })));
      });
    }
    setText('res-calib-foot', 'Out-of-fold predicted probability against the labelled outcome. Brier ' +
      num(radar.launch.brier, 3) + ' against ' + num(radar.launch.brier_base, 3) + ' for the base rate.');

    setText('f-k', String(f.prior_k));
    setText('f-z', num(f.band_z, 2));
    setText('f-slope', num(f.size_slope, 3));
    setText('f-t', num(f.size_t, 2));
    var ship = null;
    for (var i = 0; i < f.ablation.length; i++) if (f.ablation[i].priced) ship = f.ablation[i];
    setText('f-mae-cat', num(f.ablation[1] ? f.ablation[1].mae_dex : NaN, 3));
    setText('f-mae-ship', num(ship ? ship.mae_dex : NaN, 3));
    setText('f-auc', num(radar.launch.auc, 3));
    setText('f-brier', num(radar.launch.brier, 3));
    setText('f-brier-base', num(radar.launch.brier_base, 3));
    setText('f-horizon', Math.round(radar.horizon_share * 100) + '%');
    setText('f-share', (K.farmer_share * 100).toFixed(1) + '%');
    setText('f-elig', Math.round(K.eligible_tvl_share * 100) + '%');
    setText('f-fixed', '$' + K.fixed_cost_usd);
    setText('f-months', String(K.months));

    var list = document.getElementById('res-list');
    if (list) {
      f.ablation.filter(function (a) { return !a.priced; }).forEach(function (a) {
        list.appendChild(el('li', null,
          el('b', { text: a.name + ': ' }),
          '+' + num(a.delta_dex, 3) + ' dex of held-out error. Refused, so it does not move a row.'));
      });
      list.appendChild(el('li', null,
        el('b', { text: 'Sample: ' }),
        f.n_live + ' priced peers. That is enough to rank levels, not enough to claim statistical significance.')); 
    }

    var foot = document.getElementById('how-foot');
    if (foot) {
      foot.textContent = 'Fitted on this snapshot, not typed in: ' + f.n_live + ' live-token peers gave one market multiple of ' +
        f.global_multiple.toFixed(3) + '\u00d7, then ' + f.categories.filter(function (c) { return c.n > 0; }).length +
        ' category levels shrunk toward it with a prior of ' + f.prior_k + ' peers. Size slope ' + num(f.size_slope, 3) +
        ' dex per decade (t=' + num(f.size_t, 2) + '). Median held-out error ' + num(f.p50_ratio, 2) + '\u00d7 against ' +
        num(f.baseline_p50_ratio, 2) + '\u00d7 for a flat multiple.';
    }

    var limit = document.getElementById('honest-limit');
    if (limit) {
      limit.textContent = 'What this desk cannot do: with ' + f.n_live + ' priced peers it sets a level per category and ' +
        'orders rows by odds and size, but it cannot separate two protocols inside one category beyond their TVL. ' +
        'Launch odds are a prevalence model, not a catalyst model: an announced airdrop page would move a row and this ' +
        'snapshot does not carry one. Every figure is an estimate with a band, not a price.';
    }
  }

  function wireEvents() {
    var q = document.getElementById('q');
    if (q) q.addEventListener('input', function () { state.query = q.value; renderBoard(); });

    var cat = document.getElementById('category');
    if (cat) cat.addEventListener('change', function () { state.category = cat.value; renderBoard(); });

    var chain = document.getElementById('chain');
    if (chain) chain.addEventListener('change', function () { state.chain = chain.value; renderBoard(); });

    var verd = document.getElementById('verdict');
    if (verd) verd.addEventListener('change', function () { state.verdict = verd.value; renderBoard(); });

    var band = document.getElementById('tvl-band');
    if (band) band.addEventListener('change', function () { state.tvlBand = band.value; renderBoard(); });

    var sort = document.getElementById('sort');
    if (sort) sort.addEventListener('change', function () {
      state.sortKey = sort.value;
      state.sortDir = (state.sortKey === 'name' || state.sortKey === 'age' || state.sortKey === 'tvl') ? 'asc' : 'desc';
      renderSortHeads();
      renderBoard();
    });

    var tabs = document.querySelectorAll('#dep-tabs [data-dep]');
    for (var i = 0; i < tabs.length; i++) {
      tabs[i].addEventListener('click', function (e) { setDeposit(Number(e.currentTarget.dataset.dep)); });
    }

    var resetBtn = document.getElementById('reset');
    if (resetBtn) resetBtn.addEventListener('click', function () {
      state.query = '';
      state.verdict = '';
      state.category = '';
      state.chain = '';
      state.tvlBand = '';
      state.sortKey = 'implied';
      state.sortDir = 'desc';
      state.depositIdx = 1;
      state.share = K.farmer_share;
      if (q) q.value = '';
      ['category', 'chain', 'verdict', 'tvl-band'].forEach(function (id) {
        var s = document.getElementById(id);
        if (s) s.value = '';
      });
      var sortSel = document.getElementById('sort');
      if (sortSel) sortSel.value = 'implied';
      var depTabs = document.querySelectorAll('#dep-tabs [data-dep]');
      for (var k = 0; k < depTabs.length; k++) {
        depTabs[k].classList.toggle('is-active', k === 1);
        depTabs[k].setAttribute('aria-pressed', String(k === 1));
      }
      renderSortHeads();
      renderBoard();
    });

    var emptyReset = document.getElementById('empty-reset');
    if (emptyReset && resetBtn) emptyReset.addEventListener('click', function () { resetBtn.click(); });

    var heads = document.querySelectorAll('#board-table th.sortable');
    for (var b = 0; b < heads.length; b++) {
      heads[b].addEventListener('click', function (e) {
        var key = e.currentTarget.dataset.key;
        if (!key) return;
        if (state.sortKey === key) state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
        else {
          state.sortKey = key;
          state.sortDir = (key === 'name' || key === 'age' || key === 'tvl') ? 'asc' : 'desc';
        }
        var sel = document.getElementById('sort');
        if (sel) sel.value = key;
        renderSortHeads();
        renderBoard();
      });
    }

    var body = document.getElementById('board-body');
    if (body) body.addEventListener('click', function (e) {
      var tr = e.target.closest ? e.target.closest('tr.rowlink') : null;
      if (tr && tr.dataset.slug) openDetail(tr.dataset.slug);
    });

    var dialog = document.getElementById('detail');
    if (dialog) {
      var close = document.getElementById('detail-close');
      if (close) close.addEventListener('click', function () { dialog.close(); });
      var prev = document.getElementById('detail-prev');
      var next = document.getElementById('detail-next');
      function step(delta) {
        if (view.length === 0 || currentIndex < 0) return;
        currentIndex = (currentIndex + delta + view.length) % view.length;
        renderDetail(view[currentIndex]);
      }
      if (prev) prev.addEventListener('click', function () { step(-1); });
      if (next) next.addEventListener('click', function () { step(1); });
      dialog.addEventListener('keydown', function (e) {
        if (e.key === 'ArrowLeft') step(-1);
        if (e.key === 'ArrowRight') step(1);
      });
    }
  }

  // Honest read-only handle for the screenshot tooling and for anyone auditing the page in a console.
  window.RadarApp = {
    deposit: function (i) { setDeposit(i); },
    farmAt: farmAt,
    rows: function () { return view.slice(); },
    detail: openDetail,
  };

  renderHeader();
  renderFit();
  populateSelects();
  wireEvents();
  renderSortHeads();
  if (!checkOk) {
    var note = document.getElementById('count');
    if (note) note.textContent = 'Farm economics in the page do not reproduce the build\u2019s own numbers; treat the farm columns as unreliable.';
  }
  if (radar) renderBoard(); else showEmpty('no-data');
  renderLive();
})();
