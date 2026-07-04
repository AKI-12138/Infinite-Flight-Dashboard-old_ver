// =============================== MAIN ===============================
// イベントハンドラ・配線・初期化。
// DOM 操作の起点（onclick/oninput）とフロー制御はここに集約。
// 依存: airports.js / datasource.js / normalize.js / compute.js /
//       parse.js / render.js のすべて。

// =============================== DELETE LOGIC ===============================
let pendingDeleteType=null; // 'selected' | 'all'

function confirmDeleteOne(no){
  const f=flights.find(x=>x.no===no);
  if(!f) return;
  selectedIds.clear();
  selectedIds.add(no);
  pendingDeleteType='selected';
  document.getElementById('confirmTitle').textContent='Delete Flight #'+no+'?';
  document.getElementById('confirmDesc').innerHTML=
    `Remove <strong>${_escapeHtml(f.dep)} → ${_escapeHtml(f.arr)}</strong> on ${_escapeHtml(f.date)} (${_escapeHtml(f.ac)}, ${_escapeHtml(f.al)})?<br>This cannot be undone.`;
  document.getElementById('confirmOverlay').classList.add('show');
  _lockBodyScroll('confirmOverlay');
}

function confirmDeleteSelected(){
  const cnt=selectedIds.size;
  if(cnt===0) return;
  pendingDeleteType='selected';
  document.getElementById('confirmTitle').textContent='Delete '+cnt+' Flight'+(cnt>1?'s':'')+'?';
  document.getElementById('confirmDesc').innerHTML=
    `This will permanently remove <strong>${cnt} flight${cnt>1?'s':''}</strong> from your log.<br>This action cannot be undone.`;
  document.getElementById('confirmOverlay').classList.add('show');
  _lockBodyScroll('confirmOverlay');
}

function confirmDeleteAll(){
  if(flights.length===0) return;
  pendingDeleteType='all';
  document.getElementById('confirmTitle').textContent='Delete ALL Flights?';
  document.getElementById('confirmDesc').innerHTML=
    `This will permanently remove <strong>all ${flights.length} flights</strong> from your log.<br>This action cannot be undone.`;
  document.getElementById('confirmOverlay').classList.add('show');
  _lockBodyScroll('confirmOverlay');
}

function closeConfirm(){
  document.getElementById('confirmOverlay').classList.remove('show');
  _unlockBodyScroll('confirmOverlay');
  pendingDeleteType=null;
}

function executeDelete(){
  let count=0;
  if(pendingDeleteType==='all'){
    count=DataSource.count;
    DataSource.clearAll();
    // localStorage も明示的にクリア（Clear All は「全部消す」の意図なので、
    // 次回新セッション時に Restore モーダルが出ないようにする）
    DataSource.clearStorage();
  } else if(pendingDeleteType==='selected'){
    count=selectedIds.size;
    DataSource.removeByIds([...selectedIds]);
  }
  flights=DataSource.flights;
  selectedIds.clear();
  closeConfirm();
  rebuildYearFilter();
  refreshAll();
  showToast(`🗑️ ${count} flight${count>1?'s':''} deleted`,'red');
}

// =============================== FILTERS ===============================
// rebuildYearFilter is an alias for rebuildFilters (kept for backward compatibility with old call sites)
function rebuildYearFilter(){ rebuildFilters(); }

// フィルタ定義（FILTER_DEFS）・ラベル定数・地理 cascade ヘルパー・_ADV_FILTER_KEYS は
// js/filters-config.js へ分離（2026-07-03）。ここでは描画・状態更新ロジックのみを扱う。
function _cap(s){ return s.charAt(0).toUpperCase()+s.slice(1); }
// _escapeHtml / _escapeAttr は render.js（共通ユーティリティ）側で定義済み

// 現在のフライトデータから、各フィルタで選べる選択肢を返す。
// 年は降順、それ以外は昇順。fixedOptions を持つ def はデータに依存しないので、
// 別経路で渡す（_renderFilterMenu 側で def.fixedOptions を直接読む）。
function _availableOptions(){
  const years=new Set(), airlines=new Set(), aircraft=new Set(), countries=new Set();
  // フェーズY-2：空港軸の選択肢（データに登場する ICAO のみ）。
  //   depAirport / arrAirport は向き別、airports（either・drilldown 用）は和集合。
  const depAp=new Set(), arrAp=new Set(), anyAp=new Set(), cityset=new Set();
  const depCitySet=new Set(), arrCitySet=new Set(), depCoSet=new Set(), arrCoSet=new Set();
  flights.forEach(f=>{
    years.add(f.date.slice(0,4));
    if(f.al) airlines.add(f.al);
    if(f.ac) aircraft.add(f.ac);
    _flightCountry(f).forEach(c=>countries.add(c));
    _flightCities(f).forEach(c=>cityset.add(c));
    if(f.dep){ depAp.add(f.dep); anyAp.add(f.dep); const m=AP[f.dep]; if(m){ if(m.city)depCitySet.add(m.city); if(m.co)depCoSet.add(m.co); } }
    if(f.arr){ arrAp.add(f.arr); anyAp.add(f.arr); const m=AP[f.arr]; if(m){ if(m.city)arrCitySet.add(m.city); if(m.co)arrCoSet.add(m.co); } }
  });
  return {
    year:     [...years].sort().reverse(),
    airline:  [...airlines].sort(),
    aircraft: [...aircraft].sort(),
    country:  [...countries].sort(),
    depAirport: [...depAp].sort(),
    arrAirport: [...arrAp].sort(),
    airports:   [...anyAp].sort(),
    city:       [...cityset].sort(),
    depCity:    [...depCitySet].sort(),
    arrCity:    [...arrCitySet].sort(),
    depCountry: [...depCoSet].sort(),
    arrCountry: [...arrCoSet].sort(),
  };
}

function rebuildFilters(){
  const opts = _availableOptions();
  FILTER_DEFS.forEach(def => {
    // ① prune：データから消えた値を FilterState から除外（全データで判定。cascade とは無関係）。
    //    ＝「表示の絞り込み(cascade)」と「保存値の prune」を分離（Y-2c ルール4）。
    if(!def.fixedOptions){
      const valid = new Set(opts[def.key] || []);
      FilterState[def.stateKey] = FilterState[def.stateKey].filter(v => valid.has(v));
    }
    // ② 表示：cascade で候補を絞って描画。
    _renderDefMenu(def, opts);
  });
  _syncFilterChips();
}

// 1 つの def について、cascade（地理依存）で候補を絞ってからメニュー描画する。
//   - 選択済みの値は絞り込みで消えても残す（Y-2c ルール2＝解除できるように）。
//   - 隠した件数は hint 表示のため _renderFilterMenu に渡す（ルール3）。
function _renderDefMenu(def, opts){
  const fullOptions = def.fixedOptions || opts[def.key] || [];
  const allow = _cascadeAllow(def);
  if(!allow){ _renderFilterMenu(def, fullOptions, 0); return; }
  const sel = new Set(FilterState[def.stateKey]);
  const kept = []; let hidden = 0;
  fullOptions.forEach(o => {
    const v = (typeof o === 'object') ? o.value : o;
    if(allow(v) || sel.has(v)) kept.push(o);   // 許可 or 選択済みは残す
    else hidden++;
  });
  _renderFilterMenu(def, kept, hidden);
}

// geo 軸（大陸/国）を変更したとき、依存する cascade メニュー（空港/都市/国）を絞り直す。
// 変更した軸自身は再描画しない（開いているメニューのスクロール位置を温存）。
function _refreshCascadeMenus(exceptKey){
  const opts = _availableOptions();
  FILTER_DEFS.forEach(def => {
    if(def.cascade && def.key !== exceptKey) _renderDefMenu(def, opts);
  });
}

// 1 つのフィルタについて、選択肢のチェックボックス行を描画。
// options は string[]（データ由来）か {value,label}[]（fixedOptions 由来）のどちらか。
function _renderFilterMenu(def, options, hidden){
  // 同じフィルタがバー＋高度パネルの複数箇所に出るので、data-menu="<key>" 全部に描画する（Y-2 パネル再構成）。
  const menus = document.querySelectorAll('[data-menu="'+def.key+'"]');
  if(!menus.length) return;
  // cascade で隠れた件数のヒント（Y-2c(2) ルール3）。0 なら出さない。
  const hintHtml = (hidden > 0) ? `<div class="chip-menu-hint">${hidden} hidden by filters</div>` : '';
  // 飛行時間だけ：末尾にカスタム範囲入力を付ける（①(b)）。
  const extraHtml = (def.key === 'duration') ? _durationRangeHtml() : '';
  if(options.length===0){
    menus.forEach(m => m.innerHTML = `<div class="chip-menu-empty">(none)</div>` + extraHtml + hintHtml);
    return;
  }
  const sel = new Set(FilterState[def.stateKey]);
  const _optHtml = opt => {
    const value = typeof opt === 'object' ? opt.value : opt;
    const label = typeof opt === 'object' ? opt.label : opt;
    // data-search＝検索対象文字列（①(a)）。空港は都市名/IATA も含める。
    return `
    <label class="chip-menu-item" data-search="${_escapeAttr(_optSearchText(def, value, label))}">
      <input type="checkbox" class="cb" data-filter-key="${def.key}" data-filter-value="${_escapeAttr(value)}"${sel.has(value)?' checked':''}>
      <span>${_escapeHtml(label)}</span>
    </label>
  `;
  };
  // 候補が多いデータ由来メニューは上部に検索ボックス（①(a)）。固定リスト（月/曜日/scope 等）や少数には出さない。
  const searchHtml = (!def.fixedOptions && options.length > 8)
    ? `<div class="chip-menu-search"><input type="text" class="chip-search-input" placeholder="Search…" autocomplete="off" spellcheck="false" oninput="_filterChipMenu(this)"></div>`
    : '';
  let body;
  // groupBy を持つ def（例：空港＝大陸別・Y-2c 1a）は小見出し＋区切り線でグループ表示。無ければ平坦リスト。
  if(typeof def.groupBy === 'function'){
    const groups = new Map();
    options.forEach(opt => {
      const value = typeof opt === 'object' ? opt.value : opt;
      const g = def.groupBy(value) || 'Other';
      if(!groups.has(g)) groups.set(g, []);
      groups.get(g).push(opt);
    });
    const order = def.groupOrder || [];
    const keys = [
      ...order.filter(g => groups.has(g)),
      ...[...groups.keys()].filter(g => !order.includes(g)),
    ];
    body = keys.map((g, i) => {
      const sep = i > 0 ? ' chip-menu-group-sep' : '';
      return `<div class="chip-menu-group${sep}">${_escapeHtml(g)}</div>` + groups.get(g).map(_optHtml).join('');
    }).join('');
  } else {
    body = options.map(_optHtml).join('');
  }
  menus.forEach(m => m.innerHTML = searchHtml + body + extraHtml + hintHtml);
}

// ===== ①(a) メニュー内検索 =====
// メニュー項目の検索対象文字列。空港は ICAO に加えて都市名・IATA も対象にする。
function _optSearchText(def, value, label){
  let t = String(label);
  if(def.cascade === 'airport'){ const m = AP[value]; if(m){ t += ' ' + (m.city||'') + ' ' + (m.iata||''); } }
  return t.toLowerCase();
}
// 入力に一致する項目だけ表示。グループ見出しは配下に可視項目がある時だけ表示。
function _filterChipMenu(input){
  const menu = input.closest('.chip-menu'); if(!menu) return;
  const q = input.value.trim().toLowerCase();
  menu.querySelectorAll('.chip-menu-item').forEach(it => {
    const s = it.dataset.search || (it.textContent || '').toLowerCase();
    it.style.display = (!q || s.indexOf(q) !== -1) ? '' : 'none';
  });
  menu.querySelectorAll('.chip-menu-group').forEach(g => {
    let any = false, n = g.nextElementSibling;
    while(n && !n.classList.contains('chip-menu-group')){
      if(n.classList.contains('chip-menu-item') && n.style.display !== 'none'){ any = true; break; }
      n = n.nextElementSibling;
    }
    g.style.display = any ? '' : 'none';
  });
}

