import { spawn, execFileSync } from "node:child_process";
import { access, cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { StringDecoder } from "node:string_decoder";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PROJECT = "cream-los-cabos";
const API = "https://api.cloudflare.com/client/v4";
const INITIAL_MIGRATION = "0001_original_orders.sql";
const FINAL_MIGRATION = "0002_order_tracking_and_customization.sql";
const BASE_COLUMNS = ["id", "customer", "branch", "items", "status", "total", "created_at"];
const NEW_COLUMNS = ["phone", "note", "updated_at", "request_id", "tracking_token", "payload_hash"];

export function requireCredentials(env) {
  const required = ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID", "HUB_TOKEN"];
  const missing = required.filter((name) => !env[name]?.trim());
  if (missing.length) {
    throw new Error(`Falta configurar ${missing.join(", ")} en el entorno privado. No se ha desplegado ni modificado ningún recurso de Cloudflare.`);
  }
  if (!/^[a-f\d]{32}$/i.test(env.CLOUDFLARE_ACCOUNT_ID)) {
    throw new Error("CLOUDFLARE_ACCOUNT_ID debe ser el identificador de cuenta de 32 caracteres.");
  }
  if (env.HUB_TOKEN.trim().length < 12 || /[\r\n]/.test(env.HUB_TOKEN) || env.HUB_TOKEN !== env.HUB_TOKEN.trim()) {
    throw new Error("HUB_TOKEN requiere al menos 12 caracteres, sin saltos de línea ni espacios al principio o al final.");
  }
  return { apiToken: env.CLOUDFLARE_API_TOKEN, accountId: env.CLOUDFLARE_ACCOUNT_ID, hubToken: env.HUB_TOKEN };
}

export function assertMigrationCompatible(columns, migrationNames, tableNames = ["orders"]) {
  const unexpectedTables = tableNames.filter((name) => name !== "orders" && name !== "d1_migrations" && !name.startsWith("sqlite_") && !name.startsWith("_cf_"));
  if (unexpectedTables.length) throw new Error("La D1 existente contiene tablas de otra aplicación. Revisar la base antes de desplegar; no se ha modificado.");
  const migrations = new Set(migrationNames);
  if (migrationNames.some((name) => ![INITIAL_MIGRATION, FINAL_MIGRATION].includes(name))) {
    throw new Error("La D1 existente tiene migraciones ajenas a este MVP. Revisar su historial antes de desplegar; no se ha modificado.");
  }
  if (!columns.length) {
    if (migrations.size) throw new Error("La D1 registra migraciones pero no contiene orders. Revisar la base antes de desplegar.");
    return;
  }
  const names = new Set(columns.map((column) => column.name));
  if (BASE_COLUMNS.some((name) => !names.has(name)) || columns.some((column) => ![...BASE_COLUMNS, ...NEW_COLUMNS].includes(column.name))) {
    throw new Error("La tabla orders existente no coincide con el esquema original de Cream. No se aplicarán migraciones.");
  }
  const id = columns.find((column) => column.name === "id");
  if (String(id.type).toUpperCase() !== "INTEGER" || Number(id.pk) !== 1) {
    throw new Error("La clave primaria de orders no es compatible con Cream. No se aplicarán migraciones.");
  }
  const newColumns = NEW_COLUMNS.filter((name) => names.has(name));
  if (migrations.has(FINAL_MIGRATION)) {
    if (!migrations.has(INITIAL_MIGRATION) || newColumns.length !== NEW_COLUMNS.length) {
      throw new Error("El historial y las columnas de D1 no coinciden. Revisar la base antes de desplegar.");
    }
  } else if (newColumns.length) {
    throw new Error("D1 ya tiene columnas del MVP sin registrar la segunda migración. Conciliar su historial antes de desplegar; no se modificarán ni borrarán datos.");
  }
}

export function assertPagesCompatible(project, databaseId) {
  if (!project) return;
  if (project.production_branch !== "main") {
    throw new Error("El proyecto Pages existente utiliza otra rama de producción. Revisar su configuración antes de desplegar; se conserva sin cambios.");
  }
  if (project.source) {
    const source = project.source;
    if (source.type !== "github" || source.config?.owner?.toLowerCase() !== "cimiarroyo-collab" || source.config?.repo_name !== PROJECT) {
      throw new Error("El proyecto Pages existente está vinculado a otro repositorio o su vínculo no pudo verificarse. Se conserva sin cambios.");
    }
  }
  const binding = project.deployment_configs?.production?.d1_databases?.DB;
  if (binding && (!databaseId || binding.id !== databaseId)) {
    throw new Error("El binding DB de Pages apunta a otra D1. Revisar esa base antes de desplegar; no se cambiará el destino de los pedidos existentes.");
  }
}

export function makeDeploymentConfig(template, databaseId, repositoryRoot) {
  if (!/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(databaseId)) {
    throw new Error("Cloudflare no devolvió un UUID válido para D1.");
  }
  const replaceExactlyOnce = (source, expression, replacement) => {
    if ([...source.matchAll(expression)].length !== 1) throw new Error("wrangler.toml cambió: revisar sus bindings y rutas antes de desplegar.");
    return source.replace(expression, replacement);
  };
  let config = replaceExactlyOnce(template, /^database_id\s*=\s*"[^"]+"\s*$/gm, `database_id = ${JSON.stringify(databaseId)}`);
  config = replaceExactlyOnce(config, /^migrations_dir\s*=\s*"[^"]+"\s*$/gm, `migrations_dir = ${JSON.stringify(join(repositoryRoot, "migrations"))}`);
  config = replaceExactlyOnce(config, /^pages_build_output_dir\s*=\s*"[^"]+"\s*$/gm, 'pages_build_output_dir = "dist"');
  if (!/^name\s*=\s*"cream-los-cabos"\s*$/m.test(config) || !/^binding\s*=\s*"DB"\s*$/m.test(config)) {
    throw new Error("wrangler.toml no declara el proyecto Cream y su binding DB esperado.");
  }
  return config;
}

function redactor(secrets) {
  return (value) => secrets.reduce((text, secret) => text.replaceAll(secret, "[REDACTADO]"), String(value));
}

function run(command, args, { cwd = ROOT, env = process.env, input, redact, capture = false } = {}) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { cwd, env, shell: false, stdio: ["pipe", "pipe", "pipe"] });
    const output = [];
    for (const [stream, target] of [[child.stdout, process.stdout], [child.stderr, process.stderr]]) {
      const decoder = new StringDecoder("utf8");
      let pending = "";
      const write = (value) => {
        const safe = redact ? redact(value) : value;
        if (capture) output.push(safe);
        else target.write(safe);
      };
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
    child.stdin.on("error", (error) => { if (error.code !== "EPIPE") reject(error); });
    child.on("close", (code, signal) => {
      if (code === 0) resolveRun(output.join(""));
      else reject(new Error(`Falló ${command === process.execPath ? "Wrangler" : command} (${signal || `código ${code}`}). No se eliminaron recursos; revisar el error y volver a ejecutar.`));
    });
    child.stdin.end(input);
  });
}

