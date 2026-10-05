import {
  apiResponse,
  handleApi,
  checkOrigin,
  readJson,
  hubConfigured,
  hasHubSession,
  createHubSession,
  sessionCookie,
} from "../../_lib/api.js";

export async function onRequest({ request, env }) {
  return handleApi(async () => {
    if (request.method === "GET") {
      return apiResponse({
        authenticated: await hasHubSession(request, env),
        configured: hubConfigured(env),
      });
    }
    if (request.method === "POST") {
      checkOrigin(request);
      const { token } = await readJson(request, 2048);
      const cookie = await createHubSession(request, env, token);
      return apiResponse({ authenticated: true, configured: true }, 200, {
        "Set-Cookie": cookie,
      });
    }
    if (request.method === "DELETE") {
      checkOrigin(request);
      return apiResponse(
        { authenticated: false, configured: hubConfigured(env) },
        200,
        { "Set-Cookie": sessionCookie(request) },
      );
    }
    return apiResponse({ error: "Método no permitido." }, 405, {
      Allow: "GET, POST, DELETE",
    });
  });
}
