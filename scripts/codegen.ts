/**
 * Pulls the LIVE OpenAPI spec from production and vendors it into spec/openapi.json.
 * The committed spec is the snapshot the SDK's types are validated against; CI
 * (openapi-sync.yml) re-runs this and fails if the snapshot drifts from prod,
 * so the SDK can never silently fall behind the deployed backend.
 *
 * Run: npm run codegen
 *
 * (A future step pipes spec/openapi.json through `openapi-typescript` to
 * regenerate src/generated/. For v0.1 the hand-written client in src/ is the
 * source of truth and this script keeps the spec snapshot honest.)
 */
import * as fs from "node:fs";
import * as path from "node:path";

const SPEC_URL = process.env.OSMODA_SPEC_URL || "https://spawn.os.moda/api/v1/docs";
const OUT = path.join(import.meta.dirname, "..", "spec", "openapi.json");

const res = await fetch(SPEC_URL);
if (!res.ok) {
  console.error(`Failed to fetch spec: HTTP ${res.status}`);
  process.exit(1);
}
const spec = await res.json();
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(spec, null, 2) + "\n");
console.log(`Wrote ${OUT} (OpenAPI ${spec.info?.version ?? "?"}, ${Object.keys(spec.paths ?? {}).length} paths)`);
