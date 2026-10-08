import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import jsQR from "jsqr";

const baseURL = process.env.CREAM_E2E_URL || "http://127.0.0.1:8788";
const accessCode = process.env.CREAM_HUB_TOKEN || "cream-local-test-token";
const executablePath = process.env.CREAM_CHROMIUM_PATH || process.env.CHROMIUM_PATH ||
  (existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined);
const browser = await chromium.launch({
  ...(executablePath ? { executablePath } : {}),
  headless: true,
  args: ["--no-sandbox"],
});
const clubContext = await browser.newContext({ baseURL, viewport: { width: 1280, height: 900 } });
const hubContext = await browser.newContext({ baseURL, viewport: { width: 1440, height: 1000 } });
const club = await clubContext.newPage();
const hub = await hubContext.newPage();
const browserErrors = [];
for (const page of [club, hub]) page.on("pageerror", (error) => browserErrors.push(error.message));

async function step(name, run) {
  await run();
  console.log(`✓ ${name}`);
}
async function savedMember() {
  return club.evaluate(() => JSON.parse(localStorage.getItem("cream-member-v1")));
}
async function noOverflow(page) {
  const layout = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth }));
  assert.ok(layout.scroll <= layout.width + 1, `Overflow at ${layout.width}px: ${layout.scroll}px`);
}
async function trackingStatus(id, status) {
  await club.waitForFunction(
    ({ orderId, state }) => document.querySelector(`[aria-label="Estado del pedido #${orderId}"]`)?.textContent === state,
    { orderId: id, state: status },
    { timeout: 25000 },
  );
}
let member;
let order;
let qrUrl;
try {
  await step("A failed registration preserves the private request and safely retries into a real D1 card", async () => {
    await club.goto("/club");
    await club.getByRole("button", { name: "Club", exact: true }).click();
    await club.getByLabel("Nombre", { exact: true }).fill(`E2E Club ${Date.now()}`);
    await club.getByLabel("Teléfono (opcional)", { exact: true }).fill("6241234567");
    let failedIntent;
    await club.route("**/api/members", async (route) => {
      if (route.request().method() === "POST") {
        failedIntent = route.request().postDataJSON();
        await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Prueba: registro temporalmente no disponible." }) });
      } else await route.continue();
    });
    await club.getByRole("button", { name: "Crear mi tarjeta", exact: true }).click();
    await club.getByRole("alert").waitFor();
    assert.match(await club.getByRole("alert").textContent(), /registro temporalmente no disponible/);
    assert.equal(await savedMember(), null, "A failed registration must not invent a member");
    assert.ok(JSON.stringify(await club.evaluate(() => JSON.parse(localStorage.getItem("cream-member-pending-v1")))) === JSON.stringify(failedIntent), "The pending private intent must match the failed request");
    assert.equal(await club.locator(".club-member-qr canvas").count(), 0);
    await club.unroute("**/api/members");
    const created = club.waitForResponse((response) => response.url().endsWith("/api/members") && response.request().method() === "POST");
    await club.getByRole("button", { name: "Crear mi tarjeta", exact: true }).click();
    const response = await created;
    assert.equal(response.status(), 201);
    assert.ok(JSON.stringify(response.request().postDataJSON()) === JSON.stringify(failedIntent), "A retry must retain the original private registration intent");
    const profile = await response.json();
    assert.equal(profile.deliveredCount, 0);
    assert.deepEqual(profile.recentOrders, []);
    assert.equal("token" in profile, false);
    assert.equal("accessToken" in profile, false);
    await club.locator(".club-member-qr canvas").waitFor();
    member = await savedMember();
    assert.equal(member.id, profile.id);
    assert.ok(member.token === failedIntent.accessToken, "The created member must preserve its private access token");
    assert.equal(await club.evaluate(() => localStorage.getItem("cream-member-pending-v1")), null);
    assert.match(await club.locator(".club-member-benefits").textContent(), /Beneficios por definir/);
  });

  await step("Profile validates phone input and persists a real edit without exposing the private access token", async () => {
    await club.getByRole("button", { name: "Mis datos", exact: true }).click();
    await club.getByRole("button", { name: "Guardar cambios", exact: true }).waitFor();
    await club.getByLabel("Teléfono (opcional)", { exact: true }).fill("6241234");
    await club.getByRole("button", { name: "Guardar cambios", exact: true }).click();
    assert.match(await club.getByRole("alert").textContent(), /Revisa el teléfono/);
    const changedName = `E2E Cream Member ${Date.now()}`;
    await club.getByLabel("Nombre", { exact: true }).fill(changedName);
    await club.getByLabel("Teléfono (opcional)", { exact: true }).fill("+52 624 123 4567");
    const updated = club.waitForResponse((response) => response.url().endsWith(`/api/members/${member.id}`) && response.request().method() === "PATCH");
    await club.getByRole("button", { name: "Guardar cambios", exact: true }).click();
    assert.equal((await updated).status(), 200);
    await club.getByText("Tus datos se guardaron.", { exact: true }).waitFor();
    member = await savedMember();
    assert.equal(member.customer, changedName);
    assert.equal(member.phone, "+52 624 123 4567");
    assert.equal((await clubContext.request.get(`/api/members/${member.id}`)).status(), 404);
    assert.equal((await clubContext.request.get(`/api/members/${member.id}`, { headers: { "X-Member-Token": randomUUID() } })).status(), 404);
    const own = await clubContext.request.get(`/api/members/${member.id}`, { headers: { "X-Member-Token": member.token } });
    assert.equal(own.status(), 200);
    assert.equal((await own.json()).customer, changedName);
    assert.equal((await club.locator("body").innerText()).includes(member.token), false);
    assert.equal((await club.locator("body").innerHTML()).includes(member.token), false);
    assert.equal(new URL(club.url()).searchParams.has("token"), false);
  });

  await step("The displayed QR decodes to an authenticated Hub lookup using only the public card ID", async () => {
    await club.getByRole("button", { name: "Mi QR", exact: true }).click();
    const canvas = club.locator(".club-member-qr canvas");
    await canvas.waitFor();
    await club.waitForFunction(() => {
      const canvas = document.querySelector(".club-member-qr canvas");
      return canvas && canvas.width === 256 && canvas.getContext("2d").getImageData(0, 0, 1, 1).data[3] === 255;
    });
    const pixels = await canvas.evaluate((element) => ({ width: element.width, height: element.height, pixels: Array.from(element.getContext("2d").getImageData(0, 0, element.width, element.height).data) }));
    const decoded = jsQR(new Uint8ClampedArray(pixels.pixels), pixels.width, pixels.height);
    assert.ok(decoded, "The rendered QR must be decodable from its actual canvas pixels");
    qrUrl = decoded.data;
    const url = new URL(qrUrl);
    assert.equal(url.origin, new URL(baseURL).origin);
    assert.equal(url.pathname, "/hub");
    assert.deepEqual([...url.searchParams.entries()], [["member", member.id]]);
    assert.equal(qrUrl.includes(member.token), false);
    await hub.goto(qrUrl);
    await hub.getByLabel("Código de acceso", { exact: true }).waitFor();
    assert.equal(await hub.getByRole("dialog", { name: "Tarjeta Cream Club", exact: true }).count(), 0);
    assert.equal((await hub.locator("body").innerText()).includes(member.customer), false);
  });

  await step("A member submits an actual customized order and Hub receives its station details", async () => {
    await club.getByRole("button", { name: "Menú", exact: true }).click();
    await club.getByRole("button", { name: "Personalizar Flat White", exact: true }).click();
    const editor = club.getByRole("dialog", { name: "Flat White", exact: true });
    await editor.getByRole("group", { name: "Leche", exact: true }).getByRole("radio", { name: /^Avena/ }).check();
    await editor.getByLabel("Nota para este producto (opcional)", { exact: true }).fill("Prueba Club: sin espuma.");
    await editor.getByRole("button", { name: /^Agregar al carrito/ }).click();
    await club.getByRole("button", { name: "Ver carrito", exact: true }).click();
    const cart = club.getByRole("dialog", { name: "Tu carrito", exact: true });
    assert.equal(await cart.getByLabel("Nombre", { exact: true }).inputValue(), member.customer);
    await cart.getByLabel("Sucursal de recolección", { exact: true }).selectOption("Palmilla");
    const submitted = club.waitForResponse((response) => response.url().endsWith("/api/orders") && response.request().method() === "POST");
    await cart.getByRole("button", { name: "Enviar pedido", exact: true }).click();
    const response = await submitted;
    assert.equal(response.status(), 201);
    assert.equal(response.request().postDataJSON().memberId, member.id);
    assert.ok(response.request().headers()["x-member-token"] === member.token, "Member orders must authenticate with the private header");
    order = await response.json();
    assert.equal(order.total, 90);
    assert.equal(order.items[0].station, "Barra");
    await trackingStatus(order.id, "Nuevo");
    await hub.getByLabel("Código de acceso", { exact: true }).fill(accessCode);
    await hub.getByRole("button", { name: "Entrar a Cream Hub", exact: true }).click();
    await hub.getByRole("heading", { name: "Pedidos en tiempo real." }).waitFor();
    const lookup = hub.getByRole("dialog", { name: "Tarjeta Cream Club", exact: true });
    await lookup.waitFor();
    await lookup.getByRole("heading", { name: member.customer, exact: true }).waitFor();
    await lookup.getByRole("button", { name: "Cerrar", exact: true }).click();
    await hub.getByLabel("Sucursal de operación", { exact: true }).selectOption("Palmilla");
    await hub.getByLabel("Buscar cliente o número de pedido", { exact: true }).fill(String(order.id));
    const card = hub.getByRole("article", { name: `Pedido #${order.id}`, exact: true });
    await card.waitFor();
    assert.match(await card.getByRole("region", { name: "Barra", exact: true }).textContent(), /Flat White.*Avena.*sin espuma/s);
  });

  for (const [action, status] of [
    ["Confirmar pedido", "Confirmado"],
    ["Iniciar preparación", "En preparación"],
    ["Marcar listo", "Listo"],
    ["Marcar entregado", "Entregado"],
  ]) {
    await step(`The member order advances to ${status} and the client sees the actual updated state`, async () => {
      const updated = hub.waitForResponse((response) => response.url().endsWith(`/api/orders/${order.id}`) && response.request().method() === "PATCH");
      await hub.getByRole("article", { name: `Pedido #${order.id}`, exact: true }).getByRole("button", { name: action, exact: true }).click();
      const response = await updated;
      assert.equal(response.status(), 200);
      assert.equal((await response.json()).status, status);
      await trackingStatus(order.id, status);
    });
  }

  await step("The delivered order appears in the real member history and survives a browser reload", async () => {
    await club.getByRole("button", { name: "Club", exact: true }).click();
    const history = club.locator(".club-member-history");
    const entry = history.locator("li").filter({ hasText: `Pedido #${order.id}` });
    await entry.waitFor();
    assert.equal((await entry.locator(".club-member-history-status").textContent()).trim(), "Entregado");
    assert.equal((await history.locator(".club-member-visit-count strong").textContent()).trim(), "1");
    await entry.getByRole("button", { name: `Consultar pedido ${order.id}`, exact: true }).click();
    await trackingStatus(order.id, "Entregado");
    await club.reload();
    await club.getByRole("button", { name: "Club", exact: true }).click();
    await entry.waitFor();
    assert.equal((await savedMember()).id, member.id);
    assert.ok((await savedMember()).token === member.token, "The private member access must survive a reload");
    assert.equal((await history.locator(".club-member-visit-count strong").textContent()).trim(), "1");
  });

  await step("Card, QR and profile fit mobile, tablet and desktop with no emojis or private tokens in the page", async () => {
    for (const width of [320, 390, 768, 1440]) {
      await club.setViewportSize({ width, height: 950 });
      for (const name of ["Mi QR", "Mis datos", "Tarjeta e historial"]) {
        await club.getByRole("button", { name, exact: true }).click();
        await noOverflow(club);
      }
    }
    assert.doesNotMatch(await club.locator("body").innerText(), /\p{Extended_Pictographic}/u);
    assert.equal((await club.locator("body").innerHTML()).includes(member.token), false);
    assert.deepEqual(browserErrors, [], "Membership views must not raise JavaScript errors");
  });
  console.log("Cream member card, decoded QR, profile and D1 order history integration passed.");
} catch (error) {
  const directory = process.env.CREAM_E2E_ARTIFACTS || "/tmp/cream-e2e/member";
  await mkdir(directory, { recursive: true });
  await Promise.allSettled([
    club.screenshot({ path: `${directory}/member-club-failure.png`, fullPage: true }),
    hub.screenshot({ path: `${directory}/member-hub-failure.png`, fullPage: true }),
  ]);
  console.error(`Member browser screenshots: ${directory}`);
  throw error;
} finally {
  await browser.close();
}
