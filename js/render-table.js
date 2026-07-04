// =============================== RENDER · FLIGHT LOG TABLE ===============================
// フライトログテーブル本体（描画・ソート・選択・検索）と、
// Flight Log カードの拡大ウィンドウ（card-fullscreen トグル + フッター）。
// 依存: getFiltered / parseMin (compute.js), _fmtHM (render.js)

// =============================== TABLE ===============================
let sortCol=0,sortAsc=false;
let selectedIds=new Set();
let currentTableData=[];

function renderTable(data){
  currentTableData=data;
  document.getElementById('flightBody').innerHTML=data.map(f=>{
    const checked=selectedIds.has(f.no)?'checked':'';
    const selClass=selectedIds.has(f.no)?'selected':'';
    return `<tr class="${selClass}" id="row-${f.no}">
      <td class="cb-wrap"><input type="checkbox" class="cb" ${checked} onchange="toggleRow(${f.no},this)"></td>
      <td class="date-tag">${f.no}</td>
      <td class="date-tag">${_escapeHtml(f.date)}</td>
      <td class="route-tag">${_escapeHtml(f.dep)} → ${_escapeHtml(f.arr)}</td>
      <td><span class="aircraft-tag">${_escapeHtml(f.ac)}</span></td>
      <td class="airline-tag">${_escapeHtml(f.al)}</td>
      <td class="time-tag">${_escapeHtml(f.t)}</td>
      <td><button class="row-delete-btn" onclick="confirmDeleteOne(${f.no})" title="Delete">✕</button></td>
    </tr>`;
  }).join('');
  updateSelectBar();
}

function toggleRow(no,cb){
  if(cb.checked) selectedIds.add(no); else selectedIds.delete(no);
  const row=document.getElementById('row-'+no);
  if(row) row.classList.toggle('selected',cb.checked);
  updateSelectBar();
  updateHeaderCb();
}

function toggleAll(masterCb){
  if(masterCb.checked){
    currentTableData.forEach(f=>selectedIds.add(f.no));
  } else {
    currentTableData.forEach(f=>selectedIds.delete(f.no));
  }
  renderTable(currentTableData);
  masterCb.classList.remove('partial');
}

function clearSelection(){
  selectedIds.clear();
  const cb=document.getElementById('cbAll');
  if(cb){cb.checked=false;cb.classList.remove('partial');}
  renderTable(currentTableData);
}

function updateSelectBar(){
  const bar=document.getElementById('selectBar');
  const cnt=selectedIds.size;
  if(cnt>0){
    bar.classList.add('show');
    document.getElementById('selCount').textContent=cnt+' selected';
  } else {
    bar.classList.remove('show');
  }
}

function updateHeaderCb(){
  const cb=document.getElementById('cbAll');
  if(!cb) return;
  const total=currentTableData.length;
  const checked=currentTableData.filter(f=>selectedIds.has(f.no)).length;
  if(checked===0){cb.checked=false;cb.classList.remove('partial');}
  else if(checked===total){cb.checked=true;cb.classList.remove('partial');}
  else{cb.checked=false;cb.classList.add('partial');}
}

function sortTable(col){
  if(sortCol===col) sortAsc=!sortAsc; else{sortCol=col;sortAsc=true;}
  const keys=['no','date','dep','ac','al','t'];
  const key=keys[col];
  const d=[...getFiltered()].sort((a,b)=>{
    if(key==='no') return sortAsc?a.no-b.no:b.no-a.no;
    if(key==='t') return sortAsc?parseMin(a.t)-parseMin(b.t):parseMin(b.t)-parseMin(a.t);
    return sortAsc?String(a[key]).localeCompare(String(b[key])):String(b[key]).localeCompare(String(a[key]));
  });
  renderTable(d);
}
// Flight Log 検索：以下の構文をサポートする。
//   ・スペース区切りで複数キーワード AND 検索（例：`RJTT ANA 2025`）
//   ・路線検索：1 トークン内に `RJTT-RJOO` / `RJTT→RJOO` / `RJTT->RJOO` / `RJTT>RJOO`
//     を書くと dep=RJTT かつ arr=RJOO の行に絞る。IATA（3 文字）も使え、自動で ICAO に解決される
//     （例：`HND-ITM` → RJTT-RJOO）
//   ・マイナス除外：`-foo` で foo を含む行を除外（例：`RJTT -RJOO`）
//   ・通常キーワード：date / dep / arr / aircraft / airline / duration を横断 substring 検索。
//     IATA を打つと対応する ICAO も同時に照合される（例：`HND` → RJTT を含む行もヒット）
// 大小文字は区別しない。クエリ空欄なら現フィルタの全行を表示。

// IATA / ICAO エイリアスを正準 ICAO に解決するヘルパ。
// 解決できて既知の空港なら ICAO（4 文字大文字）、それ以外は null を返す。
function _resolveSearchAirport(token){
  if(!token || typeof normalizeAirport !== 'function') return null;
  const norm = normalizeAirport(token);
  if(!norm) return null;
  if(typeof AP !== 'undefined' && AP[norm]) return norm;
  return null;
}