async function inspectDatabase(api, databaseId) {
  const query = async (sql) => {
    const result = await api(`/d1/database/${databaseId}/query`, { method: "POST", body: { sql, params: [] } });
    if (!Array.isArray(result) || result.some((entry) => entry.success === false)) throw new Error("No se pudo verificar el esquema de D1.");
    return result.flatMap((entry) => entry.results || []);
  };
  const [tables, columns] = await Promise.all([
    query("SELECT name FROM sqlite_master WHERE type = 'table'"),
    query("PRAGMA table_info(orders)"),
  ]);
  const migrations = tables.some((table) => table.name === "d1_migrations") ? await query("SELECT name FROM d1_migrations ORDER BY id") : [];
  assertMigrationCompatible(columns, migrations.map((row) => row.name), tables.map((row) => row.name));
}

async function verifyLive(baseURL, hubToken) {
  const request = (path, options = {}) => fetch(`${baseURL}${path}`, { ...options, redirect: "error", signal: AbortSignal.timeout(15000) });
  for (const path of ["/club", "/hub"]) {
    const response = await request(path);
    if (response.status !== 200 || !response.headers.get("content-type")?.includes("text/html") || !(await response.text()).includes('id="root"')) {
      throw new Error(`La ruta pública ${path} todavía no sirve la aplicación.`);
    }
  }
  const session = await request("/api/hub/session");
  const sessionBody = await session.json();
  if (session.status !== 200 || sessionBody.configured !== true || sessionBody.authenticated !== false) throw new Error("La API pública no confirma la configuración de Cream Hub.");
  const unauthorized = await request("/api/orders");
  if (unauthorized.status !== 401) throw new Error("La lista de pedidos no está protegida por la sesión esperada.");
  const login = await request("/api/hub/session", { method: "POST", headers: { "Content-Type": "application/json", Origin: baseURL }, body: JSON.stringify({ token: hubToken }) });
  const cookieHeader = login.headers.get("set-cookie") || "";
  if (login.status !== 200 || !/HttpOnly/i.test(cookieHeader) || !/;\s*Secure/i.test(cookieHeader) || !/SameSite=Strict/i.test(cookieHeader)) throw new Error("Cream Hub no abre una sesión segura con la clave configurada.");
  const cookie = cookieHeader.split(";")[0];
  try {
    const authenticated = await request("/api/hub/session", { headers: { Cookie: cookie } });
    if (authenticated.status !== 200 || (await authenticated.json()).authenticated !== true) throw new Error("La sesión firmada de Cream Hub no pudo verificarse.");
    const orders = await request("/api/orders", { headers: { Cookie: cookie } });
    if (orders.status !== 200 || !Array.isArray(await orders.json())) throw new Error("Cream Hub no puede leer pedidos en D1.");
  } finally {
    const logout = await request("/api/hub/session", { method: "DELETE", headers: { Cookie: cookie, Origin: baseURL } });
    if (logout.status !== 200 || !/Max-Age=0/i.test(logout.headers.get("set-cookie") || "")) throw new Error("Cream Hub no pudo cerrar la sesión de verificación.");
  }
}

