import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  requireCredentials,
  assertMigrationCompatible,
  assertPagesCompatible,
  makeDeploymentConfig,
  main,
} from "../scripts/deploy-cloudflare.mjs";

const firstMigration = "0001_original_orders.sql";
const secondMigration = "0002_order_tracking_and_customization.sql";
const thirdMigration = "0003_club_members.sql";
const databaseId = "11111111-2222-4333-8444-555555555555";
const baselineColumns = [
  { name: "id", type: "INTEGER", pk: 1 },
  ...["customer", "branch", "items", "status", "total", "created_at"].map(
    (name) => ({ name, type: "TEXT", pk: 0 }),
  ),
];
const finalColumns = [
  ...baselineColumns,
  ...["phone", "note", "updated_at", "request_id", "tracking_token", "payload_hash"].map(
    (name) => ({ name, type: "TEXT", pk: 0 }),
  ),
];
const memberOrdersColumns = [
  ...finalColumns,
  { name: "member_id", type: "TEXT", pk: 0, notnull: 0 },
];
const memberTables = ["orders", "club_members", "d1_migrations"];
const memberMigrations = [firstMigration, secondMigration, thirdMigration];
const memberSchema = () => ({
  columns: Object.entries({
    id: "TEXT",
    access_token_hash: "TEXT",
    customer: "TEXT",
    phone: "TEXT",
    created_at: "INTEGER",
    updated_at: "INTEGER",
    request_id: "TEXT",
    payload_hash: "TEXT",
  }).map(([name, type]) => ({ name, type, pk: name === "id" ? 1 : 0, notnull: name === "id" ? 0 : 1 })),
  foreignKeys: [{ table: "club_members", from: "member_id", to: "id" }],
  uniqueRequestId: true,
});
const credentials = {
  CLOUDFLARE_API_TOKEN: "private-api-token-fixture",
  CLOUDFLARE_ACCOUNT_ID: "a".repeat(32),
  HUB_TOKEN: "private-hub-token-fixture",
};
const project = () => ({
  production_branch: "main",
  source: {
    type: "github",
    config: { owner: "cimiarroyo-collab", repo_name: "cream-los-cabos" },
  },
  deployment_configs: { production: { d1_databases: { DB: { id: databaseId } } } },
  build_config: { build_command: "npm run build", destination_dir: "dist" },
});

test("deployment rejects missing or invalid credentials without exposing secret values", () => {
  assert.throws(() => requireCredentials({}), /CLOUDFLARE_API_TOKEN.*CLOUDFLARE_ACCOUNT_ID.*HUB_TOKEN/);
  for (const invalid of [
    { ...credentials, HUB_TOKEN: "" },
    { ...credentials, CLOUDFLARE_ACCOUNT_ID: "invalid-private-account" },
    { ...credentials, HUB_TOKEN: "short-key" },
    { ...credentials, HUB_TOKEN: " private-hub-token-fixture" },
  ]) {
    assert.throws(() => requireCredentials(invalid), (error) => {
      assert.ok(!error.message.includes(credentials.CLOUDFLARE_API_TOKEN));
      assert.ok(!error.message.includes(credentials.HUB_TOKEN));
      assert.ok(!error.message.includes("invalid-private-account"));
      assert.ok(!error.message.includes("short-key"));
      return true;
    });
  }
});

