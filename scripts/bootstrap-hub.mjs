import { constants, createHash, createPublicKey, publicEncrypt, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { appendFile, chmod, mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertFreshCloudflareTarget } from "./fresh-cloudflare-target.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const PROJECT = "cream-los-cabos";
export const SEALED_FILENAME = "initial-hub-access.sealed.json";

export function recipientPublicKey(encoded) {
  if (typeof encoded !== "string" || encoded.length > 32768 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw new Error("A valid base64 PEM recipient public key is required.");
  const pem = Buffer.from(encoded, "base64").toString("utf8");
  if (Buffer.from(pem).toString("base64") !== encoded || !pem.startsWith("-----BEGIN PUBLIC KEY-----")) throw new Error("Recipient key must be a base64 encoded public PEM, never a private key.");
  let key;
  try { key = createPublicKey(pem); } catch { throw new Error("Recipient public key could not be parsed."); }
  if (key.asymmetricKeyType !== "rsa" || key.asymmetricKeyDetails?.modulusLength < 3072) throw new Error("Recipient key must be RSA with at least 3072 bits.");
  return key;
}

export function keyFingerprint(key) {
  const publicKey = key.type === "public" ? key : createPublicKey(key);
  return createHash("sha256").update(publicKey.export({ type: "spki", format: "der" })).digest("hex");
}

export function metadataDigest(metadata) {
  return createHash("sha256").update(JSON.stringify(metadata)).digest("hex");
}

export function sealHubAccess(hubToken, publicKey, metadata) {
  if (!/^[a-f0-9]{64}$/.test(hubToken)) throw new Error("Generated Hub code is invalid.");
  const plaintext = Buffer.from(JSON.stringify({ hubToken, metadataSHA256: metadataDigest(metadata) }));
  const ciphertext = publicEncrypt({ key: publicKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" }, plaintext);
  return { format: "cream-hub-access/v1", algorithm: "RSA-OAEP-SHA256", metadata, ciphertext: ciphertext.toString("base64") };
}

export function bootstrapMetadata(env, publicKey, commit) {
  if (env.GITHUB_ACTIONS !== "true" || env.GITHUB_REF !== "refs/heads/main") throw new Error("Bootstrap requires GitHub Actions on main.");
  if (!/^[a-f0-9]{40}$/.test(commit) || env.GITHUB_SHA !== commit) throw new Error("Checkout commit does not match the GitHub run.");
  if (env.CREAM_EXPECTED_COMMIT && env.CREAM_EXPECTED_COMMIT !== commit) throw new Error("Checkout commit does not match the trusted expected commit.");
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(env.GITHUB_REPOSITORY || "") || !/^[1-9]\d{0,19}$/.test(env.GITHUB_RUN_ID || "") || !/^[1-9]\d{0,9}$/.test(env.GITHUB_RUN_ATTEMPT || "")) throw new Error("GitHub run metadata is missing or invalid.");
  return {
    accountId: env.CLOUDFLARE_ACCOUNT_ID,
    projectName: PROJECT,
    repository: env.GITHUB_REPOSITORY,
    runId: env.GITHUB_RUN_ID,
    runAttempt: env.GITHUB_RUN_ATTEMPT,
    commit,
    recipientFingerprint: keyFingerprint(publicKey),
  };
}

export async function prepareBootstrap({ env = process.env, root = ROOT, fetchImpl = globalThis.fetch, guard = assertFreshCloudflareTarget, gitCommit, stdout = process.stdout } = {}) {
  const accountId = env.CLOUDFLARE_ACCOUNT_ID;
  if (!/^[a-f\d]{32}$/.test(accountId || "") || env.CREAM_FRESH_ACCOUNT_ID !== accountId) throw new Error("Expected account must exactly match CLOUDFLARE_ACCOUNT_ID before any Cloudflare operation.");
  if (!env.CLOUDFLARE_API_TOKEN?.trim() || !env.GITHUB_ENV) throw new Error("Cloudflare authorization and the GitHub environment file are required.");
  const publicKey = recipientPublicKey(env.CREAM_RECIPIENT_PUBLIC_KEY_B64);
  const commit = gitCommit ?? execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  const metadata = bootstrapMetadata(env, publicKey, commit);
  await guard({ apiToken: env.CLOUDFLARE_API_TOKEN, accountId, expectedAccountId: env.CREAM_FRESH_ACCOUNT_ID, fetchImpl });
  const hubToken = randomBytes(32).toString("hex");
  // This workflow command masks the value before it reaches subsequent steps.
  stdout.write(`::add-mask::${hubToken}\n`);
  const sealed = sealHubAccess(hubToken, publicKey, metadata);
  const directory = join(root, ".cream-deploy");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const sealedPath = join(directory, SEALED_FILENAME);
  await writeFile(sealedPath, `${JSON.stringify(sealed, null, 2)}\n`, { flag: "wx", mode: 0o400 });
  await chmod(sealedPath, 0o400);
  // GITHUB_ENV is the sole plaintext handoff; never use step outputs or artifacts.
  await appendFile(env.GITHUB_ENV, `HUB_TOKEN=${hubToken}\n`, { mode: 0o600 });
  return { sealedPath, metadata };
}

export function bootstrapFailureMessage(error, env = process.env) {
  let detail = typeof error?.message === "string" ? error.message : "Verify the fresh account, public key, source and run metadata.";
  const sensitive = [env.CLOUDFLARE_API_TOKEN, env.HUB_TOKEN, env.CREAM_RECIPIENT_PUBLIC_KEY_B64]
    .filter((value) => typeof value === "string" && value.length > 0)
    .flatMap((value) => [value, value.trim()])
    .filter(Boolean)
    .sort((first, second) => second.length - first.length);
  for (const value of sensitive) detail = detail.replaceAll(value, "[REDACTED]");
  detail = detail.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, " ").replace(/\s+/g, " ").trim().slice(0, 500);
  return `Bootstrap preparation failed: ${detail || "Unknown preparation error."} No Cloudflare resource was changed.`;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  prepareBootstrap().then(() => console.log("Fresh target verified; encrypted Hub access is ready for mandatory upload.")).catch((error) => {
    console.error(bootstrapFailureMessage(error));
    process.exitCode = 1;
  });
}
