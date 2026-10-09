import { constants, createPrivateKey, privateDecrypt, timingSafeEqual } from "node:crypto";
import { chmod, lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { keyFingerprint, metadataDigest, PROJECT } from "./bootstrap-hub.mjs";

export function unsealHubAccess(sealed, privateKeyPem, expected) {
  if (!sealed || sealed.format !== "cream-hub-access/v1" || sealed.algorithm !== "RSA-OAEP-SHA256") throw new Error("Unsupported sealed access format.");
  const fields = ["accountId", "projectName", "repository", "runId", "runAttempt", "commit", "recipientFingerprint"];
  if (!sealed.metadata || Object.keys(sealed.metadata).length !== fields.length) throw new Error("Invalid sealed metadata.");
  for (const field of fields) {
    if (!expected?.[field] || sealed.metadata[field] !== expected[field]) throw new Error(`Trusted ${field} does not match the sealed run.`);
  }
  let privateKey;
  try { privateKey = createPrivateKey(privateKeyPem); } catch { throw new Error("Private key could not be parsed."); }
  if (privateKey.asymmetricKeyType !== "rsa" || privateKey.asymmetricKeyDetails?.modulusLength < 3072 || keyFingerprint(privateKey) !== expected.recipientFingerprint) throw new Error("Private key does not match the trusted recipient fingerprint.");
  if (typeof sealed.ciphertext !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(sealed.ciphertext)) throw new Error("Invalid sealed ciphertext.");
  let inner;
  try {
    inner = JSON.parse(privateDecrypt({ key: privateKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" }, Buffer.from(sealed.ciphertext, "base64")).toString("utf8"));
  } catch { throw new Error("The sealed access could not be decrypted."); }
  const digest = metadataDigest(sealed.metadata);
  if (!/^[a-f0-9]{64}$/.test(inner?.metadataSHA256 || "") || !timingSafeEqual(Buffer.from(inner.metadataSHA256, "hex"), Buffer.from(digest, "hex")) || !/^[a-f0-9]{64}$/.test(inner?.hubToken || "")) throw new Error("Encrypted metadata does not match the trusted sealed run.");
  return inner.hubToken;
}

export async function writePrivateHubCode(outputPath, hubToken) {
  if (!/^[a-f0-9]{64}$/.test(hubToken)) throw new Error("Invalid Hub code.");
  const path = resolve(outputPath);
  const directory = dirname(path);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const details = await lstat(directory);
  if (!details.isDirectory() || details.isSymbolicLink() || (details.mode & 0o077) !== 0) throw new Error("Output directory must be a real private directory with mode 0700.");
  await writeFile(path, `${hubToken}\n`, { flag: "wx", mode: 0o600 });
  await chmod(path, 0o600);
  return path;
}

export async function unsealCLI(args) {
  const flags = {};
  const allowed = new Set(["--sealed", "--private-key", "--out", "--account", "--commit", "--run", "--attempt", "--fingerprint", "--repository"]);
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    if (!allowed.has(flag) || flags[flag] || !args[index + 1] || args[index + 1].startsWith("--")) throw new Error("Required trusted unseal flags are missing or invalid.");
    flags[flag] = args[index + 1];
  }
  if (Object.keys(flags).length !== allowed.size) throw new Error("Provide sealed file, local private key, private output and every trusted run field.");
  const sealed = JSON.parse(await readFile(resolve(flags["--sealed"]), "utf8"));
  const privateKeyPem = await readFile(resolve(flags["--private-key"]), "utf8");
  const hubToken = unsealHubAccess(sealed, privateKeyPem, {
    accountId: flags["--account"], projectName: PROJECT, repository: flags["--repository"],
    commit: flags["--commit"], runId: flags["--run"], runAttempt: flags["--attempt"], recipientFingerprint: flags["--fingerprint"],
  });
  await writePrivateHubCode(flags["--out"], hubToken);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  unsealCLI(process.argv.slice(2)).then(() => console.log("Hub code saved to the requested private file.")).catch(() => {
    console.error("Unseal failed. Verify the independently trusted account, source, run and recipient key; no code was printed.");
    process.exitCode = 1;
  });
}