// ===== ①(b) 飛行時間カスタム範囲 =====
const _DUR_MAX_SENTINEL = 100000; // 「上限なし」を表す大きな分数（≒1666h）
function _hoursToMin(v){ const n = parseFloat(v); return (isFinite(n) && n >= 0) ? Math.round(n * 60) : null; }
function _minToHours(min){ const h = min / 60; return Number.isInteger(h) ? String(h) : String(Math.round(h * 10) / 10); }
function _durationRangeHtml(){
  const dr = FilterState.durationRange || [];
  const minV = dr.length ? _minToHours(dr[0]) : '';
  const maxV = (dr.length && dr[1] < _DUR_MAX_SENTINEL) ? _minToHours(dr[1]) : '';
  return `<div class="chip-menu-range">
    <div class="chip-menu-range-label">Custom range (hours)</div>
    <div class="chip-menu-range-row">
      <input type="number" class="chip-range-input dur-min" min="0" step="0.5" inputmode="decimal" placeholder="min" value="${minV}" oninput="_onDurationRangeInput(this)">
      <span class="chip-menu-range-dash">–</span>
      <input type="number" class="chip-range-input dur-max" min="0" step="0.5" inputmode="decimal" placeholder="max" value="${maxV}" oninput="_onDurationRangeInput(this)">
    </div>
  </div>`;
}
function _onDurationRangeInput(input){
  const menu = input.closest('.chip-menu'); if(!menu) return;
  const minEl = menu.querySelector('.dur-min'), maxEl = menu.querySelector('.dur-max');
  const minRaw = minEl ? minEl.value.trim() : '', maxRaw = maxEl ? maxEl.value.trim() : '';
  if(minRaw === '' && maxRaw === ''){
    FilterState.durationRange = [];
  } else {
    const lo = _hoursToMin(minRaw), hi = _hoursToMin(maxRaw);
    FilterState.durationRange = [ (lo == null ? 0 : lo), (hi == null ? _DUR_MAX_SENTINEL : hi) ];
    // カスタム範囲を入れたらバケット選択はクリア（相互排他）。DOM も直接 off（再描画せず入力フォーカス温存）。
    if(FilterState.durations.length){
      FilterState.durations = [];
      menu.querySelectorAll('.chip-menu-item .cb').forEach(cb => cb.checked = false);
    }
  }
  _syncFilterChips();
  _writeFiltersToURL();
  refreshAll();
}

// チップに表示するラベル文言。
//   0件:   "All Years" などの全選択ラベル
//   1件:   その値そのもの（"2024" / fixedOptions なら label を引く）
//   2件以上: "2024 +N"（残り件数を +N で表す。チップが伸びすぎないように短く）
function _chipLabel(def, values){
  if(values.length===0) return def.all;
  const first = def.fixedOptions
    ? (def.fixedOptions.find(o => o.value === values[0])?.label || values[0])
    : values[0];
  if(values.length===1) return first;
  return first + ' +' + (values.length-1);
}

function _syncFilterChips(){
  FILTER_DEFS.forEach(def => {
    const vals = FilterState[def.stateKey];
    // 複数箇所（バー＋パネル）の同一フィルタを全部同期。
    document.querySelectorAll('[data-chip="'+def.key+'"]').forEach(chip => chip.classList.toggle('active', vals.length>0));
    const lblText = _chipLabel(def, vals);
    document.querySelectorAll('[data-label="'+def.key+'"]').forEach(lbl => lbl.textContent = lblText);
  });
  const anyActive = isAnyFilterActive();
  document.getElementById('filterClear').style.display=anyActive?'':'none';
  // 折り畳み中用のクリアボタン：適用中だけ inline 表示を解除（展開中は CSS で隠れる）
  const topClear = document.getElementById('filterClearCollapsed');
  if(topClear) topClear.style.display = anyActive ? '' : 'none';
  // 折り畳み時にも「適用中のフィルター数」を知らせる小バッジを更新
  _updateFilterActiveBadge();
  // ⚙ 高度フィルターボタンの適用中バッジも更新
  _updateAdvBadge();
  // プリセット／Saved ボタンの active 表示も現在の FilterState に同期（手動チェックで一致/解消した時も追従）
  _renderPresets();
  _renderSaved();
}

// ⚙ ボタン：高度パネル内の新軸で適用中の総数を出す（0 なら非表示・active 解除）。
function _updateAdvBadge(){
  const btn = document.getElementById('advFilterBtn');
  const badge = document.getElementById('advFilterBadge');
  if(!btn || !badge) return;
  let n = 0;
  // durationRange は [lo,hi] で length=2 だが「1 フィルタ」として数える。
  _ADV_FILTER_KEYS.forEach(k => { n += (k === 'durationRange') ? (FilterState[k].length ? 1 : 0) : (FilterState[k]?.length || 0); });
  btn.classList.toggle('active', n>0);
  if(n>0){ badge.textContent = n; badge.style.display=''; }
  else   { badge.style.display='none'; }
}

// 適用中のフィルター総数を計算（各 def の選択値数の合計）。
// バー折り畳み時に「Filters ▾ 3」のような形で出すための数値。
function _updateFilterActiveBadge(){
  const badge=document.getElementById('filterActiveBadge');
  if(!badge) return;
  let n = 0;
  FILTER_DEFS.forEach(def => { n += (FilterState[def.stateKey]?.length || 0); });
  if(n>0){ badge.textContent=n; badge.style.display=''; }
  else   { badge.style.display='none'; }
}

// 「Filters ▾」トグル。`.filter-bar.collapsed` の切り替えだけ。
// フィルター適用中でも勝手に展開しない（適用は左の数値バッジで知らせる）。
function toggleFilterBar(){
  document.getElementById('filterBar').classList.toggle('collapsed');
}

// フィルターバー（フェーズV：sticky 化）が画面上端に貼り付いた時だけ
// `.stuck` を付けて影を出す。スクロールは rAF でスロットルした passive 監視。
// 要素が無ければ何もしない（空状態など）。
function _initFilterStickyShadow(){
  const bar = document.getElementById('filterBar');
  if(!bar) return;
  const backTop = document.getElementById('backToTop');
  let ticking = false;
  const apply = () => {
    ticking = false;
    // sticky で top:0 に貼り付くと getBoundingClientRect().top は 0 にクランプされる。
    // ただし空状態や Restore モーダル表示中はバーが display:none で、その rect は全ゼロ
    // （top も 0）になる。そのまま top<=0 で判定すると「まだスクロールしていないのに stuck」
    // になり、データ表示後もスクロールするまで影が残ってしまう。実際に描画されている
    // （高さがある）ときだけ貼り付き判定する。
    const r = bar.getBoundingClientRect();
    bar.classList.toggle('stuck', r.height > 0 && r.top <= 0);
    // 一番上に戻るボタン：ある程度スクロールしたら表示（相乗りで監視を増やさない）。
    if(backTop) backTop.classList.toggle('show', window.scrollY > 400);
  };
  const onScroll = () => {
    if(ticking) return;
    ticking = true;
    requestAnimationFrame(apply);
  };
  window.addEventListener('scroll', onScroll, { passive:true });
  apply(); // 初期状態（リロード時に既にスクロール済みの場合に備える）
}

// 「一番上に戻る」ボタン。ヘッダー（Add / ≡ / ⚙️）まで滑らかに戻る。
function scrollToTop(){
  window.scrollTo({ top:0, behavior:'smooth' });
}

// メニュー内チェックボックスの変更をイベントデリゲーションで一括処理。
// （メニューは rebuildFilters で再生成されるので、要素ごとに addEventListener する
//   よりも document レベルで聴く方が安全）
document.addEventListener('change', e => {
  const cb = e.target;
  if(!(cb instanceof HTMLInputElement)) return;
  if(cb.type!=='checkbox') return;
  const key = cb.dataset.filterKey;
  if(!key) return;
  const def = FILTER_DEFS.find(d => d.key===key);
  if(!def) return;
  const value = cb.dataset.filterValue;
  const list = FilterState[def.stateKey];
  if(cb.checked){
    if(!list.includes(value)) list.push(value);
  } else {
    FilterState[def.stateKey] = list.filter(v => v!==value);
  }
  // ①(b) 相互排他：duration バケットを触ったらカスタム範囲はクリア（入力欄も消す）。
  if(key === 'duration' && FilterState.durationRange.length){
    FilterState.durationRange = [];
    document.querySelectorAll('[data-menu="duration"] .dur-min, [data-menu="duration"] .dur-max').forEach(el => el.value = '');
  }
  _syncFilterChips();
  // Y-2c(2) 地理 cascade：大陸/国を変えたら依存メニュー（空港/都市/国）を絞り直す。
  //   変更した軸自身は再描画しない＝開いているメニューのスクロール／チェック操作を邪魔しない。
  if(_CASCADE_SOURCE_KEYS.has(key)) _refreshCascadeMenus(key);
  _writeFiltersToURL();
  refreshAll();
});
// cascade の「制約元」になる軸（大陸系・国系）。ここが変わった時だけ依存メニューを絞り直す。
const _CASCADE_SOURCE_KEYS = new Set(['continent','depContinent','arrContinent','country','depCountry','arrCountry']);

// チップのドロップダウン開閉。クリック伝播は止め、外側クリックハンドラに食われないように。
function toggleFilterMenu(key, e){
  if(e) e.stopPropagation();
  // 同一フィルタが複数箇所にあるので、クリックされたチップ内のメニューを対象にする。
  const chip = (e && e.currentTarget && e.currentTarget.closest('.filter-chip'))
    || document.querySelector('[data-chip="'+key+'"]');
  if(!chip) return;
  const menu = chip.querySelector('.chip-menu');
  if(!menu) return;
  const willOpen = !menu.classList.contains('open');
  // 他のメニューを閉じる
  _closeAllFilterMenus();
  if(willOpen){
    menu.classList.add('open');
    chip.classList.add('open');
    _positionChipMenu(chip, menu);
  }
}

// チップのドロップダウンを、収まる範囲（高度パネル内は .modal-body の可視域／バーは画面）に合わせて配置。
// 下に入らなければ上向き（.chip-menu-up）に開き、max-height を実測スペースに合わせて内部スクロールにする。
// → 高度パネルのように縦に詰まっていても Done ボタンを超えない（Add Flight の _acShow と同じ発想）。
function _positionChipMenu(chip, menu){
  menu.classList.remove('chip-menu-up');
  menu.style.maxHeight = '';
  const desired = Math.min(menu.scrollHeight + 2, 280);
  const margin = 8;
  const anchor = chip.getBoundingClientRect();
  const inModal = chip.closest('.modal-body');
  const cRect = inModal ? inModal.getBoundingClientRect() : { top:0, bottom:window.innerHeight };
  const spaceBelow = cRect.bottom - anchor.bottom - margin;
  const spaceAbove = anchor.top - cRect.top - margin;
  // 下に desired 入る or 下のほうが広ければ下開き。さもなければ上開き。
  const openDown = spaceBelow >= desired || spaceBelow >= spaceAbove;
  const floor = 80;  // 極端に狭い時でも最低これだけは見せる（内部スクロール）
  if(openDown){
    menu.style.maxHeight = Math.max(floor, Math.min(desired, spaceBelow)) + 'px';
  } else {
    menu.classList.add('chip-menu-up');
    menu.style.maxHeight = Math.max(floor, Math.min(desired, spaceAbove)) + 'px';
  }
}

function _closeAllFilterMenus(){
  document.querySelectorAll('.chip-menu.open').forEach(m => {
    m.classList.remove('open');
    m.classList.remove('chip-menu-up');
    m.style.maxHeight = '';   // 次回開く時に再計測できるようインライン値をクリア
    const chip = m.closest('.filter-chip-multi');
    if(chip) chip.classList.remove('open');
  });
}

// 外側クリック / Escape で全部閉じる
document.addEventListener('click', e => {
  if(!e.target.closest('.filter-chip-multi')) _closeAllFilterMenus();
});

