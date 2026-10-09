import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { bootstrapFailureMessage, bootstrapMetadata, keyFingerprint, prepareBootstrap, recipientPublicKey, sealHubAccess } from "../scripts/bootstrap-hub.mjs";
import { unsealCLI, unsealHubAccess, writePrivateHubCode } from "../scripts/unseal-hub-access.mjs";

const keys = generateKeyPairSync("rsa", { modulusLength: 3072 });
const privatePem = keys.privateKey.export({ type: "pkcs8", format: "pem" });
const encodedPublic = Buffer.from(keys.publicKey.export({ type: "spki", format: "pem" })).toString("base64");
const commit = "b".repeat(40);
const token = "c".repeat(64);
const envFixture = () => ({
  GITHUB_ACTIONS: "true", GITHUB_REF: "refs/heads/main", GITHUB_SHA: commit,
  GITHUB_REPOSITORY: "owner/cream-los-cabos", GITHUB_RUN_ID: "123456", GITHUB_RUN_ATTEMPT: "1",
  CLOUDFLARE_ACCOUNT_ID: "a".repeat(32), CREAM_FRESH_ACCOUNT_ID: "a".repeat(32),
  CLOUDFLARE_API_TOKEN: "fixture-private-api-token", CREAM_RECIPIENT_PUBLIC_KEY_B64: encodedPublic,
});
const metadata = bootstrapMetadata(envFixture(), keys.publicKey, commit);

test("RSA-3072 OAEP access roundtrip keeps plaintext out of sealed JSON", () => {
  const sealed = sealHubAccess(token, keys.publicKey, metadata);
  assert.equal(unsealHubAccess(sealed, privatePem, metadata), token);
  assert.equal(JSON.stringify(sealed).includes(token), false);
  assert.equal(keyFingerprint(keys.privateKey), metadata.recipientFingerprint);
});

test("trusted outer metadata and encrypted binding reject tampering", () => {
  const sealed = sealHubAccess(token, keys.publicKey, metadata);
  for (const field of Object.keys(metadata)) {
    const changed = structuredClone(sealed);
    changed.metadata[field] += "changed";
    assert.throws(() => unsealHubAccess(changed, privatePem, metadata), /Trusted/);
    // Even an operator mistake accepting changed outer metadata cannot bypass the inner binding.
    if (field !== "recipientFingerprint") assert.throws(() => unsealHubAccess(changed, privatePem, changed.metadata), /Encrypted metadata/);
  }
  const corrupted = { ...sealed, ciphertext: Buffer.alloc(384).toString("base64") };
  assert.throws(() => unsealHubAccess(corrupted, privatePem, metadata), /could not be decrypted/);
});

test("wrong private key and missing, weak or private recipient keys are rejected", () => {
  const wrong = generateKeyPairSync("rsa", { modulusLength: 3072 });
  const wrongPem = wrong.privateKey.export({ type: "pkcs8", format: "pem" });
  assert.throws(() => unsealHubAccess(sealHubAccess(token, keys.publicKey, metadata), wrongPem, metadata), /fingerprint/);
  assert.throws(() => recipientPublicKey(undefined), /required/);
  assert.throws(() => recipientPublicKey("not base64"), /required/);
  assert.throws(() => recipientPublicKey(Buffer.from(privatePem).toString("base64")), /never a private key/);
  const weak = generateKeyPairSync("rsa", { modulusLength: 2048 });
  assert.throws(() => recipientPublicKey(Buffer.from(weak.publicKey.export({ type: "spki", format: "pem" })).toString("base64")), /3072/);
});