export async function main() {
  // Missing credentials must fail before API calls, subprocesses, or filesystem writes.
  const credentials = requireCredentials(process.env);
  const redact = redactor([credentials.apiToken, credentials.hubToken]);
  const log = (message) => console.log(redact(message));
  const wrangler = join(ROOT, "node_modules", "wrangler", "bin", "wrangler.js");
  await access(wrangler).catch(() => { throw new Error("Faltan las dependencias. Ejecutar npm ci antes de desplegar."); });
  const template = await readFile(join(ROOT, "wrangler.toml"), "utf8");
  const compatibilityDate = template.match(/^compatibility_date\s*=\s*"([^"\n]+)"/m)?.[1];
  if (!compatibilityDate) throw new Error("Falta compatibility_date en wrangler.toml.");
  makeDeploymentConfig(template, "00000000-0000-0000-0000-000000000000", ROOT);
  const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  const dirty = Boolean(execFileSync("git", ["status", "--porcelain"], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim());
  const api = async (path, { method = "GET", body, allowMissing = false } = {}) => {
    const response = await fetch(`${API}/accounts/${credentials.accountId}${path}`, {
      method,
      headers: { Authorization: `Bearer ${credentials.apiToken}`, "Content-Type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(30000),
    });
    const data = await response.json().catch(() => null);
    if (allowMissing && response.status === 404 && data?.errors?.some((error) => error.code === 8000007)) return null;
    if (!response.ok || data?.success !== true) {
      const codes = data?.errors?.map((error) => error.code).join(", ") || "sin código";
      throw new Error(`Cloudflare rechazó ${method} ${path} (HTTP ${response.status}; ${codes}). Revisar los permisos de Pages y D1 del token.`);
    }
    return data.result;
  };
  log("Verificando recursos existentes de Cloudflare Pages y D1…");
  let [project, databases] = await Promise.all([
    api(`/pages/projects/${PROJECT}`, { allowMissing: true }),
    (async () => {
      const all = [];
      for (let page = 1; ; page += 1) {
        const batch = await api(`/d1/database?name=${PROJECT}&per_page=100&page=${page}`);
        if (!Array.isArray(batch)) throw new Error("Cloudflare no devolvió una lista válida de D1.");
        all.push(...batch);
        if (batch.length < 100) return all;
      }
    })(),
  ]);
  const matching = databases.filter((database) => database.name === PROJECT);
  if (matching.length > 1) throw new Error("Hay más de una D1 con el nombre Cream. Resolver esa ambigüedad antes de desplegar.");
  let database = matching[0];
  assertPagesCompatible(project, database?.uuid);
  if (database) await inspectDatabase(api, database.uuid);
  if (project?.source) log("Se conserva el vínculo existente con cimiarroyo-collab/cream-los-cabos y su configuración de build.");
  log("Ejecutando pruebas y build antes de modificar recursos…");
  await run("npm", ["run", "check"], { redact });
  if (!database) {
    log("Creando la base D1 de Cream…");
    database = await api("/d1/database", { method: "POST", body: { name: PROJECT } });
  }
  // Validate the response before creating another resource or running migrations.
  const config = makeDeploymentConfig(template, database.uuid, ROOT);
  if (!project) {
    log("Creando el proyecto Cloudflare Pages de Cream…");
    project = await api("/pages/projects", { method: "POST", body: {
      name: PROJECT,
      production_branch: "main",
      build_config: { build_command: "npm run build", destination_dir: "dist" },
      deployment_configs: { production: { compatibility_date: compatibilityDate }, preview: { compatibility_date: compatibilityDate } },
    } });
  }
  let staging;
  try {
    const stagingRoot = join(ROOT, ".cream-deploy");
    await mkdir(stagingRoot, { recursive: true, mode: 0o700 });
    staging = await mkdtemp(join(stagingRoot, "run-"));
    await writeFile(join(staging, "wrangler.toml"), config, { mode: 0o600 });
    await Promise.all(["functions", "shared", "dist"].map((directory) => cp(join(ROOT, directory), join(staging, directory), { recursive: true })));
    const env = { ...process.env, WRANGLER_LOG_PATH: join(staging, "wrangler.log"), WRANGLER_LOG_SANITIZE: "true", WRANGLER_SEND_METRICS: "false", CI: "true" };
    const cli = (args, options = {}) => run(process.execPath, [wrangler, ...args], { cwd: staging, env, redact, ...options });
    log("Aplicando únicamente las migraciones pendientes de D1…");
    await cli(["d1", "migrations", "apply", PROJECT, "--remote"]);
    await inspectDatabase(api, database.uuid);
    log("Configurando la clave privada de Cream Hub en producción…");
    // Pages secrets target production by default; do not rely on its hidden --env flag.
    await cli(["pages", "secret", "put", "HUB_TOKEN", "--project-name", PROJECT], { input: `${credentials.hubToken}\n` });
    log("Desplegando frontend y Pages Functions en la rama main…");
    await cli(["pages", "deploy", "dist", "--project-name", PROJECT, "--branch", "main", "--commit-hash", commit, `--commit-dirty=${dirty}`, "--commit-message", "Cream Los Cabos: producción verificada"]);
    const deployed = await api(`/pages/projects/${PROJECT}`);
    if (!/^[a-z\d.-]+\.pages\.dev$/i.test(deployed.subdomain || "")) throw new Error("Cloudflare no devolvió un dominio público válido de Pages.");
    const baseURL = `https://${deployed.subdomain}`;
    let verified = false;
    let lastError;
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      try {
        await verifyLive(baseURL, credentials.hubToken);
        verified = true;
        break;
      } catch (error) {
        lastError = error;
        if (attempt < 5) {
          log("Esperando propagación del despliegue y verificando las interfaces…");
          await new Promise((resolveWait) => setTimeout(resolveWait, 2000));
        }
      }
    }
    if (!verified) throw new Error(`Se publicó ${baseURL}, pero la verificación pública falló: ${lastError?.message}. El despliegue se conserva para diagnóstico.`);
    log(`Publicado y verificado: ${baseURL}/club y ${baseURL}/hub`);
    log("Verificación: rutas públicas, acceso protegido, sesión segura, lectura de pedidos en D1 y cierre de sesión. No se crearon pedidos de prueba.");
  } finally {
    if (staging) await rm(staging, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    const redact = redactor([process.env.CLOUDFLARE_API_TOKEN, process.env.HUB_TOKEN].filter(Boolean));
    console.error(redact(error.message));
    process.exitCode = 1;
  });
}
