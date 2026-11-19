// Token Launch Radar dashboard (no framework, no network).
// Reads window.RADAR from ../data.js, written by main.ts from the same board.
(function () {
  'use strict';
  var R = window.RADAR;
  if (!R) { document.getElementById('meta-line').textContent = 'No data loaded.'; return; }

  var rows = R.rows;
  var watchlist = new Set(R.watchlist || []);
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

  $('model-ver').textContent = R.version;
  $('as-of').textContent = R.as_of;
  $('meta-line').textContent = R.rows.length + ' protocols · snapshot ' + R.as_of +
    ' · floor $' + (R.floor_usd / 1e6) + 'M · ' + R.rows.filter(function (r) { return watchlist.has(r.slug); }).length + ' watchlist';

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
    var math = usd(r.tvl_usd) + ' × ' + m.base_multiple.toFixed(3) + ' × ' + m.growth_multiplier.toFixed(3) +
      ' × ' + m.maturity_multiplier.toFixed(3) + ' × ' + m.chain_multiplier.toFixed(2) + ' = ' + usd(r.implied_value_usd);
    box.innerHTML = '<button class="close" id="close-detail" type="button">Close</button>' +
      '<h2>' + esc(r.name) + ' <span class="pill">rank #' + r.rank + '</span></h2>' +
      '<p>' + esc(r.category || 'Uncategorised') + ' · ' + r.chains.map(esc).join(', ') +
      ' · TVL ' + usd(r.tvl_usd) + ' · 7d ' + (r.change_7d === null ? '—' : (r.change_7d > 0 ? '+' : '') + r.change_7d.toFixed(2) + '%') +
      ' · listed ' + (r.listed_at || 'unknown') + ' · records no token</p>' +
      '<div class="kv">' +
      '<div><b>' + usd(r.implied_value_usd) + '</b><span>implied value</span></div>' +
      '<div><b>' + m.base_multiple.toFixed(3) + '×</b><span>category multiple (median live-token mcap/TVL)</span></div>' +
      '<div><b>' + m.growth_multiplier.toFixed(3) + '×</b><span>growth, 7d ' + (m.growth_pct > 0 ? '+' : '') + m.growth_pct.toFixed(1) + '%</span></div>' +
      '<div><b>' + m.maturity_multiplier.toFixed(3) + '×</b><span>maturity, ' + (m.age_days === null ? 'age unknown (365d assumed)' : age(m.age_days) + ' old') + '</span></div>' +
      '<div><b>' + m.chain_multiplier.toFixed(2) + '×</b><span>chains, ' + r.chains.length + '</span></div>' +
      '</div>' +
      '<p class="math">' + esc(math) + '</p>' +
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
  document.querySelectorAll('[data-tab].linklike').forEach(function (b) {
    b.addEventListener('click', function () { showTab(b.getAttribute('data-tab')); });
  });

  // Live comparables + category multiples
  $('live-rows').innerHTML = R.live.map(function (p) {
    return '<tr><td><b>' + esc(p.name) + '</b><br><span class="pill">' + esc(p.slug) + '</span></td>' +
      '<td>' + esc(p.category || '—') + '</td><td class="num">' + usd(p.tvl_usd) + '</td>' +
      '<td class="num">' + usd(p.mcap_usd) + '</td><td class="num">' + p.ratio.toFixed(3) + '×</td></tr>';
  }).join('');
  $('mult-rows').innerHTML = R.category_multiples.map(function (m) {
    return '<tr><td>' + esc(m.category) + '</td><td class="num">' + m.n + '</td><td class="num">' + m.multiple.toFixed(3) + '×</td></tr>';
  }).join('') + '<tr><td><i>All categories (fallback)</i></td><td class="num">—</td><td class="num">' + R.overall_multiple.toFixed(3) + '×</td></tr>';

  // Model sandbox: re-rank from the same raw figures with adjusted constants.
  function sandbox() {
    var gw = +$('s-growth').value, mf = +$('s-mat').value, ms = +$('s-mult').value;
    $('v-growth').textContent = gw.toFixed(2);
    $('v-mat').textContent = mf.toFixed(2);
    $('v-mult').textContent = ms.toFixed(2);
    var scored = rows.map(function (r) {
      var m = r.model;
      var growth = 1 + (m.growth_pct / 100) * gw;
      var age = m.age_days === null ? 365 : m.age_days;
      var mat = mf + (Math.min(age, 1095) / 1095) * (1 - mf);
      var implied = Math.max(1, Math.round(r.tvl_usd * m.base_multiple * ms * growth * mat * m.chain_multiplier));
      return { name: r.name, implied: implied };
    }).sort(function (a, b) { return b.implied - a.implied; }).slice(0, 5);
    $('sandbox-top').innerHTML = scored.map(function (s, i) {
      return '<li>#' + (i + 1) + ' <b>' + esc(s.name) + '</b> — ' + usd(s.implied) + '</li>';
    }).join('');
  }
  ['s-growth', 's-mat', 's-mult'].forEach(function (id) { $(id).addEventListener('input', sandbox); });
  $('reset-model').addEventListener('click', function () {
    $('s-growth').value = '0.5'; $('s-mat').value = '0.6'; $('s-mult').value = '1'; sandbox();
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
