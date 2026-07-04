// =============================== DATA SOURCE ===============================
// Flight history and custom airports は localStorage に永続化される（フェーズB で導入）。
// 起動時に load() が前回データを復元、変更時に saveToStorage() が自動発火。
//
// The DataSource module is the single boundary between UI and data.
// Swapping localStorage for a server fetch later means replacing only the
// async load() / saveToStorage() internals — シグネチャは維持する。

// localStorage キー（バージョン付き：将来データフォーマットを変えても旧データを安全に弾ける）
const _STORAGE_KEY_FLIGHTS = 'if-dashboard:flights:v1';
const _STORAGE_KEY_AIRPORTS = 'if-dashboard:custom-airports:v1';
// 「最後に保存した時刻」（Unix ms 文字列）— Restore モーダルに "saved at 14:32" のように表示するため
const _STORAGE_KEY_SAVED_AT = 'if-dashboard:saved-at:v1';
// sessionStorage キー（リフレッシュ判定用：このタブで一度ロードしたか）
const _SESSION_FLAG_KEY = 'if-dashboard:session-flag';
// sessionStorage キー（Restore モーダルで「Start fresh」を選んだ印）。
// このタブ／セッション内では復元も Restore モーダルも出さず、空状態のままにする。
// タブを閉じて再オープン（新セッション）すると消えるので、また Restore モーダルが出る。
// localStorage 自体は触らないので、ヘッダ 🗑 Clear のような完全消去とは別物。
const _SESSION_OPT_OUT_RESTORE = 'if-dashboard:opt-out-restore';
// CSV エクスポート用ファイル名プレフィックス（ユーザー設定、空ならデフォルト）
const _STORAGE_KEY_EXPORT_PREFIX_FLIGHTS  = 'if-dashboard:export-prefix:flights:v1';
const _STORAGE_KEY_EXPORT_PREFIX_AIRPORTS = 'if-dashboard:export-prefix:airports:v1';
const EXPORT_PREFIX_DEFAULTS = { flights: 'flightslog', airports: 'airports' };

// ファイル名に安全に使える文字だけ残す：英数字 / _ / - のみ許可、他は _ に変換。
// 最大 40 文字、前後の空白は trim、空文字なら null を返す（呼び出し側でデフォルトに戻す）。
function sanitizeFilenamePrefix(s){
  const t = String(s == null ? '' : s).trim().replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 40);
  return t.length ? t : null;
}

// `getExportPrefix('flights')` などで現在の保存値を取得。未設定なら EXPORT_PREFIX_DEFAULTS を返す。
function getExportPrefix(kind){
  const key = kind === 'airports' ? _STORAGE_KEY_EXPORT_PREFIX_AIRPORTS : _STORAGE_KEY_EXPORT_PREFIX_FLIGHTS;
  const def = EXPORT_PREFIX_DEFAULTS[kind] || 'export';
  if(!STORAGE_AVAILABLE) return def;
  try {
    const v = localStorage.getItem(key);
    return (v && sanitizeFilenamePrefix(v)) || def;
  } catch(e) {
    return def;
  }
}

// `setExportPrefix('flights', 'mylog')` で保存。空文字ならキーごと削除（デフォルトに戻す）。
function setExportPrefix(kind, value){
  if(!STORAGE_AVAILABLE) return;
  const key = kind === 'airports' ? _STORAGE_KEY_EXPORT_PREFIX_AIRPORTS : _STORAGE_KEY_EXPORT_PREFIX_FLIGHTS;
  const clean = sanitizeFilenamePrefix(value);
  try {
    if(clean) localStorage.setItem(key, clean);
    else localStorage.removeItem(key);
  } catch(e) {
    // 保存できなくても致命的ではない（次回もデフォルトを使うだけ）
  }
}

// `flightslog_2026-05-23.csv` 形式を組み立てる。日付は実行時の today。
function buildExportFilename(prefix){
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  const ymd = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
  const safe = sanitizeFilenamePrefix(prefix) || 'export';
  return `${safe}_${ymd}.csv`;
}

// 起動時に localStorage が実際に書き込み可能か検証する。
//   - Chrome / Safari の最近の file:// プロトコル制限で SecurityError が出る
//   - シークレットウィンドウや容量超過で QuotaExceededError が出る
//   - ストレージ無効化（プライベートモード等）の検知
// true = 使用可能 / false = 使えない（UI 側で警告アイコンに切り替える）
function _testStorageAvailable(){
  try {
    const k = '__if-dashboard-test__';
    localStorage.setItem(k, '1');
    const ok = localStorage.getItem(k) === '1';
    localStorage.removeItem(k);
    return ok;
  } catch(e) {
    return false;
  }
}
const STORAGE_AVAILABLE = _testStorageAvailable();

