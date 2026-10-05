import test from "node:test";
import assert from "node:assert/strict";
import {
  BRANCHES,
  PRODUCTS,
  defaultSelections,
  normalizeOrderInput,
  priceItem,
} from "../shared/catalog.js";

const line = (overrides = {}) => ({
  productId: "flat-white",
  quantity: 1,
  selections: {},
  ...overrides,
});
const order = (overrides = {}) => ({
  customer: "María",
  branch: BRANCHES[0],
  items: [line()],
  requestId: crypto.randomUUID(),
  ...overrides,
});

test("all four menu products price customized units and route to the proper station", () => {
  const cases = [
    {
      productId: "flat-white",
      quantity: 2,
      selections: { size: "large", milk: "oat", temperature: "iced" },
      unitPrice: 105,
      station: "Barra",
    },
    {
      productId: "cabo-sunshine",
      quantity: 1,
      selections: { sweetness: "less", ice: "less" },
      unitPrice: 135,
      station: "Barra",
    },
    {
      productId: "croissant",
      quantity: 2,
      selections: { extra: "chocolate", temperature: "natural" },
      unitPrice: 120,
      station: "Panadería",
    },
    {
      productId: "avocado-toast",
      quantity: 3,
      selections: { egg: "poached" },
      unitPrice: 215,
      station: "Cocina",
    },
  ];
  for (const expected of cases) {
    const priced = priceItem(expected);
    assert.equal(priced.unitPrice, expected.unitPrice, expected.productId);
    assert.equal(
      priced.total,
      expected.unitPrice * expected.quantity,
      expected.productId,
    );
    assert.equal(priced.station, expected.station, expected.productId);
    assert.deepEqual(priced.selections, expected.selections);
    assert.ok(
      priced.options.every(
        (option) =>
          typeof option.label === "string" && option.label.includes(": "),
      ),
    );
  }
  assert.equal(PRODUCTS.length, cases.length);
});

test("omitting customization chooses catalog defaults with no surcharge", () => {
  for (const product of PRODUCTS) {
    const priced = priceItem({ productId: product.id, quantity: 1 });
    assert.deepEqual(priced.selections, defaultSelections(product));
    assert.equal(priced.unitPrice, product.price);
    assert.equal(priced.note, "");
  }
});

test("pricing ignores customer-supplied name, station, total, options, and unit price", () => {
  const priced = priceItem(
    line({
      name: "Forged product",
      station: "Otro",
      total: -1,
      unitPrice: 0,
      options: [{ price: -100000 }],
      quantity: 3,
    }),
  );
  assert.equal(priced.name, "Flat White");
  assert.equal(priced.station, "Barra");
  assert.equal(priced.unitPrice, 75);
  assert.equal(priced.total, 225);
  const normalized = normalizeOrderInput(
    order({
      total: 0,
      status: "Entregado",
      items: [line({ total: 0, unitPrice: 0 })],
    }),
  );
  assert.equal(normalized.total, 75);
  assert.ok(!("status" in normalized));
});

test("individual product quantities must be integers between one and twenty", () => {
  assert.equal(priceItem(line({ quantity: 1 })).quantity, 1);
  assert.equal(priceItem(line({ quantity: 20 })).quantity, 20);
  for (const quantity of [
    0,
    -1,
    21,
    1.5,
    NaN,
    Infinity,
    "1",
    null,
    undefined,
  ]) {
    assert.throws(() => priceItem(line({ quantity })), /cantidad/i);
  }
});

test("unknown products, option groups, option values, and malformed lines are rejected", () => {
  for (const productId of ["missing", "__proto__", "Flat White", null, 0]) {
    assert.throws(() => priceItem(line({ productId })), /disponible/i);
  }
  for (const selections of [
    { discount: "free" },
    { milk: "unknown" },
    { size: 1 },
    [],
    "oat",
  ]) {
    assert.throws(
      () => priceItem(line({ selections })),
      /opción|personalización/i,
    );
  }
  for (const value of [null, [], "flat-white", 3])
    assert.throws(() => priceItem(value), /inválido/i);
});

