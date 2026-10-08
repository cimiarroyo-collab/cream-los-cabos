import { spawn, execFileSync } from "node:child_process";
import { access, cp, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { StringDecoder } from "node:string_decoder";
import { assertMigrationCompatible } from "./deploy-cloudflare.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const WORKER = "cream-los-cabos-preview";
const DATABASE = "cream-los-cabos-preview";
const EMPTY_ID = "00000000-0000-0000-0000-000000000000";
const UUID = /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;

export function requireWorkerTarget(env) {
  const required = ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID", "CREAM_D1_DATABASE_ID"];
  if (required.some((key) => !env[key]?.trim())) {
    throw new Error(`Faltan credenciales o destino privado: ${required.filter((key) => !env[key]?.trim()).join(", ")}. No se modificó Cloudflare.`);
  }
  if (!/^[a-f\d]{32}$/i.test(env.CLOUDFLARE_ACCOUNT_ID)) throw new Error("CLOUDFLARE_ACCOUNT_ID no es un identificador de cuenta válido.");
  if (!UUID.test(env.CREAM_D1_DATABASE_ID) || env.CREAM_D1_DATABASE_ID === EMPTY_ID) throw new Error("CREAM_D1_DATABASE_ID debe identificar la D1 existente.");
  return { accountId: env.CLOUDFLARE_ACCOUNT_ID, apiToken: env.CLOUDFLARE_API_TOKEN, databaseId: env.CREAM_D1_DATABASE_ID };
}

export function assertExistingWorker(settings, database, targetId, subdomain) {
  if (database?.name !== DATABASE || database?.uuid !== targetId) throw new Error("La base indicada no es la D1 existente de esta publicación. No se creará ni cambiará ninguna base.");
  const bindings = settings?.bindings;
  if (!Array.isArray(bindings) || !bindings.some((binding) => binding.name === "DB" && binding.type === "d1" && binding.id === targetId)) {
    throw new Error("El binding DB del Worker no coincide con la D1 indicada. Se conserva sin cambios.");
  }
  if (!bindings.some((binding) => binding.name === "ASSETS" && binding.type === "assets")) throw new Error("El Worker existente no tiene el binding ASSETS esperado.");
  if (!bindings.some((binding) => binding.name === "HUB_TOKEN" && binding.type === "secret_text")) throw new Error("Falta el secreto privado HUB_TOKEN del Worker existente. No se cambia ni se muestra su valor.");
  if (bindings.some((binding) => !["secret_text", "secret_key", "plain_text", "json"].includes(binding.type) && !((binding.name === "DB" && binding.type === "d1") || (binding.name === "ASSETS" && binding.type === "assets")))) {
    throw new Error("El Worker tiene bindings adicionales. Revisar su configuración antes de actualizar; no se eliminarán bindings.");
  }
  if (subdomain?.enabled !== true) throw new Error("workers.dev está deshabilitado en esta publicación. No se modifican rutas ni dominios automáticamente.");
}

export async function inspectExistingDatabase(api, databaseId) {
  const query = async (sql) => {
    const result = await api(`/d1/database/${databaseId}/query`, { method: "POST", body: { sql, params: [] } });
    if (!Array.isArray(result) || result.some((entry) => entry.success === false)) throw new Error("No se pudo verificar el esquema existente de D1.");
    return result.flatMap((entry) => entry.results || []);
  };
  const [tables, columns] = await Promise.all([
    query("SELECT name FROM sqlite_master WHERE type = 'table'"),
    query("PRAGMA table_info(orders)"),
  ]);
  const tableNames = tables.map((table) => table.name);
  if (!columns.length) throw new Error("La publicación existente no tiene la tabla orders. Se requiere revisar su D1 antes de actualizar.");
  const migrations = tableNames.includes("d1_migrations") ? await query("SELECT name FROM d1_migrations ORDER BY id") : [];
  let memberSchema = null;
  if (tableNames.includes("club_members")) {
    const [cardColumns, foreignKeys, uniqueRequestId] = await Promise.all([
      query("PRAGMA table_info(club_members)"),
      query("PRAGMA foreign_key_list(orders)"),
      query(`SELECT 1 AS present FROM pragma_index_list('club_members') AS indexes
        WHERE indexes.[unique] = 1 AND indexes.partial = 0 AND
        (SELECT COUNT(*) FROM pragma_index_info(indexes.name)) = 1 AND
        (SELECT name FROM pragma_index_info(indexes.name)) = 'request_id'
        LIMIT 1`),
    ]);
    memberSchema = { columns: cardColumns, foreignKeys, uniqueRequestId: uniqueRequestId.length === 1 };
  }
  assertMigrationCompatible(columns, migrations.map((row) => row.name), tableNames, memberSchema);
}

export function makeWorkerConfig(template, databaseId) {
  const config = structuredClone(template);
  if (config.name !== WORKER || config.main !== "entry.mjs" || config.d1_databases?.length !== 1 || config.d1_databases[0].binding !== "DB" || config.d1_databases[0].database_name !== DATABASE || !UUID.test(databaseId)) {
    throw new Error("La plantilla del Worker o el destino D1 no corresponden a esta publicación.");
  }
  config.d1_databases[0].database_id = databaseId;
  return config;
}

export function selectPreviousDeployment(deployments) {
  const previous = deployments?.deployments?.[0];
  if (previous?.versions?.length !== 1 || !UUID.test(previous.versions[0].version_id || "") || previous.versions[0].percentage !== 100) {
    throw new Error("No se identificó una versión anterior al 100% para recuperación. Revisar el despliegue antes de actualizar.");
  }
  return previous;
}

export function uploadedVersion(output) {
  const versions = output.trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line))
    .filter((entry) => entry.type === "version-upload" && entry.worker_name === WORKER && UUID.test(entry.version_id || ""));
  if (versions.length !== 1) throw new Error("No se pudo identificar de forma segura la versión subida. No se cambió el tráfico del Worker.");
  return versions[0].version_id;
}

