import {
  ApiError,
  digest,
  hasHubSession,
  secureEqual,
} from "./api.js";

const UUID_V4 = /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i;

export function isMemberUuid(value) {
  return typeof value === "string" && UUID_V4.test(value);
}

export function normalizeMemberProfile(raw) {
  if (
    typeof raw.customer !== "string" ||
    raw.customer.trim().length < 2 ||
    raw.customer.trim().length > 80
  ) {
    throw new ApiError(400, "Escribe un nombre de entre 2 y 80 caracteres.");
  }
  if (raw.phone != null && typeof raw.phone !== "string") {
    throw new ApiError(400, "Escribe un teléfono válido.");
  }
  const phone = (raw.phone ?? "").trim();
  const digits = phone.replace(/\D/g, "");
  if (
    phone &&
    (!/^[+\d\s()-]+$/.test(phone) ||
      digits.length < 10 ||
      digits.length > 15 ||
      phone.length > 30)
  ) {
    throw new ApiError(400, "Escribe un teléfono de entre 10 y 15 dígitos.");
  }
  return { customer: raw.customer.trim(), phone };
}

export async function authorizedMember(request, db, env, id, allowHub = false) {
  const token = request.headers.get("X-Member-Token") || "";
  const hub = allowHub && (await hasHubSession(request, env));
  if (!hub && !isMemberUuid(token)) {
    throw new ApiError(404, "No encontramos esa tarjeta de Cream Club.");
  }
  const row = await db
    .prepare("SELECT * FROM club_members WHERE id = ?")
    .bind(id)
    .first();
  if (
    !row ||
    (!hub && !(await secureEqual(row.access_token_hash, await digest(token))))
  ) {
    throw new ApiError(404, "No encontramos esa tarjeta de Cream Club.");
  }
  return row;
}

export async function readMember(db, row) {
  const [delivered, recent] = await Promise.all([
    db
      .prepare("SELECT COUNT(*) AS total FROM orders WHERE member_id = ? AND status = 'Entregado'")
      .bind(row.id)
      .first(),
    db
      .prepare(`SELECT id, status, branch, created_at, updated_at FROM orders
        WHERE member_id = ? ORDER BY created_at DESC, id DESC LIMIT 30`)
      .bind(row.id)
      .all(),
  ]);
  return {
    id: row.id,
    customer: row.customer,
    phone: row.phone || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deliveredCount: Number(delivered?.total || 0),
    recentOrders: recent.results.map((order) => ({
      id: order.id,
      status: order.status,
      branch: order.branch,
      createdAt: order.created_at,
      updatedAt: order.updated_at || order.created_at,
    })),
  };
}
