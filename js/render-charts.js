// =============================== RENDER · CHARTS ===============================
// Chart.js による描画一式：Continent doughnut / Year bar / Month line / Weekday line。
// Continents カードの拡大表示（大ドーナツ）もここに含む（地図・地球儀と同じく
// 専用オーバーレイ ＋ 別 Chart.js インスタンス）。
// 依存: Chart (Chart.js CDN), computeAll / getFiltered (compute.js),
//       showToast (render.js)

let cContinent, cYear, cMonth, cWeekday, cContinentLarge;
// 拡大ウィンドウ用の Chart.js インスタンス（Year / Month / Weekday）。
// 各オーバーレイが閉じている間は null、開いている間だけ生きている。
let cYearLarge, cMonthLarge, cWeekdayLarge;

// 大陸の配色（インラインと拡大で同一）。隣接ハイライト時に区別できる分散配色。
const CT_COLORS={
  Asia:'#3b9eff',            // 鮮やかな青
  Europe:'#9d7aff',          // 紫
  Oceania:'#00d68f',         // 緑
  'North America':'#ff4d6a', // 赤
  'South America':'#ff8a3d', // オレンジ
  Africa:'#ffd400',          // 黄
  Antarctica:'#b8c5d6',      // 氷のシルバー
};
const chartFont={family:'Outfit',size:11};
// テーマ追従のため、描画関数内で getter として呼び出して最新値を取る。
// （定数 object として保持すると初回 cssVar() 値が固定化されて切替に追従しない）
function _chartGrid(){ return { color: cssVar('--chart-grid') }; }
function _chartTick(){ return { color: cssVar('--chart-tick'), font: chartFont }; }

function renderCharts(s){
  // Continent — インライン（小）の doughnut。配色は CT_COLORS で統一。
  const ctxC=document.getElementById('continentChart').getContext('2d');
  if(cContinent) cContinent.destroy();
  const ctTotal=s.ct.reduce((sum,d)=>sum+d[1],0);
  cContinent=new Chart(ctxC,{type:'doughnut',data:{
    labels:s.ct.map(d=>d[0]),
    datasets:[{data:s.ct.map(d=>d[1]),backgroundColor:s.ct.map(d=>CT_COLORS[d[0]]||'#4d5f7a'),borderWidth:0,borderRadius:4,spacing:3}]
  },options:{responsive:true,maintainAspectRatio:false,cutout:'62%',plugins:{
    legend:{position:'bottom',labels:{color:cssVar('--chart-legend'),font:chartFont,padding:14,usePointStyle:true,pointStyleWidth:8}},
    tooltip:{callbacks:{label:ctx=>{
      const v=ctx.parsed;
      const pct=ctTotal?((v/ctTotal)*100).toFixed(1):'0.0';
      return ` ${v} flights (${pct}%)`;
    }}}
  }}});
  // 拡大表示が開いていれば、同じデータでそちらも更新（フィルタ変更に追従）
  if(document.getElementById('continentsOverlay')?.classList.contains('show')){
    _renderContinentsLargeChart(s.ct);
  }

  // Year
  const years=Object.keys(s.yr).sort();
  const ctxY=document.getElementById('yearChart').getContext('2d');
  if(cYear) cYear.destroy();
  const yColors=['#3b9eff','#9d7aff','#00d68f','#ffb020','#ff4d6a','#00d4ff','#ff8a3d','#ff6b9d'];
  cYear=new Chart(ctxY,{type:'bar',data:{
    labels:years,
    datasets:[{data:years.map(y=>s.yr[y]),backgroundColor:years.map((_,i)=>yColors[i%yColors.length]+'70'),borderColor:years.map((_,i)=>yColors[i%yColors.length]),borderWidth:1.5,borderRadius:5,barPercentage:0.55}]
  },options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{
    y:{beginAtZero:true,grid:_chartGrid(),ticks:_chartTick()},
    x:{grid:{display:false},ticks:{..._chartTick(),font:{family:'JetBrains Mono',size:11}}}
  }}});
  if(document.getElementById('yearOverlay')?.classList.contains('show')){
    _renderYearLargeChart(s.yr);
  }

  // Month
  const months=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const mData=months.map((_,i)=>s.mo[i+1]||0);
  const ctxM=document.getElementById('monthChart').getContext('2d');
  if(cMonth) cMonth.destroy();
  cMonth=new Chart(ctxM,{type:'line',data:{
    labels:months,
    datasets:[{data:mData,borderColor:cssVar('--red'),backgroundColor:'rgba(255,77,106,0.08)',fill:true,tension:0.4,pointRadius:5,pointBackgroundColor:cssVar('--red'),pointBorderColor:cssVar('--chart-point-border'),pointBorderWidth:2}]
  },options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{
    y:{beginAtZero:true,grid:_chartGrid(),ticks:_chartTick()},
    x:{grid:{display:false},ticks:_chartTick()}
  }}});
  if(document.getElementById('monthOverlay')?.classList.contains('show')){
    _renderMonthLargeChart(s.mo);
  }

  // Weekday — Mon〜Sun。月と同じ折れ線スタイル。
  const weekdays=['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
  const wData=weekdays.map((_,i)=>s.wd?.[i]||0);
  const wLine=cssVar('--cyan'); // ライン＆ポイント色
  const ctxW=document.getElementById('weekdayChart').getContext('2d');
  if(cWeekday) cWeekday.destroy();
  cWeekday=new Chart(ctxW,{type:'line',data:{
    labels:weekdays,
    datasets:[{
      data:wData,
      borderColor:wLine,
      backgroundColor:'rgba(0,212,255,0.08)',
      fill:true,tension:0.4,
      pointRadius:5,
      pointBackgroundColor:wLine,
      pointBorderColor:cssVar('--chart-point-border'),pointBorderWidth:2,
    }]
  },options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{
    y:{beginAtZero:true,grid:_chartGrid(),ticks:_chartTick()},
    x:{grid:{display:false},ticks:{..._chartTick(),font:{family:'JetBrains Mono',size:11}}}
  }}});
  if(document.getElementById('weekdayOverlay')?.classList.contains('show')){
    _renderWeekdayLargeChart(s.wd);
  }
}

