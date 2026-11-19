// Token Radar's plain dashboard. It reads window.RADAR (written beside dashboard/ by main.ts) and
// renders the ranked board, a filterable table, a per-protocol detail drawer with the model's own
// inputs and the protocol's farm plan. No network: every byte it shows is in data.js.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var state = { q: '', category: '', tab: 'pre-token', sort: 'implied', dir: -1, selected: null };

  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e12) return '$' + (n / 1e12).toFixed(2) + 'T';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  // The model in one function: the page recomputes a row from the snapshot figures and checks the
  // number board.json carries, so the page's code and the board's data are visibly the same arithmetic.
  function impliedOf(row, model) {
    var growth = Math.min(model.growth_cap, Math.max(model.growth_floor, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
    var growthMult = 1 + (growth / 100) * model.growth_weight;
    var age = row.age_days === null || row.age_days === undefined ? model.unknown_age_days : row.age_days;
    var maturity = model.maturity_floor + (Math.min(Math.max(age, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
    var airdrop = row.airdrop_multiplier === null || row.airdrop_multiplier === undefined ? 1 : row.airdrop_multiplier;
    return Math.max(1, Math.round(row.tvl_usd * model.base_multiple * growthMult * maturity * airdrop));
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  // The farm plan is the same derivation main.ts writes to board.json: category, chains, TVL and age
  // decide the action, the capital, the hold and every cost and time. No name is special-cased.
  function chainOf(p) { return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain'; }
  function capitalFor(p) {
    if (p.tvl_usd >= 5e9) return 250;
    if (p.tvl_usd >= 1e9) return 150;
    if (p.tvl_usd >= 1e8) return 100;
    return 50;
  }
  function holdDaysFor(age) {
    if (age === null || age === undefined) return 30;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  }
  function actionFor(p, capital, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Supply $' + capital + ' of USDC to ' + name + ' on ' + chain + ' and keep the position open.';
    if (c.indexOf('dex') >= 0 || c.indexOf('yield') >= 0 || c.indexOf('leveraged farm') >= 0) return 'Provide $' + capital + ' of liquidity to ' + name + "'s main pool on " + chain + ' and keep the position open.';
    if (c.indexOf('bridge') >= 0) return 'Bridge $' + capital + ' of USDC to ' + chain + ' through ' + name + ' and use the bridged funds in its app.';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return "Stake $" + capital + " of the chain's staking asset through " + name + ' and keep the receipt.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0) return 'Deposit $' + capital + ' of USDC as margin on ' + name + ' and open one small hedge.';
    if (c.indexOf('prediction') >= 0) return 'Fund $' + capital + ' and place one market position on ' + name + '.';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0) return 'Deposit $' + capital + ' into a ' + name + ' vault on ' + chain + ' and keep the shares.';
    if (c.indexOf('stable') >= 0) return 'Mint or deposit $' + capital + ' of the stable asset through ' + name + ' on ' + chain + '.';
    if (c.indexOf('rwa') >= 0) return "Mint $" + capital + " of the protocol's yield asset on " + chain + ' and hold it.';
    if (c.indexOf('insurance') >= 0) return 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' and keep the policy.';
    return 'Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain + ' and keep the position open.';
  }
  function stepText(step) {
    var s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
    if (s.length > 600) s = s.slice(0, 596) + '...';
    if (s.length < 20) s = s + " Hold the position and check the protocol's own page.";
    return s;
  }
  function farmSteps(p) {
    var chain = chainOf(p);
    var capital = capitalFor(p);
    var hold = holdDaysFor(p.age_days);
    return [
      { text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.', cost: 'under $3 of gas for the first transaction', time: '5 minutes' },
      { text: actionFor(p, capital, chain), cost: '$' + capital + ' of capital and about $' + (capital >= 150 ? 8 : 4) + ' of gas', time: '15 minutes to set up' },
      { text: 'Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.', cost: 'about $2 of gas a week', time: '10 minutes a week' },
      { text: 'Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot.', cost: 'the $' + capital + ' stays in the position', time: hold + ' days' },
      { text: "Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.", cost: 'no fee to check, and never pay to claim', time: '10 minutes' },
      { text: 'Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.', cost: 'nothing but the log', time: '5 minutes' }
    ].map(stepText);
  }

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('p')) state.selected = params.get('p');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('tab')) state.tab = params.get('tab');
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category) params.set('category', state.category);
    if (state.tab !== 'pre-token') params.set('tab', state.tab);
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  function rows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.category && r.category !== state.category) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sortedRows(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' },
        el('span', { class: 'mark', html: '<i></i>' }),
        el('span', { class: 'brand-text' },
          el('span', { class: 'brand-name', text: 'Token Radar' }),
          el('span', { class: 'brand-sub', text: 'pre-token launch desk' })
        )
      ),
      el('dl', { class: 'telemetry' },
        el('div', null,
          el('dt', { text: 'Snapshot' }),
          el('dd', { id: 't-asof', text: DATA.as_of })
        ),
        el('div', null,
          el('dt', { text: 'Floor' }),
          el('dd', { id: 't-floor', text: fmtUsd(DATA.floor_usd) })
        ),
        el('div', null,
          el('dt', { text: 'Model' }),
          el('dd', { id: 't-model', text: DATA.model_version })
        ),
        el('div', null,
          el('dt', { text: 'Status' }),
          el('dd', { class: 'lamp' },
            el('span', { class: 'lamp-dot', 'aria-hidden': 'true' }),
            el('span', { text: 'local data' })
          )
        )
      )
    );
  }

  function hero() {
    return el('section', { class: 'hero' },
      el('div', { class: 'hero-copy' },
        el('p', { class: 'kicker' },
          el('span', { id: 't-scanned', text: String(DATA.rows.length + DATA.live.length) }),
          ' protocols in the sealed snapshot'
        ),
        el('h1', null,
          el('span', { class: 'count', id: 't-watch', text: String(DATA.watchlist_size) }),
          ' protocols record no token. This is what one might be worth.'
        ),
        el('p', { class: 'lede', text: 'Every protocol at or above the watchlist floor that records no token is ranked by an implied value built from its own figures: TVL, seven-day growth and the time it has been tracked. The early radar adds the pre-token protocols below the floor; protocols whose token already trades are set aside with their market caps shown. The estimate is the entry\'s claim, not a promise, and not a price.' })
      ),
      el('div', { class: 'hero-stats', id: 't-stats' },
        el('div', { class: 'stat' },
          el('span', { class: 'stat-label', text: 'Watchlist' }),
          el('span', { class: 'stat-value', id: 't-covered', text: String(DATA.watchlist_size) }),
          el('span', { class: 'stat-note', text: 'every slug covered' })
        ),
        el('div', { class: 'stat' },
          el('span', { class: 'stat-label', text: 'Board rows' }),
          el('span', { class: 'stat-value', id: 't-rows', text: String(DATA.board_size) }),
          el('span', { class: 'stat-note', text: 'ranked by value' })
        ),
        el('div', { class: 'stat' },
          el('span', { class: 'stat-label', text: 'Early radar' }),
          el('span', { class: 'stat-value', id: 't-early', text: String(DATA.early_size) }),
          el('span', { class: 'stat-note', text: 'below the floor' })
        ),
        el('div', { class: 'stat' },
          el('span', { class: 'stat-label', text: 'Set aside' }),
          el('span', { class: 'stat-value', id: 't-live', text: String(DATA.live_size) }),
          el('span', { class: 'stat-note', text: 'token trades' })
        )
      )
    );
  }

  function controls() {
    var categories = [''].concat(Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort());
    var search = el('input', { type: 'search', id: 'q', placeholder: 'name, category or chain', value: state.q, 'aria-label': 'Search the board', enterkeyhint: 'search' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    var clearQ = el('button', { type: 'button', class: 'clear-q', id: 'clear-q', 'aria-label': 'Clear the search', title: 'Clear search', hidden: !state.q, html: '&times;' });
    clearQ.addEventListener('click', function () { state.q = ''; writeHash(); render(); });
    var select = el('select', { id: 'category', 'aria-label': 'Filter by category' },
      el('option', { value: '', text: 'All categories' })
    );
    categories.forEach(function (c) {
      if (c) select.appendChild(el('option', { value: c, text: c, selected: c === state.category ? 'selected' : null }));
    });
    select.addEventListener('change', function () { state.category = select.value; writeHash(); render(); });
    var pre = el('button', { type: 'button', 'aria-pressed': state.tab === 'pre-token' ? 'true' : 'false', text: 'Pre-token', onclick: function () { state.tab = 'pre-token'; state.selected = null; writeHash(); render(); } });
    var live = el('button', { type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Trades now', onclick: function () { state.tab = 'live'; state.selected = null; writeHash(); render(); } });
    var countText = state.tab === 'pre-token' ? rows().length + ' rows shown' : DATA.live.length + ' live-token protocols';
    return el('form', { class: 'filters', role: 'search', id: 'filters', autocomplete: 'off', action: '#console' },
      el('div', { class: 'field field-search' },
        el('label', { class: 'field-label', for: 'q', text: 'Search' }),
        el('div', { class: 'input-wrap' }, search, clearQ)
      ),
      el('div', { class: 'field' },
        el('label', { class: 'field-label', for: 'category', text: 'Category' }),
        select
      ),
      el('div', { class: 'field' },
        el('span', { class: 'field-label', id: 'tab-label', text: 'Token status' }),
        el('div', { class: 'tabs', role: 'group', 'aria-labelledby': 'tab-label' }, pre, live)
      ),
      el('p', { class: 'result-count', id: 'count', role: 'status', 'aria-live': 'polite', text: countText })
    );
  }

  function banner() {
    if (!state.q && !state.category) return null;
    var text = '';
    if (state.q) text += 'search: "' + state.q + '"';
    if (state.category) {
      if (text) text += ', ';
      text += 'category: ' + state.category;
    }
    return el('div', { class: 'banner', id: 'banner' },
      el('span', { class: 'banner-tag', text: 'Filtered' }),
      el('p', { id: 'banner-text', text: text }),
      el('button', { type: 'button', class: 'ghost', id: 'banner-clear', text: 'Clear filters', onclick: function () { state.q = ''; state.category = ''; writeHash(); render(); } })
    );
  }

  function sortHeader(key, label) {
    var sorted = state.sort === key;
    var dirClass = sorted ? (state.dir < 0 ? 'sorted-desc' : 'sorted-asc') : '';
    return el('th', { scope: 'col', class: dirClass },
      el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } writeHash(); render(); } },
        label
      )
    );
  }

  function boardTable() {
    var list = sortedRows(rows());
    if (list.length === 0) {
      return el('div', { class: 'panel' },
        el('div', { class: 'empty', id: 'empty' },
          el('p', { class: 'empty-kicker', text: 'No contact' }),
          el('h2', { id: 'empty-title', text: 'Nothing matches that filter' }),
          el('p', { class: 'empty-copy', id: 'empty-copy', text: 'The radar is still scanning the whole snapshot — the table is only narrowed. Try a different search term or category.' }),
          el('button', { class: 'button primary', id: 'empty-clear', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = ''; writeHash(); render(); } })
        )
      );
    }
    var max = list[0].implied_value_usd || 1;
    var tbody = el('tbody', { id: 'board-body' });
    list.forEach(function (r) {
      var growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var pct = Math.max(3, Math.round((r.implied_value_usd / max) * 100));
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'num', text: String(r.rank) }),
        el('td', null, el('div', { class: 'name' },
          el('b', { text: r.name }),
          el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') })
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: growth }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + pct + '%' })),
          el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) })
        )),
        el('td', null, el('span', { class: 'status', text: 'no token' }))
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', { id: 'board-table' },
          el('caption', { id: 'board-caption', class: 'sub', text: 'Pre-token protocols, strongest implied value first. Pick a column to sort it; open a row for its equation and farm plan.' }),
          el('thead', { id: 'board-head' }, el('tr', null,
            sortHeader('rank', 'Rank'),
            sortHeader('name', 'Protocol'),
            sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d'),
            sortHeader('age', 'Age'),
            sortHeader('implied', 'Implied value'),
            el('th', { scope: 'col', text: 'Token' })
          )),
          tbody
        )
      )
    );
  }

  function liveTable() {
    var tbody = el('tbody', { id: 'live-body' });
    DATA.live.forEach(function (r) {
      var growthClass = r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg';
      tbody.appendChild(el('tr', null,
        el('td', { class: 'num', text: 'live' }),
        el('td', null, el('div', { class: 'name' },
          el('b', { text: r.name }),
          el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') })
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', null, el('span', { class: 'status', text: 'already trades' }))
      ));
    });
    return el('div', { class: 'panel', id: 'live-panel' },
      el('div', { class: 'table-wrap' },
        el('table', { id: 'live-table' },
          el('caption', { class: 'sub', text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. They are never ranked against the pre-token board.' }),
          el('thead', null, el('tr', null,
            el('th', { scope: 'col', text: 'Status' }),
            el('th', { scope: 'col', text: 'Protocol' }),
            el('th', { scope: 'col', class: 'num', text: 'TVL' }),
            el('th', { scope: 'col', class: 'num', text: '7d' }),
            el('th', { scope: 'col', class: 'num', text: 'Market cap' }),
            el('th', { scope: 'col', text: 'Token' })
          )),
          tbody
        )
      )
    );
  }

  function modelPanel() {
    var m = DATA.model;
    return el('section', { class: 'panel model' },
      el('h2', { text: 'How implied value is computed' }),
      el('p', { class: 'sub', text: 'Every row is scored by one function of the snapshot figures. No protocol name is special-cased, and no row is hand-picked.' }),
      el('div', { class: 'formula' },
        el('code', { text: 'implied = round( tvl_usd x ' + m.base_multiple + ' x (1 + clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ') / 100 x ' + m.growth_weight + ') x (' + m.maturity_floor + ' + min(age_days, ' + m.maturity_days + ') / ' + m.maturity_days + ' x ' + m.maturity_range + ') x airdropCategoryFactor )' })
      ),
      el('p', { class: 'sub', text: 'TVL and seven-day growth come from the snapshot. Age is the time since the protocol was first listed, the best record of how long it has run with no token; an unlisted age uses ' + m.unknown_age_days + ' days. On top of those, the airdrop category factor rewards the categories that have historically farmed a token most often (bridges, restaking, L2 chains, DEXs, lending, launchpads) and trims the ones that rarely do (CEX, wrappers), so a live-dollar TVL in a farming category outranks the same TVL in a dead-end one. The early radar is every pre-token protocol below the watchlist floor, by TVL, and the live-token protocols are set aside with their market caps shown.' })
    );
  }

  var dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); render(); });

  var sortedCache = null;
  function getSortedRows() {
    if (!sortedCache) sortedCache = sortedRows(rows());
    return sortedCache;
  }
  function findIndex(slug) {
    var list = getSortedRows();
    for (var i = 0; i < list.length; i++) {
      if (list[i].slug === slug) return i;
    }
    return -1;
  }

  function openDetail(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    state.selected = slug;
    writeHash();
    dialog.textContent = '';
    var steps = farmSteps(row);
    var idx = findIndex(slug);
    var list = getSortedRows();
    dialog.appendChild(el('div', { class: 'detail-bar' },
      el('p', { class: 'detail-file', id: 'detail-file', text: 'Protocol file' }),
      el('div', { class: 'detail-nav' },
        el('button', { type: 'button', id: 'detail-prev', 'aria-label': 'Previous protocol in this sort', text: '‹ Prev', onclick: function () { if (idx > 0) openDetail(list[idx - 1].slug); } }),
        el('button', { type: 'button', id: 'detail-next', 'aria-label': 'Next protocol in this sort', text: 'Next ›', onclick: function () { if (idx < list.length - 1) openDetail(list[idx + 1].slug); } }),
        el('button', { type: 'button', class: 'close', id: 'detail-close', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })
      )
    ));
    dialog.appendChild(el('header', { class: 'detail-head' },
      el('div', { class: 'detail-id' },
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'detail-meta', id: 'detail-meta', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') })
      ),
      el('div', { class: 'detail-figure' },
        el('span', { id: 'detail-figure-label', text: 'Implied value' }),
        el('strong', { id: 'detail-value', text: fmtUsd(row.implied_value_usd) })
      )
    ));
    dialog.appendChild(el('div', { class: 'detail-body', id: 'detail-body' },
      el('section', { class: 'detail-section' },
        el('h3', { text: 'Implied value' }),
        el('div', { class: 'equation' },
          el('div', null, el('span', { text: 'TVL' }), el('b', { class: 'num', text: fmtUsd(row.tvl_usd) })),
          el('div', null, el('span', { text: 'Seven-day growth' }), el('b', { class: 'num', text: fmtPct(row.change_7d) })),
          el('div', null, el('span', { text: 'Age with no token' }), el('b', { class: 'num', text: fmtAge(row.age_days) })),
          el('div', null, el('span', { text: 'Growth multiplier' }), el('b', { class: 'num', text: String(row.growth_multiplier) })),
          el('div', null, el('span', { text: 'Maturity multiplier' }), el('b', { class: 'num', text: String(row.maturity_multiplier) })),
          el('div', null, el('span', { text: 'Airdrop category factor' }), el('b', { class: 'num', text: String(row.airdrop_multiplier) })),
          el('div', null, el('span', { text: 'Implied value' }), el('b', { class: 'num', text: fmtUsd(row.implied_value_usd) }))
        ),
        el('p', { class: 'sub', text: 'Model ' + DATA.model_version + ': the same function scores every protocol. The page recomputes this row as ' + fmtUsd(impliedOf(row, DATA.model)) + (impliedOf(row, DATA.model) === row.implied_value_usd ? ', the same number board.json carries.' : ', which differs from the board: the data would be stale.') + ' This is an estimate, not a price.' })
      ),
      el('section', { class: 'detail-section' },
        el('h3', { text: 'Farm plan' }),
        el('ol', { class: 'steps' }, steps.map(function (s) {
          var at = s.indexOf(' Cost: ');
          var action = at >= 0 ? s.slice(0, at) : s;
          var tail = at >= 0 ? s.slice(at + 1) : '';
          return el('li', null, el('b', { text: action }), el('span', { class: 'cost', text: tail }));
        }))
      )
    ));
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  function render() {
    sortedCache = null;
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    shell.appendChild(hero());
    shell.appendChild(controls());
    var bannerEl = banner();
    if (bannerEl) shell.appendChild(bannerEl);
    shell.appendChild(state.tab === 'pre-token' ? boardTable() : liveTable());
    if (state.tab === 'pre-token') shell.appendChild(modelPanel());
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) app.appendChild(dialog);
    if (state.selected) openDetail(state.selected);
  }

  readHash();
  render();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dialog.open) dialog.close();
  });
  window.addEventListener('hashchange', function () {
    readHash();
    render();
  });
})();
