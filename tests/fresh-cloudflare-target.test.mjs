import test from "node:test";
import assert from "node:assert/strict";
import childProcess from "node:child_process";
import fsPromises from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { EventEmitter, once } from "node:events";
import { PassThrough } from "node:stream";
import { basename, dirname, join } from "node:path";
import { assertFreshAccountId, assertFreshCloudflareTarget } from "../scripts/fresh-cloudflare-target.mjs";
import { main } from "../scripts/deploy-cloudflare.mjs";

const accountId = "a".repeat(32);
const apiToken = "private-api-token-fixture";
const database = (name = "cream-los-cabos", number = 1) => ({ name, uuid: `11111111-2222-4333-8444-${String(number).padStart(12, "0")}` });
const response = (status, body) => ({ status, ok: status >= 200 && status < 300, json: async () => body });
const absentPages = () => response(404, { success: false, result: null, errors: [{ code: 8000007 }] });
const d1 = (rows = [], result_info) => response(200, { success: true, errors: [], result: rows, ...(result_info ? { result_info } : {}) });
const options = (fetchImpl, extra = {}) => ({ apiToken, accountId, expectedAccountId: accountId, fetchImpl, ...extra });
const queued = (responses) => {
  const calls = [];
  return {
    calls,
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      assert.ok(responses.length, "unexpected extra API request");
      return responses.shift();
    },
  };
};

const copyFixture = async (_source, target) => {
  await fsPromises.mkdir(target, { recursive: true });
  await fsPromises.writeFile(join(target, "fixture.txt"), "deployment artifact fixture\n");
};