// =============================== CONTINENTS EXPANDED (大ドーナツ) ===============================
// Continents カード専用の拡大表示。インラインも拡大も doughnut（拡大版はラベル・
// 凡例・スペーシングを大きく取る）。マップ拡大と同じパターン：別オーバーレイで
// Chart.js インスタンスを別に持ち、フィルタ変更時は renderCharts から更新される。
function openContinentsExpanded(){
  const s=computeAll(getFiltered());
  if(!s.ct || s.ct.length===0){ showToast('No data to show','red'); return; }
  document.getElementById('continentsOverlay').classList.add('show');
  _lockBodyScroll('continentsOverlay');
  // モーダル CSS アニメ完了後に canvas 寸法が確定する。少し待ってから描画。
  setTimeout(()=>_renderContinentsLargeChart(s.ct), 250);
}

function closeContinentsExpanded(){
  document.getElementById('continentsOverlay').classList.remove('show');
  _unlockBodyScroll('continentsOverlay');
  if(cContinentLarge){ cContinentLarge.destroy(); cContinentLarge=null; }
}

function _renderContinentsLargeChart(ctData){
  const canvas=document.getElementById('continentChartLarge');
  if(!canvas) return;
  const ctxC=canvas.getContext('2d');
  if(cContinentLarge) cContinentLarge.destroy();
  const ctTotal=ctData.reduce((sum,d)=>sum+d[1],0);
  cContinentLarge=new Chart(ctxC,{type:'doughnut',data:{
    labels:ctData.map(d=>d[0]),
    datasets:[{
      data:ctData.map(d=>d[1]),
      backgroundColor:ctData.map(d=>CT_COLORS[d[0]]||'#4d5f7a'),
      borderWidth:0,borderRadius:6,spacing:4,
    }]
  },options:{
    responsive:true,maintainAspectRatio:false,cutout:'58%',
    plugins:{
      legend:{position:'bottom',labels:{
        color:cssVar('--chart-legend-strong'),font:{family:'Outfit',size:14},padding:20,
        usePointStyle:true,pointStyleWidth:12,
      }},
      tooltip:{callbacks:{label:ctx=>{
        const v=ctx.parsed;
        const pct=ctTotal?((v/ctTotal)*100).toFixed(1):'0.0';
        return ` ${v} flights (${pct}%)`;
      }}}
    }
  }});
}