test("line notes trim whitespace, allow two hundred characters, and reject longer or non-text notes", () => {
  assert.equal(priceItem(line({ note: "  Sin azúcar  " })).note, "Sin azúcar");
  assert.equal(priceItem(line({ note: "x".repeat(200) })).note.length, 200);
  assert.throws(() => priceItem(line({ note: "x".repeat(201) })), /200/);
  assert.throws(() => priceItem(line({ note: 123 })), /texto/i);
});

test("orders allow thirty lines and fifty units but reject over-limit or empty carts", () => {
  assert.equal(
    normalizeOrderInput(
      order({ items: Array.from({ length: 30 }, () => line()) }),
    ).items.length,
    30,
  );
  assert.equal(
    normalizeOrderInput(
      order({
        items: [
          line({ quantity: 20 }),
          line({ quantity: 20 }),
          line({ quantity: 10 }),
        ],
      }),
    ).total,
    3750,
  );
  for (const items of [
    [],
    null,
    {},
    Array.from({ length: 31 }, () => line()),
    [line({ quantity: 20 }), line({ quantity: 20 }), line({ quantity: 11 })],
  ]) {
    assert.throws(
      () => normalizeOrderInput(order({ items })),
      /productos|unidades/i,
    );
  }
});

test("names are required, trimmed, and limited to two through eighty characters", () => {
  assert.equal(
    normalizeOrderInput(order({ customer: "  Ana  " })).customer,
    "Ana",
  );
  assert.equal(
    normalizeOrderInput(order({ customer: "A".repeat(80) })).customer.length,
    80,
  );
  for (const customer of ["", " ", "A", "A".repeat(81), null, 123]) {
    assert.throws(() => normalizeOrderInput(order({ customer })), /nombre/i);
  }
});

test("orders accept only Palmilla and Ánima Village branches", () => {
  for (const branch of BRANCHES)
    assert.equal(normalizeOrderInput(order({ branch })).branch, branch);
  for (const branch of ["Unknown", "Palmilla ", "Anima Village", "", null]) {
    assert.throws(() => normalizeOrderInput(order({ branch })), /sucursal/i);
  }
});

test("optional phone numbers accept common formatting and ten through fifteen digits", () => {
  for (const phone of [
    "",
    "6241234567",
    "+52 (624) 123-4567",
    "+123456789012345",
  ]) {
    assert.equal(normalizeOrderInput(order({ phone })).phone, phone);
  }
  assert.equal(normalizeOrderInput(order()).phone, "");
  assert.equal(
    normalizeOrderInput(order({ phone: "  6241234567  " })).phone,
    "6241234567",
  );
  for (const phone of [
    "123456789",
    "1234567890123456",
    "624abc4567",
    `624${" ".repeat(22)}1234567`,
    6241234567,
  ]) {
    assert.throws(() => normalizeOrderInput(order({ phone })), /teléfono/i);
  }
});

test("order notes allow three hundred characters and require text", () => {
  assert.equal(
    normalizeOrderInput(order({ note: "  Para llevar  " })).note,
    "Para llevar",
  );
  assert.equal(
    normalizeOrderInput(order({ note: "x".repeat(300) })).note.length,
    300,
  );
  assert.throws(
    () => normalizeOrderInput(order({ note: "x".repeat(301) })),
    /300/,
  );
  assert.throws(() => normalizeOrderInput(order({ note: {} })), /texto/i);
});

test("request IDs must be UUIDv4 and invalid order envelopes are rejected", () => {
  const requestId = crypto.randomUUID();
  assert.equal(normalizeOrderInput(order({ requestId })).requestId, requestId);
  for (const invalid of [
    "",
    "123",
    "00000000-0000-0000-0000-000000000000",
    null,
    undefined,
  ]) {
    assert.throws(
      () => normalizeOrderInput(order({ requestId: invalid })),
      /identificador/i,
    );
  }
  for (const invalid of [null, [], "order", 123])
    assert.throws(() => normalizeOrderInput(invalid), /inválido/i);
});

test("normalization does not mutate customer input or retain editable selection references", () => {
  const raw = order({
    customer: "  Ana  ",
    items: [line({ selections: { milk: "oat" }, note: "  Sin azúcar  " })],
  });
  const original = JSON.stringify(raw);
  const normalized = normalizeOrderInput(raw);
  assert.equal(JSON.stringify(raw), original);
  normalized.items[0].selections.milk = "whole";
  assert.equal(raw.items[0].selections.milk, "oat");
});
