// =============================== RENDER (CORE) ===============================
// 描画の共通基盤と、各カードに分割していない汎用 UI（Stats / Bars / Top Flights /
// Expanded View / Toast / Empty&Dirty / Compare / Autocomplete / Bulk Preview）。
// 個別カードの描画は別ファイルへ：
//   render-charts.js : Continent / Year / Month / Weekday の Chart.js 描画
//   render-map.js    : Leaflet 2D + Globe.gl 3D
//   render-table.js  : Flight Log テーブル（描画・ソート・選択・拡大）
// 依存: AP (airports.js), DataSource, flights (datasource.js),
//       computeAll, getFiltered, parseMin (compute.js),
//       parseBulkFlights, parseBulkAirports (parse.js)

const BAR_GRADIENTS = {
  aircraft:   ['#ff4d6a','#e6003a'],
  airlines:   ['#ffb020','#e09000'],
  routes:     ['#3b9eff','#0070e0'],
  airports:   ['#00d68f','#00a86b'],
  countries:  ['#9d7aff','#7b4dff'],
  cities:     ['#ff8a3d','#e06a1a'],
};

// =============================== THEME (CSS VARIABLE BRIDGE) ===============================
// JS 側で色を使う箇所（Chart.js / Leaflet / Globe.gl）は、ハードコードではなく
// CSS 変数を参照する。テーマ切替（[data-theme="light"] の付け外し）に追従させるため、
// 描画のたびに getComputedStyle で最新値を読む。
//   例: cssVar('--accent') → '#3b9eff'（ダーク）/ '#2680e0'（ライト）
function cssVar(name){
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

// =============================== HTML ESCAPE ===============================
// innerHTML にユーザー入力（CSV データ・Add Flight モーダルの入力）を埋め込む際に挟む。
// CLAUDE.md「innerHTML への文字列代入はユーザー入力由来なら必ずエスケープ」規約。
//   _escapeHtml: 要素テキスト用（&,<,>,",' を実体参照化）
//   _escapeAttr: 属性値用（" を実体参照化。属性値内では <,> は無害なため最小限）
function _escapeHtml(s){
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function _escapeAttr(s){ return String(s).replace(/"/g,'&quot;'); }

// =============================== BODY SCROLL LOCK ===============================
// 開いているオーバーレイの ID を Set で管理し、最後の 1 つが閉じたタイミングだけ
// body.style.overflow を解除する。複数オーバーレイ同時表示や新規追加時に、
// 片方を閉じた瞬間にもう片方のスクロールロックが外れる事故を防ぐ。
//
// 使い方：各 open*() で `_lockBodyScroll('overlayId')`、各 close*() で `_unlockBodyScroll('overlayId')`。
// 必ず ID を渡すこと（key を統一しないと多重 add で Set のサイズが合わなくなる）。
//
// ※ Flight Log フルスクリーン（`body.has-fullscreen-card{overflow:hidden;}`）は CSS クラス
//    側でロックしているので、この Set は介さず独立に動作する（互いに干渉しない）。
const _scrollLockSet = new Set();
function _lockBodyScroll(id){
  _scrollLockSet.add(id);
  document.body.style.overflow = 'hidden';
}
function _unlockBodyScroll(id){
  _scrollLockSet.delete(id);
  if(_scrollLockSet.size === 0) document.body.style.overflow = '';
}

// =============================== STATS ROW ===============================
// 全 6 カードが対応する拡大ウィンドウを開くクリックハンドラ付き。
// 起動先はサマリーから直感的にたどれる対応関係：
//   Flights → FlightLog 拡大
//   Flight Time → Top Flights by Time 拡大
//   Aircraft              → Aircraft バー拡大（時間ソートも可）
//   Routes / Airports     → 対応バーカード拡大
//   Countries/Regions     → Countries バー拡大（Continents 拡大ではない方を採用）
function renderStats(data){
  let totalMin=0;
  data.forEach(f=>totalMin+=parseMin(f.t));
  const h=Math.floor(totalMin/60),m=totalMin%60;
  const airports=new Set(); data.forEach(f=>{airports.add(f.dep.trim());airports.add(f.arr.trim());});
  const countries=new Set(); airports.forEach(c=>{const m=AP[c];if(m)countries.add(m.co);});
  const s=computeAll(data);
  // clickable な stat-box は `.is-clickable` クラス + onclick で対応拡大を起動。
  document.getElementById('statsGrid').innerHTML=
    `<div class="stat-box is-clickable" onclick="toggleFlightLogFullscreen()"><div class="num">${data.length}</div><div class="lbl">Flights</div></div>`+
    `<div class="stat-box is-clickable" onclick="openStatExpand('aircraft')"><div class="num">${Object.keys(Object.fromEntries(s.ac)).length}</div><div class="lbl">Aircraft</div></div>`+
    `<div class="stat-box is-clickable" onclick="openStatExpand('routes')"><div class="num">${s.rt.length}</div><div class="lbl">Routes</div></div>`+
    `<div class="stat-box is-clickable" onclick="openStatExpand('airports')"><div class="num">${airports.size}</div><div class="lbl">Airports</div></div>`+
    `<div class="stat-box is-clickable" onclick="openStatExpand('countries')"><div class="num">${countries.size}</div><div class="lbl">Countries/Regions</div></div>`+
    `<div class="stat-box is-clickable" onclick="openStatExpand('flights')"><div class="num">${h}h${m?m+'m':''}</div><div class="lbl">Flight Time</div></div>`;
}

// サマリーカードのクリック → 対応する拡大ウィンドウを起動。
function openStatExpand(kind){
  if(kind === 'flights'){
    openFlightsExpanded();
    return;
  }
  const s = computeAll(getFiltered());
  const map = { aircraft:['ac', s.acMin], routes:['rt', null], airports:['ap', null], countries:['co', null] };
  const entry = map[kind];
  if(!entry) return;
  const data = s[entry[0]];
  // 該当データが空（フィルタで 0 件など）なら空ウィンドウは出さず、トーストで知らせる
  if(!data || data.length === 0){
    showToast('No data to show','red');
    return;
  }
  openExpanded(kind, data, entry[1]);
}

// =============================== BAR RENDERING ===============================
// 総飛行時間（分）→「XhYYm」形式（h と m の間にスペースなし）。分はゼロ埋め 2 桁。
//   例: 9930 → "165h30m"、9900 → "165h00m"
function _fmtHM(mins){
  const h=Math.floor(mins/60), m=mins%60;
  return h + 'h' + (m<10?'0':'') + m + 'm';
}

// minsMap が渡されたカードでは、バー右側の専用カラム（.bar-time）に総飛行時間を
// 表示する。バー内は回数のみで視認性が高い。
function renderBars(id, data, colorKey, minsMap){
  const max=data[0]?data[0][1]:1;
  const total=data.reduce((s,d)=>s+d[1],0);
  const [c1,c2]=BAR_GRADIENTS[colorKey];
  document.getElementById(id).innerHTML=data.map(([label,count])=>{
    const pct=((count/max)*100).toFixed(0);
    const share=((count/total)*100).toFixed(0);
    const timeCol = minsMap
      ? `<span class="bar-time">${_fmtHM(minsMap[label]||0)}</span>`
      : '';
    return `<div class="bar-row">
      <span class="bar-label">${_escapeHtml(label)}</span>
      <div class="bar-track"><div class="bar-fill" style="width:${pct}%;background:linear-gradient(90deg,${c1},${c2});">${count}</div></div>
      ${timeCol}
      <span class="bar-pct">${share}%</span>
    </div>`;
  }).join('');
}

// type → 総時間マップ（あれば）を返す。機材／航空会社のみ対応。
function _minsMapForType(s, type){
  if(type==='aircraft') return s.acMin;
  if(type==='airlines') return s.alMin;
  return null;
}

// =============================== TOP FLIGHTS BY TIME ===============================
// 個別フライト（集計ではなく 1 行 1 フライト）を飛行時間で並べたランキング。
// モードはトグルで切り替え、refreshAll でも保持される（モジュール変数）。
let _topFlightsMode = 'longest'; // 'longest' | 'shortest'

function renderTopFlightsBars(){
  const container=document.getElementById('topFlightsBars');
  if(!container) return;
  const mode=_topFlightsMode;
  const data=getFiltered();
  if(data.length===0){
    container.innerHTML='<div style="padding:20px 4px;color:var(--text-3);font-size:12px;text-align:center;">No flights to rank</div>';
  } else {
    // 飛行時間で並べ替えて先頭 5 件
    const sorted=data.slice().sort((a,b)=>{
      const diff=parseMin(b.t)-parseMin(a.t);
      return mode==='shortest' ? -diff : diff;
    }).slice(0,5);
    // バー幅は「いま表示中の 5 件の最長」を 100% にしたプロポーション。
    // 結果として Shortest モードでも視覚的にスケールが効く。
    const maxMin=parseMin(sorted[0].t)||1;
    const [c1,c2]=['#00d4ff','#0095c8']; // 時間テーマのシアン
    container.innerHTML=sorted.map(f=>{
      const mins=parseMin(f.t);
      const widthPct=Math.max(2,(mins/maxMin)*100).toFixed(0);
      // hover で日付・エアライン詳細を見せる（クリック領域内）
      const safeTitle=_escapeAttr(`${f.date}  ·  ${f.al||''}`);
      return `<div class="bar-row" title="${safeTitle}">
        <span class="bar-label">${_escapeHtml(f.dep)}→${_escapeHtml(f.arr)}</span>
        <div class="bar-track"><div class="bar-fill" style="width:${widthPct}%;background:linear-gradient(90deg,${c1},${c2});">${_escapeHtml(f.t)}</div></div>
        <span class="bar-pct" style="width:54px;min-width:54px;text-align:right;">${_escapeHtml(f.ac)}</span>
      </div>`;
    }).join('');
  }
  // 拡大ウィンドウが開いていれば、同じ getFiltered() データで再描画（フィルタ追従）
  if(document.getElementById('flightsOverlay')?.classList.contains('show')){
    _renderFlightsExpanded();
  }
}

function setTopFlightsView(mode, btn){
  _topFlightsMode=mode;
  btn.parentElement.querySelectorAll('.toggle-btn').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  renderTopFlightsBars();
}

// --- Top Flights 拡大ウィンドウ ---
// インラインの Longest/Shortest トグルとは独立した、専用のソート状態を持つ。
// フィルタは getFiltered() を経由するので、グローバルフィルタチップに自動追従。
let _flightsExpandedSort='time-desc'; // 'time-desc' | 'time-asc' | 'date-desc' | 'date-asc'

function openFlightsExpanded(){
  if(DataSource.count===0){ showToast('No flights to show','red'); return; }
  document.getElementById('flightsOverlay').classList.add('show');
  _lockBodyScroll('flightsOverlay');
  // 開くたびにデフォルト Time desc に戻す（前回のソート状態を引きずらない）
  const sel=document.getElementById('flightsSort');
  if(sel){ sel.value='time-desc'; }
  _flightsExpandedSort='time-desc';
  _renderFlightsExpanded();
}

function closeFlightsExpanded(){
  document.getElementById('flightsOverlay').classList.remove('show');
  _unlockBodyScroll('flightsOverlay');
}

function onFlightsSortChange(){
  const sel=document.getElementById('flightsSort');
  if(sel) _flightsExpandedSort=sel.value;
  _renderFlightsExpanded();
}

function _renderFlightsExpanded(){
  const data=getFiltered();
  const totalEl=document.getElementById('flightsExpandedTotal');
  const scrollEl=document.getElementById('flightsExpandedScroll');
  if(!scrollEl) return;
  if(totalEl) totalEl.textContent=data.length;
  if(data.length===0){
    scrollEl.innerHTML='<div style="padding:40px;text-align:center;color:var(--text-3);">No flights match current filters</div>';
    return;
  }
  const sorted=data.slice().sort((a,b)=>{
    switch(_flightsExpandedSort){
      case 'time-asc':  return parseMin(a.t)-parseMin(b.t);
      case 'date-desc': return String(b.date).localeCompare(String(a.date));
      case 'date-asc':  return String(a.date).localeCompare(String(b.date));
      case 'time-desc':
      default:          return parseMin(b.t)-parseMin(a.t);
    }
  });
  // バー幅の基準：時間ソート時は全件の最長、日付ソート時もデータの最長で揃える
  const maxMin=Math.max(...sorted.map(f=>parseMin(f.t)))||1;
  const [c1,c2]=['#00d4ff','#0095c8'];
  scrollEl.innerHTML=sorted.map((f,i)=>{
    const mins=parseMin(f.t);
    const widthPct=Math.max(2,(mins/maxMin)*100).toFixed(0);
    const safeAl=_escapeAttr(f.al||'');
    return `<div class="flight-row" title="${safeAl}">
      <span class="flight-row-rank">#${i+1}</span>
      <span class="flight-row-date">${_escapeHtml(f.date)}</span>
      <span class="flight-row-route">${_escapeHtml(f.dep)} → ${_escapeHtml(f.arr)}</span>
      <span class="flight-row-ac">${_escapeHtml(f.ac)}</span>
      <span class="flight-row-airline">${_escapeHtml(f.al||'')}</span>
      <div class="flight-row-track"><div class="flight-row-fill" style="width:${widthPct}%;background:linear-gradient(90deg,${c1},${c2});">${_escapeHtml(f.t)}</div></div>
    </div>`;
  }).join('');
}

function setView(type, mode, btn){
  btn.parentElement.querySelectorAll('.toggle-btn').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  const s=computeAll(getFiltered());
  const map={aircraft:'ac',airlines:'al',routes:'rt',airports:'ap',countries:'co',cities:'ci'};
  const data=s[map[type]];
  const minsMap=_minsMapForType(s, type);
  if(mode==='top5'){
    renderBars(type+'Bars',data.slice(0,5),type, minsMap);
  } else {
    openExpanded(type, data, minsMap);
    // Reset to top5
    btn.parentElement.querySelector('.toggle-btn').classList.add('active');
    btn.classList.remove('active');
  }
}

// =============================== EXPANDED VIEW ===============================
// 拡大ウィンドウは開いている間、type / data / minsMap を保持しておき、
// ヘッダのソートセレクタが変わったら同じデータで再描画する。
let _expandedState = null; // { type, data, minsMap }

// 与えられたソートキーで [[label,count],...] を並べ替え。
// time-* は minsMap が無いと count にフォールバック。
function _sortExpanded(data, minsMap, sortKey){
  const arr = data.slice();
  const minsOf = label => (minsMap && minsMap[label]) || 0;
  switch(sortKey){
    case 'count-asc':  arr.sort((a,b)=> a[1] - b[1]); break;
    case 'time-desc':  arr.sort((a,b)=> minsOf(b[0]) - minsOf(a[0])); break;
    case 'time-asc':   arr.sort((a,b)=> minsOf(a[0]) - minsOf(b[0])); break;
    case 'name-asc':   arr.sort((a,b)=> String(a[0]).localeCompare(String(b[0]))); break;
    case 'name-desc':  arr.sort((a,b)=> String(b[0]).localeCompare(String(a[0]))); break;
    case 'count-desc':
    default:           arr.sort((a,b)=> b[1] - a[1]); break;
  }
  return arr;
}

// time-* ソート時はバーの高さも時間ベース、それ以外は回数ベース。
// 値ラベル（上）は常に回数のみ、時間はバー内部の上端に控えめに表示。
// 拡大バーのうち、クリックでドリルダウンできる type → 「drill kind」の対応（フェーズY-2 増分2 で routes/airports/cities を追加）。
//   aircraft / airlines / countries / airports … 値がそのまま FilterState の単一軸（_drilldownFilter で処理）。
//   routes … "DEP → ARR" を depAirports + arrAirports の重ね掛けに分解（_drilldownRoute）。
//   cities … 都市ラベル（AP.city）をそのまま cities（either）軸へ（汎用 _drilldownFilter で処理）。
const _BAR_DRILL = {
  aircraft:'aircraft', airlines:'airlines', countries:'countries',
  airports:'airports', cities:'cities', routes:'route',
};

function _renderExpandedBars(){
  if(!_expandedState) return;
  const { type, data, minsMap } = _expandedState;
  const drillKey = _BAR_DRILL[type];
  const sortSel = document.getElementById('expandedSort');
  const sortKey = (sortSel && sortSel.value) || 'count-desc';
  const useTime = sortKey.startsWith('time') && minsMap;
  const sorted = _sortExpanded(data, minsMap, sortKey);
  const valueFor = useTime
    ? ([label]) => (minsMap[label]||0)
    : ([,count]) => count;
  const [c1,c2]=BAR_GRADIENTS[type];
  const max=sorted.length ? Math.max(...sorted.map(valueFor)) || 1 : 1;
  const total=sorted.reduce((s,it)=>s+valueFor(it),0) || 1;
  const maxH=220;
  document.getElementById('expandedScroll').innerHTML=sorted.map(item=>{
    const [label,count]=item;
    const v=valueFor(item);
    const h=Math.max(24,(v/max)*maxH);
    const share=((v/total)*100).toFixed(0);
    // 表示位置の方針：
    //   minsMap あり（aircraft / airlines）: 回数を上、時間をバー内
    //   minsMap なし（continents / routes / 等）: 回数をバー内に大きく、上はカラ
    const valHtml = minsMap ? `${count}` : '';
    const timeInBar = minsMap
      ? `<span class="expanded-bar-time-in">${_fmtHM(minsMap[label]||0)}</span>`
      : '';
    const countInBar = minsMap
      ? ''
      : `<span class="expanded-bar-count-in">${count}</span>`;
    // title 属性でフルネームを hover 表示（長い名前は省略されるため）
    const safeLabel = _escapeAttr(label);
    const labelHtml = _escapeHtml(label);
    // ドリルダウン対象（aircraft/airlines/countries）はクリックでフィルタ反映。
    const drillClass = drillKey ? ' is-drillable' : '';
    const drillAttrs = drillKey ? ` data-drill="${drillKey}" data-drill-val="${safeLabel}"` : '';
    // expanded-bar-stack（固定高さ）の中で「値は上端」「バーは下端」に貼り付け、
    // バーの高さは可変 → 値ラベルの y 座標がバー高さに依存しない（上端で揃う）。
    return `<div class="expanded-bar-item${drillClass}" title="${safeLabel}"${drillAttrs}>
      <div class="expanded-bar-stack">
        <div class="expanded-bar-val">${valHtml}</div>
        <div class="expanded-bar-col" style="height:${h}px;background:linear-gradient(180deg,${c1},${c2});">${countInBar}${timeInBar}</div>
      </div>
      <div class="expanded-bar-name">${labelHtml}</div>
      <div class="expanded-bar-pct">${share}%</div>
    </div>`;
  }).join('');
}

// ソートセレクタの「Time」関連オプションは、minsMap が無いカードでは非表示にする。
function _configureExpandedSort(minsMap){
  const sel = document.getElementById('expandedSort');
  if(!sel) return;
  sel.querySelectorAll('option[data-time-only]').forEach(o => {
    o.hidden = !minsMap;
    o.disabled = !minsMap;
  });
  // 拡大表示を開いたら常に既定（Count ▾）に戻す。前回のソート状態を引きずらない。
  sel.value = 'count-desc';
}

function openExpanded(type, data, minsMap){
  const titles={aircraft:'Top Aircraft',airlines:'Top Airlines',routes:'Top Routes',airports:'Top Airports',countries:'Top Countries/Regions',cities:'Top Cities'};
  const subtitles={aircraft:'total aircraft types',airlines:'total airlines',routes:'total routes',airports:'total airports',countries:'total countries/regions',cities:'total cities'};
  const [c1,_c2]=BAR_GRADIENTS[type];
  document.getElementById('expandedTitle').textContent=titles[type];
  document.getElementById('expandedTotal').textContent=data.length;
  document.getElementById('expandedTotal').style.color=c1;
  document.getElementById('expandedSub').textContent=subtitles[type];
  _expandedState = { type, data, minsMap };
  _configureExpandedSort(minsMap);
  _renderExpandedBars();
  document.getElementById('expandedOverlay').classList.add('show');
  _lockBodyScroll('expandedOverlay');
}

function onExpandedSortChange(){ _renderExpandedBars(); }

function closeExpanded(){
  document.getElementById('expandedOverlay').classList.remove('show');
  _unlockBodyScroll('expandedOverlay');
  _expandedState = null;
}

// 拡大バー（Aircraft / Airlines / Countries）クリックでグローバルフィルターにドリルダウン
// （N-B＝チャートと同じ体験）。イベント委譲で 1 か所だけ聴く。値は data 属性から取得して
// ラベルのクォート/特殊文字を安全に扱う。クリックしたら拡大を閉じてからフィルタ適用。
document.addEventListener('click', e => {
  const item = e.target.closest('.expanded-bar-item.is-drillable');
  if(!item) return;
  const kind = item.dataset.drill, val = item.dataset.drillVal;
  if(!kind) return;
  closeExpanded();
  // routes だけ複数軸（dep+arr の重ね掛け）なので専用ハンドラへ。それ以外は単一軸の汎用ドリルダウン。
  if(kind==='route'){ if(typeof _drilldownRoute==='function') _drilldownRoute(val); }
  else if(typeof _drilldownFilter==='function'){ _drilldownFilter(kind, val); }
});

// =============================== TOAST ===============================
// duration は省略可（既定 2500ms）。情報量が多くて読ませたいときは 5000ms など長めに。
// トーストはキュー方式：表示中に次の通知が来たら、現在のが消えてから順に出す。
// 例）フライト追加時の「✓ Flight added」→ 消えてから「✓ Auto-saved …」を続けて見せる。
// （トースト部品は1個だけなので、従来は同時発火すると上書きされていた）
let _toastTimer = null;
let _toastQueue = [];
function showToast(msg, variant, duration){
  _toastQueue.push({ msg, variant, duration: duration || 2500 });
  if(!_toastTimer) _drainToastQueue();
}
function _drainToastQueue(){
  const toast = document.getElementById('toast');
  if(!toast){ _toastQueue = []; _toastTimer = null; return; }
  const next = _toastQueue.shift();
  if(!next){ _toastTimer = null; return; }
  toast.textContent = next.msg;
  toast.className = 'toast' + (next.variant === 'red' ? ' toast-red' : '');
  // 連続表示でもスライドインが効くよう次フレームで show を付ける
  requestAnimationFrame(() => toast.classList.add('show'));
  _toastTimer = setTimeout(() => {
    toast.classList.remove('show');
    // フェードアウト（CSS 0.4s）を待ってから次の通知へ
    _toastTimer = setTimeout(_drainToastQueue, 450);
  }, next.duration);
}

// =============================== EMPTY STATE / DIRTY BANNER ===============================
function refreshEmptyState(){
  const isEmpty = DataSource.count===0;
  document.body.classList.toggle('is-empty', isEmpty);
}
// 旧 dirty-banner（未保存警告）の置き換え：常設バナーは廃止し、ヘッダの
// 保存ステータスアイコンに集約した。アイコンの「データありで表示／空状態で非表示」は
// CSS の `body.is-empty #saveStatus{display:none;}` で自動制御されるため、ここでは
// 何もしない（関数名は既存呼び出しを壊さないため維持）。
function refreshDirtyBanner(){
  // no-op：表示制御は CSS 側に移行済み
}

// =============================== COMPARE SECTION ===============================
// 任意の2年を比較（フェーズ3で renderYoY を一般化）。
// アンカーカード内のセレクタで yearA / yearB を選ぶ → CompareState を介して再描画。
// データレイヤー：compareStats(setA, setB) （compute.js）。
function _fmtMin(mins){const h=Math.floor(mins/60),m=mins%60;return h+'h'+(m?String(m).padStart(2,'0')+'m':'');}

// 集合A の値 vs 集合B の値 を 1 枚のカードで表現。
// formatter は表示用整形関数（数値そのまま、時間整形、など）。
function _compareCard(label, valA, valB, formatter, prevLabel){
  const pct = (now, then) => then===0 ? (now>0 ? Infinity : 0) : Math.round(((now-then)/then)*100);
  const delta = pct(valA, valB);
  const cls   = delta>0?'up':delta<0?'down':'flat';
  const arrow = delta>0?'▲':delta<0?'▼':'─';
  const sign  = delta>0?'+':'';
  const deltaTxt = delta===Infinity ? 'NEW' : sign+delta+'%';
  return `<div class="yoy-card">
    <div class="yoy-label">${label}</div>
    <div class="yoy-value">${formatter(valA)}</div>
    <span class="yoy-delta ${cls}">${arrow} ${deltaTxt}</span>
    <div class="yoy-prev">${_escapeHtml(prevLabel)}: ${formatter(valB)}</div>
  </div>`;
}

// 集合 A / B のラベル文字列を作る。月が空なら年だけ、月指定があれば "YYYY-MM" 形式。
// _compareCard の prevLabel と yoyMetrics 直前のセレクタ表示の両方で利用。
function _compareLabel(year, month){
  return month ? (year + '-' + month) : year;
}

// アンカーカードの年・月セレクタを再構築。
// 月オプションは常に "All" + '01'〜'12' を出す（データが無い月でも選択可能。
// 「2026-01 は 0 件」のような比較も意味があるため、データの有無で隠さない方針）。
function _renderCompareSelectors(years){
  const yearOpts = years.slice().reverse(); // newest first
  const buildYearOpts = (selected, otherSelected) => yearOpts.map(y => {
    // 反対側に既に選ばれている年は薄く表示（選択不可ではなく示唆だけ）
    const isDim = (y===otherSelected) ? ' style="color:var(--text-3);"' : '';
    return `<option value="${y}"${isDim}${y===selected?' selected':''}>${y}</option>`;
  }).join('');
  // 月オプション：先頭に "All"（value=''）、続けて '01'〜'12' を常に表示
  const buildMonthOpts = (selectedMonth) => {
    let html = `<option value=""${selectedMonth===''?' selected':''}>All</option>`;
    for(let m=1; m<=12; m++){
      const mm = String(m).padStart(2,'0');
      html += `<option value="${mm}"${mm===selectedMonth?' selected':''}>${mm}</option>`;
    }
    return html;
  };
  const selAy = document.getElementById('compareYearA');
  const selBy = document.getElementById('compareYearB');
  const selAm = document.getElementById('compareMonthA');
  const selBm = document.getElementById('compareMonthB');
  if(selAy) selAy.innerHTML = buildYearOpts(CompareState.yearA, CompareState.yearB);
  if(selBy) selBy.innerHTML = buildYearOpts(CompareState.yearB, CompareState.yearA);
  if(selAm) selAm.innerHTML = buildMonthOpts(CompareState.monthA);
  if(selBm) selBm.innerHTML = buildMonthOpts(CompareState.monthB);
}

function renderCompare(){
  const section=document.getElementById('yoySection');
  // 全フライトから年一覧（フィルタ非依存：比較は両集合データを必要とする）
  const years=[...new Set(flights.map(f=>f.date.slice(0,4)))].sort();
  if(years.length<2){ section.style.display='none'; return; }
  // CompareState の初期化／妥当性チェック
  // - 空 or データから消えた年が入っていれば既定値（最新／その前）へ
  // - yearA===yearB かつ monthA===monthB になっていれば yearB を別の年に
  //   （年は同じでも月が違えば「2026-05 vs 2026-04」のような有効な比較なので許容）
  if(!CompareState.yearA || !years.includes(CompareState.yearA)){
    CompareState.yearA = years[years.length-1];
  }
  if(!CompareState.yearB || !years.includes(CompareState.yearB) ||
     (CompareState.yearB===CompareState.yearA && CompareState.monthB===CompareState.monthA)){
    CompareState.yearB = years[years.length-2];
    if(CompareState.yearB===CompareState.yearA && CompareState.monthB===CompareState.monthA){
      // 念のため：yearA が最古でも yearB が同じにならないようにずらす
      CompareState.yearB = years.find(y => y!==CompareState.yearA) || years[0];
    }
  }
  _renderCompareSelectors(years);
  // 2 集合をフライトから抽出して比較。
  // 月が空なら年だけで絞る（'2025-' で始まる）、月指定があれば 'YYYY-MM-' で絞る。
  const yA=CompareState.yearA, mA=CompareState.monthA;
  const yB=CompareState.yearB, mB=CompareState.monthB;
  const prefixA = mA ? (yA+'-'+mA+'-') : (yA+'-');
  const prefixB = mB ? (yB+'-'+mB+'-') : (yB+'-');
  const setA = flights.filter(f => f.date.startsWith(prefixA));
  const setB = flights.filter(f => f.date.startsWith(prefixB));
  const { a, b } = compareStats(setA, setB);
  const labelB = _compareLabel(yB, mB);
  document.getElementById('yoyMetrics').innerHTML =
    _compareCard('Flights',          a.count,           b.count,           v=>v,     labelB) +
    _compareCard('Hours',            a.mins,            b.mins,            _fmtMin,  labelB) +
    _compareCard('Countries/Regions',a.countries.size,  b.countries.size,  v=>v,     labelB);
  section.style.display='';
}

// =============================== AUTOCOMPLETE ===============================
function getACData(type){
  if(type==='airport'){
    return Object.entries(AP).map(([code,data])=>({code,detail:data.city+', '+data.co}));
  }
  if(type==='aircraft'){
    const set=new Set(); flights.forEach(f=>set.add(f.ac));
    // 候補は data/aircraft.js の正準コード表から自動生成（単一ソース）。
    // 機材を足すときは data/aircraft.js を編集すれば、正規化と autocomplete の両方に反映される。
    if(typeof AIRCRAFT_CANONICAL_TABLE !== 'undefined'){
      Object.keys(AIRCRAFT_CANONICAL_TABLE).forEach(a=>set.add(a));
    }
    return [...set].sort().map(code=>({code,detail:''}));
  }
  if(type==='airline'){
    const set=new Set(); flights.forEach(f=>set.add(f.al));
    return [...set].sort().map(code=>({code,detail:''}));
  }
  if(type==='time-h' || type==='time-m'){
    // Flight Time（分離入力）：FR24 風の固定ドロップダウン。
    //   time-h: 0〜23（手入力で >23 は許容するが、ドロップダウンには載せない）
    //   time-m: 0, 5, 10, ..., 55（手入力で 5 刻み以外の値も許容するが、ドロップダウンには載せない）
    // 履歴に依存せず純粋な数値リストを常に提示する。バッジも付けない。
    const isH = type==='time-h';
    const values = [];
    if(isH){ for(let i=0;i<=23;i++) values.push(String(i)); }
    else   { for(let i=0;i<60;i+=5) values.push(String(i)); }
    return values.map(code => ({code, detail: ''}));
  }
  return [];
}

function acUpdate(inputId, type){
  const input=document.getElementById(inputId);
  const list=document.getElementById(inputId+'-ac');
  let items=null;
  // Flight Time の h/m は予測フィルタを行わず、常に固定の数値リスト全件を表示する。
  if(type==='time-h' || type==='time-m'){
    items = getACData(type);
  } else {
    const q=input.value.toUpperCase().trim();
    if(q.length===0){
      // Show recent/popular items
      items = getACData(type).slice(0,8);
    } else {
      const data=getACData(type);
      items = data.filter(d=>
        d.code.toUpperCase().includes(q) || d.detail.toUpperCase().includes(q)
      ).slice(0,10);
      if(items.length===0){
        list.classList.remove('show');
        return;
      }
    }
  }
  renderACList(list, items, inputId);
  _acShow(input, list);
}

// ac-list を表示し、入力欄まわりの空きスペースに応じて上開き／下開きを動的に切り替える。
// 同時表示は最大 _AC_MAX_VISIBLE 件まで、それ以上はリスト内の縦スクロールで見せる。
// モーダル本体（.modal-body）の可視範囲を基準に判定するので、Add Flight のように
// 縦に詰まったモーダルでも、ドロップダウンがはみ出してモーダル全体をスクロールさせない。
const _AC_MAX_VISIBLE = 5;
function _acShow(input, list){
  list.classList.add('show');
  // 一旦サイズ計測のためインライン max-height をクリア
  list.style.maxHeight = '';
  list.classList.remove('ac-up');
  // 項目1個の実測高さ × MAX_VISIBLE を希望サイズとする（フォント・パディング変更にも追従）
  const sample = list.querySelector('.ac-item');
  const itemH = sample ? sample.getBoundingClientRect().height : 35;
  const desired = Math.ceil(itemH * _AC_MAX_VISIBLE) + 2; // +2 はリスト枠線
  const margin = 8;    // 上下に確保したい余白
  const rect = input.getBoundingClientRect();
  const container = input.closest('.modal-body') || document.documentElement;
  const cRect = container.getBoundingClientRect ? container.getBoundingClientRect()
                                                : {top:0, bottom:window.innerHeight};
  const spaceBelow = cRect.bottom - rect.bottom - margin;
  const spaceAbove = rect.top - cRect.top - margin;
  // 下に desired 入る or 下のほうが広ければ下開き。さもなければ上開き。
  const openDown = spaceBelow >= desired || spaceBelow >= spaceAbove;
  // 最低でも 2 項目分は見せたい（spaceBelow/Above が極端に狭い場合の保険）
  const floor = Math.ceil(itemH * 2);
  if(openDown){
    list.classList.remove('ac-up');
    list.style.maxHeight = Math.max(floor, Math.min(desired, spaceBelow)) + 'px';
  } else {
    list.classList.add('ac-up');
    list.style.maxHeight = Math.max(floor, Math.min(desired, spaceAbove)) + 'px';
  }
}

function renderACList(list,items,inputId){
  list.innerHTML=items.map(d=>{
    const badge=d.detail?`<span class="ac-detail">${_escapeHtml(d.detail)}</span>`:'';
    // onmousedown 属性内の JS 文字列に code を埋め込むため、二段階エスケープ：
    //   ① JS 文字列内の `'` を `\'` に（acSelect の第2引数の '...' を壊さないため）
    //   ② HTML 属性内の `"` を `&quot;` に（onmousedown="..." を壊さないため）
    const jsCode = _escapeAttr(d.code.replace(/'/g,"\\'"));
    return `<div class="ac-item" onmousedown="acSelect('${inputId}','${jsCode}')">
      <span class="ac-code">${_escapeHtml(d.code)}</span>${badge}
    </div>`;
  }).join('');
}

function acSelect(inputId, value){
  document.getElementById(inputId).value=value;
  document.getElementById(inputId+'-ac').classList.remove('show');
}

function acHide(inputId){
  document.getElementById(inputId+'-ac').classList.remove('show');
}

// =============================== BULK IMPORT PREVIEW ===============================
function previewBulk(){
  const text=document.getElementById('bulkCSV').value;
  const preview=document.getElementById('bulkPreview');
  const count=document.getElementById('bulkCount');
  const clr=document.getElementById('bulkClearBtn');
  if(clr) clr.style.display = text.trim() ? '' : 'none';  // 入力があるときだけ Clear を出す
  if(!text.trim()){preview.style.display='none';count.style.display='none';return;}
  const parsed=parseBulkFlights(text);
  const validCount=parsed.filter(r=>r.valid).length;
  const invalidCount=parsed.filter(r=>!r.valid).length;
  const fixedCount=parsed.filter(r=>r.valid && r.fixes && r.fixes.length>0).length;
  count.innerHTML=`<span class="valid">✓ ${validCount} valid</span>`
    +(fixedCount?`<span style="color:var(--cyan);">🔧 ${fixedCount} auto-fixed</span>`:'')
    +(invalidCount?`<span class="invalid">✕ ${invalidCount} errors</span>`:'');
  count.style.display='flex';
  if(parsed.length===0){preview.style.display='none';return;}
  let html='<table><thead><tr><th>Date</th><th>Route</th><th>Aircraft</th><th>Airline</th><th>Time</th><th>Status</th></tr></thead><tbody>';
  parsed.forEach(r=>{
    if(r.valid){
      const hasFixes=r.fixes && r.fixes.length>0;
      const fixTip=hasFixes?` title="${_escapeAttr(r.fixes.join(', '))}"`:''
      const statusIcon=hasFixes?'🔧':'✓';
      const statusCol=hasFixes?'var(--cyan)':'var(--green)';
      html+=`<tr><td>${_escapeHtml(r.date)}</td><td style="color:var(--accent);font-weight:600;">${_escapeHtml(r.dep)} → ${_escapeHtml(r.arr)}</td><td>${_escapeHtml(r.ac)}</td><td>${_escapeHtml(r.al)}</td><td>${_escapeHtml(r.t)}</td><td style="color:${statusCol};cursor:${hasFixes?'help':'default'};"${fixTip}>${statusIcon}</td></tr>`;
    } else {
      html+=`<tr class="row-error"><td colspan="5">${_escapeHtml(r.raw.substring(0,80))}</td><td>${_escapeHtml(r.reason)}</td></tr>`;
    }
  });
  html+='</tbody></table>';
  preview.innerHTML=html;
  preview.style.display='';
}

function previewAirports(){
  const text=document.getElementById('bulkAirportCSV').value;
  const preview=document.getElementById('apBulkPreview');
  const count=document.getElementById('apBulkCount');
  const clr=document.getElementById('apBulkClearBtn');
  if(clr) clr.style.display = text.trim() ? '' : 'none';  // 入力があるときだけ Clear を出す
  if(!text.trim()){preview.style.display='none';count.style.display='none';return;}
  const parsed=parseBulkAirports(text);
  const validCount=parsed.filter(r=>r.valid).length;
  const invalidCount=parsed.filter(r=>!r.valid).length;
  const autoCount=parsed.filter(r=>r.valid && r.source==='auto').length;
  const existCount=parsed.filter(r=>r.valid && r.source==='existing').length;
  count.innerHTML=`<span class="valid">✓ ${validCount} valid</span>`
    +(autoCount?`<span style="color:var(--cyan);">⚡ ${autoCount} auto</span>`:'')
    +(existCount?`<span style="color:var(--amber);">● ${existCount} existing</span>`:'')
    +(invalidCount?`<span class="invalid">✕ ${invalidCount} errors</span>`:'');
  count.style.display='flex';
  if(parsed.length===0){preview.style.display='none';return;}
  let html='<table><thead><tr><th>ICAO</th><th>City</th><th>Country</th><th>Continent</th><th>Coords</th><th>Source</th></tr></thead><tbody>';
  parsed.forEach(r=>{
    if(r.valid){
      const labels={auto:'⚡ DB Auto',existing:'● Already loaded',manual:'✎ Manual'};
      const colors={auto:'var(--cyan)',existing:'var(--amber)',manual:'var(--green)'};
      html+=`<tr><td style="font-weight:600;color:var(--accent);">${_escapeHtml(r.icao)}</td><td>${_escapeHtml(r.city)}</td><td>${_escapeHtml(r.co)}</td><td>${_escapeHtml(r.ct)}</td><td>${r.lat.toFixed(2)}, ${r.lng.toFixed(2)}</td><td style="color:${colors[r.source]};">${labels[r.source]}</td></tr>`;
    } else {
      html+=`<tr class="row-error"><td colspan="5">${_escapeHtml(r.raw.substring(0,80))}</td><td>${_escapeHtml(r.reason)}</td></tr>`;
    }
  });
  html+='</tbody></table>';
  preview.innerHTML=html;
  preview.style.display='';
}
