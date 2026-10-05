export class ApiError extends Error {
  constructor(message, status = 0) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}
async function request(path, options = {}) {
  let response;
  try {
    response = await fetch(path, {
      credentials: "same-origin",
      ...options,
      headers: { "Content-Type": "application/json", ...options.headers },
      signal: options.signal ?? AbortSignal.timeout(15000),
    });
  } catch (error) {
    throw new ApiError(
      error.name === "TimeoutError"
        ? "La conexión tardó demasiado. Intenta de nuevo."
        : "No pudimos conectar. Revisa tu conexión e intenta de nuevo.",
    );
  }
  const data = await response.json().catch(() => null);
  if (!response.ok)
    throw new ApiError(
      data?.error ?? "No pudimos completar la solicitud. Intenta de nuevo.",
      response.status,
    );
  if (data == null)
    throw new ApiError(
      "El servicio no está disponible por el momento.",
      response.status,
    );
  return data;
}
export const api = {
  createOrder: (order) =>
    request("/api/orders", { method: "POST", body: JSON.stringify(order) }),
  getOrder: (id, token) =>
    request(`/api/orders/${encodeURIComponent(id)}`, {
      headers: { "X-Order-Token": token },
    }),
  getOrders: (branch) =>
    request(
      `/api/orders${branch ? `?branch=${encodeURIComponent(branch)}` : ""}`,
    ),
  updateOrder: (id, status, expectedStatus) =>
    request(`/api/orders/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify({ status, expectedStatus }),
    }),
  getSession: () => request("/api/hub/session"),
  login: (token) =>
    request("/api/hub/session", {
      method: "POST",
      body: JSON.stringify({ token }),
    }),
  logout: () => request("/api/hub/session", { method: "DELETE" }),
};
