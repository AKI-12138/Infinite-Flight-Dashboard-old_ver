// =============================== COMPUTE ===============================
// 集計とフィルタの純粋ロジック層。DOM には触らない。
// 依存: AP (airports.js), flights (datasource.js)

// =============================== HELPERS ===============================
function sorted(map){return Object.entries(map).sort((a,b)=>b[1]-a[1]);}
function parseMin(t){const m=t.match(/(\d+)h(\d+)m/);return m?parseInt(m[1])*60+parseInt(m[2]):0;}

// =============================== DURATION BUCKETS ===============================
// 飛行時間バケット（分単位・非重複・昇順）。判定は min <= x < max（最後は max:Infinity）。
// 年報の「ショート／ロングホール分布」と、将来の duration フィルタ（VISION 将来-11）の
// 両方が参照する共有定義。UI（フィルタ／プリセット）はここを唯一の正として組む。
// label は英語（in-app 多言語化＝VISION 将来-S 導入時に i18n キーへ差し替える）。
const DURATION_BUCKETS = [
  { key:'short',  label:'Under 1h', min:0,   max:60 },
  { key:'medium', label:'1–3h',     min:60,  max:180 },
  { key:'long',   label:'3–6h',     min:180, max:360 },
  { key:'xlong',  label:'6–10h',    min:360, max:600 },
  { key:'ultra',  label:'10h+',     min:600, max:Infinity },
];

// 所要時間（分）→ バケットキー。想定外の負値などは null（どのバケットにも属さない）。
function _durationBucket(mins){
  const b = DURATION_BUCKETS.find(b => mins >= b.min && mins < b.max);
  return b ? b.key : null;
}

// =============================== FILTER STATE ===============================
// 各項目は配列。空配列なら「絞り込みなし」を意味する。
// 将来の複数選択 UI / 国内線フィルタ等の拡張に備えた述語エンジン方式。
// URL パラメータは互換維持のため単数名（year, airline, ...）、値は カンマ区切り。
//
// scope: ['domestic', 'international'] の多選択で「国内線／国際線」を表現。
//   [] → 全件、['domestic'] → 国内線のみ、['international'] → 国際線のみ、
//   両方選択 → どちらでも OK＝全件と同じ結果（フィルタ無し）。
// months: ['01'..'12'] のゼロ埋め文字列配列（空 = 全月）。`f.date.slice(5,7)` と直接比較するため。
// weekdays: ['0'..'6'] = Mon..Sun の文字列配列（空 = 全曜日）。
const FilterState = {
  years: [],
  airlines: [],
  aircraft: [],
  countries: [],
  scope: [],
  months: [],
  weekdays: [],
  // ── 共有計算層（フェーズY・2026-07-02）で追加した軸。既定 [] ＝無効。
  //    まだ UI / URL 永続化には配線していない（年報＝フェーズT や将来のフィルタ UI /
  //    プリセット＝VISION 将来-10 が配線する）。述語だけ先に用意し、両者で共用する。
  //    ルート専用軸は作らず depAirports + arrAirports の「重ね掛け」で表現する方針（VISION N-E）。
  // 「either（発着どちらか）」系＝countries と同型。ドリルダウン＋パネルの "All" チップ。
  airports: [],       // 発着どちらかに含む空港 ICAO
  cities: [],         // 発着どちらかに含む都市（AP.city）
  continents: [],     // 発着どちらかに含む大陸（AP.ct）
  // 向き別（dep / arr）系。ルート＝depAirports+arrAirports の重ね掛け。
  depAirports: [],    // 出発空港 ICAO
  arrAirports: [],    // 到着空港 ICAO
  depCities: [],      // 出発都市（AP.city）
  arrCities: [],      // 到着都市（AP.city）
  depCountries: [],   // 出発国（AP.co）
  arrCountries: [],   // 到着国（AP.co）
  depContinents: [],  // 出発大陸（AP.ct）
  arrContinents: [],  // 到着大陸（AP.ct）
  contScope: [],      // ['intra','inter'] 多選択＝大陸内／大陸間（scope と同型）
  durations: [],      // DURATION_BUCKETS の key 多選択
  durationRange: [],  // カスタム範囲 [loMin, hiMin]（分）。[] = 無効。あればバケットより優先（①(b)）
};