function filterFlights(){
  const q = document.getElementById('logSearch').value.trim();
  if(!q){ renderTable(getFiltered()); return; }
  // 路線パターン：4文字以下のアルファベットコード ＋ 区切り ＋ 4文字以下のアルファベットコード
  // （日付の `2025-06` などを誤検出しないよう、コード部は [A-Z]+ のみ）
  const routeRe = /^([A-Z]{2,4})(?:->|→|>|-)([A-Z]{2,4})$/i;
  const tokens = q.split(/\s+/);
  const routes   = []; // [{dep, arr}] — 双方とも ICAO 大文字（解決済み）
  const includes = []; // string (lowercase) | { any: [lower, ...] } — any は OR
  const excludes = []; // string (lowercase)
  for(const t of tokens){
    if(t.startsWith('-') && t.length > 1){
      excludes.push(t.slice(1).toLowerCase());
      continue;
    }
    const m = t.match(routeRe);
    if(m){
      const dep = _resolveSearchAirport(m[1]) || m[1].toUpperCase();
      const arr = _resolveSearchAirport(m[2]) || m[2].toUpperCase();
      routes.push({ dep, arr });
    } else {
      const lower = t.toLowerCase();
      const resolved = _resolveSearchAirport(t);
      if(resolved && resolved.toLowerCase() !== lower){
        // IATA → ICAO の解決が効いた場合は、元キーと解決後 ICAO の OR にする
        includes.push({ any: [lower, resolved.toLowerCase()] });
      } else {
        includes.push(lower);
      }
    }
  }
  const d = getFiltered().filter(f => {
    // 路線条件：いずれかの路線パターンとマッチ（複数指定時は OR）
    if(routes.length > 0){
      const ok = routes.some(r => f.dep.toUpperCase()===r.dep && f.arr.toUpperCase()===r.arr);
      if(!ok) return false;
    }
    // 1 行を 1 つの文字列にまとめて includes/excludes を判定（フィールド横断）
    const hay = `${f.date} ${f.dep} ${f.arr} ${f.ac} ${f.al} ${f.t}`.toLowerCase();
    for(const inc of includes){
      if(typeof inc === 'string'){
        if(!hay.includes(inc)) return false;
      } else {
        // OR 集合：いずれか 1 つでも含めば通す
        if(!inc.any.some(s => hay.includes(s))) return false;
      }
    }
    for(const exc of excludes){ if(hay.includes(exc))  return false; }
    return true;
  });
  renderTable(d);
}

// =============================== FLIGHT LOG EXPANDED (拡大ウィンドウ) ===============================
// Flight Log フッターの内容を現在のフィルタ済みデータで更新。
// CSS で通常時は display:none、拡大ウィンドウ時のみ表示されるが、内容は常に最新に保つ。
function _updateFlightLogFooter(){
  const data=getFiltered();
  const totalMin=data.reduce((s,f)=>s+parseMin(f.t),0);
  const c=document.getElementById('flightLogFooterCount');
  const t=document.getElementById('flightLogFooterTime');
  if(c) c.textContent=`${data.length} flight${data.length===1?'':'s'}`;
  if(t) t.textContent=`${_fmtHM(totalMin)} total`;
}

// カード自体に .card-fullscreen を付けて画面中央に modal 風表示。
// 他オーバーレイ（flights / continents / map / globe）と同じ中央配置・固定サイズ。
// 開いている間：ボタンアイコンを ⛶ → ✕ に。
//
// スクロール位置の保存：他オーバーレイは別 DOM の表示切替なのに対し、本拡大は
// カード自身が position:fixed になりフローから外れる。これでページ総高さが縮み、
// スクロール位置が範囲内にクランプされ得るので、閉じる時に戻すよう保存しておく。
let _flightLogSavedScrollY=0;
function toggleFlightLogFullscreen(){
  const section=document.querySelector('.card.table-section');
  const backdrop=document.getElementById('fullscreenBackdrop');
  if(!section) return;
  const btn=section.querySelector('.card-expand-btn');
  const isOpen=section.classList.contains('card-fullscreen');
  if(isOpen){
    section.classList.remove('card-fullscreen');
    if(backdrop) backdrop.classList.remove('show');
    document.body.classList.remove('has-fullscreen-card');
    if(btn){ btn.textContent='⛶'; btn.title='Expand'; }
    window.scrollTo(0,_flightLogSavedScrollY);
  } else {
    _flightLogSavedScrollY=window.scrollY||window.pageYOffset||0;
    section.classList.add('card-fullscreen');
    if(backdrop) backdrop.classList.add('show');
    document.body.classList.add('has-fullscreen-card');
    if(btn){ btn.textContent='✕'; btn.title='Close'; }
  }
}
