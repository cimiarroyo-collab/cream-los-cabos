const API = "https://api.cloudflare.com/client/v4";
const PROJECT = "cream-los-cabos";
const PAGE_SIZE = 100;
const UUID = /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;
const ACCOUNT_ID = /^[a-f\d]{32}$/i;

function responseError(message, { response, data } = {}) {
  const status = Number.isInteger(response?.status) && response.status >= 100 && response.status <= 599 ? response.status : "desconocido";
  const codes = Array.isArray(data?.errors) ? data.errors.map((error) => error?.code).filter(Number.isSafeInteger).slice(0, 5) : [];
  // Never include Cloudflare messages, bodies, headers, or nonnumeric codes.
  return new Error(`${message} (HTTP ${status}; códigos Cloudflare: ${codes.length ? codes.join(", ") : "sin códigos numéricos"}).`);
}

export function assertFreshAccountId(accountId, expectedAccountId) {
  if (typeof accountId !== "string" || typeof expectedAccountId !== "string" || !ACCOUNT_ID.test(accountId) || !ACCOUNT_ID.test(expectedAccountId)) {
    throw new Error("La publicación nueva requiere identificadores de cuenta de 32 caracteres válidos.");
  }
  if (accountId !== expectedAccountId) {
    throw new Error("La cuenta configurada no coincide con la cuenta autorizada para esta publicación nueva.");
  }
}

// This guard only reads the intended Pages and D1 targets. It never inspects or
// modifies the separate Worker application or its database.
export async function assertFreshCloudflareTarget({ apiToken, accountId, expectedAccountId, fetchImpl = globalThis.fetch }) {
  assertFreshAccountId(accountId, expectedAccountId);
  if (typeof apiToken !== "string" || !apiToken.trim() || typeof fetchImpl !== "function") {
    throw new Error("Falta el acceso privado necesario para comprobar el destino nuevo de Cloudflare.");
  }
  const request = async (path) => {
    let response;
    let data;
    try {
      response = await fetchImpl(`${API}/accounts/${accountId}${path}`, {
        method: "GET",
        headers: { Authorization: `Bearer ${apiToken}` },
        redirect: "error",
        signal: AbortSignal.timeout(30000),
      });
      data = await response.json();
    } catch {
      throw responseError("No se pudo comprobar el destino nuevo de Cloudflare. No se autoriza modificar recursos.", { response });
    }
    if (!data || typeof data !== "object" || Array.isArray(data) || !Number.isInteger(response.status) || typeof response.ok !== "boolean") {
      throw responseError("Cloudflare devolvió una respuesta inválida al comprobar el destino nuevo.", { response, data });
    }
    return { response, data };
  };
  const successful = ({ response, data }) => response.ok && data.success === true &&
    (data.errors === undefined || (Array.isArray(data.errors) && data.errors.length === 0));
  const pages = await request(`/pages/projects/${PROJECT}`);
  const absent = pages.response.status === 404 && pages.data.success === false &&
    Array.isArray(pages.data.errors) && pages.data.errors.length > 0 &&
    pages.data.errors.every((error) => error && error.code === 8000007);
  if (!absent) {
    if (successful(pages) && pages.data.result && typeof pages.data.result === "object" && !Array.isArray(pages.data.result) && pages.data.result.name === PROJECT) {
      throw new Error("El proyecto Pages cream-los-cabos ya existe. La publicación nueva se detiene y conserva su configuración y secretos.");
    }
    throw responseError("No se pudo confirmar la ausencia del proyecto Pages cream-los-cabos. Revisar permisos y respuesta de Cloudflare.", pages);
  }
  const matches = [];
  let expectedTotal;
  let seen = 0;
  for (let page = 1; page <= 10000; page += 1) {
    const result = await request(`/d1/database?name=${PROJECT}&per_page=${PAGE_SIZE}&page=${page}`);
    if (!successful(result) || !Array.isArray(result.data.result)) {
      throw responseError("Cloudflare no devolvió una lista válida y autorizada de D1 para la publicación nueva.", result);
    }
    const batch = result.data.result;
    if (batch.length > PAGE_SIZE || batch.some((database) => !database || typeof database !== "object" || Array.isArray(database) || typeof database.name !== "string" || !database.name || !UUID.test(database.uuid || ""))) {
      throw responseError("La lista de D1 contiene recursos inválidos. No se autoriza la publicación nueva.", result);
    }
    matches.push(...batch.filter((database) => database.name === PROJECT));
    seen += batch.length;
    let more = batch.length === PAGE_SIZE;
    if (result.data.result_info !== undefined) {
      const info = result.data.result_info;
      if (!info || typeof info !== "object" || Array.isArray(info) || info.page !== page || !Number.isInteger(info.per_page) || info.per_page < 1 || info.per_page > PAGE_SIZE || batch.length > info.per_page ||
        (info.count !== undefined && info.count !== batch.length) ||
        (info.total_count !== undefined && (!Number.isInteger(info.total_count) || info.total_count < seen)) ||
        (info.total_pages !== undefined && (!Number.isInteger(info.total_pages) || info.total_pages < (batch.length ? page : 0)))) {
        throw responseError("Cloudflare devolvió paginación inválida de D1. No se autoriza la publicación nueva.", result);
      }
      if (info.total_count !== undefined) {
        if (expectedTotal !== undefined && expectedTotal !== info.total_count) {
          throw responseError("La lista D1 cambió durante su comprobación. Volver a comprobar el destino antes de publicar.", result);
        }
        expectedTotal = info.total_count;
        more = seen < expectedTotal;
      } else {
        more = batch.length === info.per_page;
      }
      if (info.total_pages !== undefined) {
        const morePages = page < info.total_pages;
        if (info.total_count !== undefined && more !== morePages) {
          throw responseError("Cloudflare devolvió totales incompatibles en la paginación D1.", result);
        }
        more = morePages;
      }
    }
    if (more && !batch.length) throw responseError("Cloudflare devolvió una página D1 vacía antes de completar la lista.", result);
    if (!more) {
      if (matches.length > 1) throw new Error("Hay varias D1 cream-los-cabos. La publicación nueva se detiene por ambigüedad.");
      if (matches.length) throw new Error("La D1 cream-los-cabos ya existe. La publicación nueva conserva sus datos y se detiene.");
      return { accountId, projectName: PROJECT };
    }
  }
  throw new Error("No se pudo completar la paginación D1. No se autoriza la publicación nueva.");
}