// =============================== YEAR / MONTH / WEEKDAY EXPANDED ===============================
// Continents と同じパターン：ヘッダの ⛶ ボタンで開く別オーバーレイ、別 Chart.js インスタンス。
// インラインと拡大は同じデータ（renderCharts から両方更新される）。フォント・ポイントだけ大きく。
//
// 共通の Chart.js 大型版オプション（軸・グリッド・凡例なし、フォント拡大）。
// テーマ切替に追従するため、描画関数内で毎回 getter として呼び出す（定数化すると CSS 変数値が固定化される）。
//
// N-A / N-B（拡大カードの機能強化）：
//   opts.labelLines(index) … その点の内訳ツールチップ行（string|string[]）を返す（N-A）
//   opts.onPick(index)     … その点をクリックしたときの処理（ドリルダウン・N-B）
// 両方とも省略可。onPick があるときはホバーで pointer カーソルにする。
function _chartLargeOpts(opts={}){
  const o = {
    responsive:true, maintainAspectRatio:false,
    plugins:{ legend:{display:false} },
    scales:{
      y:{beginAtZero:true, grid:_chartGrid(), ticks:{..._chartTick(), font:{family:'Outfit', size:14}}},
      x:{grid:{display:false}, ticks:{..._chartTick(), font:{family:'JetBrains Mono', size:14}}},
    },
  };
  if(opts.labelLines){
    o.plugins.tooltip = { callbacks:{ label: ctx => opts.labelLines(ctx.dataIndex) } };
  }
  if(opts.onPick){
    o.onClick = (evt, els) => { if(els && els.length) setTimeout(() => opts.onPick(els[0].index), 0); };
    o.onHover = (evt, els) => {
      const c = evt?.native?.target; if(c) c.style.cursor = (els && els.length) ? 'pointer' : 'default';
    };
  }
  return o;
}

// N-A: 拡大チャートのツールチップ内訳。pred(f)=この点（年/月/曜日）に属するか。
// 現在のフィルタ後データから「件数・総飛行時間・上位エアライン」を組み立てて返す。
function _bucketLines(pred){
  const arr = getFiltered().filter(pred);
  if(arr.length === 0) return ' 0 flights';
  let mins = 0; const al = {};
  arr.forEach(f => { mins += parseMin(f.t); if(f.al) al[f.al] = (al[f.al]||0)+1; });
  const h = Math.floor(mins/60), m = mins%60;
  const top = Object.entries(al).sort((a,b)=>b[1]-a[1]).slice(0,3)
    .map(([k,v]) => `${k} ${v}`).join(' · ');
  const lines = [` ${arr.length} flight${arr.length!==1?'s':''} · ${h}h${String(m).padStart(2,'0')}m`];
  if(top) lines.push(' ' + top);
  return lines;
}

// --- Year ---
function openYearExpanded(){
  const s = computeAll(getFiltered());
  if(!s.yr || Object.keys(s.yr).length === 0){ showToast('No data to show','red'); return; }
  document.getElementById('yearOverlay').classList.add('show');
  _lockBodyScroll('yearOverlay');
  setTimeout(() => _renderYearLargeChart(s.yr), 250);
}
function closeYearExpanded(){
  document.getElementById('yearOverlay').classList.remove('show');
  _unlockBodyScroll('yearOverlay');
  if(cYearLarge){ cYearLarge.destroy(); cYearLarge = null; }
}
function _renderYearLargeChart(yrData){
  const canvas = document.getElementById('yearChartLarge');
  if(!canvas) return;
  const ctx = canvas.getContext('2d');
  if(cYearLarge) cYearLarge.destroy();
  const years = Object.keys(yrData).sort();
  const colors = ['#3b9eff','#9d7aff','#00d68f','#ffb020','#ff4d6a','#00d4ff','#ff8a3d','#ff6b9d'];
  cYearLarge = new Chart(ctx, {
    type:'bar',
    data:{
      labels: years,
      datasets:[{
        data: years.map(y => yrData[y]),
        backgroundColor: years.map((_,i) => colors[i%colors.length]+'70'),
        borderColor:     years.map((_,i) => colors[i%colors.length]),
        borderWidth:1.5, borderRadius:8, barPercentage:0.55,
      }],
    },
    options: _chartLargeOpts({
      labelLines: i => _bucketLines(f => f.date.slice(0,4) === years[i]),
      onPick:     i => { closeYearExpanded(); _drilldownFilter('years', years[i]); },
    }),
  });
}

