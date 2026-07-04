// =============================== FILTERS CONFIG ===============================
// フィルター／プリセットの「宣言的モデル定義」を集約したファイル（2026-07-03 に main.js から分離）。
// ここには「どんなフィルタ軸があるか・どんなプリセットがあるか」という純データと、
// それを支える純粋な地理ヘルパー／集合ヘルパーだけを置く。
// DOM 描画・状態更新（rebuildFilters / _renderFilterMenu / applyPreset など）は main.js に残す。
//
// 依存：
//   - AP（data/airports.js）… 地理ヘルパーが参照（実行時）
//   - DURATION_BUCKETS（compute.js）… FILTER_DEFS の duration 軸が読込時に参照 → compute.js の後に読むこと
//   - FilterState（compute.js）… _activeGeo / _cascadeAllow が参照（実行時）
// 参照元：main.js のみ（render 系は未使用）。読み込みは main.js より前。

// 各フィルタの定義。HTML 側の id とは
//   ・チップ:        chip-<key>
//   ・メニュー:      filter<Cap>Menu
//   ・ラベル文言:    filter<Cap>Label
// の規約で対応している（_cap で先頭大文字化）。
// `fixedOptions` を持つ def はデータからではなく固定リストを選択肢として使う（順序もそのまま）。
// {value, label} 形式で value は内部・URL・FilterState で使う ID、label は UI 表示文字列。
const _MONTH_LABELS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
// Mon-Sun の表示順（compute.js の wd と一致：Mon=0..Sun=6）
const _WEEKDAY_LABELS = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
// 大陸の選択肢（Add Airport の select と同順）。dep/arr 大陸フィルタで共用（fixedOptions）。
const _CONTINENT_OPTS = ['Asia','Europe','North America','South America','Africa','Oceania','Antarctica']
  .map(c => ({ value:c, label:c }));
// 空港ドロップダウンを大陸別にグループ表示する時のグループ見出し順（Y-2c 1a）。未収録大陸は 'Other' で末尾。
const _CONTINENT_ORDER = [..._CONTINENT_OPTS.map(o => o.value), 'Other'];
// 都市ラベル（AP.city）→ 所属大陸。City 系フィルタのグループ表示（groupBy）で共用。
function _cityContinent(city){ for(const k in AP){ const m=AP[k]; if(m && m.city===city) return m.ct||'Other'; } return 'Other'; }
// 空港 ICAO → 所属大陸（Airport 系 groupBy 共用）。
function _airportContinent(icao){ return (AP[icao] && AP[icao].ct) || 'Other'; }

// ===== Y-2c(2) 地理 cascade（依存フィルタ）用の逆引き =====
// 空港 ICAO → 国、都市 → 国、国 → 大陸。cascade の絞り込み判定で使う。
function _airportCountry(icao){ return (AP[icao] && AP[icao].co) || null; }
function _cityCountry(city){ for(const k in AP){ const m=AP[k]; if(m && m.city===city) return m.co||null; } return null; }
function _countryContinent(co){ for(const k in AP){ const m=AP[k]; if(m && m.co===co) return m.ct||null; } return null; }

// 現在の「地理的制約」＝選択中の大陸集合／国集合（dep/arr/either をまとめて和集合）。
// これが cascade の絞り込み基準。空なら制約なし。
function _activeGeo(){
  return {
    continents: new Set([...FilterState.continents, ...FilterState.depContinents, ...FilterState.arrContinents]),
    countries:  new Set([...FilterState.countries,  ...FilterState.depCountries,  ...FilterState.arrCountries]),
  };
}