function run(command, args, { cwd = ROOT, env = process.env, token = "" } = {}) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { cwd, env, shell: false, stdio: ["ignore", "pipe", "pipe"] });
    for (const [stream, target] of [[child.stdout, process.stdout], [child.stderr, process.stderr]]) {
      const decoder = new StringDecoder("utf8");
      let pending = "";
      const write = (value) => target.write(token ? value.replaceAll(token, "[REDACTADO]") : value);
      stream.on("data", (chunk) => {
        pending += decoder.write(chunk);
        let end;
        while ((end = pending.indexOf("\n")) !== -1) {
          write(pending.slice(0, end + 1));
          pending = pending.slice(end + 1);
        }
      });
      stream.on("end", () => write(pending + decoder.end()));
    }
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolveRun() : reject(new Error(`Falló la preparación o actualización (código ${code}). Se conservan los recursos y la copia de recuperación.`)));
  });
}

export async function main(args = process.argv.slice(2), env = process.env) {
  if (args.length !== 1 || !["--prepare", "--deploy"].includes(args[0])) throw new Error("Uso: node scripts/update-existing-worker.mjs --prepare | --deploy");
  const deploy = args[0] === "--deploy";
  // Reject missing authorization before any network request or file write.
  const target = deploy ? requireWorkerTarget(env) : null;
  if (deploy && execFileSync("git", ["status", "--porcelain"], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim()) {
    throw new Error("El repositorio contiene cambios sin commit. Guardar y revisar la versión antes de actualizar el Worker.");
  }
  const wrangler = join(ROOT, "node_modules", "wrangler", "bin", "wrangler.js");
  await access(wrangler).catch(() => { throw new Error("Faltan dependencias; ejecutar npm ci."); });
  const template = JSON.parse(await readFile(join(ROOT, "worker", "wrangler.example.json"), "utf8"));
  const config = makeWorkerConfig(template, target?.databaseId || EMPTY_ID);
  let api;
  let previousDeployment;
  if (deploy) {
    api = async (path, { method = "GET", body } = {}) => {
      const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${target.accountId}${path}`, {
        method,
        headers: { Authorization: `Bearer ${target.apiToken}`, "Content-Type": "application/json" },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(30000),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok || result?.success !== true) throw new Error(`Cloudflare rechazó la verificación de ${path} (HTTP ${response.status}). No se crean recursos ni se cambian destinos.`);
      return result.result;
    };
    console.log("Verificando Worker, binding, secreto existente y D1 antes de modificar recursos…");
    const [settings, database, subdomain, deployments] = await Promise.all([
      api(`/workers/scripts/${WORKER}/settings`),
      api(`/d1/database/${target.databaseId}`),
      api(`/workers/scripts/${WORKER}/subdomain`),
      api(`/workers/scripts/${WORKER}/deployments`),
    ]);
    assertExistingWorker(settings, database, target.databaseId, subdomain);
    if (typeof subdomain.previews_enabled === "boolean") config.preview_urls = subdomain.previews_enabled;
    previousDeployment = selectPreviousDeployment(deployments);
    await inspectExistingDatabase(api, target.databaseId);
  }
  const stagingRoot = join(ROOT, ".cream-deploy");
  await mkdir(stagingRoot, { recursive: true, mode: 0o700 });
  const staging = await mkdtemp(join(stagingRoot, "worker-"));
  const outputPath = join(staging, "wrangler-output.jsonl");
  const childEnv = { ...env, CI: "true", WRANGLER_SEND_METRICS: "false", WRANGLER_LOG_SANITIZE: "true", WRANGLER_LOG_PATH: join(staging, "wrangler.log"), WRANGLER_OUTPUT_FILE_PATH: outputPath };
  const options = { env: childEnv, token: target?.apiToken };
  console.log("Construyendo frontend y compilando las Pages Functions existentes…");
  await run("npm", ["run", deploy ? "check" : "build"], options);
  await Promise.all(["dist", "migrations"].map((directory) => cp(join(ROOT, directory), join(staging, directory), { recursive: true })));
  await Promise.all(["entry.mjs", "router.mjs"].map((file) => cp(join(ROOT, "worker", file), join(staging, file))));
  await writeFile(join(staging, "wrangler.json"), `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  const cli = (parameters) => run(process.execPath, [wrangler, ...parameters], { ...options, cwd: staging });
  // --outfile is a multipart upload bundle in Wrangler 4, not an importable module.
  // --outdir emits index.js plus any additional modules as genuine ES modules.
  await cli(["pages", "functions", "build", join(ROOT, "functions"), "--outdir", join(staging, "pages-functions"), "--project-directory", ROOT]);
  await access(join(staging, "pages-functions", "index.js")).catch(() => {
    throw new Error("Pages Functions no generó el módulo index.js esperado. No se publicó el Worker.");
  });
  await cli(["versions", "upload", "--dry-run", "--outdir", join(staging, "bundle")]);
  if (!deploy) {
    console.log(`Worker preparado y compilado sin publicar: ${staging}`);
    return { staging, deployed: false };
  }
  const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  await writeFile(join(staging, "previous-deployment.json"), `${JSON.stringify(previousDeployment, null, 2)}\n`, { mode: 0o600 });
  console.log("Guardando export D1 antes de aplicar migraciones aditivas…");
  await cli(["d1", "export", DATABASE, "--remote", "--output", join(staging, "database-before.sql")]);
  console.log("Aplicando únicamente migraciones pendientes y conservando pedidos…");
  await cli(["d1", "migrations", "apply", DATABASE, "--remote"]);
  await inspectExistingDatabase(api, target.databaseId);
  console.log("Actualizando el Worker existente; se conservan variables y secretos…");
  await cli(["versions", "upload", "--strict", "--keep-vars", "--message", `CREAM ${commit}`]);
  const versionId = uploadedVersion(await readFile(outputPath, "utf8"));
  // Deploy a code/asset version only: do not rewrite routes, domains or subdomain settings.
  await cli(["versions", "deploy", `${versionId}@100%`, "--yes", "--message", `CREAM ${commit}`]);
  const current = selectPreviousDeployment(await api(`/workers/scripts/${WORKER}/deployments`));
  if (current.versions[0].version_id !== versionId) throw new Error("Cloudflare no confirmó la versión nueva al 100%. Se conserva la copia de recuperación para diagnóstico.");
  console.log(`Actualización publicada. Copia D1 y versión previa: ${staging}. La comprobación pública debe realizarse desde un entorno autorizado; este script no elude restricciones de acceso.`);
  return { staging, deployed: true, versionId };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(process.env.CLOUDFLARE_API_TOKEN ? error.message.replaceAll(process.env.CLOUDFLARE_API_TOKEN, "[REDACTADO]") : error.message);
    process.exitCode = 1;
  });
}