const DataSource = (function(){
  let _flights = [];       // [{no, date, dep, arr, ac, al, t}, ...]
  let _customAirports = {};// {ICAO:{lat,lng,city,co,ct}, ...}
  let _dirty = false;      // true when in-memory state diverges from last imported/exported CSV
  let _autoSaveEnabled = true; // 一括ロード中など、保存を一時停止したい局面で false にする

  function _renumber(){
    _flights.sort((a,b) => a.date.localeCompare(b.date));
    _flights.forEach((f,i) => f.no = i + 1);
  }
  function _key(f){
    // Duplicate-detection key — same flight = same date/dep/arr/aircraft/airline/duration
    return [f.date, f.dep, f.arr, f.ac, (f.al||'').trim().toLowerCase(), f.t].join('|');
  }

  // データ変更後に呼ぶ：自動保存 + 保存通知フック発火。
  // _autoSaveEnabled が false の間は実際の I/O をスキップ（連続変更の最後に 1 回呼ぶ運用）。
  // STORAGE_AVAILABLE が false の環境（file:// 直開きで Chrome/Safari が拒否、シークレット等）
  // では保存ステータスアイコンが「disabled」のままで、データはメモリ上のみ保持。
  function _persistAfterChange(){
    if(!_autoSaveEnabled) return;
    if(!STORAGE_AVAILABLE){
      if(typeof onAutoSaveError === 'function') onAutoSaveError(new Error('Storage unavailable'));
      return;
    }
    try {
      localStorage.setItem(_STORAGE_KEY_FLIGHTS, JSON.stringify(_flights));
      localStorage.setItem(_STORAGE_KEY_AIRPORTS, JSON.stringify(_customAirports));
      localStorage.setItem(_STORAGE_KEY_SAVED_AT, String(Date.now()));
      // [Start fresh] 後にユーザーが新しくデータを追加／編集／削除した場合は、
      // 「今度はこのデータを次回も使う」という意思表示なので opt-out フラグを解除する。
      // これで次のリフレッシュでは新データが自動復元される。
      try { sessionStorage.removeItem(_SESSION_OPT_OUT_RESTORE); } catch(e2) { /* ignore */ }
      if(typeof onAutoSave === 'function') onAutoSave();
    } catch(e) {
      // 容量超過（QuotaExceededError 等）でも全体は動かす。UI 側で警告するなら onAutoSaveError 経由。
      console.warn('Auto-save to localStorage failed:', e);
      if(typeof onAutoSaveError === 'function') onAutoSaveError(e);
    }
  }

  return {
    get flights(){ return _flights; },
    get customAirports(){ return _customAirports; },
    get dirty(){ return _dirty; },
    get count(){ return _flights.length; },

    markClean(){ _dirty = false; if(typeof onDirtyChange==='function') onDirtyChange(); },
    markDirty(){ _dirty = true;  if(typeof onDirtyChange==='function') onDirtyChange(); },

    // Replace entire flight list (used by full CSV reload)
    replaceAll(newFlights){
      _flights = newFlights.map(f => ({...f}));
      _renumber();
      this.markClean();
      _persistAfterChange();
    },

    // Append flights; returns {added, duplicates}
    addFlights(newFlights, {skipDuplicates=true} = {}){
      const existing = new Set(_flights.map(_key));
      const added = [], duplicates = [];
      newFlights.forEach(f => {
        if(skipDuplicates && existing.has(_key(f))){
          duplicates.push(f);
        } else {
          _flights.push({...f, no:0});
          existing.add(_key(f));
          added.push(f);
        }
      });
      _renumber();
      if(added.length){
        this.markDirty();
        _persistAfterChange();
      }
      return {added, duplicates};
    },

    addOne(f){
      _flights.push({...f, no:0});
      _renumber();
      this.markDirty();
      _persistAfterChange();
    },

    removeByIds(ids){
      const set = new Set(ids);
      const before = _flights.length;
      _flights = _flights.filter(f => !set.has(f.no));
      _renumber();
      const removed = before - _flights.length;
      if(removed){
        this.markDirty();
        _persistAfterChange();
      }
      return removed;
    },

    clearAll(){
      const n = _flights.length;
      _flights = [];
      if(n){
        this.markDirty();
        _persistAfterChange();
      }
      return n;
    },

    // Custom airports (not in the built-in 172-airport DB)
    addAirports(newAPs){
      let added = 0;
      Object.entries(newAPs).forEach(([icao, data]) => {
        if(!_customAirports[icao]){ _customAirports[icao] = data; added++; }
      });
      if(added){
        this.markDirty();
        _persistAfterChange();
      }
      return added;
    },

    // =============================== STORAGE LAYER ===============================
    // ストレージが利用可能かどうか（UI 側でアイコンの色を決めるのに使う）
    isStorageAvailable(){ return STORAGE_AVAILABLE; },

    // localStorage に前回データがあるか（Restore モーダル表示判定用）
    hasStoredData(){
      if(!STORAGE_AVAILABLE) return false;
      try {
        const raw = localStorage.getItem(_STORAGE_KEY_FLIGHTS);
        if(!raw) return false;
        const arr = JSON.parse(raw);
        return Array.isArray(arr) && arr.length > 0;
      } catch(e) {
        return false;
      }
    },

    // 前回データの「件数」「最新フライト日付」「最終保存時刻」をプレビュー用に返す。
    // Restore モーダルの文言で使用。ファイル全体をパースするが、フライトデータは
    // 数百件程度なので速度面の問題なし。
    //   - latestDate: 最新フライトの飛行日（YYYY-MM-DD）
    //   - savedAt:    最後に自動保存した時刻（Date オブジェクト、無ければ null）
    storedDataSummary(){
      if(!STORAGE_AVAILABLE) return null;
      try {
        const arr = JSON.parse(localStorage.getItem(_STORAGE_KEY_FLIGHTS) || '[]');
        if(!Array.isArray(arr) || arr.length === 0) return null;
        const latest = arr.reduce((m,f) => (f.date > m ? f.date : m), '');
        const savedAtRaw = localStorage.getItem(_STORAGE_KEY_SAVED_AT);
        const savedAt = savedAtRaw ? new Date(parseInt(savedAtRaw, 10)) : null;
        return { count: arr.length, latestDate: latest, savedAt };
      } catch(e) {
        return null;
      }
    },

    // Async ロード：localStorage から flights + customAirports を復元。
    // BaaS 移行時はこの中身を fetch('/api/flights') に差し替えるだけ。
    // 戻り値：復元に成功して件数が 1 以上なら true、それ以外は false。
    //
    // 重要：_flights は同じ配列参照を維持して中身だけ入れ替える（`_flights = newArr`
    // で参照を切り替えると、トップレベルの `let flights = DataSource.flights;` が
    // 古い空配列を指したままになり、`getFiltered()` 等が空になるバグを引き起こす）。
    async load(){
      if(!STORAGE_AVAILABLE) return false;
      try {
        const rawF = localStorage.getItem(_STORAGE_KEY_FLIGHTS);
        const rawA = localStorage.getItem(_STORAGE_KEY_AIRPORTS);
        const arr  = rawF ? JSON.parse(rawF) : [];
        const aps  = rawA ? JSON.parse(rawA) : {};
        if(Array.isArray(arr) && arr.length){
          // 自動保存を抑止しながら一括復元（ロード中の重複書き込みを防ぐ）
          _autoSaveEnabled = false;
          // 配列の参照を保ったまま中身を入れ替える（push/splice ベース）
          _flights.length = 0;
          arr.forEach(f => _flights.push({...f}));
          _customAirports = (aps && typeof aps === 'object') ? aps : {};
          _renumber();
          _autoSaveEnabled = true;
          this.markClean(); // 復元直後は dirty ではない
          return true;
        }
        return false;
      } catch(e) {
        console.warn('Failed to load from localStorage:', e);
        return false;
      }
    },

    // 明示的に localStorage を消す（ヘッダ Clear ボタン等から呼ばれる想定）
    clearStorage(){
      if(!STORAGE_AVAILABLE) return;
      try {
        localStorage.removeItem(_STORAGE_KEY_FLIGHTS);
        localStorage.removeItem(_STORAGE_KEY_AIRPORTS);
        localStorage.removeItem(_STORAGE_KEY_SAVED_AT);
      } catch(e) {
        console.warn('Failed to clear localStorage:', e);
      }
    },
  };
})();

// `flights` is kept as a backward-compatible reference into DataSource.
// All mutations should go through DataSource; reads via `flights` are fine.
let flights = DataSource.flights;

// Hook for UI to react to dirty-state changes（既存）
let onDirtyChange = null;
// Hook for UI to react to auto-save events（B-3：保存トースト用に main.js から差し込む）
let onAutoSave = null;
let onAutoSaveError = null;