// =============================== HEADER MENUS（≡ 機能 / ⚙️ 設定・フェーズS） ===============================
// chip-menu と同じ作法：トリガーで開閉、外側クリック / ESC で閉じる。排他（片方を開くと他方は閉じる）。
// which: 'data'（≡ 機能メニュー）| 'settings'（⚙️ 設定メニュー）
function toggleHeaderMenu(which, e){
  if(e) e.stopPropagation();
  const wrap = document.getElementById(which === 'settings' ? 'settingsMenuWrap' : 'dataMenuWrap');
  if(!wrap) return;
  const willOpen = !wrap.classList.contains('open');
  closeHeaderMenus();           // 自分も含め一旦すべて閉じる（排他）
  if(willOpen){
    wrap.classList.add('open');
    const btn = wrap.querySelector('.header-icon-btn');
    if(btn) btn.setAttribute('aria-expanded', 'true');
  }
}

function closeHeaderMenus(){
  document.querySelectorAll('.header-menu-wrap.open').forEach(w => {
    w.classList.remove('open');
    const btn = w.querySelector('.header-icon-btn');
    if(btn) btn.setAttribute('aria-expanded', 'false');
  });
}

// 外側クリックで閉じる（トリガー・メニュー内のクリックは .header-menu-wrap 内なので無視）
document.addEventListener('click', e => {
  if(!e.target.closest('.header-menu-wrap')) closeHeaderMenus();
});

// ≡ メニューの「Search flights」：Flight Log を拡大表示で開いて検索欄にフォーカス。
// （ページ末尾へスクロールするより、専用の拡大ビューを出す方が探しやすい）
function focusFlightSearch(){
  closeHeaderMenus();
  const section = document.querySelector('.card.table-section');
  const input = document.getElementById('logSearch');
  if(!section || !input) return;
  // まだ拡大していなければ拡大表示にする（既に開いていればそのまま）
  if(!section.classList.contains('card-fullscreen') && typeof toggleFlightLogFullscreen === 'function'){
    toggleFlightLogFullscreen();
  }
  // 拡大アニメーション後に検索欄へフォーカス
  setTimeout(() => { input.focus(); }, 120);
}

// =============================== DATA CHECK（フェーズX：未収録の検出） ===============================
// フライトに含まれる空港/機材のうち、データセット（AP / AIRCRAFT_CANONICAL_TABLE）に無いものを洗い出す。
// 未収録空港は座標が無いため地図に出ず、国内/国際・国別カウントからも除外（unknown）される。
// その「サイレントな抜け」を可視化し、何を airports.js / aircraft.js に足せばよいか分かるようにする。

// 便を舐めて、未収録の空港コード・機材コードを集計する。
//   air:  { ICAO: { count(便数), routes:Set(例ルート) } }
//   acft: { 機材コード: count(便数) }
function _computeUnrecognized(){
  const flights = (typeof DataSource !== 'undefined') ? DataSource.flights : [];
  const air = {};
  const acft = {};
  flights.forEach(f => {
    const seen = new Set(); // 同一便で同じ未収録コードを二重カウントしない
    [f.dep, f.arr].forEach(code => {
      if(code && (typeof AP === 'undefined' || !AP[code])){
        if(!air[code]) air[code] = { count:0, routes:new Set() };
        if(!seen.has(code)){ air[code].count++; seen.add(code); }
        air[code].routes.add(`${f.dep || '?'}→${f.arr || '?'}`);
      }
    });
    const ac = f.ac;
    if(ac && (typeof AIRCRAFT_CANONICAL_TABLE === 'undefined' || !(ac in AIRCRAFT_CANONICAL_TABLE))){
      acft[ac] = (acft[ac] || 0) + 1;
    }
  });
  return { air, acft };
}

function openDataCheck(){
  closeHeaderMenus();
  const overlay = document.getElementById('dataCheckOverlay');
  if(!overlay) return;
  _renderDataCheck();
  overlay.classList.add('show');
  _lockBodyScroll('dataCheckOverlay');
}
function closeDataCheck(){
  const overlay = document.getElementById('dataCheckOverlay');
  if(!overlay) return;
  overlay.classList.remove('show');
  _unlockBodyScroll('dataCheckOverlay');
}

// 未収録空港リストの「+ Add」ボタン → 手動追加フォームを開く（イベント委譲で1回だけ配線）。
// data-icao はブラウザが HTML エンティティを復号して dataset に渡すので、そのまま安全に使える。
(function _wireDataCheckAddButtons(){
  const box = document.getElementById('dcAirports');
  if(!box) return;
  box.addEventListener('click', e => {
    const btn = e.target.closest('.dc-add-btn');
    if(btn) openAddAirport(btn.dataset.icao || '');
  });
})();

// =============================== ADD AIRPORT（手動追加） ===============================
// Import の「Manual mode（6列）」と同じ内部処理（DataSource.addAirports）を、少数追加向けの
// やさしいフォームで包んだもの。Data check の各行「+ Add」から ICAO 事前入力で開く。
function openAddAirport(icao){
  const ov = document.getElementById('addAirportOverlay');
  if(!ov) return;
  document.getElementById('aaIcao').value = (icao || '').toUpperCase();
  document.getElementById('aaLat').value = '';
  document.getElementById('aaLng').value = '';
  document.getElementById('aaCity').value = '';
  document.getElementById('aaCountry').value = '';
  document.getElementById('aaContinent').value = 'Asia';
  _updateAaCoordLink();
  ov.classList.add('show');
  _lockBodyScroll('addAirportOverlay');
  // 緯度から入力を始めてもらう（ICAO は既に埋まっているため）
  setTimeout(() => { const el = document.getElementById('aaLat'); if(el) el.focus(); }, 50);
}
function closeAddAirport(){
  const ov = document.getElementById('addAirportOverlay');
  if(!ov) return;
  ov.classList.remove('show');
  _unlockBodyScroll('addAirportOverlay');
}
// 座標調べリンクの href を、入力中の ICAO / 都市名で OpenStreetMap 検索に更新。
function _updateAaCoordLink(){
  const link = document.getElementById('aaCoordLink');
  if(!link) return;
  const icao = (document.getElementById('aaIcao').value || '').trim();
  const city = (document.getElementById('aaCity').value || '').trim();
  const q = encodeURIComponent([icao, city, 'airport'].filter(Boolean).join(' '));
  link.href = 'https://www.openstreetmap.org/search?query=' + q;
}
// 入力値を検証 → AP に反映 + DataSource（localStorage）へ永続化 → 再描画。
function submitAddAirport(){
  const icaoRaw = (document.getElementById('aaIcao').value || '').trim();
  // IATA 3字も normalizeAirport で ICAO に寄せる（Import と同じ扱い）
  const icao = (typeof normalizeAirport === 'function' ? normalizeAirport(icaoRaw) : '') || icaoRaw.toUpperCase();
  const lat = parseFloat(document.getElementById('aaLat').value);
  const lng = parseFloat(document.getElementById('aaLng').value);
  const city = (document.getElementById('aaCity').value || '').trim();
  const co = (document.getElementById('aaCountry').value || '').trim();
  const ct = document.getElementById('aaContinent').value;
  if(icao.length < 2 || icao.length > 4){ alert('Please enter a valid ICAO code (2–4 letters).'); return; }
  if(isNaN(lat) || isNaN(lng)){ alert('Please enter latitude and longitude as numbers (decimal degrees).'); return; }
  if(lat < -90 || lat > 90 || lng < -180 || lng > 180){ alert('Latitude must be between −90 and 90, longitude between −180 and 180.'); return; }
  if(!city){ alert('Please enter a city name.'); return; }
  if(!co){ alert('Please enter a country.'); return; }
  const entry = { lat, lng, city, co, ct };
  AP[icao] = entry;                       // 実行中セッションの空港テーブルに即反映
  DataSource.addAirports({ [icao]: entry }); // カスタム空港として localStorage 永続化
  flights = DataSource.flights;
  refreshAll();                           // 地図・カウント・データ収録ステータスを更新
  closeAddAirport();
  _renderDataCheck();                     // 背後の Data check 一覧から追加済みコードを消す
  showToast(`✓ ${icao} added`);
}

// 窓を開くたびに最新データで再描画。コード類はユーザー入力由来なので必ず _escapeHtml。
function _renderDataCheck(){
  const { air, acft } = _computeUnrecognized();

  const apBox = document.getElementById('dcAirports');
  if(apBox){
    const list = Object.entries(air).sort((a,b)=>b[1].count-a[1].count);
    if(!list.length){
      apBox.innerHTML = `<div class="dc-ok">✓ All airports recognized</div>`;
    } else {
      apBox.innerHTML = list.map(([code, info]) => {
        const eg = Array.from(info.routes).slice(0,2).map(_escapeHtml).join(', ');
        const more = info.routes.size > 2 ? ` +${info.routes.size-2}` : '';
        const safe = _escapeHtml(code);
        return `<div class="dc-row">
          <span class="dc-code">${safe}</span>
          <span class="dc-count">${info.count} flight${info.count>1?'s':''}</span>
          <span class="dc-eg">${eg}${more}</span>
          <button class="dc-add-btn" data-icao="${safe}">+ Add</button>
        </div>`;
      }).join('');
    }
  }

  const acBox = document.getElementById('dcAircraft');
  if(acBox){
    const list = Object.entries(acft).sort((a,b)=>b[1]-a[1]);
    if(!list.length){
      acBox.innerHTML = `<div class="dc-ok">✓ All aircraft recognized</div>`;
    } else {
      acBox.innerHTML = list.map(([code, n]) =>
        `<div class="dc-row">
          <span class="dc-code">${_escapeHtml(code)}</span>
          <span class="dc-count">${n} flight${n>1?'s':''}</span>
        </div>`
      ).join('');
    }
  }

  // 検索欄はリセット
  const li = document.getElementById('dcLookupInput');
  const lr = document.getElementById('dcLookupResult');
  if(li) li.value = '';
  if(lr){ lr.textContent = ''; lr.className = 'dc-lookup-result'; }
}

// ⚙️ 設定メニューの「データ収録ステータス」行を更新（refreshAll から毎回呼ぶ）。
// 未収録の空港＋機材コードが 0 → 緑✓、1 以上 → ⚠️ N（クリックで Data check 窓）。
function _updateDataStatus(){
  const row   = document.getElementById('dataStatus');
  const icon  = document.getElementById('dataStatusIcon');
  const label = document.getElementById('dataStatusLabel');
  if(!row || !icon || !label) return;
  const { air, acft } = _computeUnrecognized();
  const n = Object.keys(air).length + Object.keys(acft).length;
  if(n === 0){
    row.classList.remove('is-warn');
    icon.textContent = '✓';
    label.textContent = 'All data recognized';
  } else {
    row.classList.add('is-warn');
    icon.textContent = '⚠️';
    label.textContent = `${n} unrecognized`;
  }
}

// 「Check an airport」：入力（ICAO/IATA/都市名）を normalizeAirport で解決し AP 収録有無を返す。
function dataCheckLookup(){
  const input = document.getElementById('dcLookupInput');
  const out = document.getElementById('dcLookupResult');
  if(!input || !out) return;
  const raw = input.value.trim();
  if(!raw){ out.textContent = ''; out.className = 'dc-lookup-result'; return; }
  const icao = (typeof normalizeAirport === 'function') ? normalizeAirport(raw) : raw;
  if(icao && typeof AP !== 'undefined' && AP[icao]){
    const m = AP[icao];
    out.className = 'dc-lookup-result is-ok';
    out.textContent = `✓ ${m.city || icao} · ${icao}${m.co ? ' · ' + m.co : ''}`;
  } else {
    out.className = 'dc-lookup-result is-no';
    out.textContent = `✗ Not in dataset (read as “${icao}”)`;
  }
}