function _flightCountry(f){
  const dep=AP[f.dep], arr=AP[f.arr];
  return [dep?dep.co:null, arr?arr.co:null].filter(Boolean);
}

// dep / arr の物理所在大陸（AP.ct）を返す。未収録側は除外。_flightCountry の大陸版。
function _flightContinents(f){
  const dep=AP[f.dep], arr=AP[f.arr];
  return [dep?dep.ct:null, arr?arr.ct:null].filter(Boolean);
}

// dep / arr の都市（AP.city）を返す。未収録側は除外。_flightCountry の都市版（cities フィルタ用）。
function _flightCities(f){
  const dep=AP[f.dep], arr=AP[f.arr];
  return [dep?dep.city:null, arr?arr.city:null].filter(Boolean);
}

// =============================== AVIATION REGIMES ===============================
// 「同一航空管轄グループ」のホワイトリスト。
// 同一グループ内に dep.co と arr.co の両方が含まれるフライトは国内線扱いとする。
//
// 設計意図（詳細は CLAUDE.md「空港データの規約」参照）：
//   - airports.js の co フィールドは領土の政治的・税関的実態で 2 分法：
//     A. 親国と同一税関連合・自由往来・国内便扱い → 親国の co をそのまま使う
//        （例：Madeira → "Portugal", Canary Islands → "Spain", Hawaii → "USA"）
//     B. 別税関 or 別法域 or 海外領土扱い → "Name(Parent)" 形式
//        （例：Greenland → "Greenland(Denmark)", Hong Kong → "Hong Kong(China)"）
//   - このリストには B タイプのうち、親国民が事実上自由往来できる領土だけ登録
//   - A タイプ（親国扱い）は co が一致するので登録不要
//   - 香港・マカオ・台湾は B タイプだが「別管轄」なので意図的に未登録（国際線扱いのまま）
//   - airports.js に該当空港がまだ無くてもリストには載せてよい（将来追加時に効く）
//
// 領土を新規追加するときの判断基準（B タイプのみ該当）：
//   親国民がパスポートなしで自由往来でき、親国エアラインが国内便として運航しているなら登録。
//   別税関・別出入国管理を持つ領土は登録しない（自動的に国際線扱いになる）。
const DOMESTIC_REGIMES = [
  // デンマーク王国構成領（EU 圏外・独自政府だが北欧パスポート同盟下でデンマーク国民は自由往来）
  new Set(['Denmark', 'Greenland(Denmark)', 'Faroe Islands(Denmark)']),
  // フランス（海外県 DOM のみ。海外準県 COM の French Polynesia / New Caledonia は
  //          EU 圏外・別税関なので登録しない＝自動的に国際線扱い）
  new Set(['France', 'Martinique(France)', 'Guadeloupe(France)', 'Réunion(France)', 'Mayotte(France)', 'French Guiana(France)']),
  // 米国（領土全般・米国民パスポート不要。Hawaii は別 ICAO 接頭辞 PH だが州なので co: "USA" のまま）
  new Set(['USA', 'Puerto Rico(USA)', 'US Virgin Islands(USA)', 'Guam(USA)', 'Northern Mariana Islands(USA)']),
];

