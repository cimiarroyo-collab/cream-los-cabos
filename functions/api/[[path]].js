import { apiResponse } from "../_lib/api.js";

// Keep unknown API routes JSON, so a missing endpoint cannot return the SPA shell as a success.
export function onRequest() {
  return apiResponse({ error: "No encontramos esta ruta del servicio." }, 404);
}
