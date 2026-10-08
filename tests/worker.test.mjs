import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createWorker } from "../worker/router.mjs";
import { requireWorkerTarget, assertExistingWorker, inspectExistingDatabase, makeWorkerConfig, selectPreviousDeployment, uploadedVersion, main } from "../scripts/update-existing-worker.mjs";

const databaseId = "11111111-2222-4333-8444-555555555555";
const target = { CLOUDFLARE_API_TOKEN: "private-token-fixture", CLOUDFLARE_ACCOUNT_ID: "a".repeat(32), CREAM_D1_DATABASE_ID: databaseId };
const settings = () => ({ bindings: [
  { name: "DB", type: "d1", id: databaseId },
  { name: "ASSETS", type: "assets" },
  { name: "HUB_TOKEN", type: "secret_text" },
  { name: "EXISTING_VAR", type: "plain_text" },
] });
const database = { name: "cream-los-cabos-preview", uuid: databaseId };

test("existing Worker adapter sends only API routes to Pages Functions", async () => {
  const requests = [];
  const ctx = {};
  const env = { ASSETS: { fetch: async (request) => { requests.push(["asset", request.url]); return new Response("asset"); } } };
  const worker = createWorker({ fetch: async (request, receivedEnv, receivedCtx) => {
    assert.equal(receivedEnv, env);
    assert.equal(receivedCtx, ctx);
    requests.push(["api", request.url]);
    return new Response("api", { status: 401 });
  } });
  for (const path of ["/club", "/hub", "/photos/food.jpg", "/apiary", "/api", "/api/orders", "/api/members/123"]) {
    const result = await worker.fetch(new Request(`https://cream.example${path}`), env, ctx);
    assert.equal(result.status, path === "/api" || path.startsWith("/api/") ? 401 : 200);
  }
  assert.deepEqual(requests.map(([kind]) => kind), ["asset", "asset", "asset", "asset", "api", "api", "api"]);
});

test("API runtime failures return a private service error and never expose assets or exception data", async () => {
  let assetsCalled = false;
  const worker = createWorker({ fetch: async () => { throw new Error("private-database-details"); } });
  const response = await worker.fetch(new Request("https://cream.example/api/orders"), { ASSETS: { fetch: async () => { assetsCalled = true; } } }, {});
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
  assert.equal(assetsCalled, false);
  assert.ok(!(await response.text()).includes("private-database-details"));
});

test("Worker adapter preserves API Origin, private headers, request body and secure session response", async () => {
  const request = new Request("https://cream.example/api/hub/session", {
    method: "POST",
    headers: { Origin: "https://cream.example", "Content-Type": "application/json", "X-Member-Token": "private-member-fixture" },
    body: JSON.stringify({ token: "private-hub-fixture" }),
  });
  const expected = new Response("{}", { headers: { "Set-Cookie": "cream_hub=fixture; HttpOnly; Secure; SameSite=Strict", "Cache-Control": "no-store" } });
  const worker = createWorker({ fetch: async (original) => {
    assert.equal(original, request);
    assert.equal(original.url, "https://cream.example/api/hub/session");
    assert.equal(original.headers.get("Origin"), "https://cream.example");
    assert.equal(original.headers.get("X-Member-Token"), "private-member-fixture");
    assert.deepEqual(await original.json(), { token: "private-hub-fixture" });
    return expected;
  } });
  assert.equal(await worker.fetch(request, {}, {}), expected);
  assert.match(expected.headers.get("Set-Cookie"), /HttpOnly; Secure; SameSite=Strict/);
});

test("Worker update requires genuine authorization and a real existing D1 before network access", async (context) => {
  const previousFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; throw new Error("Unexpected request"); };
  context.after(() => { globalThis.fetch = previousFetch; });
  await assert.rejects(main(["--deploy"], {}), /No se modificó Cloudflare/);
  assert.equal(calls, 0);
  assert.deepEqual(requireWorkerTarget(target), { apiToken: target.CLOUDFLARE_API_TOKEN, accountId: target.CLOUDFLARE_ACCOUNT_ID, databaseId });
  for (const invalid of [{}, { ...target, CLOUDFLARE_ACCOUNT_ID: "invalid-private-account" }, { ...target, CREAM_D1_DATABASE_ID: "00000000-0000-0000-0000-000000000000" }, { ...target, CREAM_D1_DATABASE_ID: "wrong-database" }]) {
    assert.throws(() => requireWorkerTarget(invalid), (error) => !error.message.includes(target.CLOUDFLARE_API_TOKEN) && !error.message.includes("invalid-private-account"));
  }
});

