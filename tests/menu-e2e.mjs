import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { PRODUCTS } from "../shared/catalog.js";

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
const errors = [];
for (const page of [club, hub]) page.on("pageerror", (error) => errors.push(error.message));

async function step(name, run) {
  await run();
  console.log(`✓ ${name}`);
}

async function openCart() {
  await club.getByRole("button", { name: "Ver carrito", exact: true }).click();
  const cart = club.getByRole("dialog", { name: "Tu carrito", exact: true });
  await cart.waitFor();
  return cart;
}

async function chooseSection(name) {
  await club.locator(".section-chips").getByRole("button", { name, exact: true }).click();
}

async function visibleProductNames() {
  return club.getByRole("button", { name: /^Personalizar / }).evaluateAll(elements => elements.map(element => element.getAttribute("aria-label")));
}

async function trackingStatus(id, status) {
  await club.waitForFunction(
    ({ orderId, state }) => document.querySelector(`[aria-label="Estado del pedido #${orderId}"]`)?.textContent === state,
    { orderId: id, state: status },
    { timeout: 25000 },
  );
}

function pendingOrder(order) {
  assert.equal(order.total, null);
  assert.equal(order.knownTotal, 180);
  assert.equal(order.pricingPending, true);
  const pizza = order.items.find((item) => item.productId === "make-your-own-pizza");
  assert.ok(pizza);
  assert.equal(pizza.pricePending, true);
  assert.equal(pizza.unitPrice, null);
  assert.equal(pizza.total, null);
  assert.equal(pizza.quantity, 2);
  assert.deepEqual(pizza.selections, { vegetable: "mushroom", topping: "pepperoni", protein: "shrimp" });
  assert.equal(pizza.station, "Cocina");
  assert.equal(pizza.note, "Sin cebolla, por favor.");
  const coffee = order.items.find((item) => item.productId === "flat-white");
  assert.ok(coffee);
  assert.equal(coffee.pricePending, false);
  assert.equal(coffee.unitPrice, 90);
  assert.equal(coffee.total, 180);
  assert.equal(coffee.quantity, 2);
  assert.equal(coffee.station, "Barra");
}

function assertNotFree(text) {
  assert.doesNotMatch(text, /\$\s*0(?:[.,]00)?(?:\s|MXN|$)/, "An unpublished price must not be displayed as free");
}

async function assertReceipt(id) {
  const receipt = club.locator(".tracking-card").filter({
    has: club.getByRole("heading", { name: `Pedido #${id}`, exact: true }),
  });
  await receipt.waitFor();
  assert.equal((await receipt.locator("summary strong").textContent()).trim(), "Por confirmar");
  assert.match(await receipt.locator(".tracking-pricing-notice").textContent(), /Precio por confirmar en sucursal/);
  assertNotFree(await receipt.textContent());
  return receipt;
}