// =============================== COMPARE SECTION ===============================
// アンカーカード内の年・月セレクタが変わったとき。
// CompareState を更新して再描画するだけ（フィルタとは独立 → refreshAll は不要）。
// 月（monthA/monthB）は '' なら "その年の全月"、'01'〜'12' でその月のみ。
// 同年月（yearA===yearB かつ monthA===monthB）は renderCompare 側で自動で別の年にずらす
// （完全一致比較は全項目 0% / ─ になるだけで無意味なため）。
function onCompareChange(){
  CompareState.yearA  = document.getElementById('compareYearA').value;
  CompareState.yearB  = document.getElementById('compareYearB').value;
  CompareState.monthA = document.getElementById('compareMonthA').value;
  CompareState.monthB = document.getElementById('compareMonthB').value;
  renderCompare();
}

// N-B: 拡大チャート（Year / Month / Weekday）のクリックでグローバルフィルターに反映。
// stateKey は FilterState のキー（'years' / 'months' / 'weekdays'）、value は compute.js の
// フォーマットに合わせた単一値（年='2024' / 月='07' / 曜日='0'..'6'）。
// 既にその値だけが単独選択中なら解除（同じ点の再クリックで全表示に戻るトグル）。
function _drilldownFilter(stateKey, value){
  const cur = FilterState[stateKey] || [];
  const isOnlyThis = cur.length === 1 && cur[0] === value;
  FilterState[stateKey] = isOnlyThis ? [] : [value];
  rebuildFilters();      // メニューのチェック状態＆チップ表示をプログラム変更に同期
  _writeFiltersToURL();
  refreshAll();
}

// フェーズY-2 増分2：Top Routes の拡大バークリック → 出発+到着の重ね掛けに分解（ルート専用軸は作らない）。
// ラベルは computeAll の "DEP → ARR"（区切りは ' → '）。同じルートだけが選択中なら解除トグル。
function _drilldownRoute(routeLabel){
  const parts = String(routeLabel).split(' → ');
  if(parts.length !== 2) return;
  const [dep, arr] = parts;
  const isOnlyThis = _sameSet(FilterState.depAirports, [dep]) && _sameSet(FilterState.arrAirports, [arr]);
  FilterState.depAirports = isOnlyThis ? [] : [dep];
  FilterState.arrAirports = isOnlyThis ? [] : [arr];
  rebuildFilters();
  _writeFiltersToURL();
  refreshAll();
}

// 注：Top Cities の拡大バークリックは cities 軸ができたので専用処理は不要になった
//     （render.js から `_drilldownFilter('cities', 都市ラベル)` を直接呼ぶ）。

function clearFilters(){
  FILTER_DEFS.forEach(def => { FilterState[def.stateKey] = []; });
  FilterState.durationRange = [];   // DEF を持たない軸も忘れずクリア（①(b)）
  // チェックボックスの見た目もリセット（rebuildFilters が再描画するので保険的に）
  document.querySelectorAll('.chip-menu input[type="checkbox"]').forEach(cb => cb.checked=false);
  _closeAllFilterMenus();
  rebuildFilters();   // メニュー（duration の範囲入力含む）を最新の FilterState で再描画
  _writeFiltersToURL();
  refreshAll();
}

// ============================ ADVANCED FILTER PANEL（フェーズY-2） ============================
// 上=プリセット（複数軸コンボ）/ 区切り線 / 下=新軸フィルタ。7 チップは維持し、増える軸はここへ。
// プリセットは「複数軸の掛け合わせ」（単軸は既にチップで 1 クリック可）。同じ組合せを再クリックで解除トグル。
// FILTER_PRESETS（プリセット定義）と _sameSet は js/filters-config.js へ分離（2026-07-03）。
// 適用・描画（applyPreset / _renderPresets / _presetActive）はここ（DOM 層）に残す。

// プリセットが「今ちょうど適用されている」か（set に列挙した各軸が値まで一致）。
function _presetActive(p){
  return Object.entries(p.set).every(([k,v]) => _sameSet(FilterState[k], v));
}

function _renderPresets(){
  const box = document.getElementById('advPresets');
  if(!box) return;
  box.innerHTML = FILTER_PRESETS.map(p => `
    <button type="button" class="adv-preset${_presetActive(p)?' active':''}" onclick="applyPreset('${p.id}')">
      <span class="adv-preset-emoji">${p.emoji}</span>
      <span>${_escapeHtml(p.label)}</span>
    </button>
  `).join('');
}

// プリセット適用：列挙した軸を値ごとセット（他軸は触らず＝重ね掛け可）。
// 既にそのプリセットどおりなら該当軸をクリア（再クリックで解除トグル）。
function applyPreset(id){
  const p = FILTER_PRESETS.find(x => x.id===id);
  if(!p) return;
  const active = _presetActive(p);
  Object.entries(p.set).forEach(([k,v]) => { FilterState[k] = active ? [] : v.slice(); });
  rebuildFilters();       // メニュー／チップ／高度パネルのチェック状態を同期
  _renderPresets();       // プリセットボタンの active 表示も更新
  _writeFiltersToURL();
  refreshAll();
}

// ============================ SAVED (CUSTOM) PRESETS（Y-2 増分3） ============================
// ユーザーが「現在の絞り込み」を名前付きで保存 → Presets 下の Saved にカスタムボタンとして表示。
// localStorage 永続（将来サーバー移行で長期記憶）。削除は Saved タイトル横の ✏️ 編集モード → 各ボタンの ✕。
const _STORAGE_KEY_CUSTOM_PRESETS = 'if-dashboard:custom-presets:v1';
// _ALL_STATE_KEYS（保存/復元で扱う全フィルタ軸）は js/filters-config.js へ分離（2026-07-03）。
let _customPresets = _loadCustomPresets();
let _savedEditMode = false;

function _loadCustomPresets(){
  if(typeof STORAGE_AVAILABLE !== 'undefined' && !STORAGE_AVAILABLE) return [];
  try {
    const raw = localStorage.getItem(_STORAGE_KEY_CUSTOM_PRESETS);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.filter(p => p && p.id && typeof p.name === 'string' && p.state) : [];
  } catch(e){ return []; }
}
function _persistCustomPresets(){
  if(typeof STORAGE_AVAILABLE !== 'undefined' && !STORAGE_AVAILABLE) return;
  try { localStorage.setItem(_STORAGE_KEY_CUSTOM_PRESETS, JSON.stringify(_customPresets)); }
  catch(e){ /* 保存できなくても致命的でない（次回もデフォルト＝空） */ }
}

// 現在の FilterState の「効いている軸」だけを取り出したスナップショット。
function _captureFilterState(){
  const snap = {};
  _ALL_STATE_KEYS.forEach(k => { if(FilterState[k] && FilterState[k].length) snap[k] = FilterState[k].slice(); });
  return snap;
}
// スナップショットを丸ごと復元（他軸はクリア＝「保存したビューを開く」）。
function _applySavedState(state){
  _ALL_STATE_KEYS.forEach(k => { FilterState[k] = (state && state[k]) ? state[k].slice() : []; });
  rebuildFilters();
  _renderPresets(); _renderSaved();
  _writeFiltersToURL();
  refreshAll();
}
// 効いている軸の数（保存確認・空判定用）。
function _activeAxisCount(){
  return _ALL_STATE_KEYS.reduce((n,k) => n + ((FilterState[k] && FilterState[k].length) ? 1 : 0), 0);
}
// そのカスタムプリセットが今ちょうど適用されているか（全軸一致）。
function _savedActive(p){
  return _ALL_STATE_KEYS.every(k => _sameSet(FilterState[k] || [], (p.state && p.state[k]) || []));
}

function _renderSaved(){
  const box = document.getElementById('advSaved');
  const editBtn = document.getElementById('advSavedEdit');
  if(!box) return;
  if(!_customPresets.length){
    _savedEditMode = false;
    if(editBtn) editBtn.style.display = 'none';
    box.classList.remove('is-editing');
    box.innerHTML = `<button type="button" class="adv-preset adv-saved-add" onclick="openSavePreset()" title="Save current filters as a preset"><span class="adv-preset-emoji">＋</span><span>Save current filters</span></button>`;
    return;
  }
  if(editBtn){ editBtn.style.display = ''; editBtn.classList.toggle('is-editing', _savedEditMode); }
  box.classList.toggle('is-editing', _savedEditMode);
  box.innerHTML = _customPresets.map(p => {
    const active = _savedActive(p) ? ' active' : '';
    const del = _savedEditMode
      ? `<span class="adv-preset-del" onclick="deleteSavedPreset('${p.id}', event)" title="Delete" role="button" aria-label="Delete preset">✕</span>`
      : '';
    return `<button type="button" class="adv-preset${active}" onclick="applySavedPreset('${p.id}')">
      <span class="adv-preset-emoji">💾</span><span>${_escapeHtml(p.name)}</span>${del}</button>`;
  }).join('');
}

function applySavedPreset(id){
  if(_savedEditMode) return;   // 編集モード中は適用しない（削除操作を優先）
  const p = _customPresets.find(x => x.id === id);
  if(p) _applySavedState(p.state);
}
function deleteSavedPreset(id, e){
  if(e) e.stopPropagation();
  _customPresets = _customPresets.filter(p => p.id !== id);
  _persistCustomPresets();
  if(!_customPresets.length) _savedEditMode = false;
  _renderSaved();
}
function toggleSavedEdit(){
  _savedEditMode = !_savedEditMode;
  _renderSaved();
}

// 保存フロー：命名ウィンドウ
function openSavePreset(){
  if(_activeAxisCount() === 0){ showToast('Set some filters first', 'red'); return; }
  const ov = document.getElementById('savePresetOverlay');
  if(!ov) return;
  const input = document.getElementById('savePresetName');
  if(input) input.value = '';
  const sum = document.getElementById('savePresetSummary');
  if(sum){ const n = _activeAxisCount(); sum.textContent = `Saving ${n} active filter${n!==1?'s':''} as a preset.`; }
  ov.classList.add('show');
  _lockBodyScroll('savePresetOverlay');
  setTimeout(() => { if(input) input.focus(); }, 50);
}
function closeSavePreset(){
  const ov = document.getElementById('savePresetOverlay');
  if(!ov) return;
  ov.classList.remove('show');
  _unlockBodyScroll('savePresetOverlay');
}
function confirmSavePreset(){
  const input = document.getElementById('savePresetName');
  const name = (input ? input.value : '').trim();
  if(!name){ showToast('Enter a name', 'red'); if(input) input.focus(); return; }
  if(_activeAxisCount() === 0){ showToast('Set some filters first', 'red'); closeSavePreset(); return; }
  _customPresets.push({ id: 'cp' + Date.now(), name: name.slice(0,40), state: _captureFilterState() });
  _persistCustomPresets();
  closeSavePreset();
  _renderSaved();
  showToast('✓ Preset saved');
}

function openAdvancedFilters(){
  const ov = document.getElementById('advFilterOverlay');
  if(!ov) return;
  _closeAllFilterMenus();  // バーのチップメニューが開いていたら閉じる
  rebuildFilters();        // パネル内の選択肢＆チェック状態を最新化
  _renderPresets();
  _renderSaved();
  ov.classList.add('show');
  _lockBodyScroll('advFilterOverlay');
}

