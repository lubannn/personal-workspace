// Sources/permissions and the two source excerpts are documented beside the data.
// Entirely offline: regenerate the shipped 34 province-scoped option lists.
import { readFileSync, writeFileSync } from "node:fs";
const root = new URL("../src/lib/github-data/travel-city-data/", import.meta.url);
const read = name => JSON.parse(readFileSync(new URL(name, root), "utf8"));
const municipalities = new Set(["11", "12", "31", "50"]);
const provinces = read("mainland-provinces.source.json");
const cities = read("mainland-cities.source.json");
const direct = read("mainland-direct-units.source.json");
const options = Object.fromEntries(provinces.map(p => [p.code + "0000", []]));
for (const city of cities) {
  if (!city.code.startsWith(city.provinceCode) || !options[city.provinceCode + "0000"]) throw Error("Invalid source province");
  // Replace municipality statistics buckets with the municipality itself.
  // Expand aggregate direct-admin buckets into their real county-level units.
  if (!municipalities.has(city.provinceCode) && !city.code.endsWith("90")) options[city.provinceCode + "0000"].push(city.name);
}
for (const unit of direct) {
  if (!cities.some(c => c.code === unit.cityCode && c.provinceCode === unit.provinceCode) || !unit.code.startsWith(unit.cityCode)) throw Error("Invalid direct unit");
  options[unit.provinceCode + "0000"].push(unit.name);
}
for (const p of provinces.filter(p => municipalities.has(p.code))) options[p.code + "0000"] = [p.name];
// The Taiwan source also contains two postal geographic buckets, not counties.
options["710000"] = read("taiwan-counties.source.json").filter(name => /[市縣]$/u.test(name));
options["810000"] = ["香港"];
options["820000"] = ["澳门"];
if (Object.keys(options).length !== 34 || options["710000"].length !== 22) throw Error("Incomplete province scope");
for (const cities of Object.values(options)) if (!cities.length || new Set(cities).size !== cities.length) throw Error("Empty/duplicate options");
writeFileSync(new URL("cities.json", root), JSON.stringify(options, null, 2) + "\n");
console.log(`${Object.keys(options).length} province units, ${Object.values(options).flat().length} city/region options`);