// def が cascade 対象（cascade:'airport'|'city'|'country'）なら「オプション値→表示可否」の述語を返す。
// 制約が無い（大陸も国も未選択）なら null＝絞らない。
//   airport / city … 選択中の大陸 かつ 選択中の国 に属すものだけ表示（地理的包含）
//   country … 選択中の大陸 に属すものだけ表示（国は大陸で絞る。国どうしでは絞らない＝self 除外）
// ※ 上位（大陸/国）→下位（空港/都市/国）へのトップダウン絞り。空港/都市の選択は他軸を絞らない（v1）。
function _cascadeAllow(def){
  if(!def.cascade) return null;
  const { continents, countries } = _activeGeo();
  if(!continents.size && !countries.size) return null;
  if(def.cascade === 'airport'){
    return v => (!continents.size || continents.has(_airportContinent(v)))
             && (!countries.size  || countries.has(_airportCountry(v)));
  }
  if(def.cascade === 'city'){
    return v => (!continents.size || continents.has(_cityContinent(v)))
             && (!countries.size  || countries.has(_cityCountry(v)));
  }
  if(def.cascade === 'country'){
    return v => (!continents.size || continents.has(_countryContinent(v)));
  }
  return null;
}
const FILTER_DEFS = [
  { key:'year',     stateKey:'years',     all:'All Years',             order:'desc' },
  { key:'month',    stateKey:'months',    all:'All Months',            order:'asc',
    fixedOptions: _MONTH_LABELS.map((m,i) => ({
      value: String(i+1).padStart(2,'0'),  // '01'..'12'（compute.js 側と一致）
      label: m,
    }))
  },
  { key:'weekday',  stateKey:'weekdays',  all:'All Weekdays',          order:'asc',
    fixedOptions: _WEEKDAY_LABELS.map((w,i) => ({
      value: String(i),  // '0'..'6'（Mon=0..Sun=6）
      label: w,
    }))
  },
  { key:'airline',  stateKey:'airlines',  all:'All Airlines',          order:'asc'  },
  { key:'aircraft', stateKey:'aircraft',  all:'All Aircraft',          order:'asc'  },
  { key:'country',  stateKey:'countries', all:'All Countries/Regions', order:'asc', cascade:'country' },
  { key:'scope',    stateKey:'scope',     all:'All Flights',           order:'asc',
    fixedOptions:[
      { value:'domestic',      label:'🏠 Domestic' },
      { value:'international', label:'🌎 International' },
    ]
  },
  // ── フェーズY-2：高度フィルターパネルの軸。各カテゴリを All（either）/ Dep / Arr で揃える。
  // Airport：All（either・空港クリック drilldown 兼用）／Dep／Arr。大陸別グループ表示。
  { key:'airports',     stateKey:'airports',      all:'All Airports',       order:'asc', cascade:'airport',
    groupBy:_airportContinent, groupOrder:_CONTINENT_ORDER },
  { key:'depAirport',   stateKey:'depAirports',   all:'All Dep Airports',   order:'asc', cascade:'airport',
    groupBy:_airportContinent, groupOrder:_CONTINENT_ORDER },
  { key:'arrAirport',   stateKey:'arrAirports',   all:'All Arr Airports',   order:'asc', cascade:'airport',
    groupBy:_airportContinent, groupOrder:_CONTINENT_ORDER },
  // City：All（either・都市クリック drilldown 兼用）／Dep／Arr。大陸別グループ表示。
  { key:'city',         stateKey:'cities',        all:'All Cities',         order:'asc', cascade:'city',
    groupBy:_cityContinent, groupOrder:_CONTINENT_ORDER },
  { key:'depCity',      stateKey:'depCities',     all:'All Dep Cities',     order:'asc', cascade:'city',
    groupBy:_cityContinent, groupOrder:_CONTINENT_ORDER },
  { key:'arrCity',      stateKey:'arrCities',     all:'All Arr Cities',     order:'asc', cascade:'city',
    groupBy:_cityContinent, groupOrder:_CONTINENT_ORDER },
  // Country：All（either・バーの country と同一軸）／Dep／Arr（新設・平坦）。
  { key:'depCountry',   stateKey:'depCountries',  all:'All Dep Countries',  order:'asc', cascade:'country' },
  { key:'arrCountry',   stateKey:'arrCountries',  all:'All Arr Countries',  order:'asc', cascade:'country' },
  // Continent：All（either・新設）／Dep／Arr／大陸内外。
  { key:'continent',    stateKey:'continents',    all:'All Continents',     order:'asc', fixedOptions:_CONTINENT_OPTS },
  { key:'depContinent', stateKey:'depContinents', all:'All Dep Continents', order:'asc', fixedOptions:_CONTINENT_OPTS },
  { key:'arrContinent', stateKey:'arrContinents', all:'All Arr Continents', order:'asc', fixedOptions:_CONTINENT_OPTS },
  { key:'contScope',    stateKey:'contScope',     all:'All Cont. Scope',    order:'asc',
    fixedOptions:[
      { value:'intra', label:'🗺️ Intra-continental' },
      { value:'inter', label:'🌐 Inter-continental' },
    ]
  },
  { key:'duration',     stateKey:'durations',     all:'All Durations',      order:'asc',
    fixedOptions: DURATION_BUCKETS.map(b => ({ value:b.key, label:b.label })) },
];
// 高度パネル内にある軸を列挙（⚙ ボタンのバッジ件数・active 判定用＝バーに出ない軸のみ）。
// 注：year/month/airline/aircraft/country/scope はバーにも出るので ⚙ バッジには数えない
//     （バッジは「バーから見えない絞り込みが N 個ある」ことを示す用途）。
const _ADV_FILTER_KEYS = ['weekdays','airports','cities','continents','depAirports','arrAirports',
  'depCities','arrCities','depCountries','arrCountries','depContinents','arrContinents','contScope','durations','durationRange'];

// ============================ PRESETS（宣言的モデル） ============================
// プリセットは「複数軸の掛け合わせ」（単軸は既にチップで 1 クリック可）。同じ組合せを再クリックで解除トグル。
// 適用・描画（applyPreset / _renderPresets / _presetActive）は main.js 側（DOM 層）に残す。
const FILTER_PRESETS = [
  { id:'interLong',     emoji:'🌐', label:'Inter-continental long-haul', set:{ contScope:['inter'], durations:['ultra'] } },
  { id:'weekendIntl',   emoji:'🏝️', label:'Weekend international',        set:{ weekdays:['5','6'], scope:['international'] } },
  { id:'intraLong',     emoji:'🚀', label:'Intra-continental long-haul', set:{ contScope:['intra'], durations:['long','xlong','ultra'] } },
  { id:'domesticShort', emoji:'🛫', label:'Domestic short hops',          set:{ scope:['domestic'], durations:['short'] } },
];

// 集合の一致（順不同）。プリセットの再クリック解除トグル判定に使う。
function _sameSet(a, b){
  if(!Array.isArray(a) || a.length!==b.length) return false;
  const sa=new Set(a);
  return b.every(v => sa.has(v));
}

// 保存/復元で扱う全フィルタ軸（FILTER_DEFS の stateKey を重複排除＋DEF を持たない durationRange）。
const _ALL_STATE_KEYS = [...new Set(FILTER_DEFS.map(d => d.stateKey)), 'durationRange'];