function closeAdvancedFilters(){
  const ov = document.getElementById('advFilterOverlay');
  if(!ov) return;
  ov.classList.remove('show');
  _unlockBodyScroll('advFilterOverlay');
}
// URL パラメータは単数名（year, month, weekday, airline, aircraft, country, scope）、値はカンマ区切り。
// 例: ?year=2024,2025&month=07,12&weekday=5,6&airline=ANA,JAL&scope=domestic
// 旧 domestic=1 / international=1 形式は廃止（単一ユーザー想定・後方互換なし）。
function _writeFiltersToURL(){
  const params=new URLSearchParams();
  if(FilterState.years.length)     params.set('year',     FilterState.years.join(','));
  if(FilterState.months.length)    params.set('month',    FilterState.months.join(','));
  if(FilterState.weekdays.length)  params.set('weekday',  FilterState.weekdays.join(','));
  if(FilterState.airlines.length)  params.set('airline',  FilterState.airlines.join(','));
  if(FilterState.aircraft.length)  params.set('aircraft', FilterState.aircraft.join(','));
  if(FilterState.countries.length) params.set('country',  FilterState.countries.join(','));
  if(FilterState.scope.length)     params.set('scope',    FilterState.scope.join(','));
  // フェーズY-2：高度フィルターの新軸も URL に保存（単数キー・カンマ区切り）。
  if(FilterState.airports.length)      params.set('airport',      FilterState.airports.join(','));
  if(FilterState.cities.length)        params.set('city',         FilterState.cities.join(','));
  if(FilterState.continents.length)    params.set('continent',    FilterState.continents.join(','));
  if(FilterState.depAirports.length)   params.set('depAirport',   FilterState.depAirports.join(','));
  if(FilterState.arrAirports.length)   params.set('arrAirport',   FilterState.arrAirports.join(','));
  if(FilterState.depCities.length)     params.set('depCity',      FilterState.depCities.join(','));
  if(FilterState.arrCities.length)     params.set('arrCity',      FilterState.arrCities.join(','));
  if(FilterState.depCountries.length)  params.set('depCountry',   FilterState.depCountries.join(','));
  if(FilterState.arrCountries.length)  params.set('arrCountry',   FilterState.arrCountries.join(','));
  if(FilterState.depContinents.length) params.set('depContinent', FilterState.depContinents.join(','));
  if(FilterState.arrContinents.length) params.set('arrContinent', FilterState.arrContinents.join(','));
  if(FilterState.contScope.length)     params.set('contScope',    FilterState.contScope.join(','));
  if(FilterState.durations.length)     params.set('duration',     FilterState.durations.join(','));
  if(FilterState.durationRange.length===2) params.set('durRange',  FilterState.durationRange.join('-'));
  const qs=params.toString();
  history.replaceState(null,'',qs?'?'+qs:location.pathname);
}
function _parseCSVParam(raw){
  // 空文字や null は空配列、それ以外はカンマ分割＋trim＋空要素除去
  if(!raw) return [];
  return raw.split(',').map(s=>s.trim()).filter(Boolean);
}
function _readFiltersFromURL(){
  const p=new URLSearchParams(location.search);
  FilterState.years     = _parseCSVParam(p.get('year'));
  FilterState.airlines  = _parseCSVParam(p.get('airline'));
  FilterState.aircraft  = _parseCSVParam(p.get('aircraft'));
  FilterState.countries = _parseCSVParam(p.get('country'));
  // scope は 'domestic' / 'international' のみ受け付ける（不正値は無視）
  const validScope = new Set(['domestic', 'international']);
  FilterState.scope = _parseCSVParam(p.get('scope')).filter(v => validScope.has(v));
  // month は '01'..'12' のゼロ埋め文字列のみ受け付ける（fixedOptions の value と合わせる）
  const validMonths = new Set(_MONTH_LABELS.map((_,i) => String(i+1).padStart(2,'0')));
  FilterState.months = _parseCSVParam(p.get('month')).filter(v => validMonths.has(v));
  // weekday は '0'..'6' のみ受け付ける（Mon=0..Sun=6）
  const validWeekdays = new Set(['0','1','2','3','4','5','6']);
  FilterState.weekdays = _parseCSVParam(p.get('weekday')).filter(v => validWeekdays.has(v));
  // フェーズY-2：高度フィルターの新軸。
  //   空港系（airport/depAirport/arrAirport）は素通し＝rebuildFilters の prune でデータ外を除去。
  FilterState.airports    = _parseCSVParam(p.get('airport'));
  FilterState.cities      = _parseCSVParam(p.get('city'));
  FilterState.depAirports = _parseCSVParam(p.get('depAirport'));
  FilterState.arrAirports = _parseCSVParam(p.get('arrAirport'));
  FilterState.depCities   = _parseCSVParam(p.get('depCity'));
  FilterState.arrCities   = _parseCSVParam(p.get('arrCity'));
  FilterState.depCountries = _parseCSVParam(p.get('depCountry'));
  FilterState.arrCountries = _parseCSVParam(p.get('arrCountry'));
  const validCont = new Set(_CONTINENT_OPTS.map(o => o.value));
  FilterState.continents    = _parseCSVParam(p.get('continent')).filter(v => validCont.has(v));
  FilterState.depContinents = _parseCSVParam(p.get('depContinent')).filter(v => validCont.has(v));
  FilterState.arrContinents = _parseCSVParam(p.get('arrContinent')).filter(v => validCont.has(v));
  const validContScope = new Set(['intra','inter']);
  FilterState.contScope = _parseCSVParam(p.get('contScope')).filter(v => validContScope.has(v));
  const validDur = new Set(DURATION_BUCKETS.map(b => b.key));
  FilterState.durations = _parseCSVParam(p.get('duration')).filter(v => validDur.has(v));
  // カスタム範囲 durRange=lo-hi（分・整数）。両方が有効な非負整数で lo<=hi のときだけ採用。
  const dr = (p.get('durRange') || '').split('-').map(s => parseInt(s, 10));
  FilterState.durationRange = (dr.length === 2 && dr.every(n => Number.isFinite(n) && n >= 0) && dr[0] <= dr[1]) ? dr : [];
}

// populateYears is an alias for the unified filter rebuild (kept for backward compatibility)
function populateYears(){ rebuildFilters(); }

// =============================== ADD FLIGHT MODAL ===============================
function openModal(){
  document.getElementById('modalOverlay').classList.add('show');
  _lockBodyScroll('modalOverlay');
  // 開いた直後に Date 欄へフォーカス（アニメ完了を少し待つ）
  setTimeout(()=>{ const f=document.getElementById('fDate'); if(f) f.focus(); }, 80);
}
function closeModal(){document.getElementById('modalOverlay').classList.remove('show');_unlockBodyScroll('modalOverlay');}
function addFlight(){
  const date=document.getElementById('fDate').value;
  // 入力の生値を取り、データ境界で必ず正規化する（IATA→ICAO、機材正準コード、エアライン正式名）
  const dep = normalizeAirport(document.getElementById('fDep').value) || '';
  const arr = normalizeAirport(document.getElementById('fArr').value) || '';
  const ac  = normalizeAircraft(document.getElementById('fAircraft').value) || '';
  const al  = normalizeAirline(document.getElementById('fAirline').value) || '';
  // Flight Time：分離入力（h／m）を結合してから normalizeTime に通す。
  // h は >23 も許容（直接入力）、m は 0〜59 を厳格チェック。空欄は 0 扱い。
  const rawH = document.getElementById('fTimeH').value.trim();
  const rawM = document.getElementById('fTimeM').value.trim();
  const h = rawH==='' ? 0 : parseInt(rawH, 10);
  const m = rawM==='' ? 0 : parseInt(rawM, 10);
  if(isNaN(h) || isNaN(m) || h<0 || m<0){ alert('Flight time must be non-negative numbers.'); return; }
  if(m > 59){ alert('Minutes must be 0–59 (use the hour field for full hours).'); return; }
  if(!date||!dep||!arr||!ac||!al || (h===0 && m===0)){
    alert('Please fill in all fields.');
    return;
  }
  // 正準形 "Xh{padded2}m" に組み立て → normalize 経由で確実に canonical 化
  const combined = `${h}h${String(m).padStart(2,'0')}m`;
  let t = normalizeTime(combined) || combined;
  DataSource.addOne({date,dep,arr,ac,al,t});
  flights=DataSource.flights;
  closeModal();
  rebuildYearFilter();
  refreshAll();
  ['fDate','fDep','fArr','fAircraft','fAirline','fTimeH','fTimeM'].forEach(id=>document.getElementById(id).value='');
  showToast('✓ Flight added successfully');
}

// =============================== REFRESH ===============================
// Leaflet's map needs a visible container to initialize correctly,
// so we defer map init until the first refresh that has data.
let _mapInited = false;
function ensureMap(){
  if(_mapInited) return;
  initMap();
  _mapInited = true;
}
function refreshAll(){
  refreshEmptyState();
  refreshDirtyBanner();
  _updateDataStatus();   // ⚙️ のデータ収録ステータス（未収録 N 件）を更新
  if(DataSource.count===0){
    // Nothing to render — empty-state UI handles it
    return;
  }
  ensureMap();
  // If map was already inited but is just becoming visible again, refresh its size
  if(map && map.invalidateSize) map.invalidateSize();
  const data=getFiltered();
  const s=computeAll(data);
  renderStats(data);
  renderBars('aircraftBars',s.ac.slice(0,5),'aircraft', s.acMin);
  renderBars('airlinesBars',s.al.slice(0,5),'airlines', s.alMin);
  renderBars('routesBars',s.rt.slice(0,5),'routes');
  renderBars('airportsBars',s.ap.slice(0,5),'airports');
  renderBars('countriesBars',s.co.slice(0,5),'countries');
  renderBars('citiesBars',s.ci.slice(0,5),'cities');
  renderCharts(s);
  renderTable([...data].reverse());
  renderMap(data);
  renderTopFlightsBars();
  renderCompare();
  _updateFlightLogFooter();
  // Reset toggles
  document.querySelectorAll('.toggle').forEach(t=>{
    t.querySelectorAll('.toggle-btn').forEach((b,i)=>b.classList.toggle('active',i===0));
  });
  // Reset header checkbox
  const cbAll=document.getElementById('cbAll');
  if(cbAll){cbAll.checked=false;cbAll.classList.remove('partial');}
  document.getElementById('selectBar').classList.remove('show');
}

// =============================== THEME (LIGHT / DARK / AUTO) ===============================
// localStorage には 'auto' / 'light' / 'dark' の3値を保存。
// 'auto' は OS の prefers-color-scheme に追従し、OS 設定の変更にもリアルタイム反映する。
// 切替はヘッダの ☀️/🌙/🔄 ボタンから toggleTheme() で：auto → light → dark → auto の順に巡回。
// テーマは <html data-theme="..."> に反映（CSS の :root はダーク、[data-theme="light"] で上書き）。
//
// アイコンの意味（状態オーナー型：今の状態を表示）：
//   ☀️ = Light 固定 / 🌙 = Dark 固定 / 🔄 = Auto（OS追従）
// 次に切替わる先は title 属性（hover）に表示。
const _THEME_KEY = 'if-dashboard:theme:v1';
const _THEME_CYCLE = ['auto','light','dark'];
const _THEME_LABELS = { auto:'Auto (follow OS)', light:'Light', dark:'Dark' };

// localStorage から保存値（'auto'/'light'/'dark'）を取得。未保存・不正値は 'auto'。
function _resolveStoredTheme(){
  try {
    const saved = localStorage.getItem(_THEME_KEY);
    if(_THEME_CYCLE.includes(saved)) return saved;
  } catch(e){ /* fallthrough */ }
  return 'auto';
}

// OS が light を要求しているか（matchMedia 未対応環境では false → dark にフォールバック）
function _osPrefersLight(){
  return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches);
}

// 保存値（auto含む）→ 実際に適用するテーマ（light/dark のみ）に解決
function _resolveEffectiveTheme(stored){
  if(stored === 'auto') return _osPrefersLight() ? 'light' : 'dark';
  return stored;
}

// 現在の保存値に応じて、⚙️ 設定メニュー内のテーマ 3 択の選択表示（✓）と
// ⚙️ ボタンの tooltip を更新（フェーズS：旧・単独テーマトグルから移設）。
function _updateThemeButton(stored){
  document.querySelectorAll('#settingsMenu [data-theme-opt]').forEach(el => {
    const on = el.dataset.themeOpt === stored;
    el.classList.toggle('is-active', on);
    el.setAttribute('aria-checked', on ? 'true' : 'false');
  });
  const gear = document.getElementById('btnSettingsMenu');
  if(gear) gear.title = `Settings · Theme: ${_THEME_LABELS[stored]}`;
}

// モバイルのブラウザ上部（iOS Safari ステータスバー背景 / Android Chrome ステータスバー）を
// 現テーマのページ背景（--bg）に合わせる。--bg はヘッダー gradient の上端色と一致しているので、
// 「ステータスバーが白いままヘッダーと段差になる」問題が解消する。data-theme 反映後に呼ぶこと。
function _updateThemeColorMeta(){
  const meta = document.getElementById('themeColorMeta');
  if(!meta) return;
  const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
  if(bg) meta.setAttribute('content', bg);
}