// --- Month ---
function openMonthExpanded(){
  const s = computeAll(getFiltered());
  if(!s.mo){ showToast('No data to show','red'); return; }
  document.getElementById('monthOverlay').classList.add('show');
  _lockBodyScroll('monthOverlay');
  setTimeout(() => _renderMonthLargeChart(s.mo), 250);
}
function closeMonthExpanded(){
  document.getElementById('monthOverlay').classList.remove('show');
  _unlockBodyScroll('monthOverlay');
  if(cMonthLarge){ cMonthLarge.destroy(); cMonthLarge = null; }
}
function _renderMonthLargeChart(moData){
  const canvas = document.getElementById('monthChartLarge');
  if(!canvas) return;
  const ctx = canvas.getContext('2d');
  if(cMonthLarge) cMonthLarge.destroy();
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const data   = months.map((_,i) => moData[i+1] || 0);
  cMonthLarge = new Chart(ctx, {
    type:'line',
    data:{
      labels: months,
      datasets:[{
        data, borderColor:cssVar('--red'), backgroundColor:'rgba(255,77,106,0.10)',
        fill:true, tension:0.4,
        pointRadius:7, pointHoverRadius:9,
        pointBackgroundColor:cssVar('--red'), pointBorderColor:cssVar('--chart-point-border'), pointBorderWidth:2,
        borderWidth:3,
      }],
    },
    options: _chartLargeOpts({
      labelLines: i => _bucketLines(f => f.date.slice(5,7) === String(i+1).padStart(2,'0')),
      onPick:     i => { closeMonthExpanded(); _drilldownFilter('months', String(i+1).padStart(2,'0')); },
    }),
  });
}

// --- Weekday ---
function openWeekdayExpanded(){
  const s = computeAll(getFiltered());
  if(!s.wd){ showToast('No data to show','red'); return; }
  document.getElementById('weekdayOverlay').classList.add('show');
  _lockBodyScroll('weekdayOverlay');
  setTimeout(() => _renderWeekdayLargeChart(s.wd), 250);
}
function closeWeekdayExpanded(){
  document.getElementById('weekdayOverlay').classList.remove('show');
  _unlockBodyScroll('weekdayOverlay');
  if(cWeekdayLarge){ cWeekdayLarge.destroy(); cWeekdayLarge = null; }
}
function _renderWeekdayLargeChart(wdData){
  const canvas = document.getElementById('weekdayChartLarge');
  if(!canvas) return;
  const ctx = canvas.getContext('2d');
  if(cWeekdayLarge) cWeekdayLarge.destroy();
  const weekdays = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
  const data     = weekdays.map((_,i) => wdData?.[i] || 0);
  cWeekdayLarge = new Chart(ctx, {
    type:'line',
    data:{
      labels: weekdays,
      datasets:[{
        data, borderColor:cssVar('--cyan'), backgroundColor:'rgba(0,212,255,0.10)',
        fill:true, tension:0.4,
        pointRadius:7, pointHoverRadius:9,
        pointBackgroundColor:cssVar('--cyan'), pointBorderColor:cssVar('--chart-point-border'), pointBorderWidth:2,
        borderWidth:3,
      }],
    },
    options: _chartLargeOpts({
      labelLines: i => _bucketLines(f => {
        const [yy,mm,dd] = f.date.split('-').map(Number);
        return ((new Date(yy, mm-1, dd).getDay() + 6) % 7) === i;
      }),
      onPick: i => { closeWeekdayExpanded(); _drilldownFilter('weekdays', String(i)); },
    }),
  });
}
