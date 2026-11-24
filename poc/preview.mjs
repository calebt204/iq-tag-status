// Local preview: render poc/sample.json (or a saved API response) to poc/preview.html
//
//   node poc/preview.mjs                      # uses poc/sample.json
//   node poc/preview.mjs path/to/resp.json    # your own saved response
//   open poc/preview.html

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderUnitPage } from "./render.mjs";

const dir = dirname(fileURLToPath(import.meta.url));
const input = process.argv[2] ?? join(dir, "sample.json");
const config = JSON.parse(readFileSync(input, "utf8"));
const out = join(dir, "preview.html");

writeFileSync(out, renderUnitPage(config, config.units?.[0]?.id));
console.log("wrote", out);
