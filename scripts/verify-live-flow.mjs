import { randomUUID } from "node:crypto";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { BRANCHES, PRODUCTS, STATUSES, STATIONS, defaultSelections, priceItem } from "../shared/catalog.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const TEST_MARKER = "PRUEBA TÉCNICA — NO PREPARAR";
const PHONE = "0000000000";
const UUID = /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i;

function requireCheck(value, message) {
  if (!value) throw new Error(`Verificación pública: ${message}.`);
}

export function technicalOrderItems() {
  const items = STATIONS.map((station) => {
    const product = PRODUCTS.find((entry) => entry.station === station && entry.price !== null);
    requireCheck(product, "catálogo incompleto");
    return { productId: product.id, quantity: 1, selections: defaultSelections(product), note: TEST_MARKER };
  });
  const customizable = items.find((item) => PRODUCTS.find((p) => p.id === item.productId).options.some((group) => group.values.length > 1));
  requireCheck(customizable, "personalización no disponible");
  const product = PRODUCTS.find((entry) => entry.id === customizable.productId);
  const group = product.options.find((entry) => entry.values.length > 1);
  customizable.selections[group.id] = group.values[1].id;
  return items;
}

export async function verifyLiveFlow({ baseURL, databaseId, commit, hubToken, fetchImpl = globalThis.fetch,
  reportPath = resolve(ROOT, ".cream-deploy/public-e2e.json") }) {
  let origin;
  try { origin = new URL(baseURL); } catch { throw new Error("Verificación pública: URL de Pages inválida."); }
  requireCheck(origin.protocol === "https:" && /^[a-z\d-]+\.pages\.dev$/i.test(origin.hostname) &&
    !origin.username && !origin.password && !origin.port && origin.pathname === "/" && !origin.search && !origin.hash,
  "URL de Pages inválida");
  requireCheck(typeof databaseId === "string" && /^[\da-f-]{36}$/i.test(databaseId), "identificador de D1 inválido");
  requireCheck(typeof commit === "string" && /^[\da-f]{40}$/i.test(commit), "commit inválido");
  requireCheck(typeof hubToken === "string" && hubToken.trim().length >= 12, "clave de Hub no configurada");
  const publicURL = origin.origin;
  const checks = {};
  let cookie = "";
  let report;
  let failure;

  async function request(path, { method = "GET", body, headers = {}, status = 200, session = false, json = true } = {}) {
    let response;
    try {
      response = await fetchImpl(`${publicURL}${path}`, {
        method, redirect: "error", signal: AbortSignal.timeout(30000),
        headers: { Origin: publicURL, ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
          ...(session ? { Cookie: cookie } : {}), ...headers },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
    } catch { throw new Error("Verificación pública: solicitud fallida."); }
    requireCheck(response.status === status, "respuesta HTTP inesperada");
    let data;
    if (json) {
      try { data = await response.json(); } catch { throw new Error("Verificación pública: respuesta JSON inválida."); }
    }
    return { response, data };
  }

  try {
    await request("/club", { json: false });
    checks.publicClub = true;
    await request("/hub", { json: false });
    checks.publicHubLogin = true;
    await request("/api/orders", { status: 401 });
    checks.anonymousOrdersDenied = true;
    const login = await request("/api/hub/session", { method: "POST", body: { token: hubToken } });
    const setCookie = login.response.headers.get("Set-Cookie") || "";
    // Capture the cookie immediately so a later failed assertion still logs the session out.
    cookie = setCookie.split(";")[0];
    requireCheck(/^cream_hub_session=[\da-f.-]+$/i.test(cookie) && /;\s*HttpOnly(?:;|$)/i.test(setCookie) &&
      /;\s*Secure(?:;|$)/i.test(setCookie) && /;\s*SameSite=Strict(?:;|$)/i.test(setCookie) &&
      /;\s*Path=\/api(?:;|$)/i.test(setCookie) && /;\s*Max-Age=28800(?:;|$)/i.test(setCookie), "cookie segura inválida");
    requireCheck(login.data.authenticated === true && login.data.configured === true, "sesión no autenticada");
    const session = await request("/api/hub/session", { session: true });
    requireCheck(session.data.authenticated === true, "sesión no persistida");
    checks.secureHubSession = true;

    const memberToken = randomUUID();
    const member = (await request("/api/members", { method: "POST", status: 201, body: {
      customer: TEST_MARKER, phone: PHONE, requestId: randomUUID(), accessToken: memberToken,
    } })).data;
    requireCheck(UUID.test(member.id || "") && member.deliveredCount === 0 && Array.isArray(member.recentOrders) &&
      member.recentOrders.length === 0, "tarjeta técnica inválida");
    await request(`/api/members/${member.id}`, { status: 404 });
    checks.anonymousMemberDenied = true;
    const items = technicalOrderItems();
    const expectedItems = items.map(priceItem);
    const branch = BRANCHES[0];
    const order = (await request("/api/orders", { method: "POST", status: 201,
      headers: { "X-Member-Token": memberToken }, body: {
        customer: TEST_MARKER, phone: PHONE, branch, memberId: member.id,
        requestId: randomUUID(), note: TEST_MARKER, items,
      } })).data;
    requireCheck(Number.isSafeInteger(order.id) && order.id > 0 && UUID.test(order.trackingToken || ""), "pedido técnico inválido");
    await request(`/api/orders/${order.id}`, { status: 404 });
    checks.anonymousTrackingDenied = true;
    function verifyOrder(value, status) {
      requireCheck(value?.id === order.id && value.status === status && value.branch === branch &&
        value.customer === TEST_MARKER && value.phone === PHONE && value.note === TEST_MARKER, "pedido o estado incorrecto");
      requireCheck(Array.isArray(value.items) && value.items.length === expectedItems.length &&
        expectedItems.every((expected, index) => {
          const actual = value.items[index];
          return actual?.productId === expected.productId && actual.station === expected.station &&
            actual.quantity === expected.quantity && actual.note === TEST_MARKER &&
            actual.unitPrice === expected.unitPrice && actual.total === expected.total &&
            JSON.stringify(actual.selections) === JSON.stringify(expected.selections) &&
            JSON.stringify(actual.options) === JSON.stringify(expected.options);
        }), "productos, estaciones o personalización incorrectos");
    }
    async function verifyState(status) {
      const list = (await request(`/api/orders?branch=${encodeURIComponent(branch)}`, { session: true })).data;
      requireCheck(Array.isArray(list), "lista de Hub inválida");
      verifyOrder(list.find((entry) => entry.id === order.id), status);
      const tracked = (await request(`/api/orders/${order.id}`, { headers: { "X-Order-Token": order.trackingToken } })).data;
      verifyOrder(tracked, status);
      for (const options of [{ headers: { "X-Member-Token": memberToken } }, { session: true }]) {
        const history = (await request(`/api/members/${member.id}`, options)).data;
        requireCheck(history.id === member.id && history.customer === TEST_MARKER &&
          history.deliveredCount === (status === STATUSES.at(-1) ? 1 : 0) &&
          history.recentOrders?.length === 1 && history.recentOrders[0].id === order.id &&
          history.recentOrders[0].status === status && history.recentOrders[0].branch === branch, "historial Club incorrecto");
      }
    }
    verifyOrder(order, STATUSES[0]);
    await verifyState(STATUSES[0]);
    const statusSequence = [STATUSES[0]];
    for (const status of STATUSES.slice(1)) {
      const updated = (await request(`/api/orders/${order.id}`, { method: "PATCH", session: true,
        body: { status, expectedStatus: statusSequence.at(-1) } })).data;
      verifyOrder(updated, status);
      await verifyState(status);
      statusSequence.push(status);
    }
    Object.assign(checks, { orderPersisted: true, hubItemsBranchStations: true, modificationPersisted: true,
      sequentialTransitions: true, customerTrackingEveryState: true, customerMemberHistoryEveryState: true,
      hubMemberHistoryEveryState: true, deliveredCount: true, technicalOrderDelivered: true });
    report = { publicURLs: { club: `${publicURL}/club`, hub: `${publicURL}/hub` }, orderID: order.id,
      statusSequence, stations: [...STATIONS], sourceCommit: commit, databaseID: databaseId,
      testMarker: TEST_MARKER, time: new Date().toISOString(), checks };
  } catch (error) {
    // Never forward request objects, response bodies, cookies or platform errors into CI logs.
    failure = new Error(error instanceof Error && error.message.startsWith("Verificación pública:")
      ? error.message : "Verificación pública: comprobación fallida.");
  } finally {
    if (cookie) {
      try {
        const logout = await request("/api/hub/session", { method: "DELETE", session: true });
        requireCheck(logout.data.authenticated === false && /Max-Age=0(?:;|$)/.test(logout.response.headers.get("Set-Cookie") || ""), "cierre de sesión fallido");
        cookie = "";
        const anonymous = await request("/api/hub/session");
        requireCheck(anonymous.data.authenticated === false, "sesión anónima inválida");
        await request("/api/orders", { status: 401 });
        checks.logout = true;
      } catch { failure ||= new Error("Verificación pública: cierre de sesión fallido."); }
      cookie = "";
    }
  }
  if (failure) throw failure;
  try {
    await mkdir(dirname(reportPath), { recursive: true, mode: 0o700 });
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
    await chmod(reportPath, 0o600);
  } catch { throw new Error("Verificación pública: informe no guardado."); }
  return report;
}

export async function main() {
  requireCheck(process.argv.slice(2).length === 1 && process.argv[2] === "--deploy-fresh", "se requiere --deploy-fresh");
  requireCheck(/^[\da-f]{32}$/i.test(process.env.CREAM_FRESH_ACCOUNT_ID || ""), "se requiere cuenta nueva explícita");
  requireCheck(typeof process.env.HUB_TOKEN === "string" && process.env.HUB_TOKEN.trim().length >= 12, "clave de Hub no configurada");
  const { main: deploy } = await import("./deploy-cloudflare.mjs");
  const deployment = await deploy();
  const report = await verifyLiveFlow({ ...deployment, hubToken: process.env.HUB_TOKEN });
  console.log(`Prueba técnica entregada: pedido #${report.orderID}. Informe: .cream-deploy/public-e2e.json`);
  return report;
}

export function safeCliDiagnostic(error, env = process.env) {
  let message = typeof error?.message === "string" ? error.message : "Comprobación fallida.";
  for (const secret of [env.CLOUDFLARE_API_TOKEN, env.HUB_TOKEN]) {
    if (typeof secret === "string" && secret.length) message = message.split(secret).join("[redactado]");
  }
  message = message.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, " ").slice(0, 500);
  return `Verificación pública fallida: ${message}`;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(safeCliDiagnostic(error));
    process.exitCode = 1;
  });
}
