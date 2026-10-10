# Province city maps — historical static geography

Source: Apache ECharts **4.9.0**, Apache-2.0, copyright 2017–2020
The Apache Software Foundation. Original regional JSON is retained verbatim in
`sources/`; province-name routing is in `sources.json`.
https://github.com/apache/echarts/tree/4.9.0/map/json/province

Whole municipality/Hong Kong/Macao shapes reuse the existing original
`../travel-map/china.source.json`, at the existing catalog's single-city granularity.
They do not imply district-level visits. Full upstream LICENSE/NOTICE are retained
in `../travel-map/` and copied with the generated public maps for attribution.

Run `node scripts/generate-travel-city-maps.mjs` entirely offline. It decodes
upstream geometry, fits a local equirectangular view, and simplifies at 0.35 SVG
units while retaining every polygon/ring (including islands/holes). Smaller rings
retain original points. No random geometry, external map API or dependency is used.
`manifest.json` records source/output SHA-256, sizes and complete catalog coverage.

The 34 province units / 393 current city options are fully accounted for:
389 have matching historical shapes, four explicitly lack them: **那曲市** and
**新星市、白杨市、胡杨河市**. Missing shapes remain selectable/countable via the
complete city list; no shape is drawn for them. Source **那曲地区、莱芜市** and
the Taiwan source's extra geographic feature remain neutral, non-interactive
historical boundaries. In particular, old Laiwu geometry is not merged into or
highlighted as today's Jinan. These snapshots are not current legal boundaries.
Tibet has an empty Shannan placeholder plus a real Shannan polygon; only the empty
placeholder is omitted and is explicitly recorded in the manifest.

Taiwan's 22 simplified source names have a reviewed, one-to-one table to the
catalog's traditional names in the generator. This table applies to geography
only. User records always match the selected province and **exact catalog city**;
old free text such as `杭州` is retained in records but never guessed as `杭州市`.
Unmatched old records receive a clear notice and remain visible in province/time
lists. Repeated visits count once; deleting only the final active visit unlights.

Generated assets live at `public/travel-city-maps/<province_id>.json`. The UI fetches
only the selected province, with cancellation when switching; no aggregate city
geometry is imported into the client bundle. All maps total about 1.51 MB uncompressed,
with each province below 100 KB. Failed map loads retain the complete city list.
City names render in a separate top layer. `label-layout.ts` reserves each full
name's bounds, moves colliding/edge labels with leaders to their original anchors,
and maintains at least 13px screen type when resized. Long names wrap in full;
crowded narrow maps can grow vertically. No names are hidden or truncated.
Names use plain text without a white background, outline or shadow. Leaders are
masked behind reserved text bounds without covering the underlying geography.
Browser coverage and synthetic screenshots: [city-label validation](../../../../../docs/TRAVEL_CITY_LABELS.md).
Province selection changes display only; selecting a city explicitly opens the
existing visit form without saving. Time view always shows every active visit,
including multiple dates/notes for the same city. CRUD/storage/schema are unchanged.
