import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const baseURL = process.env.CREAM_E2E_URL || "http://127.0.0.1:8788";
const executablePath =
  process.env.CREAM_CHROMIUM_PATH ||
  process.env.CHROMIUM_PATH ||
  (existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined);
const browser = await chromium.launch({
  ...(executablePath ? { executablePath } : {}),
  headless: true,
  args: ["--no-sandbox"],
});

async function lostResponseRecovery({ blockedStorage = false } = {}) {
  const context = await browser.newContext({ baseURL });
  const page = await context.newPage();
  try {
    if (blockedStorage)
      await page.addInitScript(() => {
        Storage.prototype.setItem = function () {
          throw new DOMException("Storage disabled for test", "SecurityError");
        };
      });
    await page.goto("/club");
    await page
      .getByRole("button", { name: "Personalizar Cabo Sunshine", exact: true })
      .click();
    await page.getByRole("button", { name: /^Agregar al carrito/ }).click();
    await page
      .getByRole("button", { name: "Ver carrito", exact: true })
      .click();
    const cart = page.getByRole("dialog", { name: "Tu carrito", exact: true });
    await cart
      .getByLabel("Nombre", { exact: true })
      .fill(`Recovery ${Date.now()}`);
    await cart
      .getByLabel("Nota del pedido (opcional)", { exact: true })
      .fill("Conservar nota tras pérdida de respuesta");
    let accepted;
    let firstPayload;
    await page.route("**/api/orders", async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      firstPayload = route.request().postDataJSON();
      const response = await route.fetch();
      accepted = { status: response.status(), order: await response.json() };
      await route.abort("failed");
    });
    await cart
      .getByRole("button", { name: "Enviar pedido", exact: true })
      .click();
    await cart.getByRole("alert").waitFor();
    assert.equal(accepted.status, 201);
    assert.equal(await cart.locator(".cart-line").count(), 1);
    await page.unroute("**/api/orders");
    if (!blockedStorage) {
      await page.reload();
      await page
        .getByRole("button", { name: "Ver carrito", exact: true })
        .click();
      await cart.waitFor();
      assert.equal(
        await cart
          .getByLabel("Nota del pedido (opcional)", { exact: true })
          .inputValue(),
        firstPayload.note,
      );
    }
    const responseWait = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/orders") &&
        response.request().method() === "POST",
    );
    await cart
      .getByRole("button", { name: "Enviar pedido", exact: true })
      .click();
    const response = await responseWait;
    assert.equal(response.status(), 200);
    assert.equal(
      response.request().postDataJSON().requestId,
      firstPayload.requestId,
    );
    assert.equal((await response.json()).id, accepted.order.id);
    await page
      .getByRole("heading", {
        name: `Pedido #${accepted.order.id}`,
        exact: true,
      })
      .waitFor();
    if (blockedStorage)
      await page
        .getByText(/Este navegador no permite guardar el seguimiento/)
        .waitFor();
    console.log(
      blockedStorage
        ? "✓ Blocked browser storage retains the pending ID and explains receipt preservation"
        : "✓ Accepted order with lost response survives reload and retries without duplication",
    );
  } catch (error) {
    const directory = process.env.CREAM_E2E_ARTIFACTS || "/tmp/cream-e2e";
    await mkdir(directory, { recursive: true });
    await page.screenshot({
      path: `${directory}/recovery-${blockedStorage ? "storage" : "reload"}-failure.png`,
      fullPage: true,
    });
    throw error;
  } finally {
    await context.close();
  }
}

try {
  await lostResponseRecovery();
  await lostResponseRecovery({ blockedStorage: true });
  const context = await browser.newContext({ baseURL });
  try {
    const page = await context.newPage();
    await page.addInitScript(() =>
      localStorage.setItem(
        "cream-tracking-v2",
        JSON.stringify([
          null,
          {
            id: 1,
            token: "invalid-cache",
            order: {
              id: 1,
              customer: "Invalid timestamp",
              branch: "Palmilla",
              status: "Nuevo",
              total: 75,
              createdAt: 1e100,
              note: "",
              items: [
                {
                  name: "Flat White",
                  quantity: 1,
                  total: 75,
                  options: [],
                  note: "",
                },
              ],
            },
          },
        ]),
      ),
    );
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("/club");
    await page
      .getByRole("button", { name: "Personalizar Flat White", exact: true })
      .waitFor();
    await page
      .getByRole("button", { name: "Mis pedidos", exact: true })
      .click();
    await page
      .getByRole("heading", {
        name: "Tu próximo favorito te espera",
        exact: true,
      })
      .waitFor();
    assert.deepEqual(errors, []);
    console.log(
      "✓ Corrupt cached records and invalid timestamps recover without a broken interface",
    );
  } finally {
    await context.close();
  }
  console.log("Cream order recovery browser tests passed.");
} finally {
  await browser.close();
}