// 描画系（Chart.js / Leaflet / Globe / バー等）を新しい CSS 変数で再適用
function _refreshThemeDependentRenders(){
  if(typeof applyMapTheme === 'function') applyMapTheme();
  if(typeof applyGlobeTheme === 'function') applyGlobeTheme();
  if(DataSource && DataSource.count > 0) refreshAll();
}

function applyTheme(stored){
  // 永続化（失敗しても致命的ではない）
  try { localStorage.setItem(_THEME_KEY, stored); } catch(e){}
  // 実テーマを反映
  document.documentElement.dataset.theme = _resolveEffectiveTheme(stored);
  _updateThemeColorMeta();
  _updateThemeButton(stored);
  _refreshThemeDependentRenders();
}

function toggleTheme(){
  const cur = _resolveStoredTheme();
  const next = _THEME_CYCLE[(_THEME_CYCLE.indexOf(cur) + 1) % _THEME_CYCLE.length];
  applyTheme(next);
}

// ⚙️ 設定メニューのテーマ 3 択（Auto / Light / Dark）から明示的に選ぶ。
// 選んだらメニューを閉じる。不正値は無視。
function setTheme(stored){
  if(!_THEME_CYCLE.includes(stored)) return;
  applyTheme(stored);
  closeHeaderMenus();
}

// OS のテーマ設定変更を監視。保存値が 'auto' のときだけリアルタイム追従。
// 'light'/'dark' 固定中は OS が変わってもユーザーの明示的選択を尊重し、無反応。
function _watchOsThemeChanges(){
  if(!window.matchMedia) return;
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  const handler = () => {
    if(_resolveStoredTheme() === 'auto'){
      document.documentElement.dataset.theme = _resolveEffectiveTheme('auto');
      _updateThemeColorMeta();
      _refreshThemeDependentRenders();
    }
  };
  // 古い Safari 互換：addEventListener 未対応なら addListener にフォールバック
  if(mq.addEventListener) mq.addEventListener('change', handler);
  else if(mq.addListener) mq.addListener(handler);
}

// 初期化：DOM 完成前に <html data-theme> を立てて FOUC（一瞬の白チラ）を防ぐ。
// アイコン更新＆OS監視は DOMContentLoaded 後にセットアップ。
(function _bootstrapTheme(){
  const stored = _resolveStoredTheme();
  document.documentElement.dataset.theme = _resolveEffectiveTheme(stored);
  _updateThemeColorMeta(); // ステータスバー色も初回から現テーマに合わせる
  document.addEventListener('DOMContentLoaded', () => {
    _updateThemeButton(stored);
    _watchOsThemeChanges();
    _initFilterStickyShadow();
  });
})();

// =============================== CSV FILE UPLOAD ===============================
function loadCSVFile(fileInput, mode){
  const file=fileInput.files[0];
  if(!file) return;
  const nameEl=document.getElementById(mode==='airport'?'apCsvFileName':'csvFileName');
  nameEl.textContent=file.name+' ('+Math.round(file.size/1024)+'KB)';
  const reader=new FileReader();
  reader.onload=function(e){
    const text=e.target.result;
    if(mode==='airport'){
      document.getElementById('bulkAirportCSV').value=text;
      previewAirports();
    } else {
      document.getElementById('bulkCSV').value=text;
      previewBulk();
    }
  };
  reader.readAsText(file);
}

// =============================== 3D GLOBE OVERLAY ===============================
// 2D 地図の代替ビューとして 3D 地球儀を表示。データは getFiltered() を共有する。
function openGlobe(){
  if(DataSource.count===0){
    showToast('No flights to show','red');
    return;
  }
  document.getElementById('globeOverlay').classList.add('show');
  _lockBodyScroll('globeOverlay');
  // モーダル CSS アニメ完了後に初期化／リサイズしないと container 寸法が 0 になる
  setTimeout(()=>{
    initGlobe();
    resizeGlobe();
    renderGlobeData();
  }, 250);
}
function closeGlobe(){
  document.getElementById('globeOverlay').classList.remove('show');
  _unlockBodyScroll('globeOverlay');
}

// =============================== 2D MAP EXPANDED OVERLAY ===============================
// インラインの 2D 地図と同じ Leaflet を、別インスタンスで拡大ウィンドウ表示する。
// データはインライン地図と共有（renderMap が両方を更新する）。
function openMapExpanded(){
  if(DataSource.count===0){
    showToast('No flights to show','red');
    return;
  }
  document.getElementById('mapOverlay').classList.add('show');
  _lockBodyScroll('mapOverlay');
  // モーダル CSS アニメ完了後に初期化／リサイズしないと container 寸法が 0 になる
  setTimeout(()=>{
    initMapExpanded();
    resizeMapExpanded();
    // 初回はここで初描画、2 回目以降は renderMap 側で同期されているので
    // invalidateSize の後にもう一度 fitBounds させるため再描画する。
    renderMap(getFiltered());
  }, 250);
}
function closeMapExpanded(){
  document.getElementById('mapOverlay').classList.remove('show');
  _unlockBodyScroll('mapOverlay');
}

// ウィンドウサイズ変化時に追従
window.addEventListener('resize', ()=>{
  if(document.getElementById('globeOverlay').classList.contains('show')) resizeGlobe();
  if(document.getElementById('mapOverlay').classList.contains('show')) resizeMapExpanded();
});

// =============================== EXPORT DIALOG ===============================
// ユーザーが Flight Log / Custom Airports をそれぞれ選んで DL できる。
// 出力 CSV は DataSource 経由なので、正規化済み（ICAO 4 文字、正式エアライン名等）の
// フォーマットになる。
function openExport(){
  if(DataSource.count===0 && Object.keys(DataSource.customAirports).length===0){
    showToast('Nothing to export','red');
    return;
  }
  const fCount = DataSource.count;
  const aCount = Object.keys(DataSource.customAirports).length;
  document.getElementById('exportFlightsCount').textContent =
    `${fCount} flight${fCount===1?'':'s'}`;
  document.getElementById('exportAirportsCount').textContent =
    `${aCount} airport${aCount===1?'':'s'} added`;
  // 件数 0 はチェック不能・選択不可に
  const fBox = document.getElementById('exportFlights');
  const aBox = document.getElementById('exportAirports');
  fBox.checked  = fCount>0;
  fBox.disabled = fCount===0;
  aBox.checked  = aCount>0;
  aBox.disabled = aCount===0;
  // プレフィックス入力欄に保存値（または既定値）をセット → 末尾の日付プレビューも更新
  document.getElementById('exportFlightsPrefix').value  = getExportPrefix('flights');
  document.getElementById('exportAirportsPrefix').value = getExportPrefix('airports');
  _updateExportFilenamePreviews();
  document.getElementById('exportOverlay').classList.add('show');
  _lockBodyScroll('exportOverlay');
}

// 各プレフィックス入力の末尾に「_YYYY-MM-DD.csv」のプレビューを表示する。
// 入力時 (oninput) からも呼ばれる。
function _updateExportFilenamePreviews(){
  const fInput = document.getElementById('exportFlightsPrefix');
  const aInput = document.getElementById('exportAirportsPrefix');
  const fPrev  = document.getElementById('exportFlightsPreview');
  const aPrev  = document.getElementById('exportAirportsPreview');
  if(fInput && fPrev) fPrev.textContent = buildExportFilename(fInput.value);
  if(aInput && aPrev) aPrev.textContent = buildExportFilename(aInput.value);
}
function onExportPrefixInput(){ _updateExportFilenamePreviews(); }
function closeExport(){
  document.getElementById('exportOverlay').classList.remove('show');
  _unlockBodyScroll('exportOverlay');
}
function executeExport(){
  const wantF = document.getElementById('exportFlights').checked;
  const wantA = document.getElementById('exportAirports').checked;
  if(!wantF && !wantA){
    showToast('Select at least one file','red');
    return;
  }
  // 入力されたプレフィックスを localStorage に保存（次回のエクスポートに引き継ぐ）
  const fPrefixRaw = document.getElementById('exportFlightsPrefix').value;
  const aPrefixRaw = document.getElementById('exportAirportsPrefix').value;
  setExportPrefix('flights',  fPrefixRaw);
  setExportPrefix('airports', aPrefixRaw);
  let n=0;
  if(wantF && DataSource.count>0){
    _download(buildExportFilename(fPrefixRaw || EXPORT_PREFIX_DEFAULTS.flights),
              buildFlightCSV(DataSource.flights));
    n++;
  }
  if(wantA){
    const custom = DataSource.customAirports;
    if(Object.keys(custom).length>0){
      _download(buildExportFilename(aPrefixRaw || EXPORT_PREFIX_DEFAULTS.airports),
                buildAirportCSV(custom));
      n++;
    }
  }
  // Flight Log を出した場合のみ dirty フラグをクリア
  if(wantF) DataSource.markClean();
  closeExport();
  if(n>0) showToast(`✓ Exported ${n} file${n>1?'s':''}`);
}

// =============================== BULK IMPORT ===============================
let currentBulkTab = 'flights';

function openBulk(){
  document.getElementById('bulkOverlay').classList.add('show');
  _lockBodyScroll('bulkOverlay');
  // Flights タブのテキストエリアへフォーカス
  setTimeout(()=>{
    const ta = currentBulkTab==='airports'
      ? document.getElementById('bulkAirportCSV')
      : document.getElementById('bulkCSV');
    if(ta) ta.focus();
  }, 80);
}
function closeBulk(){
  document.getElementById('bulkOverlay').classList.remove('show');
  _unlockBodyScroll('bulkOverlay');
  document.getElementById('bulkCSV').value='';
  document.getElementById('bulkAirportCSV').value='';
  document.getElementById('bulkPreview').style.display='none';
  document.getElementById('bulkCount').style.display='none';
  document.getElementById('apBulkPreview').style.display='none';
  document.getElementById('apBulkCount').style.display='none';
  document.getElementById('bulkClearBtn').style.display='none';
  document.getElementById('apBulkClearBtn').style.display='none';
  document.getElementById('csvFileName').textContent='';
  document.getElementById('apCsvFileName').textContent='';
  document.getElementById('csvFileInput').value='';
  document.getElementById('apCsvFileInput').value='';
}

// テキストエリアを 1 クリックで空にする（Clear ボタン）。プレビュー/件数も連動リセット、
// 続けて自分のデータを貼れるよう即フォーカス。mode='airport' で空港タブ、既定は Flights。
function clearBulkInput(mode){
  const isAir = mode==='airport';
  const ta = document.getElementById(isAir ? 'bulkAirportCSV' : 'bulkCSV');
  if(!ta) return;
  ta.value='';
  if(isAir) previewAirports(); else previewBulk();  // 件数/プレビュー/Clear ボタンを空状態へ
  ta.focus();
}

function switchBulkTab(tab, btn){
  currentBulkTab = tab;
  btn.parentElement.querySelectorAll('.modal-tab').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('bulkFlightsTab').style.display = tab==='flights' ? '' : 'none';
  document.getElementById('bulkAirportsTab').style.display = tab==='airports' ? '' : 'none';
  document.getElementById('bulkImportBtn').textContent = tab==='flights' ? 'Import Flights' : 'Import Airports';
}

