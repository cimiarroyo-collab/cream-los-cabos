import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { onRequest as ordersApi } from "../functions/api/orders/[[id]].js";
import { onRequest as sessionApi } from "../functions/api/hub/session.js";
import { BRANCHES, PRODUCTS, STATUSES } from "../shared/catalog.js";

const HUB_TOKEN = "local-test-hub-secret-cream";
const origin = "https://cream.example";

// Execute actual SQLite statements, using the asynchronous prepared-statement shape of D1.
function database(t, legacy = false) {
  const sql = new DatabaseSync(":memory:");
  t.after(() => sql.close());
  if (legacy) {
    sql.exec(
      readFileSync(
        new URL("../migrations/0001_original_orders.sql", import.meta.url),
        "utf8",
      ),
    );
  } else {
    sql.exec(readFileSync(new URL("../schema.sql", import.meta.url), "utf8"));
  }
  const DB = {
    prepare(query) {
      const statement = sql.prepare(query);
      let values = [];
      const prepared = {
        bind(...args) {
          values = args;
          return prepared;
        },
        async first() {
          return statement.get(...values) || null;
        },
        async all() {
          return { results: statement.all(...values) };
        },
        async run() {
          const info = statement.run(...values);
          return { meta: { changes: info.changes } };
        },
      };
      return prepared;
    },
  };
  return { sql, DB, env: { DB, HUB_TOKEN } };
}

function input(overrides = {}) {
  const product = PRODUCTS[0];
  return {
    customer: "María Arroyo",
    phone: "+52 624 123 4567",
    branch: BRANCHES[0],
    items: [
      {
        productId: product.id,
        quantity: 2,
        selections: {},
        note: "Para llevar",
      },
    ],
    note: "Sin cubiertos",
    requestId: crypto.randomUUID(),
    ...overrides,
  };
}

