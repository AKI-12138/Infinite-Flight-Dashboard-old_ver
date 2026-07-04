# Changelog

User-facing highlights for each version of **Infinite Flight Dashboard**. The version here
matches the number in the dashboard footer. This is a summary of notable changes — smaller or
internal-only updates may be grouped.

## v2.0 — 2026-07-02
A big upgrade to filtering.

- **Advanced filters panel.** A new **⚙ More** button next to the filter bar opens a panel with a
  full set of filters, grouped by category (Date · Airport · Cities · Countries/Regions ·
  Continents · Aircraft/Airline · Time). The 6 quick chips stay on the bar; everything else lives
  in the panel, and the two stay in sync.
- **Many more ways to filter.** Filter by **departure / arrival** separately for airports, cities,
  countries, and continents; by **within-a-continent vs across-continents**; and by **flight
  duration** — pick from buckets (under 1h, 1–3h, 3–6h, 6–10h, 10h+) or type a **custom hour
  range**.
- **Presets.** One-click combinations like *Inter-continental long-haul*, *Weekend international*,
  *Intra-continental long-haul*, *Domestic short hops*.
- **Save your own presets.** Set up any combination of filters and **💾 Save preset** it with a
  name; it appears under **Saved** and is remembered on your device. Edit / delete them anytime.
- **Search inside long menus.** Airport / city / country / airline / aircraft dropdowns now have a
  search box — type part of a code or an airport name (e.g. "haneda", "tokyo") to find it fast.
- **Smart, geography-aware options.** Pick a continent or country and the airport / city / country
  lists narrow to match, so you're not scrolling past irrelevant options.
- **Click any chart to filter — now including routes, airports, and cities.** Click a bar in an
  expanded *Top Routes / Airports / Cities* card to filter the whole dashboard to it.
- **Polish.** Dropdowns flip upward when there's no room below; Cancel / Clear / Close buttons glow
  red on hover consistently; the filter and Add-Flight windows no longer close on an accidental
  background click.

## v1.9 — 2026-07-01
- **Add missing airports right from Data check.** Each unrecognized airport now has a **+ Add**
  button that opens a small form (ICAO pre-filled) to add its coordinates — no CSV editing needed.
  A link to look up the coordinates is built in. Unrecognized codes are also highlighted so they
  stand out.
- **Back to top.** A small **↑** button appears at the right edge of the filter bar as you scroll,
  to jump back to the header in one tap.
- **Mobile polish.** On phones, the first (empty) screen has a cleaner, shorter header, and the
  browser's status-bar area now matches the dashboard header color instead of showing plain white.
- **Fix:** on wide screens, the pinned filter bar now covers the full width as you scroll, instead
  of leaving the edges showing content behind it. It also no longer shows a stray "pinned" shadow
  on first load before you've scrolled.

## v1.8 — 2026-07-01
- **Tidier header.** The header is now just **+ Add Flight** plus two compact menus: a **≡ menu**
  (Search flights, Data check, Import, Export, Clear all) and a **⚙️ settings menu** (theme and
  status). Less clutter, one clear primary button.
- **Data check.** A new window (in the **≡ menu**) lists any airports or aircraft in your log that
  aren't in the dataset — these silently drop off the map and out of the country counts — and lets
  you look up whether a given airport is recognized. The **⚙️ settings menu** shows a quick
  "all recognized / ⚠️ N unrecognized" status that opens it.
- **Clearer theme picker.** Theme is now an explicit **Auto / Light / Dark** choice in the
  ⚙️ settings menu (instead of a one-button cycle).
- **Clear filters while collapsed.** When the filter bar is collapsed, a **Clear all** button now
  appears next to it whenever filters are active.
- **One-click clear in Import.** The paste box in Bulk Import has a **✕ Clear** button to empty it
  and start over.
- **Calmer save notifications.** "Auto-saved" now shows as a brief toast after the action message,
  instead of a banner that lingered. Save *errors* still stay until you dismiss them.

## v1.7 — 2026-06-30
- **Click to filter (drill-down).** Click a bar or point in any expanded card — *Flights per
  Year / Month / Weekday*, or *Top Aircraft / Airlines / Countries* — to filter the whole
  dashboard to it. Click the same one again to clear.
- **Richer chart tooltips.** Expanded Year / Month / Weekday charts now show a breakdown on
  hover: number of flights, total time, and your top airlines for that point.
- **Sticky filter bar.** The filter bar stays pinned to the top as you scroll, so you can adjust
  filters while looking at any chart.
- **Sharper 3D globe.** Higher-resolution Earth texture and finer country borders (with a
  graceful fallback if the high-res texture isn't available).
- **Globe rotation control.** The globe pauses while you drag to inspect and resumes a few
  seconds later; a new ⏸ / ▶ button lets you pause it for as long as you like.
- **Fix:** country borders on the globe are now clearly visible in light mode.

## v1.6 — 2026-06-30
- **Try it with sample data.** Load a built-in sample flight log in one click (or download it as
  a CSV template) to explore the dashboard before importing your own.

## v1.5 — 2026-06-07
- Map display improvements, consolidated airport data, and various UX fixes.

## v1.3 – v1.4 — 2026-05-28
- Design and accessibility polish from a full design review.
- README published in three languages (English / 日本語 / 简体中文).

## v1.0 — initial release
- Flight log dashboard: stats, charts, a 2D route map, a 3D globe, filters, year-over-year
  comparison, CSV import / export, and light / dark themes — all stored locally, no signup.

---

_Smaller or internal updates (e.g. v1.1–v1.2) aren't listed individually._
