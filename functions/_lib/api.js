const SESSION_COOKIE = "cream_hub_session";
const SESSION_SECONDS = 8 * 60 * 60;
const encoder = new TextEncoder();

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function apiResponse(data, status = 200, extraHeaders = {}) {
  return Response.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...extraHeaders,
    },
  });
}

export async function handleApi(callback) {
  try {
    return await callback();
  } catch (error) {
    if (error instanceof ApiError)
      return apiResponse({ error: error.message }, error.status);
    // Keep storage details, customer data and configured secrets out of public error responses.
    console.error("Cream API request failed:", error?.name || "Error");
    return apiResponse(
      {
        error:
          "No pudimos procesar la solicitud. Intenta de nuevo en un momento.",
      },
      500,
    );
  }
}

export function requireDatabase(env) {
  if (!env?.DB?.prepare) {
    throw new ApiError(
      503,
      "El servicio de pedidos no está disponible. Intenta más tarde.",
    );
  }
  return env.DB;
}

export function checkOrigin(request) {
  const origin = request.headers.get("Origin");
  if (origin && origin !== new URL(request.url).origin) {
    throw new ApiError(403, "No se permite esta solicitud desde otro sitio.");
  }
}

export async function readJson(request, maxBytes = 24 * 1024) {
  if (
    !/^application\/json(?:\s*;|$)/i.test(
      request.headers.get("Content-Type") || "",
    )
  ) {
    throw new ApiError(415, "La solicitud debe enviarse como JSON.");
  }
  if (Number(request.headers.get("Content-Length")) > maxBytes) {
    throw new ApiError(
      413,
      "El pedido es demasiado grande. Reduce las notas o los productos.",
    );
  }
  if (!request.body) throw new ApiError(400, "La solicitud está vacía.");
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new ApiError(
          413,
          "El pedido es demasiado grande. Reduce las notas o los productos.",
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  let body;
  try {
    body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new ApiError(400, "No pudimos leer la solicitud JSON.");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new ApiError(400, "La solicitud debe ser un objeto JSON.");
  }
  return body;
}

function hex(bytes) {
  return Array.from(new Uint8Array(bytes), (value) =>
    value.toString(16).padStart(2, "0"),
  ).join("");
}

export async function digest(text) {
  return hex(await crypto.subtle.digest("SHA-256", encoder.encode(text)));
}

export async function secureEqual(left, right) {
  const [a, b] = await Promise.all([
    digest(String(left)),
    digest(String(right)),
  ]);
  let different = 0;
  for (let i = 0; i < a.length; i += 1)
    different |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return different === 0;
}

export function hubConfigured(env) {
  return (
    typeof env?.HUB_TOKEN === "string" && env.HUB_TOKEN.trim().length >= 12
  );
}

function hubSecret(env) {
  if (!hubConfigured(env)) {
    throw new ApiError(
      503,
      "Cream Hub requiere configurar una clave de acceso de al menos 12 caracteres.",
    );
  }
  return env.HUB_TOKEN;
}

async function sign(message, secret) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return hex(await crypto.subtle.sign("HMAC", key, encoder.encode(message)));
}

function getSession(request) {
  const cookie = request.headers.get("Cookie") || "";
  for (const part of cookie.split(";")) {
    const trimmed = part.trim();
    if (trimmed.startsWith(`${SESSION_COOKIE}=`))
      return trimmed.slice(SESSION_COOKIE.length + 1);
  }
  return "";
}

export async function hasHubSession(request, env) {
  if (!hubConfigured(env)) return false;
  const token = getSession(request);
  if (token.length > 256) return false;
  const [issued, nonce, signature, extra] = token.split(".");
  if (
    extra ||
    !/^\d{10}$/.test(issued || "") ||
    !/^[\da-f-]{36}$/.test(nonce || "") ||
    !/^[\da-f]{64}$/.test(signature || "")
  )
    return false;
  const age = Math.floor(Date.now() / 1000) - Number(issued);
  if (age < -30 || age > SESSION_SECONDS) return false;
  return secureEqual(
    signature,
    await sign(`${issued}.${nonce}`, env.HUB_TOKEN),
  );
}

export async function requireHubSession(request, env) {
  hubSecret(env);
  if (!(await hasHubSession(request, env))) {
    throw new ApiError(401, "Inicia sesión en Cream Hub para continuar.");
  }
}

export async function createHubSession(request, env, token) {
  const secret = hubSecret(env);
  if (
    typeof token !== "string" ||
    token.length > 1024 ||
    !(await secureEqual(token, secret))
  ) {
    throw new ApiError(401, "La clave de acceso no es correcta.");
  }
  const message = `${Math.floor(Date.now() / 1000)}.${crypto.randomUUID()}`;
  const value = `${message}.${await sign(message, secret)}`;
  return sessionCookie(request, value, SESSION_SECONDS);
}

export function sessionCookie(request, value = "", maxAge = 0) {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${SESSION_COOKIE}=${value}; Path=/api; Max-Age=${maxAge}; HttpOnly; SameSite=Strict${secure}`;
}
