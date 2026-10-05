import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const baseURL = process.env.CREAM_E2E_URL || "http://127.0.0.1:8788";
const accessCode = process.env.CREAM_HUB_TOKEN || "cream-local-test-token";
const chromiumPath =
  process.env.CREAM_CHROMIUM_PATH ||
  process.env.CHROMIUM_PATH ||
  (existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined);
const browser = await chromium.launch({
  ...(chromiumPath ? { executablePath: chromiumPath } : {}),
  headless: true,
  args: ["--no-sandbox"],
});
const clubContext = await browser.newContext({
  baseURL,
  viewport: { width: 1280, height: 900 },
});
const hubContext = await browser.newContext({
  baseURL,
  viewport: { width: 1440, height: 1000 },
});
const club = await clubContext.newPage();
const hub = await hubContext.newPage();
const uncaught = [];
for (const page of [club, hub])
  page.on("pageerror", (error) => uncaught.push(error.message));

async function step(name, callback) {
  await callback();
  console.log(`✓ ${name}`);
}

async function noOverflow(page) {
  const layout = await page.evaluate(() => ({
    width: window.innerWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  assert.ok(
    layout.scroll <= layout.width + 1,
    `Horizontal overflow: ${layout.scroll}px at ${layout.width}px`,
  );
}

async function addProduct(name, customize) {
  await club
    .getByRole("button", { name: `Personalizar ${name}`, exact: true })
    .click();
  const dialog = club.getByRole("dialog", { name, exact: true });
  await dialog.waitFor();
  if (customize) await customize(dialog);
  await dialog.getByRole("button", { name: /^Agregar al carrito/ }).click();
  await dialog.waitFor({ state: "hidden" });
}

async function openCart() {
  await club.getByRole("button", { name: "Ver carrito", exact: true }).click();
  const dialog = club.getByRole("dialog", { name: "Tu carrito", exact: true });
  await dialog.waitFor();
  return dialog;
}

async function checkTracking(orderId, status) {
  await club.waitForFunction(
    ({ id, state }) =>
      document.querySelector(`[aria-label="Estado del pedido #${id}"]`)
        ?.textContent === state,
    { id: orderId, state: status },
    { timeout: 25000 },
  );
}

async function exerciseHub(order, otherOrder, checkTracking) {
  await step(
    "Hub rejects an incorrect code and opens a private session with the correct code",
    async () => {
      await hub.goto("/hub");
      await hub
        .getByLabel("Código de acceso", { exact: true })
        .fill("incorrect-access-code");
      const rejected = hub.waitForResponse(
        (response) =>
          response.url().endsWith("/api/hub/session") &&
          response.request().method() === "POST",
      );
      await hub
        .getByRole("button", { name: "Entrar a Cream Hub", exact: true })
        .click();
      assert.equal((await rejected).status(), 401);
      await hub.getByRole("alert").waitFor();
      await hub
        .getByLabel("Código de acceso", { exact: true })
        .fill(accessCode);
      await hub
        .getByRole("button", { name: "Entrar a Cream Hub", exact: true })
        .click();
      await hub
        .getByRole("heading", { name: "Pedidos en tiempo real." })
        .waitFor();
      const cookies = await hubContext.cookies(`${baseURL}/api/orders`);
      assert.ok(
        cookies.some(
          (cookie) => cookie.name === "cream_hub_session" && cookie.httpOnly,
        ),
        "Hub session must use an HttpOnly cookie",
      );
      await hub.reload();
      await hub
        .getByRole("heading", { name: "Pedidos en tiempo real." })
        .waitFor();
      const list = await hubContext.request.get("/api/orders");
      assert.equal(list.status(), 200);
      const orders = await list.json();
      assert.ok(orders.some((item) => item.id === order.id));
      assert.ok(
        orders.every((item) => !("trackingToken" in item)),
        "Operations listing must not expose customer tracking tokens",
      );
    },
  );

  const card = hub.getByRole("article", {
    name: `Pedido #${order.id}`,
    exact: true,
  });
  await step(
    "Hub separates Palmilla and Ánima Village orders and station preparation lines",
    async () => {
      await hub
        .getByLabel("Sucursal de operación", { exact: true })
        .selectOption(otherOrder.branch);
      await hub
        .getByRole("article", { name: `Pedido #${otherOrder.id}`, exact: true })
        .waitFor();
      assert.equal(await card.count(), 0);
      await hub
        .getByLabel("Sucursal de operación", { exact: true })
        .selectOption(order.branch);
      await card.waitFor();
      assert.equal(
        await hub
          .getByRole("article", {
            name: `Pedido #${otherOrder.id}`,
            exact: true,
          })
          .count(),
        0,
      );
      for (const station of ["Barra", "Cocina", "Panadería"]) {
        await card
          .getByRole("region", { name: station, exact: true })
          .waitFor();
      }
      for (const station of ["Barra", "Cocina", "Panadería"]) {
        await hub.getByRole("button", { name: station, exact: true }).click();
        await card
          .getByRole("region", { name: station, exact: true })
          .waitFor();
        for (const hidden of ["Barra", "Cocina", "Panadería"].filter(
          (name) => name !== station,
        )) {
          assert.equal(
            await card
              .getByRole("region", { name: hidden, exact: true })
              .count(),
            0,
          );
        }
        assert.match(await card.textContent(), /También incluye/);
      }
      await hub
        .getByRole("button", { name: "Todas las estaciones", exact: true })
        .click();
      await hub
        .getByLabel("Buscar cliente o número de pedido", { exact: true })
        .fill(String(order.id));
      await card.waitFor();
      await noOverflow(hub);
    },
  );

  await step(
    "Hub keeps the last received orders visible when an update fails",
    async () => {
      await hub.route("**/api/orders*", async (route) => {
        if (route.request().method() === "GET")
          await route.fulfill({
            status: 503,
            contentType: "application/json",
            body: JSON.stringify({ error: "Prueba de conexión interrumpida." }),
          });
        else await route.continue();
      });
      const failedUpdate = hub.waitForResponse(
        (response) =>
          response.url().includes("/api/orders") &&
          response.request().method() === "GET" &&
          response.status() === 503,
      );
      await hub
        .getByRole("button", { name: "Actualizar pedidos", exact: true })
        .click();
      await failedUpdate;
      await hub.getByRole("alert").waitFor();
      await card.waitFor();
      assert.match(
        await hub.getByRole("alert").textContent(),
        /Conservamos los últimos pedidos/,
      );
      await hub.unroute("**/api/orders*");
      await hub
        .getByRole("button", { name: "Reintentar", exact: true })
        .click();
      await hub.getByRole("alert").waitFor({ state: "hidden" });
    },
  );

  await step(
    "Server rejects skipped workflow steps and stale concurrent updates",
    async () => {
      const skip = await hubContext.request.patch(`/api/orders/${order.id}`, {
        data: { status: "Listo", expectedStatus: "Nuevo" },
      });
      assert.equal(skip.status(), 400);
      const stale = await hubContext.request.patch(`/api/orders/${order.id}`, {
        data: { status: "En preparación", expectedStatus: "Confirmado" },
      });
      assert.equal(stale.status(), 409);
    },
  );

  for (const [button, status] of [
    ["Confirmar pedido", "Confirmado"],
    ["Iniciar preparación", "En preparación"],
    ["Marcar listo", "Listo"],
    ["Marcar entregado", "Entregado"],
  ]) {
    await step(
      `Hub advances to ${status} and Club observes the live status`,
      async () => {
        const update = hub.waitForResponse(
          (response) =>
            response.url().endsWith(`/api/orders/${order.id}`) &&
            response.request().method() === "PATCH",
        );
        await card.getByRole("button", { name: button, exact: true }).click();
        const response = await update;
        assert.equal(response.status(), 200);
        assert.equal((await response.json()).status, status);
        await checkTracking(status);
      },
    );
  }

  await step(
    "Hub operates on a mobile viewport and logout removes API access",
    async () => {
      await hub.setViewportSize({ width: 390, height: 844 });
      await noOverflow(hub);
      await hub
        .getByRole("button", { name: "Cerrar sesión", exact: true })
        .click();
      await hub.getByLabel("Código de acceso", { exact: true }).waitFor();
      assert.equal((await hubContext.request.get("/api/orders")).status(), 401);
      await hub.reload();
      await hub.getByLabel("Código de acceso", { exact: true }).waitFor();
      await noOverflow(hub);
    },
  );
}

try {
  await step(
    "Order listing and status updates require Hub authentication",
    async () => {
      const list = await clubContext.request.get("/api/orders");
      assert.equal(list.status(), 401);
      const update = await clubContext.request.patch("/api/orders/1", {
        data: { status: "Confirmado", expectedStatus: "Nuevo" },
      });
      assert.equal(update.status(), 401);
      const privateOrder = await clubContext.request.get("/api/orders/1");
      assert.equal(privateOrder.status(), 404);
    },
  );

  await step(
    "Club browses categories, searches the menu and handles empty results",
    async () => {
      await club.goto("/club");
      assert.equal(await club.title(), "Cream Club · Los Cabos");
      await club
        .getByRole("button", { name: "Personalizar Flat White", exact: true })
        .waitFor();
      await noOverflow(club);
      const categories = club.getByRole("group", {
        name: "Categorías del menú",
        exact: true,
      });
      await categories
        .getByRole("button", { name: "Café", exact: true })
        .click();
      assert.equal(
        await club.getByRole("button", { name: /^Personalizar / }).count(),
        1,
      );
      await club
        .getByLabel("Buscar en el menú", { exact: true })
        .fill("not-a-menu-product");
      await club
        .getByRole("heading", {
          name: "No encontramos ese antojo",
          exact: true,
        })
        .waitFor();
      await club
        .getByRole("button", { name: "Ver todo el menú", exact: true })
        .click();
      await club.getByLabel("Buscar en el menú", { exact: true }).fill("croi");
      assert.equal(
        await club.getByRole("button", { name: /^Personalizar / }).count(),
        1,
      );
      await club
        .getByRole("button", { name: "Personalizar Croissant", exact: true })
        .waitFor();
      await club.getByLabel("Buscar en el menú", { exact: true }).fill("");
      assert.equal(
        await club.getByRole("button", { name: /^Personalizar / }).count(),
        4,
      );
    },
  );

  await step(
    "Club customizes products for all stations and supports removing a cart line",
    async () => {
      await addProduct("Cabo Sunshine");
      const firstCart = await openCart();
      await firstCart
        .getByRole("button", { name: "Eliminar Cabo Sunshine", exact: true })
        .click();
      await firstCart
        .getByRole("heading", { name: "Aquí van tus favoritos", exact: true })
        .waitFor();
      await firstCart
        .getByRole("button", { name: "Cerrar", exact: true })
        .click();
      await addProduct("Flat White", async (dialog) => {
        await dialog
          .getByRole("group", { name: "Tamaño", exact: true })
          .getByRole("radio", { name: /^Grande/ })
          .check();
        await dialog
          .getByRole("group", { name: "Leche", exact: true })
          .getByRole("radio", { name: /^Avena/ })
          .check();
        await dialog
          .getByRole("group", { name: "Temperatura", exact: true })
          .getByRole("radio", { name: "Con hielo", exact: true })
          .check();
        await dialog
          .getByLabel("Nota para este producto (opcional)", { exact: true })
          .fill("Sin espuma, por favor.");
      });
      await addProduct("Croissant", async (dialog) => {
        await dialog
          .getByRole("group", { name: "Acompañamiento", exact: true })
          .getByRole("radio", { name: /^Mermelada/ })
          .check();
      });
      await addProduct("Avocado Toast", async (dialog) => {
        await dialog
          .getByRole("group", { name: "Agrega un huevo", exact: true })
          .getByRole("radio", { name: /^Pochado/ })
          .check();
      });
    },
  );

  await step(
    "Club edits quantities and options, and restores the cart after refresh",
    async () => {
      let cart = await openCart();
      await cart
        .getByRole("button", {
          name: "Aumentar cantidad de Flat White",
          exact: true,
        })
        .click();
      await cart
        .getByRole("button", {
          name: "Disminuir cantidad de Flat White",
          exact: true,
        })
        .click();
      await cart
        .getByRole("button", {
          name: "Aumentar cantidad de Flat White",
          exact: true,
        })
        .click();
      await cart
        .getByRole("button", { name: "Editar Flat White", exact: true })
        .click();
      const editor = club.getByRole("dialog", {
        name: "Flat White",
        exact: true,
      });
      await editor
        .getByRole("group", { name: "Leche", exact: true })
        .getByRole("radio", { name: /^Almendra/ })
        .check();
      await editor.getByRole("button", { name: /^Guardar cambios/ }).click();
      cart = club.getByRole("dialog", { name: "Tu carrito", exact: true });
      await cart.waitFor();
      assert.match(await cart.textContent(), /Grande · Almendra · Con hielo/);
      assert.match(await cart.locator(".cart-total").textContent(), /540/);
      await club.reload();
      cart = await openCart();
      assert.equal(await cart.locator(".cart-line").count(), 3);
      assert.match(await cart.locator(".cart-total").textContent(), /540/);
      assert.match(await cart.textContent(), /Sin espuma, por favor/);
    },
  );

  let order;
  let submittedPayload;
  await step(
    "Club submits a real customized order for the selected branch",
    async () => {
      const cart = club.getByRole("dialog", {
        name: "Tu carrito",
        exact: true,
      });
      await cart
        .getByLabel("Nombre", { exact: true })
        .fill(`E2E Cream ${Date.now()}`);
      await cart
        .getByLabel("Teléfono (opcional)", { exact: true })
        .fill("6241234567");
      await cart
        .getByLabel("Sucursal de recolección", { exact: true })
        .selectOption("Ánima Village");
      await cart
        .getByLabel("Sucursal de recolección", { exact: true })
        .selectOption("Palmilla");
      await cart
        .getByLabel("Nota del pedido (opcional)", { exact: true })
        .fill("Prueba de integración Cream.");
      const created = club.waitForResponse(
        (response) =>
          response.url().endsWith("/api/orders") &&
          response.request().method() === "POST",
      );
      await cart
        .getByRole("button", { name: "Enviar pedido", exact: true })
        .click();
      const response = await created;
      assert.equal(response.status(), 201);
      order = await response.json();
      submittedPayload = response.request().postDataJSON();
      assert.equal(order.branch, "Palmilla");
      assert.equal(order.total, 540);
      assert.equal(order.items.length, 3);
      assert.deepEqual(
        order.items.map((item) => item.station).sort(),
        ["Barra", "Cocina", "Panadería"].sort(),
      );
      const coffee = order.items.find(
        (item) => item.productId === "flat-white",
      );
      assert.equal(coffee.quantity, 2);
      assert.equal(coffee.unitPrice, 105);
      assert.equal(coffee.selections.milk, "almond");
      assert.equal(coffee.note, "Sin espuma, por favor.");
      assert.ok(order.trackingToken);
      await checkTracking(order.id, "Nuevo");
      const stored = await club.evaluate(() =>
        JSON.parse(localStorage.getItem("cream-cart-v2")),
      );
      assert.deepEqual(stored, []);
      await club.reload();
      await club
        .getByRole("button", { name: "Mis pedidos", exact: true })
        .click();
      await checkTracking(order.id, "Nuevo");
    },
  );

  let otherOrder;
  await step(
    "Order retries are idempotent, totals are calculated on the server and tracking stays private",
    async () => {
      const duplicate = await clubContext.request.post("/api/orders", {
        data: submittedPayload,
      });
      assert.equal(duplicate.status(), 200);
      assert.equal((await duplicate.json()).id, order.id);
      const changed = await clubContext.request.post("/api/orders", {
        data: { ...submittedPayload, customer: "Changed request" },
      });
      assert.equal(changed.status(), 409);
      assert.equal(
        (await clubContext.request.get(`/api/orders/${order.id}`)).status(),
        404,
      );
      assert.equal(
        (
          await clubContext.request.get(`/api/orders/${order.id}`, {
            headers: { "X-Order-Token": randomUUID() },
          })
        ).status(),
        404,
      );
      const tracking = await clubContext.request.get(
        `/api/orders/${order.id}`,
        { headers: { "X-Order-Token": order.trackingToken } },
      );
      assert.equal(tracking.status(), 200);
      assert.equal((await tracking.json()).total, 540);
      const second = await clubContext.request.post("/api/orders", {
        data: {
          customer: `E2E Ánima ${Date.now()}`,
          branch: "Ánima Village",
          requestId: randomUUID(),
          total: 1,
          items: [{ productId: "flat-white", quantity: 1, selections: {} }],
        },
      });
      assert.equal(second.status(), 201);
      otherOrder = await second.json();
      assert.equal(otherOrder.total, 75);
      assert.equal(
        (
          await clubContext.request.get(`/api/orders/${otherOrder.id}`, {
            headers: { "X-Order-Token": order.trackingToken },
          })
        ).status(),
        404,
      );
    },
  );

  await exerciseHub(order, otherOrder, (status) =>
    checkTracking(order.id, status),
  );

  await step(
    "Mobile Club preserves the cart and never reports success during an API failure",
    async () => {
      await club.setViewportSize({ width: 390, height: 844 });
      await noOverflow(club);
      await club.getByRole("button", { name: "Menú", exact: true }).click();
      await noOverflow(club);
      await addProduct("Cabo Sunshine");
      const cart = await openCart();
      await noOverflow(club);
      const trackedBefore = await club.evaluate(
        () => JSON.parse(localStorage.getItem("cream-tracking-v2")).length,
      );
      let failedPayload;
      await club.route("**/api/orders", async (route) => {
        if (route.request().method() === "POST") {
          failedPayload = route.request().postDataJSON();
          await route.fulfill({
            status: 503,
            contentType: "application/json",
            body: JSON.stringify({
              error: "Prueba: servicio temporalmente no disponible.",
            }),
          });
        } else await route.continue();
      });
      await cart
        .getByRole("button", { name: "Enviar pedido", exact: true })
        .click();
      await cart.getByRole("alert").waitFor();
      assert.match(
        await cart.getByRole("alert").textContent(),
        /servicio temporalmente no disponible/,
      );
      assert.equal(await cart.locator(".cart-line").count(), 1);
      assert.equal(
        await club.evaluate(
          () => JSON.parse(localStorage.getItem("cream-tracking-v2")).length,
        ),
        trackedBefore,
      );
      assert.equal(
        await club.evaluate(
          () => JSON.parse(localStorage.getItem("cream-cart-v2")).length,
        ),
        1,
      );
      assert.ok(failedPayload?.requestId);
      await club.unroute("**/api/orders");
      const retry = club.waitForResponse(
        (response) =>
          response.url().endsWith("/api/orders") &&
          response.request().method() === "POST",
      );
      await cart
        .getByRole("button", { name: "Enviar pedido", exact: true })
        .click();
      const recovered = await retry;
      assert.equal(recovered.status(), 201);
      assert.equal(
        recovered.request().postDataJSON().requestId,
        failedPayload.requestId,
      );
      const recoveredOrder = await recovered.json();
      await checkTracking(recoveredOrder.id, "Nuevo");
      assert.equal(
        await club.evaluate(() => localStorage.getItem("cream-pending-v2")),
        null,
      );
      await noOverflow(club);
    },
  );

  assert.deepEqual(
    uncaught,
    [],
    "The browser must not raise uncaught JavaScript errors",
  );
  console.log("Cream Club + Cream Hub browser integration passed.");
} catch (error) {
  const artifactDir = process.env.CREAM_E2E_ARTIFACTS || "/tmp/cream-e2e";
  await mkdir(artifactDir, { recursive: true });
  await Promise.allSettled([
    club.screenshot({
      path: `${artifactDir}/club-failure.png`,
      fullPage: true,
    }),
    hub.screenshot({ path: `${artifactDir}/hub-failure.png`, fullPage: true }),
  ]);
  console.error(`Browser screenshots: ${artifactDir}`);
  throw error;
} finally {
  await browser.close();
}
