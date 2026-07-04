// =============================== NORMALIZE ===============================
// 入力の揺れ補正。日付・時間・空港・機材の表記ゆれを内部標準形に揃える。
// CSV 取り込みや手動入力など「データが入る境界」で必ず通すこと。
// 正準形は NORMALIZATION.md を参照。
//
// 依存: IATA_TO_ICAO (airports.js)

// =============================== DATE ===============================
function normalizeDate(raw){
  let s=raw.trim();
  // Already correct: 2025-06-01
  if(/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  // YYYY/MM/DD or YYYY.MM.DD
  if(/^\d{4}[\/\.]\d{1,2}[\/\.]\d{1,2}$/.test(s)){
    const p=s.split(/[\/\.]/); return `${p[0]}-${p[1].padStart(2,'0')}-${p[2].padStart(2,'0')}`;
  }
  // YY-MM-DD or YY/MM/DD
  if(/^\d{2}[-\/\.]\d{1,2}[-\/\.]\d{1,2}$/.test(s)){
    const p=s.split(/[-\/\.]/);
    const yr=parseInt(p[0]); const full=yr>=50?'19'+p[0]:'20'+p[0];
    return `${full}-${p[1].padStart(2,'0')}-${p[2].padStart(2,'0')}`;
  }
  // YYYYMMDD (no separators)
  if(/^\d{8}$/.test(s)) return `${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}`;
  // DD/MM/YYYY or DD-MM-YYYY (if day > 12 we know it's DD/MM)
  if(/^\d{1,2}[-\/\.]\d{1,2}[-\/\.]\d{4}$/.test(s)){
    const p=s.split(/[-\/\.]/);
    if(parseInt(p[0])>12) return `${p[2]}-${p[1].padStart(2,'0')}-${p[0].padStart(2,'0')}`;
    // Ambiguous — assume MM/DD/YYYY (US-style) if first<=12
    return `${p[2]}-${p[0].padStart(2,'0')}-${p[1].padStart(2,'0')}`;
  }
  // YYYY-M-D (missing leading zeros)
  if(/^\d{4}-\d{1,2}-\d{1,2}$/.test(s)){
    const p=s.split('-'); return `${p[0]}-${p[1].padStart(2,'0')}-${p[2].padStart(2,'0')}`;
  }
  return null; // Can't parse
}

// =============================== TIME ===============================
function normalizeTime(raw){
  let s=raw.trim().toLowerCase().replace(/\s+/g,'');
  // Already correct: 1h30m
  if(/^\d+h\d+m$/.test(s)) return s;
  // 1h30 (missing m)
  if(/^\d+h\d+$/.test(s)) return s+'m';
  // 1:30 or 01:30
  if(/^\d{1,2}:\d{2}$/.test(s)){
    const [h,m]=s.split(':'); return `${parseInt(h)}h${m}m`;
  }
  // 90m (minutes only)
  if(/^\d+m$/.test(s)){
    const mins=parseInt(s); return `${Math.floor(mins/60)}h${(mins%60).toString().padStart(2,'0')}m`;
  }
  // 1H30M (uppercase)
  if(/^\d+[hH]\d+[mM]$/.test(s)) return s.replace(/[HM]/g,c=>c.toLowerCase());
  // 1h (hours only, no minutes)
  if(/^\d+h$/.test(s)) return s+'00m';
  // 1.5h (decimal hours)
  if(/^[\d.]+h$/.test(s)){
    const hrs=parseFloat(s); const h=Math.floor(hrs); const m=Math.round((hrs-h)*60);
    return `${h}h${m.toString().padStart(2,'0')}m`;
  }
  return null; // Can't parse
}

// =============================== AIRPORT ===============================
// 旧コード／タイポを正準 ICAO に揃える救済テーブル。
// （IATA→ICAO は airports.js の IATA_TO_ICAO を使用）
const ICAO_ALIASES = {
  NZQH: 'NZQN', // Queenstown：誤った旧コード。正しくは NZQN
};

// 入力を compact 化（大文字英数のみ）したうえで段階的に照合する。
//   1. 旧 ICAO のタイポ救済（ICAO_ALIASES, 例: NZQH→NZQN）
//   2. 既知の 4 文字 ICAO はそのまま
//   3. 3 文字 IATA → ICAO 変換
//   4. 都市+空港識別子（例: "Tokyo HND" → TOKYOHND → RJTT）
//   5. 都市名のみ（単一空港の都市のみ、例: "Zurich" → LSZH）
//   6. どれにも一致しない場合は compact 形をそのまま返す（後段で validation エラー）
function normalizeAirport(raw){
  if(raw == null) return null;
  const s = String(raw).toUpperCase().replace(/[^A-Z0-9]/g, '');
  if(!s) return null;
  if(ICAO_ALIASES[s]) return ICAO_ALIASES[s];
  if(s.length === 4 && typeof AP !== 'undefined' && AP[s]) return s;
  if(s.length === 3 && typeof IATA_TO_ICAO !== 'undefined' && IATA_TO_ICAO[s]){
    return IATA_TO_ICAO[s];
  }
  if(typeof CITY_AIRPORT_TO_ICAO !== 'undefined' && CITY_AIRPORT_TO_ICAO[s]){
    return CITY_AIRPORT_TO_ICAO[s];
  }
  if(typeof CITY_TO_ICAO !== 'undefined' && CITY_TO_ICAO[s]){
    return CITY_TO_ICAO[s];
  }
  return s;
}

// =============================== AIRCRAFT ===============================
// 正準コード→別名の表 AIRCRAFT_CANONICAL_TABLE は data/aircraft.js に分離した
// （機材を手で足すときはそちらを編集）。下の AIRCRAFT_ALIASES はその表から起動時に構築する。

// canonical→canonical, alias→canonical の両方を1辞書に集約（起動時に構築）
const AIRCRAFT_ALIASES = {};
Object.entries(AIRCRAFT_CANONICAL_TABLE).forEach(([canonical, aliases]) => {
  AIRCRAFT_ALIASES[canonical] = canonical;
  aliases.forEach(a => { AIRCRAFT_ALIASES[a] = canonical; });
});

// メーカー名のプレフィックスを除去（剥がして機種コード単独にする）。
// "MD"/"ERJ"/"ATR" は機種名の一部（MD11, ERJ190, ATR72）なので含めない。
// "McDonnell Douglas" の "MD" は MCDONNELL の方で剥がれるので個別不要。
const AIRCRAFT_PREFIX_RE = /^(BOEING|AIRBUS|EMBRAER|BOMBARDIER|MCDONNELL\s*DOUGLAS|CESSNA|CIRRUS|GULFSTREAM|PILATUS|COMAC)\s*/i;

// =============================== AIRLINE ===============================
// 正式名称→別名の表 AIRLINE_TABLE は data/airlines.js に分離した
// （航空会社を手で足すときはそちらを編集）。下の AIRLINE_ALIASES はその表から起動時に構築する。

// canonical の compact 形と alias を 1 つの辞書に集約（起動時に構築）
const AIRLINE_ALIASES = {};
Object.entries(AIRLINE_TABLE).forEach(([canonical, aliases]) => {
  const compactCanon = canonical.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if(compactCanon) AIRLINE_ALIASES[compactCanon] = canonical;
  aliases.forEach(a => {
    const c = String(a).toUpperCase().replace(/[^A-Z0-9]/g, '');
    if(c && !AIRLINE_ALIASES[c]) AIRLINE_ALIASES[c] = canonical;
  });
});

// 入力されたエアライン名／コードを正式名称に揃える。
// AIRLINE_TABLE に該当が無ければ元の文字列を trim して返す（formatting 維持）。
function normalizeAirline(raw){
  if(raw == null) return null;
  const original = String(raw).trim();
  if(!original) return null;
  const compact = original.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if(compact && AIRLINE_ALIASES[compact]) return AIRLINE_ALIASES[compact];
  return original;
}

// =============================== AIRCRAFT ===============================
// 機材入力を正準 ICAO に揃える。
// 不明なものは compact 化した値（大文字英数のみ）を返す — 後段は弾かない。
function normalizeAircraft(raw){
  if(raw == null) return null;
  let s = String(raw).toUpperCase().trim();
  s = s.replace(AIRCRAFT_PREFIX_RE, '');
  const compact = s.replace(/[^A-Z0-9]/g, '');
  if(!compact) return null;
  // 直接ヒット（canonical または alias）
  if(AIRCRAFT_ALIASES[compact]) return AIRCRAFT_ALIASES[compact];
  // 救済：先頭が「英字1 + 数字3桁以上」のとき、頭の英字を剥がしてもう一度試す。
  // 例：「B777300ER」→「777300ER」→ B77W、「B737800」→「737800」→ B738。
  // これで「B777-300ER」「B737-800」のような表記もメーカー記号 B/A 付きで認識できる。
  if(/^[A-Z]\d{3}/.test(compact)){
    const stripped = compact.substring(1);
    if(AIRCRAFT_ALIASES[stripped]) return AIRCRAFT_ALIASES[stripped];
  }
  return compact;
}
