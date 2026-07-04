// data/sample.js
// 公開デモ用のサンプルフライトデータ（バニラ JS・グローバルスコープ）。
// file:// でも動くよう、外部 CSV を fetch せず JS 文字列としてそのまま同梱する。
// Bulk Import の「サンプルを読み込む / ダウンロード」ボタンと、空状態の
// 「サンプルで試す」ボタンから参照される。
//
// 中身は実在の空港（すべて内蔵 DB に存在）・機材・航空会社を使った例。
// 国内/国際・複数大陸・2 年分に分散させ、全グラフと地図がきれいに埋まるようにしてある。
// ダウンロードして自分用テンプレートとして編集する用途も兼ねる。
const SAMPLE_FLIGHT_CSV = `# IF_FlightLog v1 — sample data
# このファイルを編集して、自分のフライト記録に置き換えられます。
# 列: date,dep,arr,aircraft,airline,duration（6 列）
date,dep,arr,aircraft,airline,duration
2024-01-13,RJTT,RJOO,B772,All Nippon Airways,1h05m
2024-02-03,RJOO,RJCC,A320,Japan Airlines,1h45m
2024-03-20,RJTT,RJFF,B738,All Nippon Airways,1h55m
2024-04-07,RJTT,RKSI,B789,All Nippon Airways,2h30m
2024-05-18,RKSI,RJTT,A333,Korean Air,2h25m
2024-06-15,RJTT,VHHH,B77W,Cathay Pacific,4h45m
2024-07-04,RJAA,KLAX,B789,All Nippon Airways,9h40m
2024-08-22,KLAX,KJFK,A321,United Airlines,5h20m
2024-09-10,KJFK,EGLL,B763,British Airways,6h55m
2024-10-05,EGLL,LFPG,A320,British Airways,1h15m
2024-11-19,LFPG,EDDF,A320,Air France,1h10m
2024-12-24,EDDF,RJAA,B748,Lufthansa,11h20m
2025-01-08,RJTT,ROAH,A321,All Nippon Airways,2h40m
2025-02-14,ROAH,RJTT,B738,Japan Airlines,2h20m
2025-03-02,RJBB,WSSS,A359,Singapore Airlines,6h30m
2025-03-29,WSSS,YSSY,B789,Singapore Airlines,7h50m
2025-04-12,YSSY,NZAA,A320,Air New Zealand,3h00m
2025-05-01,RJTT,OMDB,B77W,Emirates,11h30m
2025-05-30,OMDB,EGLL,A388,Emirates,7h45m
2025-06-21,RJTT,ZBAA,B763,All Nippon Airways,4h05m
2025-07-15,RJOO,RJCC,A320,All Nippon Airways,1h50m
2025-08-09,RJTT,KSFO,B789,United Airlines,9h25m
2025-09-13,KSFO,KSEA,B738,Alaska Airlines,2h10m
2025-10-27,RJTT,RJOO,A359,Japan Airlines,1h10m
`;

// 空港用サンプル（簡易・主にフォーマット見本／ダウンロード用途）。
// 内蔵 DB に無い空港を「手動指定（6 列）」で追加する例。
// Quick mode（ICAO だけ並べる）の使い方もコメントで併記。大陸名は
// Africa / Antarctica / Asia / Europe / North America / Oceania / South America のいずれか。
const SAMPLE_AIRPORT_CSV = `# IF_Airports v1 — sample data
# 内蔵 DB に無い空港を追加するための CSV です。編集して自分用に使えます。
#
# 簡単な使い方（Quick mode）：ICAO コードだけ並べれば内蔵 DB から自動解決されます。
#   RJTT
#   KJFK
#
# 手動指定（Manual mode・6 列）：DB に無い空港を座標付きで追加します。
icao,lat,lng,city,country,continent
PGUM,13.4853,144.7960,Hagatna,Guam,Oceania
PHTO,19.7214,-155.0485,Hilo,United States,North America
SKBO,4.7016,-74.1469,Bogota,Colombia,South America
FMEE,-20.8871,55.5103,Saint-Denis,Reunion,Africa
`;