// 国内線／国際線の三値判定：'domestic' / 'international' / 'unknown'
//   - 片方/両方が AP 未登録 → 'unknown'（判定不能。座標・国が未収録のため断定しない）
//   - 両端の co が一致 → 'domestic'（最も単純なケース・forceIntl があっても優先）
//   - 片方/両方に forceIntl フラグが立っている → 'international'（DOMESTIC_REGIMES を上書き）
//   - 両端が同じ DOMESTIC_REGIMES グループに属する → 'domestic'（自治領⇄親国など）
//   - それ以外 → 'international'
//
// 'unknown' は domestic / international のどちらの絞り込みにも入れない（scope フィルタ参照）。
// 未収録空港を「国際」と誤分類しないための三値設計。他の統計には従来どおり全件カウントされる。
// forceIntl はオプションのエスケープハッチ。詳細は airports.js コメント参照。
function _flightDomesticState(f){
  const dep=AP[f.dep], arr=AP[f.arr];
  if(!dep || !arr) return 'unknown';
  if(dep.co === arr.co) return 'domestic';
  if(dep.forceIntl || arr.forceIntl) return 'international';
  return DOMESTIC_REGIMES.some(g => g.has(dep.co) && g.has(arr.co)) ? 'domestic' : 'international';
}

// 大陸内／大陸間の三値判定：'intra' / 'inter' / 'unknown'
//   - 片方/両方が AP 未登録 → 'unknown'（大陸が引けないので断定しない。_flightDomesticState と同じ作法）
//   - 両端の ct が一致 → 'intra'（同一大陸内フライト）
//   - 異なる → 'inter'（大陸間フライト）
// 国内/国際（co ベース）とは別軸。国フィルタと粒度衝突しない（VISION N-E で確認済み）。
function _flightContinentState(f){
  const dep=AP[f.dep], arr=AP[f.arr];
  if(!dep || !arr) return 'unknown';
  return dep.ct === arr.ct ? 'intra' : 'inter';
}

