// Workers deployment adapter. The application API remains Pages Functions.
export function createWorker(pages) {
  return {
    async fetch(request, env, ctx) {
      const path = new URL(request.url).pathname;
      if (path === "/api" || path.startsWith("/api/")) {
        try {
          return await pages.fetch(request, env, ctx);
        } catch {
          return Response.json({ error: "El servicio no está disponible. Intenta nuevamente." }, {
            status: 503,
            headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
          });
        }
      }
      return env.ASSETS.fetch(request);
    },
  };
}