// ----- サンプルデータ（公開デモ用。data/sample.js の SAMPLE_*_CSV を使う） -----
// 指定タブを（ボタン要素無しでも）アクティブ化する内部ヘルパ（Flights / Airports 共通）。
function _activateBulkTab(tab){
  currentBulkTab = tab;
  document.querySelectorAll('#bulkOverlay .modal-tab').forEach((b,i)=>{
    b.classList.toggle('active', tab==='airports' ? i===1 : i===0); // 0=Flights, 1=Airports
  });
  document.getElementById('bulkFlightsTab').style.display = tab==='flights' ? '' : 'none';
  document.getElementById('bulkAirportsTab').style.display = tab==='airports' ? '' : 'none';
  document.getElementById('bulkImportBtn').textContent = tab==='flights' ? 'Import Flights' : 'Import Airports';
}
// サンプルをペースト欄に差し込む（中身を確認してから本人が Import を押す方式）。
function loadSampleFlights(){
  _activateBulkTab('flights');
  const ta=document.getElementById('bulkCSV');
  ta.value=SAMPLE_FLIGHT_CSV;
  previewBulk();
  ta.focus(); ta.setSelectionRange(0,0); ta.scrollTop=0;
  showToast('👀 Sample data loaded — review it, then click Import');
}
// 空港サンプル（簡易・主にフォーマット見本／DL 用途）をペースト欄に差し込む。
function loadSampleAirports(){
  _activateBulkTab('airports');
  const ta=document.getElementById('bulkAirportCSV');
  ta.value=SAMPLE_AIRPORT_CSV;
  previewAirports();
  ta.focus(); ta.setSelectionRange(0,0); ta.scrollTop=0;
  showToast('👀 Sample airports loaded — review it, then click Import');
}
// クリップボードの中身をペースト欄へ流し込む（mode='airport' で空港タブ、既定は Flights）。
// 注意：navigator.clipboard.readText() は https（GitHub Pages）でのみ動作し、
// ローカルの file:// では多くのブラウザがブロックする。読めなければテキスト欄に
// フォーカスして「手動で Ctrl/Cmd+V してね」と促すフォールバックに切り替える。
async function pasteFromClipboard(mode){
  const isAir = mode==='airport';
  _activateBulkTab(isAir ? 'airports' : 'flights');
  const ta=document.getElementById(isAir ? 'bulkAirportCSV' : 'bulkCSV');
  try{
    const text=await navigator.clipboard.readText();
    if(text && text.trim()){
      ta.value=text;
      isAir ? previewAirports() : previewBulk();
      ta.focus();
      showToast('📋 Pasted from clipboard');
    } else {
      ta.focus();
      showToast('Clipboard is empty — paste manually with Ctrl/Cmd+V');
    }
  }catch(e){
    // file:// やパーミッション拒否：手動貼り付けへ誘導
    ta.focus();
    showToast('Press Ctrl/Cmd+V to paste into the box');
  }
}
// サンプル CSV をファイル保存（エディタで編集 → 読み込みのテンプレート用）。
function downloadSampleFlights(){
  _download('IF_Flight_Log_sample.csv', SAMPLE_FLIGHT_CSV);
  showToast('⬇️ Sample CSV downloaded');
}
function downloadSampleAirports(){
  _download('IF_Airports_sample.csv', SAMPLE_AIRPORT_CSV);
  showToast('⬇️ Sample airports CSV downloaded');
}
// 空状態の「サンプルで試す」：Import を開いてサンプルを差し込む。
function openSampleInBulk(){
  openBulk();
  setTimeout(loadSampleFlights, 60);
}

function executeBulkImport(){
  if(currentBulkTab==='flights'){
    const text=document.getElementById('bulkCSV').value;
    const parsed=parseBulkFlights(text);
    const valid=parsed.filter(r=>r.valid);
    if(valid.length===0){alert('No valid flights to import.');return;}
    // 組み込み AP に無い ICAO を抽出 → ユーザーに確認を出す。
    // AP は組み込み 187 空港 + カスタム空港（"Import Airports" で手動追加した分）が
    // 既に全部入っているので、ここに無いコードは「未知の空港」として扱う。
    const unknownAPs=new Set();
    valid.forEach(r=>{
      [r.dep, r.arr].forEach(code=>{
        if(!AP[code]) unknownAPs.add(code);
      });
    });
    if(unknownAPs.size>0){
      const proceed=confirm(`⚠️ Unknown airports (not in DB): ${[...unknownAPs].join(', ')}\n\nThese won't appear on the map. You can add them later via Import > Airports tab.\n\nImport anyway?`);
      if(!proceed) return;
    }
    const incoming=valid.map(r=>({date:r.date,dep:r.dep,arr:r.arr,ac:r.ac,al:r.al,t:r.t}));
    // If user is loading the very first batch into an empty dashboard, treat it as a "fresh load"
    // (not dirty) — they haven't modified anything yet, the CSV IS the source of truth.
    const wasEmpty = DataSource.count===0;
    const {added, duplicates} = DataSource.addFlights(incoming, {skipDuplicates:true});
    if(wasEmpty) DataSource.markClean();
    flights=DataSource.flights;
    closeBulk();
    rebuildYearFilter();
    refreshAll();
    let msg = `✓ ${added.length} flight${added.length===1?'':'s'} imported`;
    if(duplicates.length) msg += ` (${duplicates.length} duplicate${duplicates.length===1?'':'s'} skipped)`;
    showToast(msg);
  } else {
    const text=document.getElementById('bulkAirportCSV').value;
    const parsed=parseBulkAirports(text);
    const valid=parsed.filter(r=>r.valid);
    if(valid.length===0){alert('No valid airports to import.');return;}
    const newAPs={};
    valid.forEach(r=>{
      const entry={lat:r.lat,lng:r.lng,city:r.city,co:r.co,ct:r.ct};
      AP[r.icao]=entry;
      newAPs[r.icao]=entry;
    });
    DataSource.addAirports(newAPs);
    closeBulk();
    refreshAll();
    showToast(`✓ ${valid.length} airport${valid.length>1?'s':''} imported`);
  }
}

// =============================== INIT ===============================
// Hook the DataSource dirty-change signal
onDirtyChange = refreshDirtyBanner;
// Hook for auto-save event（保存成功時 / 失敗時にアイコン状態を更新）
onAutoSave = _onAutoSave;
onAutoSaveError = _onAutoSaveError;

// 自動保存が走った直後に呼ばれる。アイコンを「OK」状態に維持しつつ、
// 上部の通知バナーで「✓ Auto-saved」を 10 秒表示（連続発火は間引き）。
let _lastSavedNotifyAt = 0;
function _onAutoSave(){
  _setSaveStatus('ok');
  // データが 0 件になった瞬間（Clear All 等）は通知バナーを出さない。
  // 直後に restore モーダル/empty state へ遷移するため、緑バナーが一瞬出るのが不自然。
  if(DataSource.count === 0) return;
  const now = Date.now();
  // 同じ操作内で連続発火する場合があるので、500ms 以内は間引く
  if(now - _lastSavedNotifyAt < 500) return;
  _lastSavedNotifyAt = now;
  // 成功通知はトースト化（フェーズX フィードバック）。キューにより、操作トースト
  //（「✓ Flight added」等）が消えてから続けて短く表示される。エラーは下の常設バナーのまま。
  // 注意：_onAutoSave は DataSource の変更中（＝操作トーストを showToast する前）に
  // 同期的に呼ばれるため、そのまま enqueue すると「✓ Auto-saved」が先に出てしまう。
  // 1 tick 遅らせて、呼び出し元の操作トースト（「✓ N flights imported」等）が
  // 先にキューへ入るようにする → 「件数 → 消える → 自動保存済み」の順で表示される。
  setTimeout(() => {
    showToast('✓ Auto-saved · CSV backup recommended', undefined, 2000);
  }, 0);
}

// 保存失敗時：アイコンを警告状態に切り替え + 赤バナーを ✕ で閉じるまで常設表示。
function _onAutoSaveError(_err){
  if(!DataSource.isStorageAvailable()){
    _setSaveStatus('disabled');
    showNotifyBanner('error',
      'Auto-save is not available on this device. Your data exists only in memory and will be lost on close. ' +
      'Open via GitHub Pages or a local HTTP server, and back up via CSV Export.',
      { persistent: true });
  } else {
    _setSaveStatus('error');
    showNotifyBanner('error',
      'Failed to auto-save (storage may be full or restricted). Please export to CSV as a backup.',
      { persistent: true });
  }
}

// =============================== NOTIFY BANNER ===============================
// 上部スティッキーバナー。現在は**エラー専用**（赤・✕ で閉じるまで常設）。
// 保存「成功」通知はトースト（showToast）へ移行済み（2026-07-01）。'success' 経路は残すが未使用。
let _notifyTimer = null;
function showNotifyBanner(variant, message, opts){
  const banner = document.getElementById('notifyBanner');
  const msg = document.getElementById('notifyMsg');
  if(!banner || !msg) return;
  // 直前のタイマーをクリアして上書き
  if(_notifyTimer){ clearTimeout(_notifyTimer); _notifyTimer = null; }
  msg.textContent = message;
  banner.classList.remove('notify-error');
  if(variant === 'error'){
    banner.classList.add('notify-error');
  }
  banner.classList.add('show');
  // success は 10 秒で自動消滅、error は ✕ で閉じるまで常設
  const persistent = opts && opts.persistent;
  if(!persistent){
    _notifyTimer = setTimeout(() => closeNotifyBanner(), 10000);
  }
}
function closeNotifyBanner(){
  const banner = document.getElementById('notifyBanner');
  if(banner) banner.classList.remove('show');
  if(_notifyTimer){ clearTimeout(_notifyTimer); _notifyTimer = null; }
}

// =============================== SAVE STATUS INFO MODAL ===============================
// ヘッダの保存ステータスアイコンをクリックしたときに開く案内ポップアップ。
// 現在の状態（OK / error / disabled）に応じてアイコン色・タイトル・本文を切り替える。
function openSaveStatusInfo(){
  const overlay = document.getElementById('saveStatusOverlay');
  const box     = document.getElementById('saveStatusBox');
  const glyph   = document.getElementById('saveStatusInfoGlyph');
  const title   = document.getElementById('saveStatusInfoTitle');
  const desc    = document.getElementById('saveStatusInfoDesc');
  const note    = document.getElementById('saveStatusInfoNote');
  if(!overlay || !box) return;
  box.classList.remove('is-error', 'is-disabled');

  if(!DataSource.isStorageAvailable()){
    box.classList.add('is-disabled');
    glyph.textContent = '○';
    title.textContent = 'Auto-save unavailable';
    desc.innerHTML = "This browser blocks storage in the current environment "
                  + '(typically <strong>file://</strong> direct-open).<br>'
                  + 'Open via GitHub Pages or a local HTTP server '
                  + '(<code>python3 -m http.server</code>) for auto-save to work.';
    note.textContent = 'Your data exists only in memory until you export to CSV.';
  } else if(document.getElementById('saveStatus').classList.contains('is-error')){
    box.classList.add('is-error');
    glyph.textContent = '!';
    title.textContent = 'Auto-save failed';
    desc.innerHTML = 'The last save attempt failed. Storage may be <strong>full</strong>, '
                  + 'or restricted by the browser.<br>'
                  + 'Please back up your data via CSV Export.';
    note.textContent = 'Newer changes may not be persisted.';
  } else {
    glyph.textContent = '✓';
    title.textContent = 'Auto-saved';
    desc.innerHTML = 'Your flights are automatically saved to this device\'s storage.<br>'
                   + '<strong>CSV backup recommended</strong> for safety.';
    note.textContent = 'Saved on your device · not sent anywhere.';
  }
  overlay.classList.add('show');
  _lockBodyScroll('saveStatusOverlay');
}
function closeSaveStatusInfo(){
  document.getElementById('saveStatusOverlay').classList.remove('show');
  _unlockBodyScroll('saveStatusOverlay');
}

// ヘッダ右の保存ステータスアイコン（旧 dirty-banner の代替）を状態に応じて切り替える。
// state: 'ok' | 'error' | 'disabled'
function _setSaveStatus(state){
  const btn = document.getElementById('saveStatus');
  const icon = document.getElementById('saveStatusIcon');
  const label = document.getElementById('saveStatusLabel');
  if(!btn || !icon) return;
  btn.classList.remove('is-error', 'is-disabled');
  if(state === 'error'){
    btn.classList.add('is-error');
    icon.textContent = '!';
    if(label) label.textContent = 'Auto-save failed';
    btn.title = 'Failed to auto-save · click to back up as CSV right now';
  } else if(state === 'disabled'){
    btn.classList.add('is-disabled');
    icon.textContent = '○';
    if(label) label.textContent = 'Auto-save off';
    btn.title = "Auto-save isn't available here (try GitHub Pages or a local HTTP server) · click to back up as CSV";
  } else {
    icon.textContent = '✓';
    if(label) label.textContent = 'Auto-saved';
    btn.title = 'Auto-saved on this device · click to back up as CSV';
  }
}