test("deployment main stops before network access when private credentials are absent", async (context) => {
  const keys = ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID", "HUB_TOKEN"];
  const previous = new Map(keys.map((key) => [key, process.env[key]]));
  const previousFetch = globalThis.fetch;
  let networkCalls = 0;
  context.after(() => {
    globalThis.fetch = previousFetch;
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  for (const key of keys) delete process.env[key];
  globalThis.fetch = async () => {
    networkCalls += 1;
    throw new Error("Unexpected network request before credential validation");
  };
  await assert.rejects(main(), /No se ha desplegado ni modificado ningún recurso/);
  assert.equal(networkCalls, 0);
});

test("D1 preflight accepts a fresh database and the original schema without rewriting data", () => {
  assert.doesNotThrow(() => assertMigrationCompatible([], [], []));
  const unchanged = structuredClone(baselineColumns);
  assert.doesNotThrow(() => assertMigrationCompatible(baselineColumns, []));
  assert.doesNotThrow(() => assertMigrationCompatible(baselineColumns, [firstMigration]));
  assert.deepEqual(baselineColumns, unchanged);
});

test("D1 preflight accepts the final schema only with both migrations recorded", () => {
  assert.doesNotThrow(() => assertMigrationCompatible(finalColumns, [firstMigration, secondMigration]));
  assert.throws(() => assertMigrationCompatible(finalColumns, []), /sin registrar la segunda migración/);
  assert.throws(() => assertMigrationCompatible(finalColumns, [firstMigration]), /sin registrar la segunda migración/);
  assert.throws(() => assertMigrationCompatible(finalColumns, [secondMigration]), /historial y las columnas/);
});

test("D1 preflight stops on partial upgrades, inconsistent migration history and unrelated tables", () => {
  assert.throws(() => assertMigrationCompatible([...baselineColumns, { name: "phone", type: "TEXT", pk: 0 }], [firstMigration]), /sin registrar la segunda migración/);
  assert.throws(() => assertMigrationCompatible(baselineColumns, [firstMigration, secondMigration]), /historial y las columnas/);
  assert.throws(() => assertMigrationCompatible([], [firstMigration], ["d1_migrations"]), /no contiene orders/);
  assert.throws(() => assertMigrationCompatible(finalColumns, [firstMigration, secondMigration, "0003_other_app.sql"]), /migraciones ajenas/);
  assert.throws(() => assertMigrationCompatible(baselineColumns, [], ["orders", "unrelated_customers"]), /tablas de otra aplicación/);
});

test("D1 preflight accepts the complete Club migration without changing its schema or history", () => {
  const cards = memberSchema();
  const inputs = [memberOrdersColumns, memberMigrations, memberTables, cards];
  const unchanged = structuredClone(inputs);
  assert.doesNotThrow(() => assertMigrationCompatible(...inputs));
  assert.deepEqual(inputs, unchanged);
});

test("D1 preflight rejects Club data without the third migration or its previous migrations", () => {
  assert.throws(() => assertMigrationCompatible(memberOrdersColumns, [firstMigration, secondMigration], memberTables, memberSchema()), /sin registrar la tercera migración/);
  assert.throws(() => assertMigrationCompatible(finalColumns, [firstMigration, secondMigration], memberTables, memberSchema()), /sin registrar la tercera migración/);
  assert.throws(() => assertMigrationCompatible(memberOrdersColumns, [firstMigration, secondMigration]), /sin registrar la tercera migración/);
  assert.throws(() => assertMigrationCompatible(memberOrdersColumns, [secondMigration, thirdMigration], memberTables, memberSchema()), /historial y las columnas/);
  assert.throws(() => assertMigrationCompatible(memberOrdersColumns, [firstMigration, thirdMigration], memberTables, memberSchema()), /sin registrar la segunda migración/);
  assert.throws(() => assertMigrationCompatible(baselineColumns, [firstMigration, thirdMigration], memberTables, memberSchema()), /tercera migración/);
});

test("D1 preflight rejects partial Club upgrades and cards without an orders table", () => {
  assert.throws(() => assertMigrationCompatible([], [], ["club_members"], memberSchema()), /tarjetas sin la tabla orders/);
  assert.throws(() => assertMigrationCompatible([], memberMigrations, ["club_members", "d1_migrations"], memberSchema()), /no contiene orders/);
  assert.throws(() => assertMigrationCompatible(finalColumns, memberMigrations, memberTables, memberSchema()), /tercera migración/);
  assert.throws(() => assertMigrationCompatible(memberOrdersColumns, memberMigrations, ["orders", "d1_migrations"], memberSchema()), /tercera migración/);
  assert.throws(() => assertMigrationCompatible(memberOrdersColumns, memberMigrations, memberTables), /tercera migración/);
  const partial = memberSchema();
  partial.columns = partial.columns.filter(({ name }) => name !== "access_token_hash");
  assert.throws(() => assertMigrationCompatible(memberOrdersColumns, memberMigrations, memberTables, partial), /tercera migración/);
});

test("D1 preflight requires a nullable TEXT membership association on orders", () => {
  for (const invalid of [
    { type: "INTEGER" },
    { notnull: 1 },
    { pk: 1 },
  ]) {
    const columns = memberOrdersColumns.map((column) => column.name === "member_id" ? { ...column, ...invalid } : column);
    assert.throws(() => assertMigrationCompatible(columns, memberMigrations, memberTables, memberSchema()), /tercera migración/);
  }
});

test("D1 preflight validates Club column names, storage types, nullability and primary key", () => {
  for (const [name, invalid] of [
    ["access_token_hash", { name: "public_access_token" }],
    ["created_at", { type: "TEXT" }],
    ["customer", { notnull: 0 }],
    ["id", { pk: 0 }],
    ["request_id", { pk: 1 }],
  ]) {
    const cards = memberSchema();
    cards.columns = cards.columns.map((column) => column.name === name ? { ...column, ...invalid } : column);
    assert.throws(() => assertMigrationCompatible(memberOrdersColumns, memberMigrations, memberTables, cards), /tercera migración/);
  }
  const duplicate = memberSchema();
  duplicate.columns = duplicate.columns.map((column) => column.name === "payload_hash" ? { ...column, name: "request_id" } : column);
  assert.throws(() => assertMigrationCompatible(memberOrdersColumns, memberMigrations, memberTables, duplicate), /tercera migración/);
});

test("D1 preflight requires the member_id foreign key and the unique card request index", () => {
  for (const foreignKeys of [
    [],
    [{ table: "other_members", from: "member_id", to: "id" }],
    [{ table: "club_members", from: "customer", to: "id" }],
    [{ table: "club_members", from: "member_id", to: "request_id" }],
    [...memberSchema().foreignKeys, { table: "club_members", from: "phone", to: "phone" }],
  ]) {
    assert.throws(() => assertMigrationCompatible(memberOrdersColumns, memberMigrations, memberTables, { ...memberSchema(), foreignKeys }), /tercera migración/);
  }
  for (const uniqueRequestId of [false, undefined, 1]) {
    assert.throws(() => assertMigrationCompatible(memberOrdersColumns, memberMigrations, memberTables, { ...memberSchema(), uniqueRequestId }), /tercera migración/);
  }
});

test("D1 preflight rejects unrelated tables, migrations and order columns alongside Club cards", () => {
  assert.throws(() => assertMigrationCompatible(memberOrdersColumns, memberMigrations, [...memberTables, "another_app_members"], memberSchema()), /tablas de otra aplicación/);
  assert.throws(() => assertMigrationCompatible(memberOrdersColumns, [...memberMigrations, "0004_other_app.sql"], memberTables, memberSchema()), /migraciones ajenas/);
  assert.throws(() => assertMigrationCompatible([...memberOrdersColumns, { name: "external_user_id", type: "TEXT", pk: 0 }], memberMigrations, memberTables, memberSchema()), /esquema original/);
});

test("Pages preflight preserves the matching Git project, main branch and existing DB binding", () => {
  const existing = project();
  const unchanged = structuredClone(existing);
  assert.doesNotThrow(() => assertPagesCompatible(existing, databaseId));
  assert.deepEqual(existing, unchanged);
  assert.doesNotThrow(() => assertPagesCompatible(null, databaseId));
});

test("Pages preflight rejects a different repository, production branch or database", () => {
  const foreign = project();
  foreign.source.config.repo_name = "another-project";
  assert.throws(() => assertPagesCompatible(foreign, databaseId), /otro repositorio/);
  const otherBranch = project();
  otherBranch.production_branch = "release";
  assert.throws(() => assertPagesCompatible(otherBranch, databaseId), /otra rama de producción/);
  assert.throws(() => assertPagesCompatible(project(), "99999999-2222-4333-8444-555555555555"), /otra D1/);
  assert.throws(() => assertPagesCompatible(project(), undefined), /otra D1/);
});

test("temporary deployment config changes only the DB UUID and migration directory", async () => {
  const location = new URL("../wrangler.toml", import.meta.url);
  const original = await readFile(location, "utf8");
  const repositoryRoot = "/tmp/cream-deployment-fixture";
  const config = makeDeploymentConfig(original, databaseId, repositoryRoot);
  assert.match(config, /^database_id = "11111111-2222-4333-8444-555555555555"$/m);
  assert.match(config, /^migrations_dir = "\/tmp\/cream-deployment-fixture\/migrations"$/m);
  assert.match(config, /^pages_build_output_dir = "dist"$/m);
  const nonemptyLines = (text) => text.split(/\r?\n/).filter((line) => line.trim());
  assert.deepEqual(
    nonemptyLines(
      config
        .replace(databaseId, "00000000-0000-0000-0000-000000000000")
        .replace(`${repositoryRoot}/migrations`, "migrations"),
    ),
    nonemptyLines(original),
  );
  assert.equal(await readFile(location, "utf8"), original);
  assert.throws(() => makeDeploymentConfig(original, "not-a-uuid", repositoryRoot), /UUID válido/);
});
