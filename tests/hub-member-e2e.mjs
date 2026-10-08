import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { chromium } from "playwright";

const baseURL = process.env.CREAM_E2E_URL || "http://127.0.0.1:8788";
const accessCode = process.env.CREAM_HUB_TOKEN || "cream-local-test-token";
const chromiumPath = process.env.CREAM_CHROMIUM_PATH || process.env.CHROMIUM_PATH ||
  (existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined);
const browser = await chromium.launch({
  ...(chromiumPath ? { executablePath: chromiumPath } : {}),
  headless: true, args: ["--no-sandbox"],
});
const customerContext = await browser.newContext({ baseURL });
const hubContext = await browser.newContext({ baseURL, viewport: { width: 1440, height: 1000 } });
const hub = await hubContext.newPage();
const uncaught = [];
const memberReads = [];
hub.on("pageerror", (error) => uncaught.push(error.message));
hub.on("request", (request) => {
  if (request.method() === "GET" && new URL(request.url()).pathname.startsWith("/api/members/")) {
    memberReads.push({ url: request.url(), privateToken: request.headers()["x-member-token"] });
  }
});

async function step(name, test) {
  await test();
  console.log(`✓ ${name}`);
}

async function noOverflow(page) {
  const size = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth }));
  assert.ok(size.scroll <= size.width + 1, `Horizontal overflow at ${size.width}px`);
}

