import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { onRequest as membersApi } from "../functions/api/members/[[id]].js";
import { onRequest as ordersApi } from "../functions/api/orders/[[id]].js";
import { onRequest as sessionApi } from "../functions/api/hub/session.js";
import { BRANCHES, STATUSES } from "../shared/catalog.js";
import { digest } from "../functions/_lib/api.js";

const origin = "https://cream.example";
const HUB_TOKEN = "cream-private-member-test-session";

function database(t) {
  const sql = new DatabaseSync(":memory:");
  sql.exec("PRAGMA foreign_keys = ON");
  sql.exec(readFileSync(new URL("../schema.sql", import.meta.url), "utf8"));
  t.after(() => sql.close());
  const DB = {
    prepare(query) {
      const statement = sql.prepare(query);
      let values = [];
      const prepared = {
        bind(...args) { values = args; return prepared; },
        async first() { return statement.get(...values) || null; },
        async all() { return { results: statement.all(...values) }; },
      };
      return prepared;
    },
  };
  return { sql, env: { DB, HUB_TOKEN } };
}

function request(path, method = "GET", body, headers = {}) {
  return new Request(`${origin}${path}`, {
    method,
    headers: { ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...headers },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

function call(api, env, prefix, path = prefix, method = "GET", body, headers) {
  return api({
    env,
    request: request(path, method, body, headers),
    params: { id: path.split("?")[0].slice(prefix.length).split("/").filter(Boolean) },
  });
}

const memberCall = (env, path = "/api/members", method = "GET", body, headers) =>
  call(membersApi, env, "/api/members", path, method, body, headers);
const orderCall = (env, path = "/api/orders", method = "GET", body, headers) =>
  call(ordersApi, env, "/api/orders", path, method, body, headers);
const registration = (overrides = {}) => ({
  customer: "María Arroyo", phone: "+52 624 123 4567",
  requestId: crypto.randomUUID(), accessToken: crypto.randomUUID(), ...overrides,
});
const orderInput = (overrides = {}) => ({
  customer: "María Arroyo", branch: BRANCHES[0],
  items: [{ productId: "flat-white", quantity: 1, selections: {} }],
  requestId: crypto.randomUUID(), ...overrides,
});

async function createMember(env, overrides) {
  const payload = registration(overrides);
  const response = await memberCall(env, "/api/members", "POST", payload);
  assert.equal(response.status, 201);
  return { member: await response.json(), payload, headers: { "X-Member-Token": payload.accessToken } };
}

async function login(env) {
  const response = await sessionApi({ env, request: request("/api/hub/session", "POST", { token: HUB_TOKEN }) });
  assert.equal(response.status, 200);
  return { Cookie: response.headers.get("Set-Cookie").split(";")[0] };
}

test("Club cards persist only a hashed private token and return no invented benefits", async (t) => {
  const { env, sql } = database(t);
  const { member, payload } = await createMember(env);
  assert.match(member.id, /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/);
  assert.equal(member.customer, payload.customer);
  assert.equal(member.phone, payload.phone);
  assert.ok(member.createdAt > 0);
  assert.equal(member.updatedAt, member.createdAt);
  assert.equal(member.deliveredCount, 0);
  assert.deepEqual(member.recentOrders, []);
  assert.deepEqual(Object.keys(member).sort(), ["id", "customer", "phone", "createdAt", "updatedAt", "deliveredCount", "recentOrders"].sort());
  const row = sql.prepare("SELECT * FROM club_members").get();
  assert.equal(row.access_token_hash, await digest(payload.accessToken));
  assert.ok(!JSON.stringify(row).includes(payload.accessToken));
  assert.ok(!JSON.stringify(member).includes(payload.accessToken));
});

test("card registration is idempotent, handles races and rejects profile or secret changes", async (t) => {
  const { env, sql } = database(t);
  const body = registration();
  const responses = await Promise.all([
    memberCall(env, "/api/members", "POST", body),
    memberCall(env, "/api/members", "POST", body),
  ]);
  assert.deepEqual(responses.map((response) => response.status).sort(), [200, 201]);
  const first = await responses[0].json();
  assert.deepEqual(first, await responses[1].json());
  for (const change of [{ customer: "Otra persona" }, { phone: "624 987 6543" }, { accessToken: crypto.randomUUID() }]) {
    assert.equal((await memberCall(env, "/api/members", "POST", { ...body, ...change })).status, 409);
  }
  assert.equal(sql.prepare("SELECT COUNT(*) AS total FROM club_members").get().total, 1);
});

test("card reads require the owner's token or signed Hub session; Hub cannot edit profiles", async (t) => {
  const { env } = database(t);
  const { member, headers } = await createMember(env);
  const path = `/api/members/${member.id}`;
  assert.equal((await memberCall(env, path)).status, 404);
  assert.equal((await memberCall(env, path, "GET", undefined, { "X-Member-Token": crypto.randomUUID() })).status, 404);
  const owner = await memberCall(env, path, "GET", undefined, headers);
  assert.equal(owner.status, 200);
  assert.equal(owner.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(await owner.json(), member);
  const hub = await login(env);
  assert.equal((await memberCall(env, path, "GET", undefined, hub)).status, 200);
  assert.equal((await memberCall(env, path, "PATCH", { customer: "Edición por Hub" }, hub)).status, 404);
  assert.equal((await memberCall(env, `/api/members/${crypto.randomUUID()}`, "GET", undefined, hub)).status, 404);
});

test("profile changes persist and preserve ownership and registration retry semantics", async (t) => {
  const { env, sql } = database(t);
  const { member, payload, headers } = await createMember(env);
  const path = `/api/members/${member.id}`;
  t.mock.method(Date, "now", () => member.createdAt + 1000);
  const update = await memberCall(env, path, "PATCH", { customer: "  Cimi Arroyo  ", phone: "624 111 2222" }, headers);
  assert.equal(update.status, 200);
  const edited = await update.json();
  assert.equal(edited.customer, "Cimi Arroyo");
  assert.equal(edited.updatedAt, member.createdAt + 1000);
  assert.equal(edited.createdAt, member.createdAt);
  assert.deepEqual(await (await memberCall(env, path, "GET", undefined, headers)).json(), edited);
  const retry = await memberCall(env, "/api/members", "POST", payload);
  assert.equal(retry.status, 200);
  assert.deepEqual(await retry.json(), edited);
  assert.equal(sql.prepare("SELECT customer FROM club_members WHERE id = ?").get(member.id).customer, "Cimi Arroyo");
});

test("invalid names, phone numbers and UUIDs never create or mutate a card", async (t) => {
  const { env, sql } = database(t);
  for (const invalid of [
    { customer: "" }, { customer: "x" }, { customer: "x".repeat(81) }, { customer: 123 },
    { phone: "624" }, { phone: "1".repeat(16) }, { phone: "abc1234567890" }, { phone: 1234567890 },
    { requestId: "bad" }, { accessToken: "bad" }, { accessToken: "00000000-0000-1000-8000-000000000000" },
  ]) {
    assert.equal((await memberCall(env, "/api/members", "POST", registration(invalid))).status, 400);
  }
  assert.equal(sql.prepare("SELECT COUNT(*) AS total FROM club_members").get().total, 0);
  const { member, headers } = await createMember(env, { phone: "" });
  assert.equal((await memberCall(env, `/api/members/${member.id}`, "PATCH", { customer: "Valid", phone: "bad" }, headers)).status, 400);
  assert.equal(sql.prepare("SELECT phone FROM club_members").get().phone, "");
});

test("member creation and edits enforce same-origin writes without exposing profile data", async (t) => {
  const { env, sql } = database(t);
  const foreign = { Origin: "https://other.example" };
  assert.equal((await memberCall(env, "/api/members", "POST", registration(), foreign)).status, 403);
  assert.equal(sql.prepare("SELECT COUNT(*) AS total FROM club_members").get().total, 0);
  const { member, headers } = await createMember(env);
  assert.equal((await memberCall(env, `/api/members/${member.id}`, "PATCH", { customer: "Cambio" }, { ...headers, ...foreign })).status, 403);
  assert.equal(sql.prepare("SELECT customer FROM club_members").get().customer, member.customer);
});

test("orders associate cards only with a matching private member token", async (t) => {
  const { env, sql } = database(t);
  const { member, headers } = await createMember(env);
  const payload = orderInput({ memberId: member.id });
  for (const invalid of [{}, { "X-Member-Token": crypto.randomUUID() }, await login(env)]) {
    assert.equal((await orderCall(env, "/api/orders", "POST", payload, invalid)).status, 404);
  }
  assert.equal((await orderCall(env, "/api/orders", "POST", { ...payload, memberId: "not-a-card" }, headers)).status, 400);
  assert.equal(sql.prepare("SELECT COUNT(*) AS total FROM orders").get().total, 0);
  const response = await orderCall(env, "/api/orders", "POST", payload, headers);
  assert.equal(response.status, 201);
  const order = await response.json();
  assert.equal(sql.prepare("SELECT member_id FROM orders WHERE id = ?").get(order.id).member_id, member.id);
  assert.ok(!("memberId" in order));
  assert.ok(!("member_id" in order));
  const history = await (await memberCall(env, `/api/members/${member.id}`, "GET", undefined, headers)).json();
  assert.equal(history.deliveredCount, 0);
  assert.deepEqual(history.recentOrders.map(({ id, status }) => ({ id, status })), [{ id: order.id, status: "Nuevo" }]);
  assert.ok(!JSON.stringify(history).includes(order.trackingToken));
});

test("idempotent order retries cannot attach, remove or transfer membership", async (t) => {
  const { env, sql } = database(t);
  const one = await createMember(env);
  const two = await createMember(env);
  const payload = orderInput({ memberId: one.member.id });
  const created = await (await orderCall(env, "/api/orders", "POST", payload, one.headers)).json();
  const retry = await orderCall(env, "/api/orders", "POST", payload, one.headers);
  assert.equal(retry.status, 200);
  assert.deepEqual(await retry.json(), created);
  assert.equal((await orderCall(env, "/api/orders", "POST", payload)).status, 404);
  assert.equal((await orderCall(env, "/api/orders", "POST", { ...payload, memberId: two.member.id }, two.headers)).status, 409);
  const { memberId, ...guestRetry } = payload;
  assert.equal((await orderCall(env, "/api/orders", "POST", guestRetry)).status, 409);
  const guest = orderInput();
  assert.equal((await orderCall(env, "/api/orders", "POST", guest)).status, 201);
  assert.equal((await orderCall(env, "/api/orders", "POST", { ...guest, memberId: one.member.id }, one.headers)).status, 409);
  assert.equal(sql.prepare("SELECT member_id FROM orders WHERE id = ?").get(created.id).member_id, one.member.id);
  assert.equal(sql.prepare("SELECT COUNT(*) AS total FROM orders").get().total, 2);
});

test("private membership history counts actual delivered orders and tracks all operational states", async (t) => {
  const { env } = database(t);
  const one = await createMember(env);
  const two = await createMember(env);
  const order = await (await orderCall(env, "/api/orders", "POST", orderInput({ memberId: one.member.id }), one.headers)).json();
  await orderCall(env, "/api/orders", "POST", orderInput({ memberId: two.member.id }), two.headers);
  await orderCall(env, "/api/orders", "POST", orderInput());
  const hub = await login(env);
  for (let index = 1; index < STATUSES.length; index += 1) {
    const update = await orderCall(env, `/api/orders/${order.id}`, "PATCH", { expectedStatus: STATUSES[index - 1], status: STATUSES[index] }, hub);
    assert.equal(update.status, 200);
    const history = await (await memberCall(env, `/api/members/${one.member.id}`, "GET", undefined, one.headers)).json();
    assert.equal(history.recentOrders.length, 1);
    assert.equal(history.recentOrders[0].status, STATUSES[index]);
    assert.equal(history.deliveredCount, STATUSES[index] === "Entregado" ? 1 : 0);
  }
  assert.equal((await memberCall(env, `/api/members/${one.member.id}`, "GET", undefined, two.headers)).status, 404);
  assert.equal((await orderCall(env, `/api/orders/${order.id}`, "GET", undefined, one.headers)).status, 404);
  const tracked = await orderCall(env, `/api/orders/${order.id}`, "GET", undefined, { "X-Order-Token": order.trackingToken });
  assert.equal(tracked.status, 200);
  assert.equal((await tracked.json()).status, "Entregado");
});

test("card history bounds recent results while retaining the full delivered count", async (t) => {
  const { env, sql } = database(t);
  const { member, headers } = await createMember(env);
  const insert = sql.prepare("INSERT INTO orders (customer, branch, items, status, total, created_at, updated_at, member_id) VALUES (?, ?, '[]', 'Entregado', 0, ?, ?, ?)");
  for (let index = 0; index < 35; index += 1) insert.run(member.customer, BRANCHES[0], index + 1, index + 2, member.id);
  const history = await (await memberCall(env, `/api/members/${member.id}`, "GET", undefined, headers)).json();
  assert.equal(history.deliveredCount, 35);
  assert.equal(history.recentOrders.length, 30);
  assert.equal(history.recentOrders[0].createdAt, 35);
  assert.equal(history.recentOrders.at(-1).createdAt, 6);
});

test("member routes reject unsupported methods, malformed IDs and oversized or non-JSON input", async (t) => {
  const { env } = database(t);
  const unsupported = await memberCall(env);
  assert.equal(unsupported.status, 405);
  assert.equal(unsupported.headers.get("Allow"), "POST");
  assert.equal((await memberCall(env, "/api/members", "DELETE")).status, 405);
  assert.equal((await memberCall(env, "/api/members/bad")).status, 404);
  assert.equal((await memberCall(env, `/api/members/${crypto.randomUUID()}/extra`)).status, 404);
  assert.equal((await memberCall(env, `/api/members/${crypto.randomUUID()}`, "POST", registration())).status, 405);
  const send = (body, type = "application/json") => membersApi({ env, params: {}, request: new Request(`${origin}/api/members`, { method: "POST", body, headers: { "Content-Type": type } }) });
  assert.equal((await send("{")).status, 400);
  assert.equal((await send("[]")).status, 400);
  assert.equal((await send("{}", "text/plain")).status, 415);
  assert.equal((await send(JSON.stringify({ padding: "x".repeat(5 * 1024) }))).status, 413);
  assert.equal((await memberCall({}, "/api/members", "POST", registration())).status, 503);
});
