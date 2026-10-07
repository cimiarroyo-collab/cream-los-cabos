import { PRODUCTS, STATIONS } from "../../shared/catalog.js";

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function legacyItem(item, index) {
  if (!Array.isArray(item)) return item;
  const [name, price, station] = item;
  const product = PRODUCTS.find((candidate) => candidate.name === name);
  const amount = Number.isFinite(Number(price)) ? Number(price) : 0;
  return {
    productId: product?.id || `legacy-${index}`,
    name: String(name || "Producto"),
    station: STATIONS.includes(station)
      ? station
      : product?.station || "Cocina",
    quantity: 1,
    unitPrice: amount,
    total: amount,
    selections: {},
    options: [],
    note: "",
  };
}

export function readOrder(row) {
  let items;
  try {
    const parsed = JSON.parse(row.items);
    items = Array.isArray(parsed) ? parsed.map(legacyItem) : [];
  } catch {
    items = [];
  }
  const pricingPending = items.some((item) => item?.pricePending || item?.unitPrice === null || item?.total === null);
  return {
    id: row.id,
    customer: row.customer,
    phone: row.phone || "",
    branch: row.branch,
    items,
    status: row.status,
    total: pricingPending ? null : row.total,
    knownTotal: row.total,
    pricingPending,
    note: row.note || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at || row.created_at,
  };
}
