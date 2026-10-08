import {
  ApiError,
  apiResponse,
  checkOrigin,
  digest,
  handleApi,
  readJson,
  requireDatabase,
  secureEqual,
} from "../../_lib/api.js";
import {
  authorizedMember,
  isMemberUuid,
  normalizeMemberProfile,
  readMember,
} from "../../_lib/members.js";
import { canonicalJson } from "../../_lib/orders.js";

function memberId(value) {
  const parts = Array.isArray(value) ? value : value ? [value] : [];
  if (!parts.length) return null;
  if (parts.length !== 1 || !isMemberUuid(parts[0])) {
    throw new ApiError(404, "No encontramos esa tarjeta de Cream Club.");
  }
  return parts[0].toLowerCase();
}

async function existingMember(db, requestId, payloadHash) {
  const row = await db
    .prepare("SELECT * FROM club_members WHERE request_id = ?")
    .bind(requestId)
    .first();
  if (!row) return null;
  if (!(await secureEqual(row.payload_hash, payloadHash))) {
    throw new ApiError(409, "Esta solicitud ya se usó para otra tarjeta. Intenta de nuevo.");
  }
  return apiResponse(await readMember(db, row));
}

async function createMember(request, db) {
  checkOrigin(request);
  const raw = await readJson(request, 4 * 1024);
  const profile = normalizeMemberProfile(raw);
  if (!isMemberUuid(raw.requestId) || !isMemberUuid(raw.accessToken)) {
    throw new ApiError(400, "No pudimos validar la solicitud de tu tarjeta. Intenta de nuevo.");
  }
  const requestId = raw.requestId.toLowerCase();
  const accessTokenHash = await digest(raw.accessToken);
  const payloadHash = await digest(canonicalJson({ ...profile, requestId, accessTokenHash }));
  const existing = await existingMember(db, requestId, payloadHash);
  if (existing) return existing;
  const now = Date.now();
  let row;
  try {
    row = await db
      .prepare(`INSERT INTO club_members
        (id, access_token_hash, customer, phone, created_at, updated_at, request_id, payload_hash)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`)
      .bind(crypto.randomUUID(), accessTokenHash, profile.customer, profile.phone, now, now, requestId, payloadHash)
      .first();
  } catch (error) {
    const raced = await existingMember(db, requestId, payloadHash);
    if (raced) return raced;
    throw error;
  }
  return apiResponse(await readMember(db, row), 201);
}

async function updateMember(request, db, env, id) {
  checkOrigin(request);
  await authorizedMember(request, db, env, id);
  const profile = normalizeMemberProfile(await readJson(request, 4 * 1024));
  const row = await db
    .prepare("UPDATE club_members SET customer = ?, phone = ?, updated_at = ? WHERE id = ? RETURNING *")
    .bind(profile.customer, profile.phone, Date.now(), id)
    .first();
  if (!row) throw new ApiError(404, "No encontramos esa tarjeta de Cream Club.");
  return apiResponse(await readMember(db, row));
}

export async function onRequest({ request, env, params }) {
  return handleApi(async () => {
    const id = memberId(params?.id);
    if (
      !["GET", "POST", "PATCH"].includes(request.method) ||
      (request.method === "POST" && id !== null) ||
      (request.method !== "POST" && id === null)
    ) {
      return apiResponse({ error: "Método no permitido." }, 405, {
        Allow: id === null ? "POST" : "GET, PATCH",
      });
    }
    const db = requireDatabase(env);
    if (request.method === "POST") return createMember(request, db);
    if (request.method === "PATCH") return updateMember(request, db, env, id);
    return apiResponse(await readMember(db, await authorizedMember(request, db, env, id, true)));
  });
}