try {
  const memberToken = randomUUID();
  const created = await customerContext.request.post("/api/members", {
    data: { customer: `Tarjeta Hub E2E ${Date.now()}`, phone: "6241234567", requestId: randomUUID(), accessToken: memberToken },
  });
  assert.equal(created.status(), 201);
  const member = await created.json();
  let order;

  await step("A public Club QR opens Hub login without fetching or displaying customer information", async () => {
    const unauthorized = await customerContext.request.get(`/api/members/${member.id}`);
    assert.equal(unauthorized.status(), 404);
    await hub.goto(`/hub?member=${member.id}`);
    await hub.getByLabel("Código de acceso", { exact: true }).waitFor();
    assert.equal(memberReads.length, 0);
    assert.equal(await hub.getByText(member.customer, { exact: true }).count(), 0);
    assert.equal(await hub.getByRole("dialog", { name: "Tarjeta Cream Club", exact: true }).count(), 0);
  });

  await step("Authenticated staff read the Club card through the Hub cookie without a member secret", async () => {
    await hub.getByLabel("Código de acceso", { exact: true }).fill(accessCode);
    await hub.getByRole("button", { name: "Entrar a Cream Hub", exact: true }).click();
    const dialog = hub.getByRole("dialog", { name: "Tarjeta Cream Club", exact: true });
    await dialog.getByRole("heading", { name: member.customer, exact: true }).waitFor();
    assert.ok(memberReads.length >= 1);
    assert.ok(memberReads.every((request) => !request.privateToken));
    assert.match(await dialog.getByRole("region", { name: "Historial de la tarjeta", exact: true }).textContent(), /todavía no tiene pedidos/);
    assert.equal(await dialog.locator(".hub-member-count strong").textContent(), "0");
    assert.ok(!(await hub.content()).includes(memberToken), "Private membership token must never appear in Hub markup");
  });

  await step("The Hub card reflects a real D1 member order and counts it only after delivery", async () => {
    const placed = await customerContext.request.post("/api/orders", {
      headers: { "X-Member-Token": memberToken },
      data: { customer: member.customer, branch: "Palmilla", requestId: randomUUID(), memberId: member.id,
        items: [{ productId: "flat-white", quantity: 1, selections: {} }] },
    });
    assert.equal(placed.status(), 201);
    order = await placed.json();
    const dialog = hub.getByRole("dialog", { name: "Tarjeta Cream Club", exact: true });
    await dialog.getByRole("button", { name: "Actualizar tarjeta", exact: true }).click();
    await dialog.getByLabel(`Estado del pedido #${order.id}`, { exact: true }).waitFor();
    assert.equal(await dialog.getByLabel(`Estado del pedido #${order.id}`, { exact: true }).textContent(), "Nuevo");
    assert.equal(await dialog.locator(".hub-member-count strong").textContent(), "0");
    let previous = "Nuevo";
    for (const status of ["Confirmado", "En preparación", "Listo", "Entregado"]) {
      const advanced = await hubContext.request.patch(`/api/orders/${order.id}`, {
        data: { status, expectedStatus: previous },
      });
      assert.equal(advanced.status(), 200);
      assert.equal((await advanced.json()).status, status);
      previous = status;
    }
    await dialog.getByRole("button", { name: "Actualizar tarjeta", exact: true }).click();
    await hub.waitForFunction((id) => document.querySelector(`[aria-label="Estado del pedido #${id}"]`)?.textContent === "Entregado", order.id);
    assert.equal(await dialog.locator(".hub-member-count strong").textContent(), "1");
    const tracking = await customerContext.request.get(`/api/orders/${order.id}`, { headers: { "X-Order-Token": order.trackingToken } });
    assert.equal(tracking.status(), 200);
    assert.equal((await tracking.json()).status, "Entregado");
    await noOverflow(hub);
    await dialog.getByRole("button", { name: "Cerrar", exact: true }).click();
    assert.equal(new URL(hub.url()).searchParams.has("member"), false);
  });

  await step("Manual card lookup rejects unrelated QR URLs and accepts this site's public QR", async () => {
    await hub.getByRole("button", { name: "Consultar tarjeta Club", exact: true }).click();
    const dialog = hub.getByRole("dialog", { name: "Tarjeta Cream Club", exact: true });
    const before = memberReads.length;
    await dialog.getByLabel("Identificador de tarjeta", { exact: true }).fill(`https://example.com/hub?member=${member.id}`);
    await dialog.getByRole("button", { name: "Consultar", exact: true }).click();
    await dialog.getByRole("alert").waitFor();
    assert.equal(memberReads.length, before);
    await dialog.getByLabel("Identificador de tarjeta", { exact: true }).fill(`${baseURL}/hub?member=${member.id}`);
    await dialog.getByRole("button", { name: "Consultar", exact: true }).click();
    await dialog.getByRole("heading", { name: member.customer, exact: true }).waitFor();
    for (const width of [768, 390, 320]) {
      await hub.setViewportSize({ width, height: 844 });
      await noOverflow(hub);
      assert.ok(await dialog.isVisible());
    }
    await dialog.getByRole("button", { name: "Cerrar", exact: true }).click();
    await noOverflow(hub);
  });

  await step("Invalid QR identifiers never trigger a member API read and logout keeps the card private", async () => {
    const beforeInvalid = memberReads.length;
    await hub.goto("/hub?member=invalid-card");
    const dialog = hub.getByRole("dialog", { name: "Tarjeta Cream Club", exact: true });
    await dialog.getByRole("alert").waitFor();
    assert.equal(memberReads.length, beforeInvalid);
    await dialog.getByRole("button", { name: "Cerrar", exact: true }).click();
    await hub.getByRole("button", { name: "Cerrar sesión", exact: true }).click();
    await hub.getByLabel("Código de acceso", { exact: true }).waitFor();
    assert.equal((await hubContext.request.get(`/api/members/${member.id}`)).status(), 404);
    const beforeLogin = memberReads.length;
    await hub.goto(`/hub?member=${member.id}`);
    await hub.getByLabel("Código de acceso", { exact: true }).waitFor();
    assert.equal(memberReads.length, beforeLogin);
    assert.equal(await hub.getByText(member.customer, { exact: true }).count(), 0);
  });
  assert.deepEqual(uncaught, [], "Hub card must not raise browser runtime errors");
  console.log("Hub member QR integration passed.");
} finally {
  await browser.close();
}