test("Worker preflight preserves matching DB, assets, secrets, variables and public subdomain", () => {
  const original = settings();
  const before = structuredClone(original);
  assert.doesNotThrow(() => assertExistingWorker(original, database, databaseId, { enabled: true }));
  assert.deepEqual(original, before);
});

test("Worker preflight rejects missing resources, database redirects, lost secrets and extra bindings", () => {
  for (const wrongDatabase of [null, { ...database, name: "another-application" }, { ...database, uuid: "another-database" }]) {
    assert.throws(() => assertExistingWorker(settings(), wrongDatabase, databaseId, { enabled: true }), /D1 existente/);
  }
  const wrongBinding = settings();
  wrongBinding.bindings[0].id = "another-database";
  assert.throws(() => assertExistingWorker(wrongBinding, database, databaseId, { enabled: true }), /binding DB/);
  for (const name of ["ASSETS", "HUB_TOKEN"]) {
    const missing = { bindings: settings().bindings.filter((binding) => binding.name !== name) };
    assert.throws(() => assertExistingWorker(missing, database, databaseId, { enabled: true }), new RegExp(name));
  }
  const extra = settings();
  extra.bindings.push({ name: "EXTERNAL_DB", type: "d1", id: "foreign" });
  assert.throws(() => assertExistingWorker(extra, database, databaseId, { enabled: true }), /bindings adicionales/);
  assert.throws(() => assertExistingWorker(settings(), database, databaseId, { enabled: false }), /workers.dev está deshabilitado/);
});

test("Worker configuration changes only the D1 placeholder and keeps Pages API asset boundaries", async () => {
  const template = JSON.parse(await readFile(new URL("../worker/wrangler.example.json", import.meta.url), "utf8"));
  const unchanged = structuredClone(template);
  const config = makeWorkerConfig(template, databaseId);
  assert.equal(config.d1_databases[0].database_id, databaseId);
  config.d1_databases[0].database_id = unchanged.d1_databases[0].database_id;
  assert.deepEqual(config, unchanged);
  assert.deepEqual(template, unchanged);
  assert.deepEqual(config.assets.run_worker_first, ["/api", "/api/*"]);
  assert.equal(config.keep_vars, true);
  assert.throws(() => makeWorkerConfig({ ...template, name: "another-worker" }, databaseId), /no corresponden/);
  assert.throws(() => makeWorkerConfig(template, "invalid-database-id"), /no corresponden/);
});

test("Worker D1 preflight reads schema and refuses an empty or unrelated database", async () => {
  const columns = [{ name: "id", type: "INTEGER", pk: 1 }, ...["customer", "branch", "items", "status", "total", "created_at"].map((name) => ({ name, type: "TEXT", pk: 0 }))];
  const query = (tableNames, orderColumns) => async (path, options) => {
    assert.equal(path, `/d1/database/${databaseId}/query`);
    assert.equal(options.method, "POST");
    assert.ok(options.body.sql.startsWith("SELECT") || options.body.sql.startsWith("PRAGMA"));
    return [{ success: true, results: options.body.sql.startsWith("PRAGMA") ? orderColumns : tableNames.map((name) => ({ name })) }];
  };
  await inspectExistingDatabase(query(["orders"], columns), databaseId);
  await assert.rejects(inspectExistingDatabase(query([], []), databaseId), /no tiene la tabla orders/);
  await assert.rejects(inspectExistingDatabase(query(["orders", "another_application"], columns), databaseId), /otra aplicación/);
});

test("Worker rollback requires one identifiable prior version serving all traffic", () => {
  const previous = { id: "deployment-fixture", versions: [{ version_id: databaseId, percentage: 100 }] };
  assert.equal(selectPreviousDeployment({ deployments: [previous] }), previous);
  for (const invalid of [{}, { deployments: [] }, { deployments: [{ versions: [{ version_id: "unknown", percentage: 100 }] }] }, { deployments: [{ versions: [{ version_id: databaseId, percentage: 50 }] }] }, { deployments: [{ versions: [...previous.versions, ...previous.versions] }] }]) {
    assert.throws(() => selectPreviousDeployment(invalid), /versión anterior al 100%/);
  }
});

test("Worker update selects the actual structured uploaded version, never a dry run or another Worker", () => {
  const entry = { type: "version-upload", worker_name: "cream-los-cabos-preview", version_id: databaseId };
  const output = `${JSON.stringify({ ...entry, version_id: null })}\n${JSON.stringify(entry)}\n`;
  assert.equal(uploadedVersion(output), databaseId);
  for (const invalid of ["", JSON.stringify({ ...entry, version_id: null }), JSON.stringify({ ...entry, worker_name: "another-worker" }), `${JSON.stringify(entry)}\n${JSON.stringify(entry)}`]) {
    assert.throws(() => uploadedVersion(invalid), /No se cambió el tráfico/);
  }
});