// =============================== RESTORE MODAL ===============================
// 新セッション（タブ閉じ後の再アクセス）で localStorage にデータがある時のみ表示。
// リフレッシュ時は表示せず黙って自動復元する（_bootstrap で分岐）。
function showRestoreModal(summary){
  const overlay = document.getElementById('restoreOverlay');
  if(!overlay) return;
  document.getElementById('restoreCount').textContent = summary.count;
  // 保存時刻：今日なら "today at HH:mm"、昨日なら "yesterday at HH:mm"、それ以外は "YYYY-MM-DD at HH:mm"
  const savedAtWrap = document.getElementById('restoreSavedAtWrap');
  if(summary.savedAt instanceof Date && !isNaN(summary.savedAt)){
    document.getElementById('restoreSavedAt').textContent = _formatSavedAt(summary.savedAt);
    savedAtWrap.style.display = '';
  } else {
    savedAtWrap.style.display = 'none';
  }
  overlay.classList.add('show');
  _lockBodyScroll('restoreOverlay');
}

// 保存時刻を人間に優しい形式に整形：
//   今日:   "today at 14:32"
//   昨日:   "yesterday at 14:32"
//   それ以外: "2026-05-21 at 14:32"
function _formatSavedAt(d){
  const pad = n => String(n).padStart(2, '0');
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const now = new Date();
  const startOfDay = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const dayDiff = Math.round((startOfDay(now) - startOfDay(d)) / 86400000);
  if(dayDiff === 0) return `today at ${time}`;
  if(dayDiff === 1) return `yesterday at ${time}`;
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} at ${time}`;
}
function _hideRestoreModal(){
  document.getElementById('restoreOverlay').classList.remove('show');
  _unlockBodyScroll('restoreOverlay');
}

// [Restore] ボタン：localStorage から復元してダッシュボードを描画。
// もし以前 [Start fresh] でセッション内 opt-out フラグが立っていたら、復元する以上意図が
// 変わったので消す（リフレッシュしてもまた復元されるように）。
// localStorage から復元したカスタム空港を、実行中の AP テーブルへ反映する。
// AP は airports.js の静的 const（＝リロードのたびに組み込み分だけで作り直される）ので、
// これを呼ばないと過去に手動追加／Import したカスタム空港が地図・カウントから消える。
// 組み込み空港は上書きしない（!AP[icao] のときだけ足す）。
function _hydrateCustomAirports(){
  const custom = (typeof DataSource !== 'undefined') ? DataSource.customAirports : null;
  if(!custom) return;
  Object.entries(custom).forEach(([icao, data]) => {
    if(icao && data && !AP[icao]) AP[icao] = data;
  });
}

async function restoreFromStorage(){
  _hideRestoreModal();
  try { sessionStorage.removeItem(_SESSION_OPT_OUT_RESTORE); } catch(e) { /* ignore */ }
  const ok = await DataSource.load();
  if(ok){
    // load() 内では参照を維持しているので不要だが、防御的に再代入しておく
    flights = DataSource.flights;
    _hydrateCustomAirports(); // カスタム空港を AP に戻す（地図・カウントに反映）
    rebuildFilters();
    refreshAll();
    showToast(`✓ Restored ${DataSource.count} flights`);
  } else {
    showToast('No data to restore', 'red');
  }
}

// [Start fresh] ボタン：localStorage は消さず、モーダルだけ閉じる。さらに
// sessionStorage に「このセッション中は復元しない」フラグを立てる。
//   - 同じタブでリフレッシュ → フラグが残ってる → 空状態のまま（黙って自動復元しない）
//   - タブを閉じて再オープン → セッション変わってフラグ消える → また Restore モーダルが出る
// localStorage 本体は触らないので、データは「気が変わったら復元できる」状態で残る。
// 完全削除したいときは従来通りヘッダの 🗑 Clear を使う。
function startFreshKeepStorage(){
  _hideRestoreModal();
  try { sessionStorage.setItem(_SESSION_OPT_OUT_RESTORE, '1'); } catch(e) { /* ignore */ }
  // _bootstrap がモーダル表示時に refreshAll をスキップしているので、ここで明示的に呼ぶ。
  // データはメモリ上ゼロのままなので空状態カードが描画される。
  refreshAll();
  // 「データ消えた？」の誤解を避けるため、消えてないこと＆復元方法を一言案内。
  // 5 秒出すのは情報量に対して既定の 2.5 秒だと読み切れないため。
  showToast('Your data is still saved · close & reopen this tab to restore', undefined, 5000);
}

// ESC でアクティブなオーバーレイを閉じる。優先順は「ネストが深い／重要なもの」から。
// 確認ダイアログ → 拡大表示 → 入力モーダル群 の順。
document.addEventListener('keydown', e=>{
  if(e.key !== 'Escape') return;
  // 開いているフィルタメニューがあれば、まずそれを閉じる（モーダルより優先度低）
  if(document.querySelector('.chip-menu.open')){ _closeAllFilterMenus(); return; }
  // ヘッダの ≡/⚙️ メニューが開いていれば閉じる（同じく軽量・最優先で潰す）
  if(document.querySelector('.header-menu-wrap.open')){ closeHeaderMenus(); return; }
  const isOpen = id => document.getElementById(id).classList.contains('show');
  if(isOpen('confirmOverlay')){ closeConfirm(); return; }
  if(isOpen('saveStatusOverlay')){ closeSaveStatusInfo(); return; }
  if(isOpen('savePresetOverlay')){ closeSavePreset(); return; }   // 高度パネルの上に開くので先に閉じる
  if(isOpen('advFilterOverlay')){ closeAdvancedFilters(); return; }
  // Add Airport は Data check の上に開くので先に閉じる
  if(isOpen('addAirportOverlay')){ closeAddAirport(); return; }
  if(isOpen('dataCheckOverlay')){ closeDataCheck(); return; }
  if(isOpen('expandedOverlay')){ closeExpanded(); return; }
  if(isOpen('exportOverlay')){ closeExport(); return; }
  if(isOpen('globeOverlay')){ closeGlobe(); return; }
  if(isOpen('mapOverlay')){ closeMapExpanded(); return; }
  if(isOpen('continentsOverlay')){ closeContinentsExpanded(); return; }
  if(isOpen('yearOverlay')){ closeYearExpanded(); return; }
  if(isOpen('monthOverlay')){ closeMonthExpanded(); return; }
  if(isOpen('weekdayOverlay')){ closeWeekdayExpanded(); return; }
  if(isOpen('flightsOverlay')){ closeFlightsExpanded(); return; }
  // Flight Log フルスクリーンを閉じる（show クラスではなく .card-fullscreen で判定）
  if(document.querySelector('.card.table-section.card-fullscreen')){ toggleFlightLogFullscreen(); return; }
  if(isOpen('bulkOverlay')){ closeBulk(); return; }
  if(isOpen('modalOverlay')){ closeModal(); return; }
});

// Add Flight モーダルの入力欄で Enter を押したら送信。textarea ではないので
// 改行は不要。Shift+Enter はそのまま。
['fDate','fDep','fArr','fAircraft','fAirline','fTimeH','fTimeM'].forEach(id=>{
  const el = document.getElementById(id);
  if(!el) return;
  el.addEventListener('keydown', e=>{
    if(e.key === 'Enter' && !e.shiftKey && !e.isComposing){
      e.preventDefault();
      addFlight();
    }
  });
});

// Add Airport モーダルも Enter で送信（Add New Flight と同じ作法）
['aaIcao','aaLat','aaLng','aaCity','aaCountry'].forEach(id=>{
  const el = document.getElementById(id);
  if(!el) return;
  el.addEventListener('keydown', e=>{
    if(e.key === 'Enter' && !e.shiftKey && !e.isComposing){
      e.preventDefault();
      submitAddAirport();
    }
  });
});

// Bulk Import の送信ショートカット：
//  - textarea 内で入力中: 改行を残すため、Cmd+Enter / Ctrl+Enter のみ送信
//  - textarea 外（モーダル背景や Cancel/Import ボタンも含まない、入力状態ではない時）:
//    そのまま Enter で送信
['bulkCSV','bulkAirportCSV'].forEach(id=>{
  const el = document.getElementById(id);
  if(!el) return;
  el.addEventListener('keydown', e=>{
    if(e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !e.isComposing){
      e.preventDefault();
      executeBulkImport();
    }
  });
});
document.addEventListener('keydown', e=>{
  if(e.key !== 'Enter' || e.shiftKey || e.isComposing) return;
  if(!document.getElementById('bulkOverlay').classList.contains('show')) return;
  // 入力中のフォーム要素にフォーカスがあるときは介入しない
  // （Enter の自然な挙動：textarea=改行、button=click、input=submit を尊重）
  const a = document.activeElement;
  if(a && (a.tagName==='TEXTAREA' || a.tagName==='INPUT' || a.tagName==='BUTTON' || a.tagName==='SELECT')) return;
  e.preventDefault();
  executeBulkImport();
});

// =============================== BOOTSTRAP ===============================
// sessionStorage の存在で「同セッション内のリフレッシュ」か「新セッション」かを判定。
//   - 新セッション + データあり → Restore モーダル表示
//   - リフレッシュ + データあり → 黙って自動復元
//   - データなし → 何もしない（空状態 UI が出る）
async function _bootstrap(){
  _readFiltersFromURL();
  // フィルタ UI を先に組み立てる（データ復元前でも空メニューを描画しておく）
  rebuildFilters();

  // 起動時にストレージが使えない（file:// 制限など）なら、ヘッダアイコンを最初から disabled に。
  // 起動直後に赤バナーで案内（データを追加する前に「保存できない環境」と知らせる）。
  if(!DataSource.isStorageAvailable()){
    _setSaveStatus('disabled');
    showNotifyBanner('error',
      'Auto-save is not available on this device. Open via GitHub Pages or a local HTTP server, and back up via CSV Export.',
      { persistent: true });
  }

  // sessionStorage 自体が使えない環境では isNewSession が常に true になり、
  // データもないので Restore モーダルは出ない（実害なし）。
  let isNewSession = true;
  let isOptedOut = false;
  try {
    isNewSession = !sessionStorage.getItem(_SESSION_FLAG_KEY);
    sessionStorage.setItem(_SESSION_FLAG_KEY, '1');
    isOptedOut = !!sessionStorage.getItem(_SESSION_OPT_OUT_RESTORE);
  } catch(e) { /* ignore */ }

  if(DataSource.hasStoredData() && !isOptedOut){
    if(isNewSession){
      const summary = DataSource.storedDataSummary();
      if(summary){
        showRestoreModal(summary);
        // モーダル表示中はデータゼロの状態を裏で出さないよう refreshAll はスキップ。
        // ボタンクリック後に restoreFromStorage / startFreshKeepStorage がそれぞれ refreshAll を呼ぶ。
        return;
      }
    } else {
      // リフレッシュ：黙って復元してフィルタ UI も再構築
      await DataSource.load();
      flights = DataSource.flights; // 防御的に参照再取得
      _hydrateCustomAirports();     // カスタム空港を AP に戻す（地図・カウントに反映）
      rebuildFilters();
    }
  }
  // isOptedOut のときは復元もモーダルも出さず空状態のまま。次の新セッションで自動的に
  // フラグが消え、Restore モーダルがまた出るようになる。

  refreshAll();
}
_bootstrap();

// Leaflet tooltip style inject
const tooltipStyle=document.createElement('style');
tooltipStyle.textContent=`.map-tooltip{background:rgba(13,21,32,0.95)!important;border:1px solid #1a2744!important;color:#e8edf5!important;font-family:'Outfit',sans-serif!important;font-size:12px!important;padding:8px 12px!important;border-radius:8px!important;box-shadow:0 8px 32px rgba(0,0,0,0.4)!important;}.map-tooltip::before{border-top-color:rgba(13,21,32,0.95)!important;}.leaflet-tooltip-top::before{border-top-color:rgba(13,21,32,0.95)!important;}`;
document.head.appendChild(tooltipStyle);
