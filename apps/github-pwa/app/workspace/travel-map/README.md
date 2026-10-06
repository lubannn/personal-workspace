# Static China province boundaries

Source: Apache ECharts (incubating) **4.9.0** `map/json/china.json`:
https://github.com/apache/echarts/blob/4.9.0/map/json/china.json

The upstream file is retained verbatim as `china.source.json` (SHA-256
`d392f651a48e6213c9bfc83f406711069de296c17f426cffc0ad1148078ee226`).
Upstream Apache-2.0 LICENSE and NOTICE are retained alongside it. Copyright
2017–2020 The Apache Software Foundation. Source is historical and illustrative,
not an authoritative or current legal boundary reference.

`node scripts/generate-travel-map.mjs` decodes the upstream UTF8-encoded GeoJSON,
projects longitude/latitude to SVG coordinates, and simplifies each ring to
0.25 SVG units. `provinces.json` contains all 34 upstream province-level features,
including municipalities, autonomous regions, Taiwan, Hong Kong and Macao.
No external map API, telemetry, or runtime geography fetch is used. Province codes
are explicit stored identifiers; city text is never used to infer a province.
The original source does not supply a separate South China Sea inset; this is a
province visit illustration, not a complete national boundary map.