test("prepare masks token and hands plaintext only to GITHUB_ENV after read-only guard", async () => {
  const root = await mkdtemp(join(tmpdir(), "cream-bootstrap-"));
  try {
    const envPath = join(root, "github-env");
    const env = { ...envFixture(), GITHUB_ENV: envPath };
    const writes = [];
    let guardCalls = 0;
    const result = await prepareBootstrap({ root, env, gitCommit: commit, stdout: { write: (value) => writes.push(value) }, guard: async (options) => {
      guardCalls += 1;
      assert.equal(options.accountId, env.CLOUDFLARE_ACCOUNT_ID);
      assert.equal(options.expectedAccountId, env.CREAM_FRESH_ACCOUNT_ID);
      await assert.rejects(readFile(envPath));
    } });
    assert.equal(guardCalls, 1);
    const generated = (await readFile(envPath, "utf8")).match(/^HUB_TOKEN=([a-f0-9]{64})\n$/)[1];
    assert.deepEqual(writes, [`::add-mask::${generated}\n`]);
    assert.equal(JSON.stringify(result).includes(generated), false);
    const sealedText = await readFile(result.sealedPath, "utf8");
    assert.equal(sealedText.includes(generated), false);
    assert.equal(unsealHubAccess(JSON.parse(sealedText), privatePem, metadata), generated);
    assert.equal((await stat(result.sealedPath)).mode & 0o777, 0o400);
    await assert.rejects(prepareBootstrap({ root, env, gitCommit: commit, stdout: { write() {} }, guard: async () => {} }), /EEXIST/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("prepare fails account, source, key and existing-target checks before token delivery", async () => {
  const root = await mkdtemp(join(tmpdir(), "cream-preflight-"));
  try {
    let calls = 0;
    const base = { ...envFixture(), GITHUB_ENV: join(root, "github-env") };
    const options = { root, gitCommit: commit, stdout: { write() { assert.fail("no token should be generated"); } }, guard: async () => { calls += 1; throw new Error("existing target"); } };
    for (const changed of [{ CREAM_FRESH_ACCOUNT_ID: "d".repeat(32) }, { CREAM_RECIPIENT_PUBLIC_KEY_B64: "" }, { CREAM_EXPECTED_COMMIT: "d".repeat(40) }, { GITHUB_REF: "refs/heads/other" }]) await assert.rejects(prepareBootstrap({ ...options, env: { ...base, ...changed } }));
    assert.equal(calls, 0);
    await assert.rejects(prepareBootstrap({ ...options, env: base }), /existing target/);
    await assert.rejects(readFile(base.GITHUB_ENV));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("unseal writes exclusive mode-0600 output in mode-0700 directory without stdout", async () => {
  const root = await mkdtemp(join(tmpdir(), "cream-unseal-"));
  try {
    const sealedPath = join(root, "sealed.json");
    const privatePath = join(root, "private.pem");
    const output = join(root, "private-output", "hub-code.txt");
    await writeFile(sealedPath, JSON.stringify(sealHubAccess(token, keys.publicKey, metadata)));
    await writeFile(privatePath, privatePem, { mode: 0o600 });
    await unsealCLI(["--sealed", sealedPath, "--private-key", privatePath, "--out", output, "--account", metadata.accountId, "--repository", metadata.repository, "--commit", metadata.commit, "--run", metadata.runId, "--attempt", metadata.runAttempt, "--fingerprint", metadata.recipientFingerprint]);
    assert.equal(await readFile(output, "utf8"), `${token}\n`);
    assert.equal((await stat(output)).mode & 0o777, 0o600);
    assert.equal((await stat(join(root, "private-output"))).mode & 0o777, 0o700);
    await assert.rejects(writePrivateHubCode(output, "d".repeat(64)), /EEXIST/);
    assert.equal(await readFile(output, "utf8"), `${token}\n`);
    await assert.rejects(unsealCLI([]), /trusted/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("bootstrap workflow uploads only sealed access before deploying and shares the production lock", async () => {
  const workflow = await readFile(new URL("../.github/workflows/bootstrap-cloudflare.yml", import.meta.url), "utf8");
  assert.ok(workflow.indexOf("path: .cream-deploy/initial-hub-access.sealed.json") < workflow.indexOf("scripts/verify-live-flow.mjs --deploy-fresh"));
  assert.match(workflow, /group: cloudflare-production/);
  assert.match(workflow, /if-no-files-found: error/);
  assert.match(workflow, /retention-days: 7/);
  assert.doesNotMatch(workflow, /secrets\.HUB_TOKEN|GITHUB_OUTPUT|path: \.cream-deploy\s*$/m);
});

test("bootstrap failure diagnostics preserve useful details and redact private values before truncation", () => {
  const env = { ...envFixture(), HUB_TOKEN: token };
  const message = bootstrapFailureMessage(new Error(`Cloudflare permission denied\n\u001b token=${env.CLOUDFLARE_API_TOKEN}\ncode=${token}\nkey=${encodedPublic}`), env);
  assert.match(message, /Bootstrap preparation failed: Cloudflare permission denied/);
  assert.match(message, /\[REDACTED\]/);
  assert.match(message, /No Cloudflare resource was changed\.$/);
  for (const value of [env.CLOUDFLARE_API_TOKEN, token, encodedPublic]) assert.equal(message.includes(value), false);
  assert.doesNotMatch(message, /[\u0000-\u001f\u007f-\u009f]/);
  const long = bootstrapFailureMessage(new Error("x".repeat(1000)), env);
  assert.equal(long, `Bootstrap preparation failed: ${"x".repeat(500)} No Cloudflare resource was changed.`);
});
