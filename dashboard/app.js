// Token Launch Radar dashboard (no framework, no network).
// Reads window.RADAR from ../data.js, written by main.ts from the same board.
(function () {
  'use strict';
  var R = window.RADAR;
  if (!R) { document.getElementById('meta-line').textContent = 'No data loaded.'; return; }

  var rows = R.rows;
  var watchlist = new Set(R.watchlist || []);
  var V = R.validation || {};
  var B = V.coefficients || [0, 0, 0, 0];
  var $ = function (id) { return document.getElementById(id); };

  function usd(n) {
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return '$' + Math.round(n);
  }
  function pct(c) {
    if (c === null || c === undefined) return '—';
    var s = (c > 0 ? '+' : '') + c.toFixed(1) + '%';
    return '<span class="' + (c >= 0 ? 'pos' : 'neg') + '">' + s + '</span>';
  }
  function age(a) {
    if (a === null || a === undefined) return '—';
    if (a >= 365) return (a / 365).toFixed(1) + 'y';
    if (a >= 30) return Math.round(a / 30) + 'mo';
    return a + 'd';
  }
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function coef(x) { return (x >= 0 ? '+' : '') + x.toFixed(3); }

  $('model-ver').textContent = R.version;
  $('as-of').textContent = R.as_of;
  $('meta-line').textContent = R.rows.length + ' protocols · snapshot ' + R.as_of +
    ' · floor $' + (R.floor_usd / 1e6) + 'M · ' + R.rows.filter(function (r) { return watchlist.has(r.slug); }).length + ' watchlist';

  // KPI strip: the whole snapshot accounted for, counted at build time.
  var C = R.coverage || {};
  if (C.total !== undefined) {
    $('kpi-total').textContent = C.total;
    $('kpi-board').textContent = C.board;
    $('kpi-live').textContent = C.live;
    $('kpi-nocap').textContent = C.token_no_mcap;
    $('kpi-excl').textContent = C.excluded_pre_token;
  }

  // Fitted model numbers in the "how" section.
  $('f-b0').textContent = B[0].toFixed(3);
  $('f-b1').textContent = B[1].toFixed(3);
  $('f-b2').textContent = B[2].toFixed(3);
  $('f-b3').textContent = B[3].toFixed(3);
  $('f-r2').textContent = (V.r2 === undefined ? '—' : V.r2.toFixed(4));
  $('f-n').textContent = V.n_train === undefined ? '—' : V.n_train;

  // Validation table: 5-fold CV plus the four walk-forward splits.
  var vrows = [];
  if (V.cv_fitted_rmse !== undefined) {
    vrows.push(['5-fold cross-validation (by slug)', V.n_train === undefined ? 128 : V.n_train, V.cv_fitted_rmse, V.cv_baseline_rmse]);
  }
  (V.walk_forward || []).forEach(function (w) {
    vrows.push(['Walk-forward: ' + w.label, w.n_test, w.fitted_rmse, w.baseline_rmse]);
  });
  $('valid-rows').innerHTML = vrows.map(function (v) {
    var win = v[3] - v[2];
    return '<tr><td>' + esc(v[0]) + '</td><td class="num">' + v[1] + '</td>' +
      '<td class="num"><b>' + v[2].toFixed(3) + '</b></td><td class="num">' + v[3].toFixed(3) + '</td>' +
      '<td class="num pos">−' + win.toFixed(3) + '</td></tr>';
  }).join('');

  // Filters
  var cats = [...new Set(rows.map(function (r) { return r.category || '(no category)'; }))].sort();
  var chains = [...new Set(rows.flatMap(function (r) { return r.chains; }))].sort();
  cats.forEach(function (c) { $('f-cat').add(new Option(c, c)); });
  chains.forEach(function (c) { $('f-chain').add(new Option(c, c)); });

  function filtered() {
    var q = $('q').value.trim().toLowerCase();
    var cat = $('f-cat').value, chain = $('f-chain').value;
    var minTvl = +$('f-tvl').value, watchOnly = $('f-watch').checked;
    var list = rows.filter(function (r) {
      if (q && r.name.toLowerCase().indexOf(q) < 0 && r.slug.indexOf(q) < 0) return false;
      if (cat && (r.category || '(no category)') !== cat) return false;
      if (chain && r.chains.indexOf(chain) < 0) return false;
      if (r.tvl_usd < minTvl) return false;
      if (watchOnly && !watchlist.has(r.slug)) return false;
      return true;
    });
    var sort = $('f-sort').value;
    list.sort(function (a, b) {
      if (sort === 'tvl') return b.tvl_usd - a.tvl_usd;
      if (sort === 'growth') return (b.change_7d || 0) - (a.change_7d || 0);
      if (sort === 'age') return (b.age_days || 0) - (a.age_days || 0);
      return b.implied_value_usd - a.implied_value_usd;
    });
    return list;
  }

  function render() {
    var list = filtered();
    $('count').textContent = list.length + ' of ' + rows.length + ' shown';
    $('rows').innerHTML = list.map(function (r) {
      return '<tr data-slug="' + esc(r.slug) + '"><td>' + r.rank + '</td>' +
        '<td><b>' + esc(r.name) + '</b>' + (watchlist.has(r.slug) ? '<span class="watch">WATCHLIST</span>' : '') +
        '<br><span class="pill">' + esc(r.slug) + '</span></td>' +
        '<td>' + esc(r.category || '—') + '</td>' +
        '<td>' + r.chains.slice(0, 3).map(esc).join(', ') + (r.chains.length > 3 ? ' +' + (r.chains.length - 3) : '') + '</td>' +
        '<td class="num">' + usd(r.tvl_usd) + '</td>' +
        '<td class="num">' + pct(r.change_7d) + '</td>' +
        '<td class="num">' + age(r.age_days) + '</td>' +
        '<td class="num"><b>' + usd(r.implied_value_usd) + '</b></td></tr>';
    }).join('');
  }

  function showDetail(slug) {
    var r = rows.find(function (x) { return x.slug === slug; });
    var box = $('detail');
    if (!r) { box.hidden = true; box.innerHTML = ''; return; }
    var m = r.model;
    var b = m.coefficients;
    var math = 'ln(mcap) = ' + b[0].toFixed(3) + ' + ' + b[1].toFixed(3) + ' × ln(' + usd(r.tvl_usd) + ') + ' +
      b[2].toFixed(3) + ' × ' + m.growth.toFixed(1) + ' + ' + b[3].toFixed(3) + ' × ' + m.age_years.toFixed(2) +
      ' = ' + m.predicted_log_mcap.toFixed(3) + '  →  exp = ' + usd(r.implied_value_usd);
    box.innerHTML = '<button class="close" id="close-detail" type="button">Close</button>' +
      '<h2>' + esc(r.name) + ' <span class="pill">rank #' + r.rank + '</span></h2>' +
      '<p>' + esc(r.category || 'Uncategorised') + ' · ' + r.chains.map(esc).join(', ') +
      ' · TVL ' + usd(r.tvl_usd) + ' · 7d ' + (r.change_7d === null ? '—' : (r.change_7d > 0 ? '+' : '') + r.change_7d.toFixed(2) + '%') +
      ' · listed ' + (r.listed_at || 'unknown') + ' · records no token</p>' +
      '<div class="kv">' +
      '<div><b>' + usd(r.implied_value_usd) + '</b><span>implied value</span></div>' +
      '<div><b>' + m.log_tvl.toFixed(2) + '</b><span>ln(TVL), TVL ' + usd(r.tvl_usd) + '</span></div>' +
      '<div><b>' + coef(m.growth) + '%</b><span>growth, 7d change clamped −50…+100</span></div>' +
      '<div><b>' + m.age_years.toFixed(2) + 'y</b><span>age, ' + (m.age_years === 1 && r.listed_at === null ? 'unknown (1y assumed)' : age(r.age_days) + ' old') + '</span></div>' +
      '<div><b>' + m.predicted_log_mcap.toFixed(3) + '</b><span>predicted ln(market cap)</span></div>' +
      '</div>' +
      '<p class="math">' + esc(math) + '</p>' +
      '<p class="note">Coefficients fitted at build time on ' + (V.n_train || 128) + ' live tokens ' +
      '(R² ' + (V.r2 === undefined ? '—' : V.r2.toFixed(4)) + '): intercept ' + B[0].toFixed(3) +
      ', ln(TVL) ' + B[1].toFixed(3) + ', growth ' + B[2].toFixed(3) + ', age ' + B[3].toFixed(3) + '.</p>' +
      '<h3>How to farm it</h3><ol>' + r.farm_steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ol>';
    box.hidden = false;
    document.body.classList.add('detail-mode');
    $('close-detail').onclick = function () {
      box.hidden = true;
      document.body.classList.remove('detail-mode');
      location.hash = '';
    };
  }

  $('rows').addEventListener('click', function (e) {
    var tr = e.target.closest('tr[data-slug]');
    if (tr) { location.hash = 'detail=' + tr.getAttribute('data-slug'); showDetail(tr.getAttribute('data-slug')); }
  });
  ['q', 'f-cat', 'f-chain', 'f-tvl', 'f-sort', 'f-watch'].forEach(function (id) {
    $(id).addEventListener('input', render);
    $(id).addEventListener('change', render);
  });

  // Tabs
  document.querySelectorAll('.tab').forEach(function (tab) {
    tab.addEventListener('click', function () { showTab(tab.getAttribute('data-tab')); });
  });
  function showTab(name) {
    document.querySelectorAll('.tab').forEach(function (t) { t.classList.toggle('active', t.getAttribute('data-tab') === name); });
    ['board', 'live', 'model'].forEach(function (n) { $('tab-' + n).hidden = n !== name; });
  }

  // Live comparables (all 144) + baseline category multiples.
  $('live-rows').innerHTML = R.live.map(function (p) {
    return '<tr><td><b>' + esc(p.name) + '</b><br><span class="pill">' + esc(p.slug) + '</span></td>' +
      '<td>' + esc(p.category || '—') + '</td><td class="num">' + usd(p.tvl_usd) + '</td>' +
      '<td class="num">' + usd(p.mcap_usd) + '</td><td class="num">' + p.ratio.toFixed(3) + '×</td></tr>';
  }).join('');
  $('mult-rows').innerHTML = R.category_multiples.map(function (m) {
    return '<tr><td>' + esc(m.category) + '</td><td class="num">' + m.n + '</td><td class="num">' + m.multiple.toFixed(3) + '×</td></tr>';
  }).join('') + '<tr><td><i>All categories (fallback)</i></td><td class="num">—</td><td class="num">' + R.overall_multiple.toFixed(3) + '×</td></tr>';

  // Model sandbox: re-rank from the same per-row features with adjusted coefficients.
  $('d-b0').textContent = B[0].toFixed(3);
  $('d-b1').textContent = B[1].toFixed(3);
  $('d-b2').textContent = B[2].toFixed(3);
  $('d-b3').textContent = B[3].toFixed(3);
  $('s-b1').value = B[1].toFixed(3);
  $('s-b2').value = B[2].toFixed(3);
  $('s-b3').value = B[3].toFixed(3);
  function sandbox() {
    var b1 = +$('s-b1').value, b2 = +$('s-b2').value, b3 = +$('s-b3').value, shift = +$('s-b0').value;
    $('v-b1').textContent = b1.toFixed(3);
    $('v-b2').textContent = coef(b2);
    $('v-b3').textContent = coef(b3);
    $('v-b0').textContent = coef(shift);
    var scored = rows.map(function (r) {
      var m = r.model;
      var implied = Math.max(1, Math.round(Math.exp(B[0] + shift + b1 * m.log_tvl + b2 * m.growth + b3 * m.age_years)));
      return { name: r.name, implied: implied };
    }).sort(function (a, b) { return b.implied - a.implied; }).slice(0, 5);
    $('sandbox-top').innerHTML = scored.map(function (s, i) {
      return '<li>#' + (i + 1) + ' <b>' + esc(s.name) + '</b> — ' + usd(s.implied) + '</li>';
    }).join('');
  }
  ['s-b1', 's-b2', 's-b3', 's-b0'].forEach(function (id) { $(id).addEventListener('input', sandbox); });
  $('reset-model').addEventListener('click', function () {
    $('s-b1').value = B[1].toFixed(3); $('s-b2').value = B[2].toFixed(3);
    $('s-b3').value = B[3].toFixed(3); $('s-b0').value = '0'; sandbox();
  });

  // Deep links: #detail=<slug> opens a detail view; #cat=<category> filters it.
  function applyHash() {
    var h = location.hash.slice(1);
    var params = new URLSearchParams(h.replace(/;/g, '&'));
    if (params.get('cat')) { $('f-cat').value = params.get('cat'); }
    if (params.get('q')) { $('q').value = params.get('q'); }
    if (params.get('detail')) { showDetail(params.get('detail')); }
    render();
  }
  window.addEventListener('hashchange', applyHash);

  render();
  sandbox();
  applyHash();
})();