// 現在の FilterState から「有効な述語」だけを集めた配列を返す。
// 各述語は flight → bool。getFiltered は全述語を every() で通す。
function _buildPredicates(){
  const preds=[];
  if(FilterState.years.length){
    preds.push(f => FilterState.years.includes(f.date.slice(0,4)));
  }
  if(FilterState.airlines.length){
    preds.push(f => FilterState.airlines.includes(f.al));
  }
  if(FilterState.aircraft.length){
    preds.push(f => FilterState.aircraft.includes(f.ac));
  }
  if(FilterState.countries.length){
    // dep / arr どちらかの所属国が選択集合に入っていれば一致
    preds.push(f => _flightCountry(f).some(c => FilterState.countries.includes(c)));
  }
  // scope は ['domestic', 'international'] の多選択。
  //   1 個選択 → その種だけに絞る述語を追加
  //   0 個 or 2 個選択 → フィルタ無し（後者は両方マッチで結果が全件になるため）
  if(FilterState.scope.length === 1){
    // 'unknown'（AP 未登録の空港を含む）はどちらの絞り込みにも入れない
    if(FilterState.scope[0] === 'domestic')          preds.push(f => _flightDomesticState(f) === 'domestic');
    else if(FilterState.scope[0] === 'international') preds.push(f => _flightDomesticState(f) === 'international');
  }
  if(FilterState.months.length){
    // months はゼロ埋め文字列（'01'..'12'）。f.date.slice(5,7) も同形式なので直接比較。
    preds.push(f => FilterState.months.includes(f.date.slice(5,7)));
  }
  if(FilterState.weekdays.length){
    // 曜日は Mon='0'..Sun='6' の文字列（computeAll の wd と同じロジックを文字列化）。
    // 日付は new Date(yy,mm-1,dd) で構築してローカル曜日を取る（UTC 解釈ズレ回避）。
    preds.push(f => {
      const [yy,mm,dd] = f.date.split('-').map(Number);
      const w = (new Date(yy, mm-1, dd).getDay() + 6) % 7;
      return FilterState.weekdays.includes(String(w));
    });
  }
  // ── 共有計算層（フェーズY）の軸。既定 [] のときは述語を積まない＝挙動不変。
  // airports は「dep か arr のどちらかが一致」（countries と同型）。空港/都市クリックのドリルダウン用。
  if(FilterState.airports.length){
    preds.push(f => FilterState.airports.includes(f.dep) || FilterState.airports.includes(f.arr));
  }
  // cities も「dep か arr のどちらかの都市が一致」（countries と同型）。都市クリックのドリルダウン用。
  if(FilterState.cities.length){
    preds.push(f => _flightCities(f).some(c => FilterState.cities.includes(c)));
  }
  // continents（either）＝発着どちらかの大陸が一致（countries と同型）。パネルの Continents「All」。
  if(FilterState.continents.length){
    preds.push(f => _flightContinents(f).some(c => FilterState.continents.includes(c)));
  }
  // 向き別（dep / arr）の都市・国。未収録側は false。
  if(FilterState.depCities.length){
    preds.push(f => { const m=AP[f.dep]; return !!m && FilterState.depCities.includes(m.city); });
  }
  if(FilterState.arrCities.length){
    preds.push(f => { const m=AP[f.arr]; return !!m && FilterState.arrCities.includes(m.city); });
  }
  if(FilterState.depCountries.length){
    preds.push(f => { const m=AP[f.dep]; return !!m && FilterState.depCountries.includes(m.co); });
  }
  if(FilterState.arrCountries.length){
    preds.push(f => { const m=AP[f.arr]; return !!m && FilterState.arrCountries.includes(m.co); });
  }
  if(FilterState.depAirports.length){
    preds.push(f => FilterState.depAirports.includes(f.dep));
  }
  if(FilterState.arrAirports.length){
    preds.push(f => FilterState.arrAirports.includes(f.arr));
  }
  // 大陸は dep / arr を別軸で持つ（countries の「どちらか一致」と違い、向きを区別する）。
  //   ルート的な絞り込みは depAirports + arrAirports の重ね掛けで表現する（専用 route 軸は作らない）。
  if(FilterState.depContinents.length){
    preds.push(f => { const m=AP[f.dep]; return !!m && FilterState.depContinents.includes(m.ct); });
  }
  if(FilterState.arrContinents.length){
    preds.push(f => { const m=AP[f.arr]; return !!m && FilterState.arrContinents.includes(m.ct); });
  }
  // contScope は scope（国内/国際）と同型：1 個選択だけ絞り、0/2 個は全件。
  //   'unknown'（AP 未登録を含む便）はどちらにも入れない。
  if(FilterState.contScope.length === 1){
    if(FilterState.contScope[0] === 'intra')      preds.push(f => _flightContinentState(f) === 'intra');
    else if(FilterState.contScope[0] === 'inter') preds.push(f => _flightContinentState(f) === 'inter');
  }
  // 飛行時間：カスタム範囲があれば優先（バケットは無視）。無ければバケット選択で絞る。
  if(FilterState.durationRange.length === 2){
    const lo = FilterState.durationRange[0], hi = FilterState.durationRange[1];
    preds.push(f => { const m = parseMin(f.t); return m >= lo && m <= hi; });
  } else if(FilterState.durations.length){
    preds.push(f => FilterState.durations.includes(_durationBucket(parseMin(f.t))));
  }
  return preds;
}

function getFiltered(){
  const preds=_buildPredicates();
  if(preds.length===0) return flights.slice();
  return flights.filter(f => preds.every(p => p(f)));
}

// 何らかの絞り込みが効いているか
// scope は length===1 のときだけ「実質的に絞り込んでいる」（0 個 / 2 個は全件と同義）
function isAnyFilterActive(){
  return FilterState.years.length>0
      || FilterState.airlines.length>0
      || FilterState.aircraft.length>0
      || FilterState.countries.length>0
      || FilterState.scope.length>0
      || FilterState.months.length>0
      || FilterState.weekdays.length>0
      || FilterState.airports.length>0
      || FilterState.cities.length>0
      || FilterState.continents.length>0
      || FilterState.depAirports.length>0
      || FilterState.arrAirports.length>0
      || FilterState.depCities.length>0
      || FilterState.arrCities.length>0
      || FilterState.depCountries.length>0
      || FilterState.arrCountries.length>0
      || FilterState.depContinents.length>0
      || FilterState.arrContinents.length>0
      || FilterState.contScope.length>0
      || FilterState.durations.length>0
      || FilterState.durationRange.length>0;
}

