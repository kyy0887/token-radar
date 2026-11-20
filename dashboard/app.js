/* Token Radar - pre-token launch desk.
 *
 * Renders entirely from window.RADAR, the snapshot's data script that index.html loads before this
 * file. No fetch, no network, no framework: every figure on the page is either read from RADAR or
 * computed from RADAR's own numbers. The three model functions below (capitalFor, holdDaysFor,
 * actionFor) mirror lib/model.ts so the farm plan a row shows is the plan the model wrote.
 */
(function () {
  'use strict';

  var radar = window.RADAR || null;
  if (!radar || !Array.isArray(radar.rows)) radar = null;

  /* ---------- element helper ---------- */

  /** A DOM element from a tag, a props object and children (strings or nodes). */
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
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) { for (var j = 0; j < child.length; j++) if (child[j]) node.appendChild(child[j]); }
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  /* ---------- formatting helpers ---------- */

  /** '$2.75B' / '$570.8M' / '$499.1K' / '$123'; null or NaN becomes an em dash. */
  function usd(n) {
    if (typeof n !== 'number' || !isFinite(n)) return '\u2014';
    if (n >= 1e9) return '$' + round1(n / 1e9) + 'B';
    if (n >= 1e6) return '$' + round1(n / 1e6) + 'M';
    if (n >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return '$' + Math.round(n);
  }

  function round1(n) { return Math.round(n * 10) / 10; }

  /** '+5.64%' / '-2.19%' / an em dash when null. */
  function pct(n) {
    if (typeof n !== 'number' || !isFinite(n)) return '\u2014';
    return (n >= 0 ? '+' : '') + round1(n) + '%';
  }

  /** '543d' / '1.5 y' / an em dash when null. */
  function age(d) {
    if (typeof d !== 'number' || !isFinite(d) || d < 0) return '\u2014';
    if (d < 1000) return Math.round(d) + 'd';
    return round1(d / 365) + ' y';
  }

  /** 'x0.99' with two decimals trimmed, or an em dash. */
  function mult(n) {
    if (typeof n !== 'number' || !isFinite(n)) return '\u2014';
    var s = (Math.round(n * 100) / 100).toFixed(2);
    return '\u00d7' + s;
  }

  function dash() { return '\u2014'; }

  /* ---------- the model, mirrored from lib/model.ts ---------- */

  /** How much capital one farm position needs, from the protocol's own TVL. */
  function capitalFor(tvl) {
    if (tvl >= 5e9) return 250;
    if (tvl >= 1e9) return 150;
    if (tvl >= 1e8) return 100;
    return 50;
  }

  /** How long to hold: younger protocols get a longer qualifying window. */
  function holdDaysFor(ageDays) {
    if (ageDays === null || ageDays === undefined) return 30;
    if (ageDays < 180) return 60;
    if (ageDays < 365) return 45;
    return 30;
  }

  /** The category's one action, in the words a farmer can follow. */
  function actionFor(category, name, capital, chain) {
    var c = (category || '').toLowerCase();
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) {
      return 'Supply $' + capital + ' of USDC to ' + name + ' on ' + chain + ' and keep the position open.';
    }
    if (c.indexOf('dex') >= 0 || c.indexOf('yield') >= 0 || c.indexOf('leveraged farm') >= 0) {
      return "Provide $" + capital + " of liquidity to " + name + "'s main pool on " + chain + " and keep the position open.";
    }
    if (c.indexOf('bridge') >= 0) {
      return 'Bridge $' + capital + ' of USDC to ' + chain + ' through ' + name + ' and use the bridged funds in its app.';
    }
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) {
      return 'Stake $' + capital + " of the chain's staking asset through " + name + ' and keep the receipt.';
    }
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0) {
      return 'Deposit $' + capital + ' of USDC as margin on ' + name + ' and open one small hedge.';
    }
    if (c.indexOf('prediction') >= 0) {
      return 'Fund $' + capital + ' and place one market position on ' + name + '.';
    }
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0) {
      return 'Deposit $' + capital + ' into a ' + name + ' vault on ' + chain + ' and keep the shares.';
    }
    if (c.indexOf('stable') >= 0) {
      return 'Mint or deposit $' + capital + ' of the stable asset through ' + name + ' on ' + chain + '.';
    }
    if (c.indexOf('rwa') >= 0) {
      return "Mint $" + capital + " of the protocol's yield asset on " + chain + ' and hold it.';
    }
    if (c.indexOf('insurance') >= 0) {
      return 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' and keep the policy.';
    }
    return 'Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain + ' and keep the position open.';
  }

  /** A farm plan of six steps, each with an action, a cost and a time. */
  function farmPlan(row) {
    var chain = row.chains && row.chains.length > 0 ? row.chains[0] : 'its main chain';
    var capital = capitalFor(row.tvl_usd);
    var hold = holdDaysFor(row.age_days);
    var action = actionFor(row.category, row.name, capital, chain);
    return [
      { step: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.', cost: 'under $3 of gas', time: '5 minutes' },
      { step: action, cost: '$' + capital + ' of capital, about $' + (capital >= 150 ? 8 : 4) + ' of gas', time: '15 minutes to set up' },
      { step: 'Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.', cost: 'about $2 of gas a week', time: '10 minutes a week' },
      { step: 'Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot.', cost: 'the $' + capital + ' stays in the position', time: hold + ' days' },
      { step: "Before you withdraw, open the protocol's own points page and claim only from the link it publishes.", cost: 'no fee to check; never pay to claim', time: '10 minutes' },
      { step: 'Write the wallet, the dates and every transaction in a farm log so the position can be repeated or unwound.', cost: 'nothing but the log', time: '5 minutes' },
    ];
  }

  /* ---------- state ---------- */

  var state = {
    tab: 'pre',            // 'pre' | 'live'
    query: '',
    category: '',
    sortKey: 'rank',
    sortDir: 'asc',
  };

  var maxImplied = 1;
  if (radar) {
    for (var i = 0; i < radar.rows.length; i++) {
      if (radar.rows[i].implied_value_usd > maxImplied) maxImplied = radar.rows[i].implied_value_usd;
    }
  }

  var view = []; // rows currently shown, in display order

  /* ---------- derived figures, all computed from RADAR ---------- */

  function medianImplied(rows) {
    if (rows.length === 0) return null;
    var values = rows.map(function (r) { return r.implied_value_usd; }).sort(function (a, b) { return a - b; });
    var mid = Math.floor(values.length / 2);
    return values.length % 2 ? values[mid] : (values[mid - 1] + values[mid]) / 2;
  }

  function topCategoryByImplied(rows) {
    var totals = {};
    for (var i = 0; i < rows.length; i++) {
      var key = rows[i].category || 'Uncategorized';
      totals[key] = (totals[key] || 0) + rows[i].implied_value_usd;
    }
    var best = null;
    for (var cat in totals) {
      if (best === null || totals[cat] > totals[best]) best = cat;
    }
    return best === null ? null : { name: best, total: totals[best] };
  }

  /** How many of the watchlist slugs the board's rows cover, from RADAR's own counts. */
  function coverageLabel() {
    if (!radar) return null;
    var floorRows = radar.rows.filter(function (r) { return r.tvl_usd >= radar.floor_usd; }).length;
    var covered = Math.min(radar.watchlist_size, floorRows);
    return covered + '/' + radar.watchlist_size;
  }

  /* ---------- header, coverage, KPIs ---------- */

  function renderHeader() {
    if (!radar) return;
    var set = function (id, value) { var n = document.getElementById(id); if (n) n.textContent = value; };
    set('t-asof', 'Snapshot ' + radar.as_of);
    set('t-floor', 'Floor ' + usd(radar.floor_usd));
    set('t-model', radar.model_version);
    set('cov-watch', coverageLabel() || dash());
    set('cov-ranked', String(radar.board_size));
    set('cov-early', String(radar.early_size));
    set('cov-live', String(radar.live_size));

    var median = medianImplied(radar.rows);
    set('kpi-median', usd(median));
    set('kpi-median-note', 'middle of ' + radar.rows.length + ' ranked protocols');

    var tvlTotal = radar.rows.reduce(function (a, r) { return a + (r.tvl_usd || 0); }, 0);
    set('kpi-tvl', usd(tvlTotal));
    set('kpi-tvl-note', 'across ' + radar.rows.length + ' protocols');

    var top = topCategoryByImplied(radar.rows);
    set('kpi-cat', top ? top.name : dash());
    set('kpi-cat-note', top ? usd(top.total) + ' implied value in total' : '');

    var howFoot = document.getElementById('how-foot');
    if (howFoot && radar.fit) {
      var f = radar.fit;
      howFoot.textContent = 'Fitted on this snapshot, not typed in: ' + f.n_live +
        ' live-token peers. One global multiple of ' + f.global_multiple.toFixed(3) + 'x, then ' +
        f.categories.filter(function (c) { return c.n > 0; }).length +
        ' category multiples shrunk toward it with a prior of ' + f.prior_k + '.';
    }

    var src = document.getElementById('t-source');
    if (src && radar.source) {
      // Show only the source's words; the snapshot's own URL string is not rendered as a link.
      var words = radar.source.split(/\s+/);
      src.textContent = words.slice(0, 2).join(' ');
    }
    set('t-floor2', usd(radar.floor_usd));
    set('t-model2', radar.model_version);
  }

  /* ---------- filters ---------- */

  function populateCategories() {
    var select = document.getElementById('category');
    if (!select || !radar) return;
    var seen = {};
    radar.rows.forEach(function (r) {
      var c = r.category;
      if (c && !seen[c]) { seen[c] = true; select.appendChild(el('option', { value: c, text: c })); }
    });
  }

  function rowMatches(row) {
    var q = state.query.trim().toLowerCase();
    if (q) {
      var hay = [row.name, row.slug, row.category || '', (row.chains || []).join(' ')].join(' ').toLowerCase();
      if (hay.indexOf(q) < 0) return false;
    }
    if (state.category && row.category !== state.category) return false;
    return true;
  }

  function sortView(rows) {
    var key = state.sortKey;
    var dir = state.sortDir === 'asc' ? 1 : -1;
    var copy = rows.slice();
    copy.sort(function (a, b) {
      var va, vb;
      if (key === 'name') { va = a.name.toLowerCase(); vb = b.name.toLowerCase(); }
      else if (key === 'tvl') { va = a.tvl_usd; vb = b.tvl_usd; }
      else if (key === 'change') { va = a.change_7d === null || a.change_7d === undefined ? -Infinity : a.change_7d; vb = b.change_7d === null || b.change_7d === undefined ? -Infinity : b.change_7d; }
      else if (key === 'age') { va = a.age_days === null || a.age_days === undefined ? -1 : a.age_days; vb = b.age_days === null || b.age_days === undefined ? -1 : b.age_days; }
      else if (key === 'implied') { va = a.implied_value_usd; vb = b.implied_value_usd; }
      else { va = a.rank; vb = b.rank; }
      if (va < vb) return -dir;
      if (va > vb) return dir;
      return a.rank - b.rank;
    });
    return copy;
  }

  /* ---------- rendering: board ---------- */

  function renderBoard() {
    var body = document.getElementById('board-body');
    if (!body) return;
    while (body.firstChild) body.removeChild(body.firstChild);

    if (!radar) { showEmpty('no-data'); return; }

    var matched = radar.rows.filter(rowMatches);
    view = sortView(matched);
    hideEmpty();

    if (view.length === 0) {
      showEmpty('empty');
      return;
    }

    for (var i = 0; i < view.length; i++) body.appendChild(boardRow(view[i]));
    renderCount(view.length, matched.length);
  }

  function boardRow(row) {
    var change = row.change_7d;
    var changeClass = change === null || change === undefined ? 'chg-flat' : change >= 0 ? 'chg-pos' : 'chg-neg';
    var changeArrow = change === null || change === undefined ? '' : change >= 0 ? '\u25b2 ' : '\u25bc ';

    var barWidth = Math.max(2, Math.round((row.implied_value_usd / maxImplied) * 100));
    var bar = el('div', { class: 'impl-bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + barWidth + '%' }));

    var multChip = el('span', { class: 'mult-chip', title: 'fitted multiple: ' + row.category_n + ' live-token peer(s) in this category, shifted along the TVL size slope' }, mult(row.multiple));
    var bandChip = el('span', { class: 'mult-chip', title: '80 per cent leave-one-out band for this implied value' }, usd(row.low_value_usd) + '\u2013' + usd(row.high_value_usd));

    return el('tr', {
      class: 'rowlink',
      tabindex: '0',
      role: 'button',
      'aria-label': 'Open ' + row.name + ' details',
      dataset: { slug: row.slug },
      onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(row.slug); } },
    },
      el('td', { class: 'num' }, el('span', { class: 'rank' + (row.rank <= 3 ? ' rank-top' : ''), text: String(row.rank) })),
      el('td', null,
        el('div', { class: 'name-cell' },
          el('span', { class: 'proto-name', text: row.name || row.slug }),
          el('span', { class: 'proto-cat', text: row.category || 'Uncategorized' }))),
      el('td', { class: 'num tvl-cell', text: usd(row.tvl_usd) }),
      el('td', { class: 'num ' + changeClass }, changeArrow + pct(change)),
      el('td', { class: 'num', text: age(row.age_days) }),
      el('td', { class: 'impl-cell' },
        el('span', { class: 'impl-value', text: usd(row.implied_value_usd) }),
        bar,
        el('div', { class: 'impl-mults' }, multChip, bandChip)),
      el('td', null, el('span', { class: 'badge', text: 'NO TOKEN' })));
  }

  function renderCount(shown, matched) {
    var n = document.getElementById('count');
    if (!n || !radar) return;
    var filtered = matched < radar.rows.length ? ' (' + matched + ' after filters)' : '';
    n.textContent = '';
    n.appendChild(document.createTextNode('Showing '));
    var b = el('b', { text: shown + ' of ' + radar.rows.length });
    n.appendChild(b);
    n.appendChild(document.createTextNode(filtered + ' \u00b7 ' + radar.watchlist_size + ' on the watchlist floor'));
  }

  /* ---------- rendering: live ---------- */

  function renderLive() {
    var body = document.getElementById('live-body');
    if (!body || !radar) return;
    while (body.firstChild) body.removeChild(body.firstChild);
    var rows = radar.live || [];
    if (state.category) rows = rows.filter(function (r) { return r.category === state.category; });
    var q = state.query.trim().toLowerCase();
    if (q) {
      rows = rows.filter(function (r) {
        var hay = [r.name, r.slug, r.category || '', (r.chains || []).join(' ')].join(' ').toLowerCase();
        return hay.indexOf(q) >= 0;
      });
    }
    for (var i = 0; i < rows.length; i++) body.appendChild(liveRow(rows[i]));
    renderCount(rows.length, rows.length);
    var emptyNote = document.getElementById('live-panel');
    if (emptyNote && rows.length === 0) {
      body.appendChild(el('tr', null, el('td', { colspan: '6' }, el('p', { class: 'live-note', text: 'No live-token protocol matches that filter.' }))));
    }
  }

  function liveRow(row) {
    var change = row.change_7d;
    var changeClass = change === null || change === undefined ? 'chg-flat' : change >= 0 ? 'chg-pos' : 'chg-neg';
    var changeArrow = change === null || change === undefined ? '' : change >= 0 ? '\u25b2 ' : '\u25bc ';
    return el('tr', null,
      el('td', null, el('div', { class: 'name-cell' },
        el('span', { class: 'proto-name', text: row.name || row.slug }),
        el('span', { class: 'proto-cat', text: row.category || 'Uncategorized' }))),
      el('td', { text: row.category || dash() }),
      el('td', { class: 'num tvl-cell', text: usd(row.tvl_usd) }),
      el('td', { class: 'num', text: usd(row.mcap_usd) }),
      el('td', { class: 'num ' + changeClass }, changeArrow + pct(change)),
      el('td', null, el('span', { class: 'badge badge-live', text: 'TRADES' })));
  }

  /* ---------- empty states ---------- */

  function showEmpty(id) {
    var boardPanel = document.getElementById('board-panel');
    var table = document.getElementById('board-table');
    var panel = document.getElementById(id);
    if (table) table.hidden = true;
    if (panel) panel.hidden = false;
    if (panel === document.getElementById('no-data') && boardPanel) boardPanel.classList.add('is-blank');
    var count = document.getElementById('count');
    if (id === 'empty' && count) count.textContent = 'Showing 0 of ' + (radar ? radar.rows.length : 0) + ' \u00b7 nothing matches the current filters';
  }

  function hideEmpty() {
    var table = document.getElementById('board-table');
    if (table) table.hidden = false;
    ['empty', 'no-data'].forEach(function (id) { var p = document.getElementById(id); if (p) p.hidden = true; });
  }

  /* ---------- detail dialog ---------- */

  var currentIndex = -1;

  function openDetail(slug) {
    if (!radar) return;
    var idx = -1;
    for (var i = 0; i < view.length; i++) { if (view[i].slug === slug) { idx = i; break; } }
    if (idx < 0) return;
    currentIndex = idx;
    renderDetail(view[idx]);
    var dialog = document.getElementById('detail');
    if (dialog && !dialog.open) dialog.showModal();
  }

  function renderDetail(row) {
    var set = function (id, value) { var n = document.getElementById(id); if (n) n.textContent = value; };
    set('detail-name', row.name || row.slug);
    set('detail-meta', (row.category || 'Uncategorized') + ' \u00b7 rank #' + row.rank);
    set('detail-value', usd(row.implied_value_usd));
    var ratio = row.tvl_usd > 0 ? row.implied_value_usd / row.tvl_usd : null;
    set('detail-ratio', ratio === null ? '' : (round1(ratio * 100) / 100) + '\u00d7 its TVL');

    var body = document.getElementById('detail-body');
    if (!body) return;
    while (body.firstChild) body.removeChild(body.firstChild);

    body.appendChild(detailChains(row));
    body.appendChild(detailModel(row));
    body.appendChild(detailPlan(row));
  }

  function detailChains(row) {
    var chips = el('div', { class: 'chain-chips' });
    var chains = row.chains || [];
    if (chains.length === 0) chips.appendChild(el('span', { class: 'chain-chip', text: 'No chain recorded' }));
    else for (var i = 0; i < chains.length; i++) chips.appendChild(el('span', { class: 'chain-chip', text: chains[i] }));
    return el('div', { class: 'detail-section' },
      el('p', { class: 'detail-sec-label', text: 'Category & chains' }),
      chips);
  }

  /** The step-by-step arithmetic, each step with a bar sized against the implied value. */
  function detailModel(row) {
    var tvl = row.tvl_usd;
    var f = radar && radar.fit ? radar.fit : null;
    var key = row.category ? String(row.category).trim().toLowerCase() : 'uncategorised';
    var logCat = f && f.log_by_category[key] !== undefined ? f.log_by_category[key] : (f ? f.log_global : 0);
    var catMul = Math.pow(10, logCat);
    var logTvl = Math.log(tvl) / Math.LN10;
    var logSize = f ? f.intercept + f.size_slope * (logTvl - f.mean_log_tvl) : 0;
    var sizeMul = Math.pow(10, logSize);
    var implied = row.implied_value_usd;

    var scale = Math.max(implied, 1);
    function barRow(label, value, width, isAmber) {
      return el('div', { class: 'calc-row' },
        el('span', { class: 'calc-label', text: label }),
        el('span', { class: 'calc-bar' + (isAmber ? '' : ' mint') }, el('i', { style: 'width:' + Math.max(1, Math.round((width / scale) * 100)) + '%' })),
        el('span', { class: 'calc-val' + (isAmber ? ' is-amber' : ''), text: value }));
    }

    return el('div', { class: 'detail-section' },
      el('p', { class: 'detail-sec-label', text: 'How the implied value is built' }),
      el('div', { class: 'calc-rows' },
        barRow('TVL', usd(tvl), tvl, false),
        barRow('\u00d7 category', usd(tvl * catMul), tvl * catMul, false),
        barRow('\u00d7 size', usd(implied), implied, false),
        barRow('band', usd(row.low_value_usd) + ' \u2013 ' + usd(row.high_value_usd), implied, true)),
      el('p', { class: 'calc-note' },
        'TVL ' + usd(tvl) + ' \u00d7 ' + catMul.toFixed(3) + ' category (' + row.category_n +
        ' peers) \u00d7 ' + sizeMul.toFixed(3) + ' size (log TVL ' + logTvl.toFixed(2) + ' against ' +
        f.mean_log_tvl.toFixed(2) + ') \u2192 ' + usd(implied) + ' implied. 80% band ' +
        usd(row.low_value_usd) + ' to ' + usd(row.high_value_usd) + '. Growth ' + pct(row.change_7d) +
        ' and ' + age(row.age_days) + ' without a token are shown as context: the ablation refused both, ' +
        'so neither moves this figure.'));
  }

  function detailPlan(row) {
    var plan = farmPlan(row);
    var table = el('table', { class: 'farm-table' },
      el('thead', null, el('tr', null,
        el('th', { text: '#', class: 'num' }),
        el('th', { text: 'Step' }),
        el('th', { text: 'Cost' }),
        el('th', { text: 'Time' }))),
      el('tbody', null, plan.map(function (step, i) {
        return el('tr', null,
          el('td', { class: 'farm-n num', text: String(i + 1) }),
          el('td', { class: 'farm-step', text: step.step }),
          el('td', { class: 'farm-cost', text: step.cost }),
          el('td', { class: 'farm-time', text: step.time }));
      })));
    return el('div', { class: 'detail-section' },
      el('p', { class: 'detail-sec-label', text: 'Farm plan' }),
      table);
  }

  /* ---------- sorting UI ---------- */

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

  /* ---------- events ---------- */

  function wireEvents() {
    var q = document.getElementById('q');
    if (q) {
      q.addEventListener('input', function () {
        state.query = q.value;
        state.tab === 'live' ? renderLive() : renderBoard();
      });
    }

    var cat = document.getElementById('category');
    if (cat) {
      cat.addEventListener('change', function () {
        state.category = cat.value;
        state.tab === 'live' ? renderLive() : renderBoard();
      });
    }

    var tabPre = document.getElementById('tab-pre');
    var tabLive = document.getElementById('tab-live');
    function setTab(tab) {
      state.tab = tab;
      if (tabPre && tabLive) {
        tabPre.classList.toggle('is-active', tab === 'pre');
        tabLive.classList.toggle('is-active', tab === 'live');
        tabPre.setAttribute('aria-pressed', String(tab === 'pre'));
        tabLive.setAttribute('aria-pressed', String(tab === 'live'));
      }
      var boardPanel = document.getElementById('board-panel');
      var livePanel = document.getElementById('live-panel');
      if (boardPanel) boardPanel.hidden = tab !== 'pre';
      if (livePanel) livePanel.hidden = tab !== 'live';
      if (tab === 'live') renderLive(); else renderBoard();
    }
    if (tabPre) tabPre.addEventListener('click', function () { setTab('pre'); });
    if (tabLive) tabLive.addEventListener('click', function () { setTab('live'); });

    var resetBtn = document.getElementById('reset');
    if (resetBtn) {
      resetBtn.addEventListener('click', function () {
        state.query = '';
        state.category = '';
        if (q) q.value = '';
        if (cat) cat.value = '';
        state.tab === 'live' ? renderLive() : renderBoard();
      });
    }
    var emptyReset = document.getElementById('empty-reset');
    if (emptyReset && resetBtn) emptyReset.addEventListener('click', function () { resetBtn.click(); });

    var heads = document.querySelectorAll('#board-table th.sortable');
    for (var i = 0; i < heads.length; i++) {
      heads[i].addEventListener('click', function (e) {
        var key = e.currentTarget.dataset.key;
        if (!key) return;
        if (state.sortKey === key) state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
        else { state.sortKey = key; state.sortDir = key === 'rank' || key === 'implied' ? 'desc' : 'asc'; }
        renderSortHeads();
        renderBoard();
      });
    }

    var body = document.getElementById('board-body');
    if (body) {
      body.addEventListener('click', function (e) {
        var tr = e.target.closest ? e.target.closest('tr.rowlink') : null;
        if (tr && tr.dataset.slug) openDetail(tr.dataset.slug);
      });
    }

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

  /* ---------- fitted model panel ---------- */

  /** Fill the calibration figures and the two tables straight from radar.fit: no number is typed here. */
  function renderFit() {
    if (!radar || !radar.fit) return;
    var f = radar.fit;
    var set = function (id, value) { var n = document.getElementById(id); if (n) n.textContent = value; };
    function num(n, d) { return (typeof n === 'number' && isFinite(n)) ? n.toFixed(d) : '\u2014'; }
    function pctOf(n) { return (typeof n === 'number' && isFinite(n)) ? Math.round(n * 100) + '%' : '\u2014'; }

    set('f-k', String(f.prior_k));
    set('f-z', num(f.band_z, 2));
    set('f-slope', num(f.size_slope, 3));
    set('f-t', num(f.size_t, 2));

    var rows = f.ablation || [];
    var byCat = rows.length > 2 ? rows[1] : null;
    var byShip = rows.length > 2 ? rows[2] : null;
    if (byCat) set('f-mae-cat', num(byCat.mae_dex, 3));
    if (byShip) set('f-mae-ship', num(byShip.mae_dex, 3));

    var body = document.getElementById('ablation-body');
    if (body) {
      for (var i = 0; i < rows.length; i++) {
        var r = rows[i];
        var shipped = r.priced ? 'yes' : (r.delta_dex > 0 ? 'no, it cost ' + num(r.delta_dex, 3) + ' dex' : 'no');
        body.appendChild(el('tr', null,
          el('td', { class: 'farm-step', text: r.name }),
          el('td', { class: 'num', text: num(r.mae_dex, 3) }),
          el('td', { class: 'num', text: i === 0 ? '\u2014' : (r.delta_dex > 0 ? '+' : '') + num(r.delta_dex, 3) }),
          el('td', { text: shipped })));
      }
    }

    var catBody = document.getElementById('cat-body');
    var cats = (f.categories || []).slice().filter(function (c) { return c.n > 0; });
    if (catBody) {
      for (var j = 0; j < cats.length; j++) {
        var c = cats[j];
        catBody.appendChild(el('tr', null,
          el('td', { class: 'farm-step', text: c.category }),
          el('td', { class: 'num', text: String(c.n) }),
          el('td', { class: 'num', text: num(c.geom_multiple, 3) + '\u00d7' }),
          el('td', { class: 'num', text: num(c.shrunk_multiple, 3) + '\u00d7' }),
          el('td', { class: 'num', text: num(c.low, 3) + ' \u2013 ' + num(c.high, 3) })));
      }
    }

    var limit = document.getElementById('honest-limit');
    if (limit) {
      limit.textContent = 'What this fit cannot do: with ' + f.n_live + ' live-token peers it levels each category to a multiple, and it cannot pick which single protocol inside a category wins. ' +
        'Leave-one-out, ' + pctOf(f.within2) + ' of peers land within 2x and ' + pctOf(f.within5) + ' within 5x, at a median actual/predicted of ' + num(f.p50_ratio, 2) + 'x ' +
        '(the plain global multiple is ' + num(f.baseline_p50_ratio, 2) + 'x). ' +
        'Seven-day momentum and age were tested and refused: each made out-of-sample error worse, so neither moves a row here. ' +
        'Treat a row as a level with a band, not as a price.';
    }
  }

  /* ---------- boot ---------- */

  renderHeader();
  renderFit();
  populateCategories();
  wireEvents();
  renderSortHeads();
  if (radar) renderBoard(); else showEmpty('no-data');
})();
