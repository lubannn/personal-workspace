# Province-scoped city/region options

Offline travel dropdown reference: 34 province-level units and 393 options.
This snapshot is a travel reference, not a current official administrative registry.

## Mainland source — WTFPL

`modood/Administrative-divisions-of-China`, pinned commit
`c49d495b40ac73eb1a66f6eeae5f8fd10696f035`:
https://github.com/modood/Administrative-divisions-of-China/tree/c49d495b40ac73eb1a66f6eeae5f8fd10696f035

Upstream documents its source as National Bureau of Statistics **2023** data
(cutoff 2023-06-30, publication 2023-09-11), and states it is no longer updated.
Verbatim `dist/cities.json` and `dist/provinces.json` are retained here.
`mainland-direct-units.source.json` is the exact subset of `dist/areas.json`
whose `cityCode` ends in `90`; the full upstream file's SHA-256 is retained in
`source-hashes.json`. Original permission is retained as `LICENSE-mainland`.

All prefectural cities, autonomous prefectures, leagues and regions are retained.
The four municipality statistics buckets (市辖区/县) become 北京市/天津市/上海市/重庆市.
Aggregate 省直辖县级行政区划/自治区直辖县级行政区划 buckets expand into the
actual source units (including 济源市、仙桃市、神农架林区、海南直辖县市、新疆兵团城市).
These county-level options deliberately cover places without a prefectural parent.

## Taiwan source — MIT

`donma/TaiwanAddressCityAreaRoadChineseEnglishJSON`, pinned commit
`233bff2a43ebaea28620fd996ecec23fffc74016`:
https://github.com/donma/TaiwanAddressCityAreaRoadChineseEnglishJSON/tree/233bff2a43ebaea28620fd996ecec23fffc74016

Upstream credits Chunghwa Post address data. `taiwan-counties.source.json`
retains the exact ordered `CityName` fields from `CityCountyData.json` (full file
SHA-256 in `source-hashes.json`). Only the 22 names ending in 市/縣 are offered;
postal geographic buckets 釣魚臺/南海島 are not county/city choices. Source
traditional names are preserved without inferred simplified aliases. The original
README, including the full MIT license and copyright `(c) 2016 Donma`, is retained
in `README-taiwan.source.md` (only trailing whitespace is removed).

## Hong Kong and Macao

Both are single city-wide choices 香港/澳门 under their existing province units.
These existing workspace labels avoid inventing a prefectural hierarchy; district
or landmark detail can be entered in the visit's existing notes.

## Regeneration and compatibility

Run `node scripts/generate-travel-cities.mjs` using only these bundled files.
No runtime downloads, API keys, tracking, new dependency or storage schema are used.
City remains the existing string paired with explicit `province_id`. Existing
free-text cities (including different spelling or historical county names) are
kept intact in parsing, synchronization, deletion/restoration and exports. Editing
an unmatched city offers `保留原记录：<exact value>` only for its original province.
Changing province clears a city unless it is a valid option in the destination.
