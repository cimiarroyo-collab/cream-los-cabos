import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, existsSync } from "node:fs";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { onRequest as ordersApi } from "../functions/api/orders/[[id]].js";
import { onRequest as membersApi } from "../functions/api/members/[[id]].js";
import { onRequest as sessionApi } from "../functions/api/hub/session.js";
import { verifyLiveFlow, safeCliDiagnostic, TEST_MARKER } from "../scripts/verify-live-flow.mjs";
import { STATUSES, STATIONS } from "../shared/catalog.js";

const hubToken = "fixture-private-hub-secret";
const metadata = { baseURL: "https://cream-fixture.pages.dev", databaseId: "11111111-2222-4333-8444-555555555555", commit: "a".repeat(40), hubToken };

async function fixture(t, { failTracking = false } = {}) {
  const dir = await mkdtemp(join(tmpdir(), "cream-live-flow-"));
  const sql = new DatabaseSync(":memory:");
  sql.exec("PRAGMA foreign_keys = ON");
  sql.exec(readFileSync(new URL("../schema.sql", import.meta.url), "utf8"));
  t.after(async () => { sql.close(); await rm(dir, { recursive: true, force: true }); });
  const DB = { prepare(query) {
    const statement = sql.prepare(query);
    let values = [];
    const prepared = {
      bind(...args) { values = args; return prepared; },
      async first() { return statement.get(...values) || null; },
      async all() { return { results: statement.all(...values) }; },
    };
    return prepared;
  } };
  const env = { DB, HUB_TOKEN: hubToken };
  const requests = [];
  const secrets = [hubToken];
  const fetchImpl = async (url, options) => {
    const request = new Request(url, options);
    const path = new URL(url).pathname;
    requests.push({ path, method: request.method });
    if (["/club", "/hub"].includes(path)) return new Response("Cream", { status: 200 });
    if (failTracking && /^\/api\/orders\/\d+$/.test(path) && request.headers.has("X-Order-Token")) {
      throw new Error(`Private network failure ${request.headers.get("X-Order-Token")}`);
    }
    let response;
    if (path === "/api/hub/session") response = await sessionApi({ env, request });
    else {
      const members = path.startsWith("/api/members");
      const prefix = members ? "/api/members" : "/api/orders";
      response = await (members ? membersApi : ordersApi)({ env, request,
        params: { id: path.slice(prefix.length).split("/").filter(Boolean) } });
    }
    const data = await response.clone().json();
    if (data.trackingToken) secrets.push(data.trackingToken);
    if (request.headers.get("X-Member-Token")) secrets.push(request.headers.get("X-Member-Token"));
    if (response.headers.has("Set-Cookie")) secrets.push(response.headers.get("Set-Cookie").split(";")[0]);
    return response;
  };
  return { sql, requests, secrets, options: { ...metadata, fetchImpl, reportPath: join(dir, "public-e2e.json") } };
}

test("live flow runs real API handlers and SQLite through Club, Hub, every status and both histories", async (t) => {
  const { sql, requests, secrets, options } = await fixture(t);
  const report = await verifyLiveFlow(options);
  assert.deepEqual(report.statusSequence, STATUSES);
  assert.deepEqual(report.stations, STATIONS);
  assert.ok(Object.values(report.checks).every((value) => value === true));
  assert.equal(report.checks.logout, true);
  assert.equal(report.testMarker, TEST_MARKER);
  assert.equal(sql.prepare("SELECT COUNT(*) AS count FROM orders").get().count, 1);
  const order = sql.prepare("SELECT * FROM orders").get();
  assert.equal(order.status, "Entregado");
  assert.equal(order.customer, TEST_MARKER);
  assert.equal(order.phone, "0000000000");
  assert.equal(sql.prepare("SELECT COUNT(*) AS count FROM club_members").get().count, 1);
  assert.equal(requests.filter((request) => request.method === "PATCH").length, 4);
  assert.equal(requests.filter((request) => request.method === "DELETE").length, 1);
  const serialized = await readFile(options.reportPath, "utf8");
  assert.deepEqual(JSON.parse(serialized), report);
  assert.equal((await stat(options.reportPath)).mode & 0o777, 0o600);
  for (const secret of secrets.filter((value) => value !== "cream_hub_session=")) assert.ok(!serialized.includes(secret));
  assert.deepEqual(Object.keys(report).sort(), ["publicURLs", "orderID", "statusSequence", "stations", "sourceCommit", "databaseID", "testMarker", "time", "checks"].sort());
});

test("failed tracking logs out and never exposes private network errors or writes a success report", async (t) => {
  const { options, requests, secrets } = await fixture(t, { failTracking: true });
  await assert.rejects(verifyLiveFlow(options), (error) => {
    assert.equal(error.message, "Verificación pública: solicitud fallida.");
    for (const secret of secrets) assert.ok(!error.message.includes(secret));
    return true;
  });
  assert.equal(requests.filter((request) => request.method === "DELETE").length, 1);
  assert.equal(existsSync(options.reportPath), false);
});

test("live verification refuses workers.dev and malformed metadata before any HTTP request", async () => {
  let calls = 0;
  const fetchImpl = async () => { calls += 1; throw new Error("unexpected network"); };
  for (const overrides of [{ baseURL: "https://cream.workers.dev" }, { baseURL: "https://cream.pages.dev?private-token" },
    { commit: "not-a-commit" }, { databaseId: "not-a-db" }, { hubToken: "short" }]) {
    await assert.rejects(verifyLiveFlow({ ...metadata, ...overrides, fetchImpl }), /Verificación pública:/);
  }
  assert.equal(calls, 0);
});

test("CLI keeps deployment diagnostics while redacting credentials and neutralizing workflow commands", () => {
  const env = { CLOUDFLARE_API_TOKEN: "private-api\ncredential", HUB_TOKEN: "private-hub-credential" };
  const result = safeCliDiagnostic(new Error(`Cloudflare rechazó la cuenta: ${env.CLOUDFLARE_API_TOKEN}\n::error::${env.HUB_TOKEN}\u0000`), env);
  assert.equal(result, "Verificación pública fallida: Cloudflare rechazó la cuenta: [redactado] ::error::[redactado] ");
  assert.ok(!/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/.test(result));
  assert.ok(!result.startsWith("::"));
  assert.equal(safeCliDiagnostic(new Error("x".repeat(1000)), {}).length, "Verificación pública fallida: ".length + 500);
  assert.equal(safeCliDiagnostic({ privateBody: "must not print" }, {}), "Verificación pública fallida: Comprobación fallida.");
});