function mockDeployment(context, fetchImpl, { copyImpl = copyFixture } = {}) {
  const keys = ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID", "HUB_TOKEN", "CREAM_FRESH_ACCOUNT_ID"];
  const previous = new Map(keys.map((key) => [key, process.env[key]]));
  const previousFetch = globalThis.fetch;
  const commands = [];
  context.after(() => {
    context.mock.restoreAll();
    syncBuiltinESMExports();
    globalThis.fetch = previousFetch;
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  Object.assign(process.env, { CLOUDFLARE_API_TOKEN: apiToken, CLOUDFLARE_ACCOUNT_ID: accountId, HUB_TOKEN: "private-hub-token-fixture", CREAM_FRESH_ACCOUNT_ID: accountId });
  globalThis.fetch = fetchImpl;
  // npm check is mocked, so its build artifacts must be fixtures as well.
  // The tests must run in a clean checkout where dist does not exist yet.
  context.mock.method(fsPromises, "cp", copyImpl);
  context.mock.method(childProcess, "spawn", (command, args) => {
    commands.push({ command, args });
    const child = new EventEmitter();
    child.stdin = new PassThrough();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    const closedStreams = Promise.all([once(child.stdin, "finish"), once(child.stdout, "end"), once(child.stderr, "end")]);
    queueMicrotask(() => {
      child.stdout.end();
      child.stderr.end();
    });
    closedStreams.then(() => child.emit("close", 0));
    return child;
  });
  syncBuiltinESMExports();
  return commands;
}

test("fresh guard validates both account identifiers and exact equality before any calls", async () => {
  let calls = 0;
  const fetchImpl = async () => { calls += 1; throw new Error("unexpected request"); };
  for (const extra of [
    { accountId: "invalid" }, { expectedAccountId: undefined }, { expectedAccountId: "" },
    { expectedAccountId: "b".repeat(32) }, { expectedAccountId: "A".repeat(32) },
    { expectedAccountId: BigInt("11111111111111111111111111111111") },
  ]) {
    await assert.rejects(assertFreshCloudflareTarget(options(fetchImpl, extra)), /cuenta/);
  }
  assert.throws(() => assertFreshAccountId(accountId, `${accountId} `), /cuenta/);
  await assert.rejects(assertFreshCloudflareTarget(options(fetchImpl, { apiToken: "" })), /acceso privado/);
  assert.equal(calls, 0);
});

test("fresh guard allows only absent Pages and an empty exact-name D1 target using GET", async () => {
  const fixture = queued([absentPages(), d1()]);
  assert.deepEqual(await assertFreshCloudflareTarget(options(fixture.fetchImpl)), { accountId, projectName: "cream-los-cabos" });
  assert.equal(fixture.calls.length, 2);
  assert.match(fixture.calls[0].url, new RegExp(`/accounts/${accountId}/pages/projects/cream-los-cabos$`));
  assert.match(fixture.calls[1].url, /\/d1\/database\?name=cream-los-cabos&per_page=100&page=1$/);
  for (const { url, init } of fixture.calls) {
    assert.equal(init.method, "GET");
    assert.equal(init.redirect, "error");
    assert.equal(init.headers.Authorization, `Bearer ${apiToken}`);
    assert.equal(init.body, undefined);
    assert.doesNotMatch(url, /workers|scripts|query/);
  }
});

test("fresh guard requires the recognized Pages missing code and rejects uncertain absence", async () => {
  for (const pages of [
    response(404, { success: false, errors: [{ code: 10000 }] }),
    response(403, { success: false, errors: [{ code: 8000007 }] }),
    response(404, { success: false, errors: [{ code: "8000007" }] }),
    response(404, { success: true, errors: [{ code: 8000007 }] }),
    response(404, { success: false, errors: [] }),
    response(404, { success: false, errors: [{ code: 8000007 }, { code: 10000 }] }),
    response(404, null),
    response(200, { success: true, result: null }),
  ]) {
    const fixture = queued([pages]);
    await assert.rejects(assertFreshCloudflareTarget(options(fixture.fetchImpl)));
    assert.equal(fixture.calls.length, 1);
  }
});

test("fresh guard never accepts an existing Pages project", async () => {
  const fixture = queued([response(200, { success: true, errors: [], result: { name: "cream-los-cabos" } })]);
  await assert.rejects(assertFreshCloudflareTarget(options(fixture.fetchImpl)), /Pages.*ya existe/);
  assert.equal(fixture.calls.length, 1);
});

test("fresh guard filters exact D1 names and checks all full pages", async () => {
  const first = Array.from({ length: 100 }, (_, index) => database(`cream-los-cabos-other-${index}`, index + 1));
  const fixture = queued([absentPages(), d1(first), d1([database()])]);
  await assert.rejects(assertFreshCloudflareTarget(options(fixture.fetchImpl)), /D1.*ya existe/);
  assert.equal(fixture.calls.length, 3);
  assert.match(fixture.calls[2].url, /page=2$/);
  const unrelated = queued([absentPages(), d1([database("cream-los-cabos-other")])]);
  await assertFreshCloudflareTarget(options(unrelated.fetchImpl));
});

test("fresh guard rejects multiple exact D1 matches across pages", async () => {
  const fixture = queued([
    absentPages(),
    d1([database()], { page: 1, per_page: 1, count: 1, total_count: 2, total_pages: 2 }),
    d1([database("cream-los-cabos", 2)], { page: 2, per_page: 1, count: 1, total_count: 2, total_pages: 2 }),
  ]);
  await assert.rejects(assertFreshCloudflareTarget(options(fixture.fetchImpl)), /varias D1.*ambigüedad/);
  assert.equal(fixture.calls.length, 3);
});

test("fresh guard follows pagination totals even when a page has fewer than 100 results", async () => {
  const fixture = queued([
    absentPages(),
    d1([database("other")], { page: 1, per_page: 100, count: 1, total_count: 2, total_pages: 2 }),
    d1([database()], { page: 2, per_page: 100, count: 1, total_count: 2, total_pages: 2 }),
  ]);
  await assert.rejects(assertFreshCloudflareTarget(options(fixture.fetchImpl)), /D1.*ya existe/);
  assert.equal(fixture.calls.length, 3);
});

test("fresh guard rejects unauthorized and malformed D1 responses", async () => {
  for (const listing of [
    response(403, { success: false, errors: [{ code: 10000 }], result: [] }),
    response(200, { success: false, result: [] }),
    response(200, { success: true, result: null }),
    response(200, { success: true, errors: [{ code: 10000 }], result: [] }),
    d1([null]), d1([{ name: "other" }]), d1([{ uuid: database().uuid }]),
    d1([{ name: "cream-los-cabos", uuid: "invalid" }]),
    d1([], { page: 2, per_page: 100 }),
    d1([], { page: 1, per_page: 0 }),
    d1([], { page: 1, per_page: 100, total_count: 1 }),
    d1([database("other")], { page: 1, per_page: 100, count: 2 }),
    d1([database("other")], { page: 1, per_page: 100, total_count: 0 }),
    d1([database("other")], { page: 1, per_page: 100, total_count: 2, total_pages: 1 }),
  ]) {
    const fixture = queued([absentPages(), listing]);
    await assert.rejects(assertFreshCloudflareTarget(options(fixture.fetchImpl)));
    assert.equal(fixture.calls.length, 2);
  }
});

test("fresh guard rejects changed pagination totals", async () => {
  const fixture = queued([
    absentPages(),
    d1([database("other")], { page: 1, per_page: 1, total_count: 2 }),
    d1([database("another", 2)], { page: 2, per_page: 1, total_count: 3 }),
  ]);
  await assert.rejects(assertFreshCloudflareTarget(options(fixture.fetchImpl)), /cambió durante/);
});

test("fresh guard hides fetch and JSON errors that could include credentials", async () => {
  for (const fetchImpl of [
    async () => { throw new Error(apiToken); },
    async () => ({ status: 404, ok: false, json: async () => { throw new Error(apiToken); } }),
  ]) {
    await assert.rejects(assertFreshCloudflareTarget(options(fetchImpl)), (error) => {
      assert.ok(!error.message.includes(apiToken));
      return true;
    });
  }
});

test("fresh deployment account mismatch fails before network calls", async (context) => {
  const keys = ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID", "HUB_TOKEN", "CREAM_FRESH_ACCOUNT_ID"];
  const previous = new Map(keys.map((key) => [key, process.env[key]]));
  const previousFetch = globalThis.fetch;
  let calls = 0;
  context.after(() => {
    globalThis.fetch = previousFetch;
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  Object.assign(process.env, { CLOUDFLARE_API_TOKEN: apiToken, CLOUDFLARE_ACCOUNT_ID: accountId, HUB_TOKEN: "private-hub-token-fixture", CREAM_FRESH_ACCOUNT_ID: "b".repeat(32) });
  globalThis.fetch = async () => { calls += 1; throw new Error("unexpected request"); };
  await assert.rejects(main(), /cuenta configurada no coincide/);
  assert.equal(calls, 0);
});

test("fresh deployment refuses a D1 that appears during ordinary inspection", async (context) => {
  let listings = 0;
  const calls = [];
  const commands = mockDeployment(context, async (url, init) => {
    calls.push({ url, init });
    if (url.includes("/pages/projects/")) return absentPages();
    if (url.includes("/d1/database?")) return d1(++listings === 1 ? [] : [database()]);
    throw new Error("unexpected request");
  });
  await assert.rejects(main(), /no adoptará ni modificará/);
  assert.ok(calls.every(({ init }) => init.method === "GET"));
  assert.equal(commands.length, 0);
});

test("fresh deployment reruns its guard after checks and refuses a newly appeared project before DB writes", async (context) => {
  let pages = 0;
  const calls = [];
  const commands = mockDeployment(context, async (url, init) => {
    calls.push({ url, init });
    if (url.includes("/pages/projects/")) {
      if (++pages < 3) return absentPages();
      return response(200, { success: true, result: { name: "cream-los-cabos", id: "other-project" } });
    }
    if (url.includes("/d1/database?")) return d1();
    throw new Error("unexpected request");
  });
  await assert.rejects(main(), /Pages.*ya existe/);
  assert.equal(pages, 3);
  assert.deepEqual(commands, [{ command: "npm", args: ["run", "check"] }]);
  assert.ok(calls.every(({ init }) => init.method === "GET"));
});

for (const boundary of ["secret", "deploy"]) {
  test(`fresh deployment refuses a changed Pages identity before ${boundary}`, async (context) => {
    let pages = 0;
    const created = { id: "created-project", name: "cream-los-cabos", production_branch: "main" };
    const commands = mockDeployment(context, async (url, init) => {
      if (url.includes("/pages/projects/")) {
        pages += 1;
        if (pages <= 3) return absentPages();
        const changed = pages >= (boundary === "secret" ? 4 : 5);
        return response(200, { success: true, result: { ...created, id: changed ? "other-project" : created.id } });
      }
      if (url.includes("/d1/database?")) return d1();
      if (url.endsWith("/d1/database") && init.method === "POST") return response(200, { success: true, result: database() });
      if (url.endsWith("/pages/projects") && init.method === "POST") return response(200, { success: true, result: created });
      if (url.endsWith("/query")) return response(200, { success: true, result: [{ success: true, results: [] }] });
      throw new Error("unexpected request");
    });
    await assert.rejects(main(), /identidad del proyecto Pages recién creado/);
    assert.equal(commands.filter(({ args }) => args.includes("secret")).length, boundary === "secret" ? 0 : 1);
    assert.equal(commands.filter(({ args }) => args.includes("deploy")).length, 0);
    assert.equal(commands.filter(({ args }) => args.includes("migrations")).length, 1);
  });
}

for (const resource of ["D1", "Pages"]) {
  test(`fresh deployment aborts a ${resource} creation conflict without adopting the existing resource`, async (context) => {
    let pagesCreates = 0;
    const commands = mockDeployment(context, async (url, init) => {
      if (url.includes("/pages/projects/")) return absentPages();
      if (url.includes("/d1/database?")) return d1();
      if (url.endsWith("/d1/database") && init.method === "POST") {
        return resource === "D1" ? response(409, { success: false, errors: [{ code: 10000 }] }) : response(200, { success: true, result: database() });
      }
      if (url.endsWith("/pages/projects") && init.method === "POST") {
        pagesCreates += 1;
        return response(409, { success: false, errors: [{ code: 10000 }] });
      }
      throw new Error("unexpected request");
    });
    await assert.rejects(main(), /Cloudflare rechazó POST.*HTTP 409/);
    assert.equal(pagesCreates, resource === "D1" ? 0 : 1);
    assert.deepEqual(commands, [{ command: "npm", args: ["run", "check"] }]);
  });
}

test("fresh deployment returns only verified public deployment metadata", async (context) => {
  let pages = 0;
  const created = { id: "created-project", name: "cream-los-cabos", production_branch: "main", subdomain: "cream-los-cabos.pages.dev" };
  mockDeployment(context, async (url, init) => {
    if (url.startsWith("https://cream-los-cabos.pages.dev")) {
      const path = new URL(url).pathname;
      if (path === "/club" || path === "/hub") return new Response('<html><div id="root"></div></html>', { headers: { "Content-Type": "text/html" } });
      if (path === "/api/hub/session") {
        if (init.method === "POST") return Response.json({}, { headers: { "Set-Cookie": "cream_session=fixture; HttpOnly; Secure; SameSite=Strict" } });
        if (init.method === "DELETE") return Response.json({}, { headers: { "Set-Cookie": "cream_session=; Max-Age=0" } });
        return Response.json({ configured: true, authenticated: Boolean(init.headers?.Cookie) });
      }
      if (path === "/api/orders") return init.headers?.Cookie ? Response.json([]) : Response.json({}, { status: 401 });
      throw new Error("unexpected public verification request");
    }
    if (url.includes("/pages/projects/")) return ++pages <= 3 ? absentPages() : response(200, { success: true, result: created });
    if (url.includes("/d1/database?")) return d1();
    if (url.endsWith("/d1/database") && init.method === "POST") return response(200, { success: true, result: database() });
    if (url.endsWith("/pages/projects") && init.method === "POST") return response(200, { success: true, result: created });
    if (url.endsWith("/query")) return response(200, { success: true, result: [{ success: true, results: [] }] });
    throw new Error("unexpected request");
  });
  const result = await main();
  assert.deepEqual(Object.keys(result).sort(), ["baseURL", "commit", "databaseId", "projectName"]);
  assert.equal(result.baseURL, "https://cream-los-cabos.pages.dev");
  assert.equal(result.projectName, "cream-los-cabos");
  assert.equal(result.databaseId, database().uuid);
  assert.match(result.commit, /^[a-f\d]{40}$/);
  assert.ok(!JSON.stringify(result).includes(apiToken));
  assert.ok(!JSON.stringify(result).includes(process.env.HUB_TOKEN));
});

const createFreshFixture = async (url, init) => {
  if (url.includes("/pages/projects/")) return absentPages();
  if (url.includes("/d1/database?")) return d1();
  if (url.endsWith("/d1/database") && init.method === "POST") return response(200, { success: true, result: database() });
  if (url.endsWith("/pages/projects") && init.method === "POST") return response(200, { success: true, result: { id: "created-project", name: "cream-los-cabos", production_branch: "main" } });
  throw new Error("unexpected request");
};

test("deployment waits for all artifact copies before cleaning a failed staging directory", async (context) => {
  const originalRm = fsPromises.rm;
  const copyError = Object.assign(new Error("Missing build artifact fixture"), { code: "ENOENT" });
  let staging;
  let completedCopies = 0;
  const commands = mockDeployment(context, createFreshFixture, { copyImpl: async (source, target) => {
    staging = dirname(target);
    if (basename(source) === "dist") throw copyError;
    await new Promise((resolve) => setImmediate(resolve));
    await copyFixture(source, target);
    completedCopies += 1;
  } });
  context.mock.method(fsPromises, "rm", async (target, options) => {
    assert.equal(completedCopies, 2, "cleanup must wait for copies that outlive the first failure");
    assert.equal(options.maxRetries, 3);
    return originalRm(target, options);
  });
  syncBuiltinESMExports();
  await assert.rejects(main(), (error) => error === copyError);
  assert.deepEqual(commands, [{ command: "npm", args: ["run", "check"] }]);
  await assert.rejects(fsPromises.access(staging), { code: "ENOENT" });
});

test("deployment preserves the substantive failure when staging cleanup also fails", async (context) => {
  const originalRm = fsPromises.rm;
  const copyError = Object.assign(new Error("Missing build artifact fixture"), { code: "ENOENT" });
  const cleanupError = Object.assign(new Error("Cleanup fixture is busy"), { code: "ENOTEMPTY" });
  let staging;
  mockDeployment(context, createFreshFixture, { copyImpl: async (source, target) => {
    staging = dirname(target);
    if (basename(source) === "dist") throw copyError;
    await copyFixture(source, target);
  } });
  context.after(async () => { if (staging) await originalRm(staging, { recursive: true, force: true }); });
  context.mock.method(fsPromises, "rm", async () => { throw cleanupError; });
  syncBuiltinESMExports();
  await assert.rejects(main(), (error) => error === copyError);
});