// =============================== COMPARE STATE ===============================
// 任意の2集合（典型例：年・年月）を比較するための選択状態。
// year* / month* は UI 上のドロップダウンと連動。最初の初期化は main.js 側で行う。
// month* は '' なら「その年の全月」、'01'〜'12' ならその月のみで絞る。
const CompareState = { yearA:'', monthA:'', yearB:'', monthB:'' };

// 1 つのフライト集合から要約統計を返す（compareStats のためのヘルパ）。
// 純粋関数：DOM に触らない、グローバル状態を読まない。
function computeSetStats(arr){
  const airports=new Set(), countries=new Set();
  let count=0, mins=0;
  arr.forEach(f=>{
    count++;
    mins+=parseMin(f.t);
    [f.dep,f.arr].forEach(c=>{
      airports.add(c);
      const m=AP[c]; if(m) countries.add(m.co);
    });
  });
  return { count, mins, airports, countries };
}

// 2 集合（集合A、集合B）を比較。差分の計算は呼び出し側で。
// 戻り値: { a:{count,mins,airports,countries}, b:同 }
function compareStats(setA, setB){
  return { a: computeSetStats(setA), b: computeSetStats(setB) };
}

function computeAll(data){
  const ac={},al={},rt={},ap={},yr={},mo={};
  // 機材／航空会社ごとの「総飛行時間（分）」も並行集計。
  // バー表示で「回数 · 総時間」を併記するため。
  const acMin={}, alMin={};
  // 曜日別カウント。インデックスは Mon=0, Tue=1, ..., Sun=6（ISO-8601 風）。
  // Date#getDay() は Sun=0..Sat=6 を返すので (d+6) % 7 で Mon 起点へ。
  const wd={0:0,1:0,2:0,3:0,4:0,5:0,6:0};
  data.forEach(f=>{
    ac[f.ac]=(ac[f.ac]||0)+1;
    al[f.al]=(al[f.al]||0)+1;
    rt[f.dep+' → '+f.arr]=(rt[f.dep+' → '+f.arr]||0)+1;
    ap[f.dep]=(ap[f.dep]||0)+1; ap[f.arr]=(ap[f.arr]||0)+1;
    yr[f.date.slice(0,4)]=(yr[f.date.slice(0,4)]||0)+1;
    mo[+f.date.slice(5,7)]=(mo[+f.date.slice(5,7)]||0)+1;
    const mins=parseMin(f.t);
    acMin[f.ac]=(acMin[f.ac]||0)+mins;
    alMin[f.al]=(alMin[f.al]||0)+mins;
    // 曜日：YYYY-MM-DD を Date に渡すと UTC 解釈になり日付ズレの可能性があるため、
    // 明示的に Year/Month/Day で構築してローカル曜日を取る。
    const [yy,mm,dd]=f.date.split('-').map(Number);
    const wIdx=(new Date(yy, mm-1, dd).getDay()+6)%7;
    wd[wIdx]=(wd[wIdx]||0)+1;
  });
  const co={},ci={},ct={};
  data.forEach(f=>{
    [f.dep,f.arr].forEach(c=>{
      const m=AP[c];
      if(m){co[m.co]=(co[m.co]||0)+1;ci[m.city]=(ci[m.city]||0)+1;ct[m.ct]=(ct[m.ct]||0)+1;}
    });
  });
  return {
    ac:sorted(ac), al:sorted(al), rt:sorted(rt), ap:sorted(ap), yr, mo, wd,
    co:sorted(co), ci:sorted(ci), ct:sorted(ct),
    acMin, alMin,
  };
}