try {
  await step("The menu opens with favorites and exposes all categories through compact sections", async () => {
    await club.goto("/club");
    await club.getByRole("button", { name: "Personalizar Flat White", exact: true }).waitFor();
    assert.equal(await club.getByRole("button", { name: /^Personalizar / }).count(), 4);
    const categories = club.getByRole("group", { name: "Categorías del menú", exact: true });
    for (const name of ["Desayunos", "Comida", "Café", "Bebidas", "Bar", "Vinos"]) {
      await categories.getByRole("button", { name, exact: true }).waitFor();
    }
    await categories.getByRole("button", { name: "Comida", exact: true }).click();
    await chooseSection("Pizzas");
    assert.equal(await club.getByRole("button", { name: /^Personalizar / }).count(), 6);
    await club.getByLabel("Buscar en el menú", { exact: true }).fill("margárita pizza");
    await club.getByRole("button", { name: "Personalizar Margarita Pizza", exact: true }).waitFor();
    assert.equal(await club.getByRole("button", { name: /^Personalizar / }).count(), 1);
    await club.getByLabel("Buscar en el menú", { exact: true }).fill("");
    await chooseSection("Pastas");
    assert.equal(await club.getByRole("button", { name: /^Personalizar / }).count(), 5);
    await club.getByRole("button", { name: "Personalizar Lasagna", exact: true }).waitFor();
    await categories.getByRole("button", { name: "Vinos", exact: true }).click();
    assert.equal(await club.getByRole("button", { name: /^Personalizar / }).count(), PRODUCTS.filter((product) => product.category === "Vinos" && product.section === "Tintos por copa y botella").length);
    await club.getByLabel("Buscar en el menú", { exact: true }).fill("Oporto Grahams 20");
    assert.equal(await club.getByRole("button", { name: /^Personalizar / }).count(), 1);
    await club.getByLabel("Buscar en el menú", { exact: true }).fill("");
    await categories.getByRole("button", { name: "Comida", exact: true }).click();
    await chooseSection("Pizzas");
  });

  await step("Long sections stay at six products and global search reaches products in other categories", async () => {
    const categories = club.getByRole("group", { name: "Categorías del menú", exact: true });
    await categories.getByRole("button", { name: "Café", exact: true }).click();
    assert.equal(await club.getByRole("button", { name: /^Personalizar / }).count(), 6);
    const firstPage = await visibleProductNames();
    const pages = club.getByRole("navigation", { name: "Páginas del menú", exact: true });
    await pages.getByRole("button", { name: "Siguiente", exact: true }).click();
    assert.equal(await club.getByRole("button", { name: /^Personalizar / }).count(), 2);
    assert.ok((await visibleProductNames()).every(name => !firstPage.includes(name)));
    assert.match(await pages.textContent(), /Página 2 de 2/);
    assert.ok(await pages.getByRole("button", { name: "Siguiente", exact: true }).isDisabled());
    await pages.getByRole("button", { name: "Anterior", exact: true }).click();
    assert.deepEqual(await visibleProductNames(), firstPage);
    await club.getByLabel("Buscar en el menú", { exact: true }).fill("lasagna");
    await club.getByRole("button", { name: "Personalizar Lasagna", exact: true }).waitFor();
    assert.equal(await club.getByRole("button", { name: /^Personalizar / }).count(), 1);
    await categories.getByRole("button", { name: "Bar", exact: true }).click();
    await chooseSection("Cocteles clásicos");
    assert.equal(await club.getByRole("button", { name: /^Personalizar / }).count(), 6);
    await pages.getByRole("button", { name: "Siguiente", exact: true }).click();
    await categories.getByRole("button", { name: "Comida", exact: true }).click();
    assert.equal(await club.getByLabel("Buscar en el menú", { exact: true }).inputValue(), "");
    assert.equal(await club.getByLabel("Sección del menú", { exact: true }).inputValue(), "Pizzas");
    assert.equal(await pages.count(), 0);
    await club.setViewportSize({ width: 390, height: 844 });
    await club.getByLabel("Sección del menú", { exact: true }).selectOption("Pastas");
    await club.getByRole("button", { name: "Personalizar Lasagna", exact: true }).waitFor();
    const layout = await club.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth }));
    assert.ok(layout.scroll <= layout.width + 1, "The section menu must fit a phone viewport");
    assert.doesNotMatch(await club.locator("body").innerText(), /\p{Extended_Pictographic}/u);
    await club.getByLabel("Sección del menú", { exact: true }).selectOption("Pizzas");
    await club.setViewportSize({ width: 1280, height: 900 });
  });

  await step("A pizza with unpublished prices can be customized and mixed with a priced coffee", async () => {
    const button = club.getByRole("button", { name: "Personalizar Make Your Own Pizza", exact: true });
    const card = club.locator(".product-card").filter({ has: button });
    assert.match(await card.textContent(), /Precio por confirmar en sucursal/);
    assertNotFree(await card.textContent());
    await button.click();
    const pizza = club.getByRole("dialog", { name: "Make Your Own Pizza", exact: true });
    await pizza.getByRole("group", { name: "Vegetal extra", exact: true }).getByRole("radio", { name: "Champiñón", exact: true }).check();
    await pizza.getByRole("group", { name: "Ingrediente extra", exact: true }).getByRole("radio", { name: "Pepperoni", exact: true }).check();
    await pizza.getByRole("group", { name: "Proteína extra", exact: true }).getByRole("radio", { name: "Camarón", exact: true }).check();
    await pizza.getByLabel("Nota para este producto (opcional)", { exact: true }).fill("Sin cebolla, por favor.");
    assert.match(await pizza.getByRole("button", { name: /^Agregar al carrito/ }).textContent(), /Por confirmar/);
    assertNotFree(await pizza.textContent());
    await pizza.getByRole("button", { name: /^Agregar al carrito/ }).click();
    await club.getByRole("group", { name: "Categorías del menú", exact: true }).getByRole("button", { name: "Café", exact: true }).click();
    await club.getByRole("button", { name: "Personalizar Flat White", exact: true }).click();
    const coffee = club.getByRole("dialog", { name: "Flat White", exact: true });
    await coffee.getByRole("group", { name: "Leche", exact: true }).getByRole("radio", { name: /^Avena/ }).check();
    await coffee.getByRole("button", { name: /^Agregar al carrito/ }).click();
  });

  await step("Cart quantities and nullable totals persist after refresh without displaying zero", async () => {
    let cart = await openCart();
    await cart.getByRole("button", { name: "Aumentar cantidad de Make Your Own Pizza", exact: true }).click();
    await cart.getByRole("button", { name: "Disminuir cantidad de Make Your Own Pizza", exact: true }).click();
    await cart.getByRole("button", { name: "Aumentar cantidad de Make Your Own Pizza", exact: true }).click();
    await cart.getByRole("button", { name: "Aumentar cantidad de Flat White", exact: true }).click();
    await cart.getByLabel("Nombre", { exact: true }).fill(`E2E Menu ${Date.now()}`);
    await cart.getByLabel("Sucursal de recolección", { exact: true }).selectOption("Ánima Village");
    await cart.getByLabel("Nota del pedido (opcional)", { exact: true }).fill("Confirmar el precio de las pizzas al recoger.");
    assert.equal((await cart.locator(".cart-total strong").textContent()).trim(), "Por confirmar");
    assert.match(await cart.locator(".checkout-pricing-notice").textContent(), /Productos con precio conocido:.*180.*MXN/);
    assertNotFree(await cart.textContent());
    await club.reload();
    cart = await openCart();
    assert.equal(await cart.locator(".cart-line").count(), 2);
    assert.equal((await cart.locator(".cart-total strong").textContent()).trim(), "Por confirmar");
    assert.match(await cart.textContent(), /Productos con precio conocido:.*180.*MXN/);
    assertNotFree(await cart.textContent());
    const cached = await club.evaluate(() => JSON.parse(localStorage.getItem("cream-cart-v2")));
    const pizza = cached.find((item) => item.productId === "make-your-own-pizza");
    assert.equal(pizza.quantity, 2);
    assert.equal(pizza.pricePending, true);
    assert.equal(pizza.unitPrice, null);
    assert.equal(pizza.total, null);
    assert.equal(cached.find((item) => item.productId === "flat-white").total, 180);
  });

  let order;
  await step("D1 returns a pending total and the real known subtotal; the receipt survives reload", async () => {
    const cart = club.getByRole("dialog", { name: "Tu carrito", exact: true });
    const created = club.waitForResponse((response) => response.url().endsWith("/api/orders") && response.request().method() === "POST");
    await cart.getByRole("button", { name: "Enviar pedido", exact: true }).click();
    const response = await created;
    assert.equal(response.status(), 201);
    order = await response.json();
    pendingOrder(order);
    assert.equal(order.branch, "Ánima Village");
    assert.equal(order.items.length, 2);
    await trackingStatus(order.id, "Nuevo");
    await assertReceipt(order.id);
    const duplicate = await clubContext.request.post("/api/orders", { data: response.request().postDataJSON() });
    assert.equal(duplicate.status(), 200);
    const retried = await duplicate.json();
    assert.equal(retried.id, order.id);
    pendingOrder(retried);
    await club.reload();
    await club.getByRole("button", { name: "Mis pedidos", exact: true }).click();
    await trackingStatus(order.id, "Nuevo");
    const receipt = await assertReceipt(order.id);
    await receipt.locator("summary").click();
    assert.match(await receipt.textContent(), /Productos con precio conocido:.*180.*MXN/);
    const entry = await club.evaluate((id) => JSON.parse(localStorage.getItem("cream-tracking-v2")).find((item) => item.id === id), order.id);
    pendingOrder(entry.order);
  });

  await step("Hub receives pending-price kitchen and bar lines without treating the order as free", async () => {
    await hub.goto("/hub");
    await hub.getByLabel("Código de acceso", { exact: true }).fill(accessCode);
    await hub.getByRole("button", { name: "Entrar a Cream Hub", exact: true }).click();
    await hub.getByRole("heading", { name: "Pedidos en tiempo real." }).waitFor();
    await hub.getByLabel("Sucursal de operación", { exact: true }).selectOption("Ánima Village");
    await hub.getByLabel("Buscar cliente o número de pedido", { exact: true }).fill(order.customer);
    const card = hub.getByRole("article", { name: `Pedido #${order.id}`, exact: true });
    await card.waitFor();
    assert.match(await card.getByRole("region", { name: "Cocina", exact: true }).textContent(), /Make Your Own Pizza.*Champiñón.*Pepperoni.*Camarón/s);
    assert.match(await card.getByRole("region", { name: "Barra", exact: true }).textContent(), /Flat White.*Avena/s);
    assert.equal((await card.locator(".hub-order-total strong").textContent()).trim(), "Por confirmar");
    assert.match(await card.locator(".hub-order-pricing-note").textContent(), /Subtotal con precio:.*180/);
    assertNotFree(await card.textContent());
  });

  for (const [action, status] of [
    ["Confirmar pedido", "Confirmado"],
    ["Iniciar preparación", "En preparación"],
    ["Marcar listo", "Listo"],
    ["Marcar entregado", "Entregado"],
  ]) {
    await step(`Mixed-price order advances to ${status} with pending prices retained in Club and Hub`, async () => {
      const card = hub.getByRole("article", { name: `Pedido #${order.id}`, exact: true });
      const updated = hub.waitForResponse((response) => response.url().endsWith(`/api/orders/${order.id}`) && response.request().method() === "PATCH");
      await card.getByRole("button", { name: action, exact: true }).click();
      const response = await updated;
      assert.equal(response.status(), 200);
      const next = await response.json();
      assert.equal(next.status, status);
      pendingOrder(next);
      await trackingStatus(order.id, status);
      await assertReceipt(order.id);
      assert.equal((await card.locator(".hub-order-total strong").textContent()).trim(), "Por confirmar");
      assertNotFree(await card.textContent());
    });
  }

  await step("The completed pending-price receipt remains visible from local storage on mobile", async () => {
    await club.setViewportSize({ width: 390, height: 844 });
    await club.reload();
    await club.getByRole("button", { name: "Mis pedidos", exact: true }).click();
    await trackingStatus(order.id, "Entregado");
    await assertReceipt(order.id);
    const layout = await club.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth }));
    assert.ok(layout.scroll <= layout.width + 1, "The pending receipt must fit a mobile viewport");
    const entry = await club.evaluate((id) => JSON.parse(localStorage.getItem("cream-tracking-v2")).find((item) => item.id === id), order.id);
    pendingOrder(entry.order);
  });

  assert.deepEqual(errors, [], "The full-menu flow must not raise browser JavaScript errors");
  console.log("Cream full-menu and pending-price browser integration passed.");
} catch (error) {
  const directory = process.env.CREAM_E2E_ARTIFACTS || "/tmp/cream-e2e/menu";
  await mkdir(directory, { recursive: true });
  await Promise.allSettled([
    club.screenshot({ path: `${directory}/menu-club-failure.png`, fullPage: true }),
    hub.screenshot({ path: `${directory}/menu-hub-failure.png`, fullPage: true }),
  ]);
  console.error(`Full-menu browser screenshots: ${directory}`);
  throw error;
} finally {
  await browser.close();
}
