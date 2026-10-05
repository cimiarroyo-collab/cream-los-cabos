import {
  BRANCHES,
  STATUSES,
  normalizeOrderInput,
} from "../../../shared/catalog.js";
import {
  ApiError,
  apiResponse,
  requireDatabase,
  requireHubSession,
  checkOrigin,
  readJson,
  digest,
  secureEqual,
  handleApi,
} from "../../_lib/api.js";
import { readOrder, canonicalJson } from "../../_lib/orders.js";

function orderId(value) {
  const parts = Array.isArray(value) ? value : value ? [value] : [];
  if (!parts.length) return null;
  if (parts.length !== 1 || !/^[1-9]\d{0,14}$/.test(parts[0])) {
    throw new ApiError(404, "No encontramos ese pedido.");
  }
  const id = Number(parts[0]);
  if (!Number.isSafeInteger(id))
    throw new ApiError(404, "No encontramos ese pedido.");
  return id;
}

async function existingOrder(db, requestId, payloadHash) {
  const row = await db
    .prepare("SELECT * FROM orders WHERE request_id = ?")
    .bind(requestId)
    .first();
  if (!row) return null;
  if (
    !row.payload_hash ||
    !(await secureEqual(row.payload_hash, payloadHash))
  ) {
    throw new ApiError(
      409,
      "Esta solicitud ya se usó para otro pedido. Intenta de nuevo desde el carrito.",
    );
  }
  return apiResponse({ ...readOrder(row), trackingToken: row.tracking_token });
}

async function createOrder(request, db) {
  checkOrigin(request);
  const raw = await readJson(request);
  let order;
  try {
    order = normalizeOrderInput(raw);
  } catch (error) {
    throw new ApiError(400, error.message || "Revisa los datos de tu pedido.");
  }
  // Hash the customer's intent, rather than prices/labels that may change with a menu update.
  const payloadHash = await digest(
    canonicalJson({
      customer: order.customer,
      phone: order.phone || "",
      branch: order.branch,
      note: order.note || "",
      requestId: order.requestId,
      items: order.items.map(({ productId, quantity, selections, note }) => ({
        productId,
        quantity,
        selections,
        note,
      })),
    }),
  );
  const existing = await existingOrder(db, order.requestId, payloadHash);
  if (existing) return existing;

  const now = Date.now();
  const trackingToken = crypto.randomUUID();
  let row;
  try {
    row = await db
      .prepare(
        `
      INSERT INTO orders (customer, phone, branch, items, status, total, note,
        created_at, updated_at, request_id, tracking_token, payload_hash)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *
    `,
      )
      .bind(
        order.customer,
        order.phone || "",
        order.branch,
        JSON.stringify(order.items),
        STATUSES[0],
        order.total,
        order.note || "",
        now,
        now,
        order.requestId,
        trackingToken,
        payloadHash,
      )
      .first();
  } catch (error) {
    // A retry can race the original request; the unique request ID prevents a second order.
    const raced = await existingOrder(db, order.requestId, payloadHash);
    if (raced) return raced;
    throw error;
  }
  return apiResponse({ ...readOrder(row), trackingToken }, 201);
}

async function getOrder(request, db, id) {
  const token = request.headers.get("X-Order-Token") || "";
  if (!token || token.length > 128) {
    throw new ApiError(
      404,
      "Pedido no encontrado o enlace de seguimiento inválido.",
    );
  }
  const row = await db
    .prepare("SELECT * FROM orders WHERE id = ?")
    .bind(id)
    .first();
  if (!row?.tracking_token || !(await secureEqual(token, row.tracking_token))) {
    throw new ApiError(
      404,
      "Pedido no encontrado o enlace de seguimiento inválido.",
    );
  }
  return apiResponse(readOrder(row));
}

async function listOrders(request, db, env) {
  await requireHubSession(request, env);
  const branch = new URL(request.url).searchParams.get("branch");
  if (branch && !BRANCHES.includes(branch))
    throw new ApiError(400, "Selecciona una sucursal válida.");
  // Active orders come first; include completed orders from the last day for operational history.
  const filter = branch ? "AND branch = ?" : "";
  const query = db.prepare(`SELECT * FROM orders
    WHERE (status != 'Entregado' OR created_at >= ?) ${filter}
    ORDER BY CASE WHEN status = 'Entregado' THEN 1 ELSE 0 END,
      CASE WHEN status != 'Entregado' THEN created_at END ASC, created_at DESC
    LIMIT 500`);
  const { results } = await (
    branch
      ? query.bind(Date.now() - 24 * 60 * 60 * 1000, branch)
      : query.bind(Date.now() - 24 * 60 * 60 * 1000)
  ).all();
  return apiResponse(results.map(readOrder));
}

async function updateOrder(request, db, env, id) {
  checkOrigin(request);
  await requireHubSession(request, env);
  const body = await readJson(request);
  const current = await db
    .prepare("SELECT * FROM orders WHERE id = ?")
    .bind(id)
    .first();
  if (!current) throw new ApiError(404, "No encontramos ese pedido.");
  if (
    !STATUSES.includes(body.expectedStatus) ||
    !STATUSES.includes(body.status)
  ) {
    throw new ApiError(
      400,
      "Indica el estado actual y un nuevo estado válido.",
    );
  }
  if (current.status !== body.expectedStatus) {
    throw new ApiError(
      409,
      "El pedido cambió en otra pantalla. Actualiza para continuar.",
    );
  }
  const next = STATUSES[STATUSES.indexOf(current.status) + 1];
  if (!next || body.status !== next) {
    throw new ApiError(400, "Los pedidos deben avanzar un estado a la vez.");
  }
  const row = await db
    .prepare(
      `UPDATE orders SET status = ?, updated_at = ?
    WHERE id = ? AND status = ? RETURNING *`,
    )
    .bind(body.status, Date.now(), id, body.expectedStatus)
    .first();
  if (!row)
    throw new ApiError(
      409,
      "El pedido cambió en otra pantalla. Actualiza para continuar.",
    );
  return apiResponse(readOrder(row));
}

export async function onRequest(context) {
  return handleApi(async () => {
    const { request, env, params } = context;
    const id = orderId(params?.id);
    if (
      !["GET", "POST", "PATCH"].includes(request.method) ||
      (request.method === "POST" && id !== null) ||
      (request.method === "PATCH" && id === null)
    ) {
      return apiResponse({ error: "Método no permitido." }, 405, {
        Allow: id === null ? "GET, POST" : "GET, PATCH",
      });
    }
    const db = requireDatabase(env);
    if (request.method === "POST") return createOrder(request, db);
    if (request.method === "PATCH") return updateOrder(request, db, env, id);
    return id === null
      ? listOrders(request, db, env)
      : getOrder(request, db, id);
  });
}
