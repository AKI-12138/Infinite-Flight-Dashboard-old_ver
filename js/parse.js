// =============================== PARSE / EXPORT ===============================
// CSV の入出力アダプタ。DataSource から見て「データの入る境界」。
// 取り込み時は必ず normalize.js の関数を通してデータを揃える。
// 依存: AP (airports.js), DataSource (datasource.js),
//       normalizeDate, normalizeTime (normalize.js)

// =============================== EXPORT ===============================
// Format is identical to the import format — paste this back in and it round-trips.
function _csvField(v){
  const s=String(v==null?'':v);
  // Quote when the field contains comma, quote, or newline
  if(/[",\n]/.test(s)) return '"'+s.replace(/"/g,'""')+'"';
  return s;
}
function buildFlightCSV(flightList){
  const today=new Date().toISOString().slice(0,10);
  const head =
    '# IF_FlightLog v1 — exported '+today+'\n'+
    '# Format: 6 columns, comma-separated. Lines starting with # are ignored on import.\n'+
    '#   date     YYYY-MM-DD   (2025/6/1, 25-06-01, 20250601 are also auto-corrected)\n'+
    '#   dep      ICAO 4 chars (RJTT)\n'+
    '#   arr      ICAO 4 chars (RJOO)\n'+
    '#   aircraft ICAO type    (B772, A359 ...)\n'+
    '#   airline  free text    (if it contains a comma, wrap in quotes like "Singapore Airlines, Ltd")\n'+
    '#   duration 1h30m        (1:30, 90m, 1.5h formats are also auto-corrected)\n'+
    '#\n'+
    'date,dep,arr,aircraft,airline,duration\n';
  const rows=flightList.map(f =>
    [f.date,f.dep,f.arr,f.ac,_csvField(f.al),f.t].join(',')
  ).join('\n');
  return head+rows+'\n';
}
function buildAirportCSV(apMap){
  const today=new Date().toISOString().slice(0,10);
  const head =
    '# IF_Airports v1 — exported '+today+'\n'+
    '# Format: 6 columns. Lines starting with # are ignored on import.\n'+
    '#   icao,lat,lng,city,country,continent\n'+
    '# Only airports NOT in the built-in 172-airport DB need to live here.\n'+
    '#\n'+
    'icao,lat,lng,city,country,continent\n';
  const rows=Object.entries(apMap).map(([code,a]) =>
    [code,a.lat,a.lng,_csvField(a.city),_csvField(a.co),_csvField(a.ct)].join(',')
  ).join('\n');
  return head+rows+'\n';
}
function _download(filename, content){
  const b=new Blob([content],{type:'text/csv;charset=utf-8'});
  const u=URL.createObjectURL(b);
  const a=document.createElement('a');
  a.href=u;a.download=filename;a.click();
  URL.revokeObjectURL(u);
}
function exportCSV(){
  if(DataSource.count===0){
    showToast('No flights to export','red');
    return;
  }
  _download('IF_Flight_Log.csv', buildFlightCSV(DataSource.flights));
  // Also offer airports file if user has any custom airports
  const custom=DataSource.customAirports;
  if(Object.keys(custom).length>0){
    _download('IF_Airports.csv', buildAirportCSV(custom));
  }
  DataSource.markClean();
  showToast('✓ Exported '+DataSource.count+' flights');
}

// =============================== BULK IMPORT (PARSE) ===============================
// Split a single CSV line into fields, honoring "quoted, fields" with embedded commas.
function _splitCsvLine(line, sep){
  if(sep!==',' ) return line.split(sep);
  const out=[]; let cur=''; let inQ=false;
  for(let i=0;i<line.length;i++){
    const c=line[i];
    if(inQ){
      if(c==='"' && line[i+1]==='"'){ cur+='"'; i++; }
      else if(c==='"'){ inQ=false; }
      else cur+=c;
    } else {
      if(c==='"') inQ=true;
      else if(c===',') { out.push(cur); cur=''; }
      else cur+=c;
    }
  }
  out.push(cur);
  return out;
}

function parseBulkFlights(text){
  // 区切り文字の緩和：、（全角コンマ）を , に正規化。
  // これで日本語IMEからの誤入力も取り込める。
  //   ・, （ASCIIコンマ）  ← 元から対応、クォート処理あり
  //   ・、（全角コンマ）   ← ここで , に変換、以降の処理は同じ
  //   ・\t（タブ）         ← 元から対応（lines[0] にタブがあると sep='\t' に自動切替）
  // タブと 、 を同時に混ぜたケースは想定外（実用上ほぼ無い）。
  text = text.replace(/、/g, ',');
  // Drop blank lines and comment lines (starting with #)
  const lines = text.split(/\n/).map(l=>l.trim()).filter(l=>l.length>0 && !l.startsWith('#'));
  if(lines.length===0) return [];
  // Auto-detect separator: tab > semicolon > comma
  let sep=',';
  if(lines[0].includes('\t')) sep='\t';
  else if(lines[0].includes(';') && !lines[0].includes(',')) sep=';';
  // Skip header if detected
  let start=0;
  const first=lines[0].toLowerCase();
  if(first.includes('date') && (first.includes('dep') || first.includes('departure') || first.includes('aircraft') || first.includes('arr'))) start=1;
  const results=[];
  for(let i=start;i<lines.length;i++){
    const rawLine=lines[i];
    // Split honoring "quoted, fields"
    let parts=_splitCsvLine(rawLine, sep).map(s=>s.trim());
    // If quoted-CSV split didn't give enough fields, try a fallback on multiple spaces
    if(parts.filter(p=>p.length>0).length<6){
      const spaceParts=rawLine.split(/\s{2,}/).map(s=>s.trim()).filter(s=>s.length>0);
      if(spaceParts.length>=6) parts=spaceParts;
    }
    // Drop empty trailing fields, but keep internal empty cells so positional indexing stays right
    while(parts.length && parts[parts.length-1]==='') parts.pop();
    if(parts.length<6){results.push({valid:false,raw:rawLine,reason:'Missing columns (6 required)'});continue;}
    let [rawDate,dep,arr,ac,al,t]=parts.slice(0,6);
    // Legacy: if user pasted the old export format (7 cols: No,date,...), drop the leading No
    if(parts.length===7 && /^\d+$/.test(parts[0].trim())){
      [rawDate,dep,arr,ac,al,t]=parts.slice(1,7);
    } else if(parts.length>6){
      // Extra parts mean airline contained an un-quoted comma — rejoin middle
      al=parts.slice(4,parts.length-1).join(', ');
      t=parts[parts.length-1];
    }
    const fixes=[];
    // Normalize date
    const nDate=normalizeDate(rawDate);
    if(!nDate){results.push({valid:false,raw:rawLine,reason:`Cannot parse date: "${rawDate}"`});continue;}
    if(nDate!==rawDate) fixes.push(`date: ${rawDate}→${nDate}`);
    // Normalize time
    const nTime=normalizeTime(t);
    if(!nTime){results.push({valid:false,raw:rawLine,reason:`Cannot parse duration: "${t}"`});continue;}
    if(nTime!==t.trim()) fixes.push(`time: ${t}→${nTime}`);
    // 空港コードを正規化（IATA→ICAO 変換、旧コード救済、大文字化、空白除去）
    const nDep = normalizeAirport(dep) || '';
    const nArr = normalizeAirport(arr) || '';
    if(nDep && nDep !== dep) fixes.push(`dep: ${dep}→${nDep}`);
    if(nArr && nArr !== arr) fixes.push(`arr: ${arr}→${nArr}`);
    // 機材を正規化（"Boeing 777-300ER" "77W" "777300ER" → 全部 B77W）
    const nAc = normalizeAircraft(ac) || '';
    if(nAc && nAc !== ac) fixes.push(`ac: ${ac}→${nAc}`);
    // エアライン名／コードを正規化（"ANA" "AFR" → "All Nippon Airways" "Air France"）
    const alTrim = al.trim();
    const nAl = normalizeAirline(alTrim) || '';
    if(nAl && nAl !== alTrim) fixes.push(`airline: ${alTrim}→${nAl}`);
    // Validate
    if(nDep.length<2||nDep.length>4){results.push({valid:false,raw:rawLine,reason:`Invalid departure ICAO: "${nDep}"`});continue;}
    if(nArr.length<2||nArr.length>4){results.push({valid:false,raw:rawLine,reason:`Invalid arrival ICAO: "${nArr}"`});continue;}
    // Validate date is real
    const dateObj=new Date(nDate+'T00:00:00');
    if(isNaN(dateObj.getTime())){results.push({valid:false,raw:rawLine,reason:`Invalid date: "${nDate}"`});continue;}
    results.push({valid:true,date:nDate,dep:nDep,arr:nArr,ac:nAc,al:nAl,t:nTime,fixes});
  }
  return results;
}

function parseBulkAirports(text){
  // 区切り文字の緩和：、（全角コンマ）を , に正規化（フライト側と同じ）
  text = text.replace(/、/g, ',');
  // Drop blank lines and # comment lines
  const lines = text.split(/\n/).map(l=>l.trim()).filter(l=>l.length>0 && !l.startsWith('#'));
  if(lines.length===0) return [];
  const sep = lines[0].includes('\t') ? '\t' : ',';
  let start=0;
  const first=lines[0].toLowerCase();
  if(first.includes('icao') || (first.includes('lat') && first.includes('lng'))) start=1;
  const results=[];
  for(let i=start;i<lines.length;i++){
    const parts=_splitCsvLine(lines[i], sep).map(s=>s.trim());
    // ICAO は normalizeAirport で 3字 IATA も自動変換
    const icao = normalizeAirport(parts[0]) || '';
    if(icao.length<2||icao.length>4){results.push({valid:false,raw:lines[i],reason:'Invalid ICAO'});continue;}
    // ICAO だけ書かれた行は、組み込み AP から座標を引いて自動補完。
    // ユーザーが過去に手で追加した「カスタム空港」は DataSource.customAirports に
    // 残っているので、そちらにあれば "existing"（既知）、組み込みなら "auto"（自動補完）として
    // プレビュー表示時に区別する。
    if(parts.length===1 || (parts.length<=2 && !parts[1])){
      const a = AP[icao];
      if(a){
        const source = (typeof DataSource !== 'undefined'
          && DataSource.customAirports && DataSource.customAirports[icao]) ? 'existing' : 'auto';
        results.push({valid:true,icao,lat:a.lat,lng:a.lng,city:a.city,co:a.co,ct:a.ct,source});
      } else {
        results.push({valid:false,raw:lines[i],reason:'Not in DB — use full CSV'});
      }
      continue;
    }
    // Full CSV mode
    if(parts.length<6){results.push({valid:false,raw:lines[i],reason:'Need 6 columns or just ICAO'});continue;}
    const [,latS,lngS,city,co,ct]=parts;
    const lat=parseFloat(latS), lng=parseFloat(lngS);
    if(isNaN(lat)||isNaN(lng)){results.push({valid:false,raw:lines[i],reason:'Invalid coords'});continue;}
    results.push({valid:true,icao,lat,lng,city,co,ct,source:'manual'});
  }
  return results;
}
