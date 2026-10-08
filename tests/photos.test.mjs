import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { PRODUCTS } from "../shared/catalog.js";

const publicRoot = resolve("public");
test("Every menu product has a local photograph, descriptive alt text and published provenance", () => {
  const sources = ["food", "drinks"].flatMap(group => JSON.parse(readFileSync(`${publicRoot}/photos/${group}/SOURCES.json`, "utf8")));
  const credited = new Map(sources.map(record => [record.image, record]));
  assert.equal(PRODUCTS.length, 255);
  for (const product of PRODUCTS) {
    assert.match(product.image, /^\/(?:photos|brand|images)\/.*\.(?:jpe?g|png|webp)$/i, `${product.id} needs a photograph`);
    assert.ok(typeof product.imageAlt === "string" && product.imageAlt.length > 10, `${product.id} needs descriptive alt text`);
    const path = resolve(publicRoot, `.${product.image}`);
    assert.ok(path.startsWith(`${publicRoot}/`));
    const bytes = readFileSync(path);
    const photograph = bytes[0] === 0xff && bytes[1] === 0xd8 || bytes.subarray(1, 4).toString() === "PNG" || bytes.subarray(8, 12).toString() === "WEBP";
    assert.ok(photograph, `${product.image} must contain image data`);
    const source = credited.get(product.image);
    assert.ok(source?.sourceURL && source?.license, `${product.id} needs source and license credits`);
  }
});

test("Generated references are explicitly disclosed and unsupported illustrations are absent from the catalog", () => {
  const sources = ["food", "drinks"].flatMap(group => JSON.parse(readFileSync(`${publicRoot}/photos/${group}/SOURCES.json`, "utf8")));
  const generated = sources.filter(record => record.generated || record.sourceType === "generated-reference");
  assert.equal(new Set(generated.map(record => record.image)).size, 9);
  for (const source of generated) {
    assert.match(`${source.title} ${source.license} ${source.disclosure || ""}`, /generat|generad/i);
    const provenance = JSON.parse(readFileSync(`${publicRoot}${source.image.replace(/\.(?:jpg|png)$/, ".source.json")}`, "utf8"));
    assert.match(provenance.disclosure, /no es|not .*actual/i);
  }
  assert.ok(PRODUCTS.every(product => !product.image.endsWith(".svg")));
});
