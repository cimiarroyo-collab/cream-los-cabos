import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import { PRODUCTS } from "../shared/catalog.js";

const baseURL = process.env.CREAM_E2E_URL || "http://127.0.0.1:8788";
const artifacts = process.env.CREAM_VISUAL_ARTIFACTS || "/tmp/cream-e2e/visual";
await mkdir(artifacts, { recursive: true });
const executablePath = process.env.CREAM_CHROMIUM_PATH || (existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined);
const browser = await chromium.launch({ ...(executablePath ? { executablePath } : {}), headless: true, args: ["--no-sandbox"] });
const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 1000 } });
const hubContext = await browser.newContext({ baseURL, viewport: { width: 1440, height: 1000 } });
const club = await context.newPage();
const hub = await hubContext.newPage();
const errors = [];
for (const page of [club, hub]) page.on("pageerror", error => errors.push(error.message));
async function fit(page) {
  const result = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth, emoji: /\p{Extended_Pictographic}/u.test(document.body.innerText) }));
  assert.ok(result.scroll <= result.width + 1, `Overflow at ${result.width}px`);
  assert.equal(result.emoji, false);
}
async function capture(page, name) {
  await fit(page);
  await page.screenshot({ path: `${artifacts}/${name}.png`, fullPage: true });
}
try {
  const response = await club.goto("/club");
  assert.equal(response.status(), 200);
  await club.getByRole("button", { name: "Personalizar Flat White", exact: true }).waitFor();
  assert.equal((await context.request.get("/api/orders")).status(), 401);
  const images = [...new Set(PRODUCTS.map(product => product.image))];
  for (let start = 0; start < images.length; start += 8) {
    await Promise.all(images.slice(start, start + 8).map(async path => {
      const image = await context.request.get(path);
      assert.equal(image.status(), 200, path);
      assert.match(image.headers()["content-type"], /^image\//, path);
      const bytes = await image.body();
      assert.ok(bytes.length > 1000 && bytes[0] === 0xff && bytes[1] === 0xd8, `Invalid photograph: ${path}`);
    }));
  }
  console.log(`✓ Public Club serves all ${images.length} catalog photographs without authentication`);
  assert.equal((await context.request.get("/photos/credits.html")).status(), 200);
  for (const width of [1440, 768, 390, 320]) {
    await club.setViewportSize({ width, height: width > 700 ? 1000 : 844 });
    await club.getByRole("navigation", { name: "Navegación Cream Club" }).getByRole("button", { name: "Inicio", exact: true }).click();
    assert.equal(await club.getByRole("button", { name: /^Personalizar / }).count(), 4);
    await capture(club, `cream-club-${width}`);
    await club.getByRole("group", { name: "Categorías del menú" }).getByRole("button", { name: "Desayunos", exact: true }).click();
    await capture(club, `cream-club-menu-${width}`);
    assert.ok(await club.getByRole("button", { name: /^Personalizar / }).count() <= 6);
    await club.getByRole("button", { name: /^Personalizar / }).first().click();
    await capture(club, `cream-club-producto-${width}`);
    await club.getByRole("dialog").getByRole("button", { name: "Cerrar", exact: true }).click();
  }
  console.log("✓ Home, compact menu and product fit 320/390/768/1440 px without emojis or overflow");
  await club.setViewportSize({ width: 390, height: 844 });
  const customer = "VERIFICACIÓN VISUAL CREAM";
  await club.getByRole("navigation", { name: "Navegación Cream Club" }).getByRole("button", { name: "Club", exact: true }).click();
  await club.getByLabel("Nombre", { exact: true }).fill(customer);
  await club.getByRole("button", { name: "Crear mi tarjeta", exact: true }).click();
  await club.getByRole("button", { name: "Mi QR", exact: true }).click();
  await club.getByRole("img", { name: "Código QR de tu tarjeta Cream Club" }).waitFor();
  await capture(club, "cream-club-qr-390");
  await club.getByRole("button", { name: "Tarjeta e historial", exact: true }).click();
  await capture(club, "cream-club-tarjeta-390");
  const member = await club.evaluate(() => JSON.parse(localStorage.getItem("cream-member-v1")));
  assert.ok(member?.id && member?.token);
  const placed = await context.request.post("/api/orders", {
    headers: { "X-Member-Token": member.token },
    data: { customer, branch: "Ánima Village", requestId: crypto.randomUUID(), memberId: member.id,
      items: [{ productId: "flat-white", quantity: 1, selections: {} }, { productId: "croissant", quantity: 1, selections: {} }, { productId: "avocado-toast", quantity: 1, selections: {} }] },
  });
  assert.equal(placed.status(), 201);
  const { trackingToken, ...order } = await placed.json();
  assert.deepEqual([...new Set(order.items.map(item => item.station))].sort(), ["Barra", "Cocina", "Panadería"]);
  await club.evaluate(({ order, token }) => localStorage.setItem("cream-tracking-v2", JSON.stringify([{ id: order.id, token, order }])), { order, token: trackingToken });
  await club.reload();
  await club.getByRole("navigation", { name: "Navegación Cream Club" }).getByRole("button", { name: "Mis pedidos", exact: true }).click();
  await hub.goto("/hub");
  await hub.getByLabel("Código de acceso", { exact: true }).fill(process.env.CREAM_HUB_TOKEN || "cream-local-test-token");
  await hub.getByRole("button", { name: "Entrar a Cream Hub", exact: true }).click();
  await hub.getByRole("heading", { name: "Pedidos en tiempo real." }).waitFor();
  const card = hub.getByRole("article", { name: `Pedido #${order.id}`, exact: true });
  await card.waitFor();
  for (const width of [1440, 768]) {
    await hub.setViewportSize({ width, height: 1000 });
    await capture(hub, `cream-hub-${width}`);
  }
  await capture(club, "cream-club-pedido-390");
  const states = ["Nuevo"];
  for (const [action, status] of [["Confirmar pedido", "Confirmado"], ["Iniciar preparación", "En preparación"], ["Marcar listo", "Listo"], ["Marcar entregado", "Entregado"]]) {
    await card.getByRole("button", { name: action, exact: true }).click();
    await club.waitForFunction(({ id, status }) => document.querySelector(`[aria-label="Estado del pedido #${id}"]`)?.textContent === status, { id: order.id, status }, { timeout: 25000 });
    states.push(status);
  }
  await club.getByRole("navigation", { name: "Navegación Cream Club" }).getByRole("button", { name: "Club", exact: true }).click();
  await club.locator(".club-member-history-status.is-delivered").waitFor();
  await capture(club, "cream-club-historial-390");
  assert.deepEqual(errors, []);
  await writeFile(`${artifacts}/cream-verification.json`, JSON.stringify({ verifiedAt: new Date().toISOString(), environment: baseURL, localD1: new URL(baseURL).hostname === "127.0.0.1", catalogProducts: PRODUCTS.length, photographs: images.length, orderId: order.id, branch: order.branch, stations: ["Barra", "Cocina", "Panadería"], states, deliveredHistory: true, widths: [320, 390, 768, 1440], runtimeErrors: errors }, null, 2));
  console.log(`✓ D1 order #${order.id} appears in Hub, reaches Entregado and updates Club history`);
} finally { await browser.close(); }