function request(path, method = "GET", body, headers = {}, base = origin) {
  return new Request(`${base}${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...headers,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

function call(env, path = "/api/orders", method = "GET", body, headers = {}) {
  const parts = path
    .split("?")[0]
    .replace("/api/orders", "")
    .split("/")
    .filter(Boolean);
  return ordersApi({
    env,
    request: request(path, method, body, headers),
    params: { id: parts },
  });
}

async function login(env, base = origin) {
  const response = await sessionApi({
    env,
    request: request(
      "/api/hub/session",
      "POST",
      { token: HUB_TOKEN },
      {},
      base,
    ),
  });
  assert.equal(response.status, 200);
  return response.headers.get("Set-Cookie").split(";")[0];
}

test("create prices and station assignments come from the server catalog", async (t) => {
  const { env, sql } = database(t);
  const order = input({ total: 0.01, status: "Entregado" });
  order.items[0].unitPrice = 0.01;
  order.items[0].station = "Otro";
  const response = await call(env, "/api/orders", "POST", order);
  assert.equal(response.status, 201);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  const created = await response.json();
  assert.equal(created.status, "Nuevo");
  assert.equal(created.items[0].unitPrice, PRODUCTS[0].price);
  assert.equal(created.items[0].station, PRODUCTS[0].station);
  assert.equal(created.total, PRODUCTS[0].price * 2);
  assert.match(created.trackingToken, /^[\da-f-]{36}$/);
  assert.ok(created.createdAt > 0);
  assert.equal(created.createdAt, created.updatedAt);
  assert.equal(sql.prepare("SELECT count(*) AS n FROM orders").get().n, 1);
});

test("selected customization prices are retained for operational preparation", async (t) => {
  const { env } = database(t);
  const product = PRODUCTS.find((entry) =>
    entry.options.some((group) =>
      group.values.some((option) => option.price > 0),
    ),
  );
  assert.ok(product, "The menu must include at least one paid customization");
  const selections = {};
  let unitPrice = product.price;
  for (const group of product.options) {
    const selected =
      group.values.find((option) => option.price > 0) || group.values[0];
    selections[group.id] = selected.id;
    unitPrice += selected.price;
  }
  const response = await call(
    env,
    "/api/orders",
    "POST",
    input({
      items: [
        {
          productId: product.id,
          quantity: 3,
          selections,
          note: "Bien caliente",
        },
      ],
    }),
  );
  assert.equal(response.status, 201);
  const created = await response.json();
  assert.equal(created.total, unitPrice * 3);
  assert.deepEqual(created.items[0].selections, selections);
  assert.equal(created.items[0].note, "Bien caliente");
  assert.equal(created.items[0].options.length, product.options.length);
});

test("matching idempotent retries keep the same order and tracking secret", async (t) => {
  const { env, sql } = database(t);
  const body = input();
  const first = await call(env, "/api/orders", "POST", body);
  const second = await call(env, "/api/orders", "POST", body);
  assert.equal(first.status, 201);
  assert.equal(second.status, 200);
  assert.deepEqual(await first.json(), await second.json());
  assert.equal(sql.prepare("SELECT count(*) AS n FROM orders").get().n, 1);
  const conflict = await call(env, "/api/orders", "POST", {
    ...body,
    customer: "Otra persona",
  });
  assert.equal(conflict.status, 409);
});

test("racing POST retries insert only one order", async (t) => {
  const { env, sql } = database(t);
  const body = input();
  const responses = await Promise.all([
    call(env, "/api/orders", "POST", body),
    call(env, "/api/orders", "POST", body),
  ]);
  assert.deepEqual(responses.map((res) => res.status).sort(), [200, 201]);
  assert.deepEqual(await responses[0].json(), await responses[1].json());
  assert.equal(sql.prepare("SELECT count(*) AS n FROM orders").get().n, 1);
});

test("a retry after a menu price change returns the original paid total", async (t) => {
  const { env } = database(t);
  const body = input();
  const original = await (await call(env, "/api/orders", "POST", body)).json();
  const product = PRODUCTS[0];
  const previousPrice = product.price;
  t.after(() => {
    product.price = previousPrice;
  });
  product.price += 10;
  const retry = await call(env, "/api/orders", "POST", body);
  assert.equal(retry.status, 200);
  assert.deepEqual(await retry.json(), original);
});

test("order tracking is private and does not reveal secrets in the response", async (t) => {
  const { env } = database(t);
  const one = await (await call(env, "/api/orders", "POST", input())).json();
  const two = await (await call(env, "/api/orders", "POST", input())).json();
  assert.equal((await call(env, `/api/orders/${one.id}`)).status, 404);
  assert.equal(
    (
      await call(env, `/api/orders/${one.id}`, "GET", undefined, {
        "X-Order-Token": two.trackingToken,
      })
    ).status,
    404,
  );
  const tracked = await call(env, `/api/orders/${one.id}`, "GET", undefined, {
    "X-Order-Token": one.trackingToken,
  });
  assert.equal(tracked.status, 200);
  const body = await tracked.json();
  assert.equal(body.customer, one.customer);
  for (const key of [
    "trackingToken",
    "tracking_token",
    "request_id",
    "payload_hash",
  ])
    assert.ok(!(key in body));
});

test("Hub listing and status changes require an authenticated session", async (t) => {
  const { env } = database(t);
  const created = await (
    await call(env, "/api/orders", "POST", input())
  ).json();
  assert.equal((await call(env)).status, 401);
  assert.equal(
    (
      await call(env, `/api/orders/${created.id}`, "PATCH", {
        status: "Confirmado",
        expectedStatus: "Nuevo",
      })
    ).status,
    401,
  );
  const cookie = await login(env);
  const listing = await call(env, "/api/orders", "GET", undefined, {
    Cookie: cookie,
  });
  assert.equal(listing.status, 200);
  const [listed] = await listing.json();
  assert.equal(listed.id, created.id);
  for (const key of [
    "trackingToken",
    "tracking_token",
    "request_id",
    "payload_hash",
  ])
    assert.ok(!(key in listed));
});

test("Hub orders filter by exact branch and reject invalid branches", async (t) => {
  const { env } = database(t);
  await call(env, "/api/orders", "POST", input({ branch: BRANCHES[0] }));
  await call(env, "/api/orders", "POST", input({ branch: BRANCHES[1] }));
  const cookie = await login(env);
  const response = await call(
    env,
    `/api/orders?branch=${encodeURIComponent(BRANCHES[1])}`,
    "GET",
    undefined,
    { Cookie: cookie },
  );
  assert.equal(response.status, 200);
  const rows = await response.json();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].branch, BRANCHES[1]);
  assert.equal(
    (
      await call(env, "/api/orders?branch=Unknown", "GET", undefined, {
        Cookie: cookie,
      })
    ).status,
    400,
  );
});

test("Hub retains old orders delivered today and excludes orders completed over a day ago", async (t) => {
  const { env, sql } = database(t);
  const clock = Date.now();
  const daysAgo = clock - 3 * 24 * 60 * 60 * 1000;
  const old = await (await call(env, "/api/orders", "POST", input())).json();
  const expired = await (await call(env, "/api/orders", "POST", input())).json();
  sql.prepare("UPDATE orders SET created_at = ?, updated_at = ?, status = 'Listo' WHERE id = ?").run(daysAgo, daysAgo, old.id);
  sql.prepare("UPDATE orders SET created_at = ?, updated_at = ?, status = 'Entregado' WHERE id = ?").run(daysAgo, daysAgo, expired.id);
  const cookie = await login(env);
  const delivered = await call(env, `/api/orders/${old.id}`, "PATCH", { expectedStatus: "Listo", status: "Entregado" }, { Cookie: cookie });
  assert.equal(delivered.status, 200);
  const rows = await (await call(env, "/api/orders", "GET", undefined, { Cookie: cookie })).json();
  assert.deepEqual(rows.map((row) => row.id), [old.id]);
  assert.equal(rows[0].status, "Entregado");
});

test("the complete state machine allows only successive steps and detects stale writes", async (t) => {
  const { env } = database(t);
  const created = await (
    await call(env, "/api/orders", "POST", input())
  ).json();
  const cookie = await login(env);
  const change = (expectedStatus, status) =>
    call(
      env,
      `/api/orders/${created.id}`,
      "PATCH",
      { expectedStatus, status },
      { Cookie: cookie },
    );
  assert.equal((await change("Nuevo", "Listo")).status, 400);
  let previous = created;
  for (let i = 1; i < STATUSES.length; i += 1) {
    const response = await change(STATUSES[i - 1], STATUSES[i]);
    assert.equal(response.status, 200);
    const updated = await response.json();
    assert.equal(updated.status, STATUSES[i]);
    assert.ok(updated.updatedAt >= previous.updatedAt);
    assert.equal((await change(STATUSES[i - 1], STATUSES[i])).status, 409);
    previous = updated;
  }
  assert.equal((await change("Entregado", "Nuevo")).status, 400);
  const tracked = await (
    await call(env, `/api/orders/${created.id}`, "GET", undefined, {
      "X-Order-Token": created.trackingToken,
    })
  ).json();
  assert.equal(tracked.status, "Entregado");
});

test("concurrent status updates allow exactly one operator to advance", async (t) => {
  const { env } = database(t);
  const created = await (
    await call(env, "/api/orders", "POST", input())
  ).json();
  const cookie = await login(env);
  const responses = await Promise.all(
    [0, 1].map(() =>
      call(
        env,
        `/api/orders/${created.id}`,
        "PATCH",
        { expectedStatus: "Nuevo", status: "Confirmado" },
        { Cookie: cookie },
      ),
    ),
  );
  assert.deepEqual(responses.map((res) => res.status).sort(), [200, 409]);
});

test("invalid order data never inserts into the database", async (t) => {
  const { env, sql } = database(t);
  const invalid = [
    { customer: "" },
    { branch: "Unknown" },
    { items: [] },
    { requestId: "bad-id" },
    { items: [{ productId: "unknown", quantity: 1, selections: {} }] },
    { items: [{ productId: PRODUCTS[0].id, quantity: 0, selections: {} }] },
    { items: [{ productId: PRODUCTS[0].id, quantity: 1.5, selections: {} }] },
    { items: [{ productId: PRODUCTS[0].id, quantity: 1000, selections: {} }] },
    {
      items: [
        {
          productId: PRODUCTS[0].id,
          quantity: 1,
          selections: { unknown: "unknown" },
        },
      ],
    },
  ];
  for (const overrides of invalid) {
    const response = await call(env, "/api/orders", "POST", input(overrides));
    assert.equal(response.status, 400, JSON.stringify(overrides));
    assert.equal(typeof (await response.json()).error, "string");
  }
  assert.equal(sql.prepare("SELECT count(*) AS n FROM orders").get().n, 0);
});

test("sessions use signed HttpOnly cookies, expire, and work on local HTTP", async (t) => {
  const { env } = database(t);
  const loginResponse = await sessionApi({
    env,
    request: request("/api/hub/session", "POST", { token: HUB_TOKEN }),
  });
  const header = loginResponse.headers.get("Set-Cookie");
  assert.match(header, /HttpOnly/);
  assert.match(header, /SameSite=Strict/);
  assert.match(header, /Secure/);
  assert.ok(!header.includes(HUB_TOKEN));
  const cookie = header.split(";")[0];
  const state = await sessionApi({
    env,
    request: request("/api/hub/session", "GET", undefined, { Cookie: cookie }),
  });
  assert.deepEqual(await state.json(), {
    authenticated: true,
    configured: true,
  });
  const altered = `${cookie.slice(0, -1)}${cookie.endsWith("0") ? "1" : "0"}`;
  assert.equal(
    (
      await (
        await sessionApi({
          env,
          request: request("/api/hub/session", "GET", undefined, {
            Cookie: altered,
          }),
        })
      ).json()
    ).authenticated,
    false,
  );
  const local = await sessionApi({
    env,
    request: request(
      "/api/hub/session",
      "POST",
      { token: HUB_TOKEN },
      {},
      "http://localhost:8788",
    ),
  });
  assert.equal(local.status, 200);
  assert.ok(!local.headers.get("Set-Cookie").includes("Secure"));
  const clock = Date.now();
  t.mock.method(Date, "now", () => clock + 9 * 60 * 60 * 1000);
  assert.equal(
    (
      await (
        await sessionApi({
          env,
          request: request("/api/hub/session", "GET", undefined, {
            Cookie: cookie,
          }),
        })
      ).json()
    ).authenticated,
    false,
  );
});

test("incorrect Hub passwords fail and logout expires the session cookie", async (t) => {
  const { env } = database(t);
  const wrong = await sessionApi({
    env,
    request: request("/api/hub/session", "POST", { token: "wrong-password" }),
  });
  assert.equal(wrong.status, 401);
  assert.equal(wrong.headers.get("Set-Cookie"), null);
  const loggedOut = await sessionApi({
    env,
    request: request("/api/hub/session", "DELETE"),
  });
  assert.equal(loggedOut.status, 200);
  assert.match(loggedOut.headers.get("Set-Cookie"), /Max-Age=0/);
});

test("missing DB and missing or weak Hub secrets fail without demo access", async (t) => {
  const { env } = database(t);
  assert.equal((await call({}, "/api/orders", "POST", input())).status, 503);
  assert.equal((await call({ DB: env.DB })).status, 503);
  assert.equal((await call({ DB: env.DB, HUB_TOKEN: "short" })).status, 503);
  const session = await sessionApi({
    env: {},
    request: request("/api/hub/session"),
  });
  assert.deepEqual(await session.json(), {
    authenticated: false,
    configured: false,
  });
  const loginResponse = await sessionApi({
    env: {},
    request: request("/api/hub/session", "POST", { token: HUB_TOKEN }),
  });
  assert.equal(loginResponse.status, 503);
});

test("cross-origin order changes and sessions are blocked", async (t) => {
  const { env, sql } = database(t);
  const badOrigin = { Origin: "https://other.example" };
  assert.equal(
    (await call(env, "/api/orders", "POST", input(), badOrigin)).status,
    403,
  );
  assert.equal(sql.prepare("SELECT count(*) AS n FROM orders").get().n, 0);
  const session = await sessionApi({
    env,
    request: request(
      "/api/hub/session",
      "POST",
      { token: HUB_TOKEN },
      badOrigin,
    ),
  });
  assert.equal(session.status, 403);
  const logout = await sessionApi({
    env,
    request: request("/api/hub/session", "DELETE", undefined, badOrigin),
  });
  assert.equal(logout.status, 403);
});

test("malformed, non-JSON and oversized request bodies return explicit client errors", async (t) => {
  const { env } = database(t);
  const send = (body, type = "application/json") =>
    ordersApi({
      env,
      params: {},
      request: new Request(`${origin}/api/orders`, {
        method: "POST",
        body,
        headers: { "Content-Type": type },
      }),
    });
  assert.equal((await send("{")).status, 400);
  assert.equal((await send("null")).status, 400);
  assert.equal((await send("[]")).status, 400);
  assert.equal((await send("{}", "text/plain")).status, 415);
  assert.equal(
    (await send(JSON.stringify({ note: "x".repeat(25 * 1024) }))).status,
    413,
  );
});

test("unavailable methods and malformed IDs do not reach storage", async (t) => {
  const { env } = database(t);
  const method = await call(env, "/api/orders", "DELETE");
  assert.equal(method.status, 405);
  assert.equal(method.headers.get("Allow"), "GET, POST");
  assert.equal((await call(env, "/api/orders/abc")).status, 404);
  assert.equal((await call(env, "/api/orders/1/2")).status, 404);
  assert.equal((await call(env, "/api/orders/1", "POST", input())).status, 405);
  assert.equal(
    (await call(env, "/api/orders", "PATCH", { status: "Nuevo" })).status,
    405,
  );
});

test("additive migrations preserve legacy orders and render tuple items for Hub", async (t) => {
  const { env, sql } = database(t, true);
  sql
    .prepare(
      "INSERT INTO orders (customer, branch, items, status, total, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .run(
      "Cliente original",
      BRANCHES[0],
      JSON.stringify([["Flat White", 75, "Barra"]]),
      "Nuevo",
      75,
      1234,
    );
  sql.exec(
    readFileSync(
      new URL("../migrations/0001_original_orders.sql", import.meta.url),
      "utf8",
    ),
  );
  sql.exec(
    readFileSync(
      new URL(
        "../migrations/0002_order_tracking_and_customization.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  sql.exec(readFileSync(new URL("../migrations/0003_club_members.sql", import.meta.url), "utf8"));
  assert.equal(sql.prepare("SELECT member_id FROM orders WHERE id = 1").get().member_id, null);
  assert.equal(sql.prepare("SELECT COUNT(*) AS total FROM club_members").get().total, 0);
  const cookie = await login(env);
  const [legacy] = await (
    await call(env, "/api/orders", "GET", undefined, { Cookie: cookie })
  ).json();
  assert.equal(legacy.customer, "Cliente original");
  assert.equal(legacy.items[0].name, "Flat White");
  assert.equal(legacy.items[0].station, "Barra");
  assert.equal(legacy.items[0].quantity, 1);
  assert.equal(legacy.updatedAt, 1234);
  assert.equal(
    (
      await call(env, "/api/orders/1", "GET", undefined, {
        "X-Order-Token": "anything",
      })
    ).status,
    404,
  );
  assert.equal((await call(env, "/api/orders", "POST", input())).status, 201);
});

test("internal storage errors never expose query or customer details", async () => {
  const response = await call(
    {
      DB: {
        prepare() {
          throw new Error("SQL private tracking_token SECRET");
        },
      },
    },
    "/api/orders",
    "POST",
    input(),
  );
  assert.equal(response.status, 500);
  const body = await response.text();
  assert.ok(!body.includes("SECRET"));
  assert.ok(!body.includes("tracking_token"));
});

test('unpriced orders persist a valid D1 subtotal and remain explicitly pending through tracking and all states', async (t) => {
  const { env, sql } = database(t);
  const product = PRODUCTS.find((entry) => entry.price === null);
  assert.ok(product);
  const payload = input({ items: [{ productId: product.id, quantity: 2, selections: {} }], total: 1, pricingPending: false });
  const createdResponse = await call(env, '/api/orders', 'POST', payload);
  assert.equal(createdResponse.status, 201);
  const created = await createdResponse.json();
  assert.equal(created.total, null);
  assert.equal(created.knownTotal, 0);
  assert.equal(created.pricingPending, true);
  assert.equal(created.items[0].unitPrice, null);
  assert.equal(created.items[0].total, null);
  assert.equal(created.items[0].pricePending, true);
  assert.equal(sql.prepare('SELECT total FROM orders WHERE id = ?').get(created.id).total, 0);
  const cookie = await login(env);
  const [listed] = await (await call(env, '/api/orders', 'GET', undefined, { Cookie: cookie })).json();
  assert.equal(listed.total, null);
  assert.equal(listed.pricingPending, true);
  for (let index = 1; index < STATUSES.length; index += 1) {
    const response = await call(env, `/api/orders/${created.id}`, 'PATCH',
      { expectedStatus: STATUSES[index - 1], status: STATUSES[index] }, { Cookie: cookie });
    assert.equal(response.status, 200);
    const updated = await response.json();
    assert.equal(updated.status, STATUSES[index]);
    assert.equal(updated.total, null);
    assert.equal(updated.knownTotal, 0);
    assert.equal(updated.pricingPending, true);
  }
  const tracked = await (await call(env, `/api/orders/${created.id}`, 'GET', undefined,
    { 'X-Order-Token': created.trackingToken })).json();
  assert.equal(tracked.total, null);
  assert.equal(tracked.pricingPending, true);
  const retry = await call(env, '/api/orders', 'POST', payload);
  assert.equal(retry.status, 200);
  assert.equal((await retry.json()).status, 'Entregado');
  assert.equal(sql.prepare('SELECT count(*) AS n FROM orders').get().n, 1);
});

test('mixed-price orders expose known subtotal without presenting it as the final total', async (t) => {
  const { env, sql } = database(t);
  const product = PRODUCTS.find((entry) => entry.price === null);
  const response = await call(env, '/api/orders', 'POST', input({ items: [
    { productId: 'flat-white', quantity: 2, selections: {} },
    { productId: product.id, quantity: 1, selections: {} },
  ] }));
  assert.equal(response.status, 201);
  const created = await response.json();
  assert.equal(created.total, null);
  assert.equal(created.knownTotal, 150);
  assert.equal(created.pricingPending, true);
  assert.equal(created.items[0].total, 150);
  assert.equal(created.items[1].total, null);
  assert.equal(sql.prepare('SELECT total FROM orders WHERE id = ?').get(created.id).total, 150);
});

test('idempotent pending-price retries retain the saved snapshot after publication of prices', async (t) => {
  const { env, sql } = database(t);
  const product = PRODUCTS.find((entry) => entry.price === null
    && entry.options.every((group) => group.values[0].price !== null));
  assert.ok(product);
  const payload = input({ items: [{ productId: product.id, quantity: 1, selections: {} }] });
  const created = await (await call(env, '/api/orders', 'POST', payload)).json();
  const previousPrice = product.price;
  t.after(() => { product.price = previousPrice; });
  product.price = 100;
  const retry = await call(env, '/api/orders', 'POST', payload);
  assert.equal(retry.status, 200);
  assert.deepEqual(await retry.json(), created);
  assert.equal(created.total, null);
  assert.equal(sql.prepare('SELECT count(*) AS n FROM orders').get().n, 1);
});

test('read-only pricing flags derive from null item snapshots even when a flag is absent', async (t) => {
  const { env, sql } = database(t);
  const created = await (await call(env, '/api/orders', 'POST', input())).json();
  const snapshot = created.items.map(({ pricePending, ...item }) => ({ ...item, unitPrice: null, total: null }));
  sql.prepare('UPDATE orders SET items = ? WHERE id = ?').run(JSON.stringify(snapshot), created.id);
  const tracked = await (await call(env, `/api/orders/${created.id}`, 'GET', undefined,
    { 'X-Order-Token': created.trackingToken })).json();
  assert.equal(tracked.total, null);
  assert.equal(tracked.knownTotal, 150);
  assert.equal(tracked.pricingPending, true);
});
