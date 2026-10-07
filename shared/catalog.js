import { MENU_SOURCE, OFFICIAL_PRODUCTS } from "./menu.js";

export const BRANCHES = ["Palmilla", "Ánima Village"];
export const STATUSES = [
  "Nuevo",
  "Confirmado",
  "En preparación",
  "Listo",
  "Entregado",
];
export const STATIONS = ["Barra", "Cocina", "Panadería"];
const ORIGINAL_PRODUCTS = [
  {
    id: "flat-white",
    name: "Flat White",
    category: "Café",
    station: "Barra",
    price: 75,
    description: "Espresso intenso, leche sedosa y un momento para ti.",
    image: "/images/coffee.jpg",
    options: [
      {
        id: "size",
        label: "Tamaño",
        values: [
          { id: "regular", label: "Regular", price: 0 },
          { id: "large", label: "Grande", price: 15 },
        ],
      },
      {
        id: "milk",
        label: "Leche",
        values: [
          { id: "whole", label: "Entera", price: 0 },
          { id: "oat", label: "Avena", price: 15 },
          { id: "almond", label: "Almendra", price: 15 },
        ],
      },
      {
        id: "temperature",
        label: "Temperatura",
        values: [
          { id: "hot", label: "Caliente", price: 0 },
          { id: "iced", label: "Con hielo", price: 0 },
        ],
      },
    ],
  },
  {
    id: "cabo-sunshine",
    name: "Cabo Sunshine",
    category: "Bebidas",
    station: "Barra",
    price: 135,
    description: "Una mezcla cítrica y refrescante que sabe a Cabo.",
    image: "/images/sunshine.jpg",
    options: [
      {
        id: "sweetness",
        label: "Dulzor",
        values: [
          { id: "regular", label: "Regular", price: 0 },
          { id: "less", label: "Poco dulce", price: 0 },
          { id: "none", label: "Sin azúcar añadida", price: 0 },
        ],
      },
      {
        id: "ice",
        label: "Hielo",
        values: [
          { id: "regular", label: "Regular", price: 0 },
          { id: "less", label: "Poco hielo", price: 0 },
        ],
      },
    ],
  },
  {
    id: "croissant",
    name: "Croissant",
    category: "Panadería",
    station: "Panadería",
    price: 95,
    description: "Capas doradas, mantequilla y ese primer bocado crujiente.",
    image: "/images/croissant.jpg",
    options: [
      {
        id: "extra",
        label: "Acompañamiento",
        values: [
          { id: "plain", label: "Sin extra", price: 0 },
          { id: "jam", label: "Mermelada", price: 20 },
          { id: "chocolate", label: "Chocolate", price: 25 },
        ],
      },
      {
        id: "temperature",
        label: "¿Cómo lo prefieres?",
        values: [
          { id: "warm", label: "Calientito", price: 0 },
          { id: "natural", label: "Al natural", price: 0 },
        ],
      },
    ],
  },
  {
    id: "avocado-toast",
    name: "Avocado Toast",
    category: "Desayunos",
    station: "Cocina",
    price: 185,
    description: "Pan tostado, aguacate fresco y un toque de la costa.",
    image: "/images/toast.jpg",
    options: [
      {
        id: "egg",
        label: "Agrega un huevo",
        values: [
          { id: "none", label: "Sin huevo", price: 0 },
          { id: "fried", label: "Estrellado", price: 25 },
          { id: "poached", label: "Pochado", price: 30 },
        ],
      },
    ],
  },
];
const originalIds = new Set(ORIGINAL_PRODUCTS.map((product) => product.id));
export const PRODUCTS = [
  ...ORIGINAL_PRODUCTS.map((product) => {
    const official = OFFICIAL_PRODUCTS.find((entry) => entry.id === product.id);
    return official
      ? {
          ...product,
          section: official.section,
          sourceMetadata: {
            ...MENU_SOURCE,
            name: official.name,
            section: official.section,
            description: official.description,
          },
        }
      : product;
  }),
  ...OFFICIAL_PRODUCTS.filter((product) => !originalIds.has(product.id)).map(
    (product) => ({ ...product, sourceMetadata: { ...MENU_SOURCE } }),
  ),
];
export const CATEGORIES = [
  "Todo",
  ...new Set([
    "Café",
    "Bebidas",
    "Desayunos",
    "Panadería",
    ...PRODUCTS.map((product) => product.category),
  ]),
];
export const findProduct = (id) =>
  PRODUCTS.find((product) => product.id === id);
export const defaultSelections = (product) =>
  Object.fromEntries(
    product.options.map((group) => [group.id, group.values[0].id]),
  );
export const formatMoney = (amount) =>
  amount == null ? "Por confirmar" : new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
    maximumFractionDigits: 0,
  }).format(amount);
export const formatTime = (timestamp) =>
  new Intl.DateTimeFormat("es-MX", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Mazatlan",
  }).format(new Date(timestamp));
export function priceItem(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new Error("Producto inválido.");
  const product = findProduct(raw.productId);
  if (!product) throw new Error("Este producto ya no está disponible.");
  if (!Number.isInteger(raw.quantity) || raw.quantity < 1 || raw.quantity > 20)
    throw new Error("La cantidad debe estar entre 1 y 20.");
  const selections = raw.selections ?? {};
  if (
    typeof selections !== "object" ||
    Array.isArray(selections) ||
    selections === null
  )
    throw new Error("Personalización inválida.");
  if (
    Object.keys(selections).some(
      (id) => !product.options.some((group) => group.id === id),
    )
  )
    throw new Error("Personalización no disponible.");
  const options = product.options.map((group) => {
    const selectedId = selections[group.id] ?? group.values[0].id;
    const value = group.values.find((option) => option.id === selectedId);
    if (!value)
      throw new Error(
        `Selecciona una opción válida para ${group.label.toLowerCase()}.`,
      );
    return {
      groupId: group.id,
      optionId: value.id,
      label: `${group.label}: ${value.label}`,
      price: value.price,
    };
  });
  if (raw.note != null && typeof raw.note !== "string")
    throw new Error("La nota del producto debe ser texto.");
  const note = (raw.note ?? "").trim();
  if (note.length > 200)
    throw new Error("La nota del producto admite hasta 200 caracteres.");
  const pricePending = product.price === null || options.some((option) => option.price === null);
  const unitPrice = pricePending ? null :
    product.price + options.reduce((sum, option) => sum + option.price, 0);
  return {
    productId: product.id,
    name: product.name,
    station: product.station,
    quantity: raw.quantity,
    unitPrice,
    total: pricePending ? null : unitPrice * raw.quantity,
    pricePending,
    selections: Object.fromEntries(
      options.map((option) => [option.groupId, option.optionId]),
    ),
    options,
    note,
  };
}
export function normalizeOrderInput(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new Error("Pedido inválido.");
  if (
    typeof raw.customer !== "string" ||
    raw.customer.trim().length < 2 ||
    raw.customer.trim().length > 80
  )
    throw new Error("Escribe tu nombre (de 2 a 80 caracteres).");
  if (!BRANCHES.includes(raw.branch))
    throw new Error("Selecciona una sucursal válida.");
  if (
    !Array.isArray(raw.items) ||
    raw.items.length < 1 ||
    raw.items.length > 30
  )
    throw new Error("El pedido debe tener entre 1 y 30 productos.");
  const items = raw.items.map(priceItem);
  if (items.reduce((sum, item) => sum + item.quantity, 0) > 50)
    throw new Error("El pedido admite hasta 50 unidades.");
  if (raw.phone != null && typeof raw.phone !== "string")
    throw new Error("Teléfono inválido.");
  const phone = (raw.phone ?? "").trim();
  if (
    phone &&
    (!/^[+\d\s()-]+$/.test(phone) ||
      phone.replace(/\D/g, "").length < 10 ||
      phone.replace(/\D/g, "").length > 15 ||
      phone.length > 30)
  )
    throw new Error("Escribe un teléfono válido de 10 a 15 dígitos.");
  if (raw.note != null && typeof raw.note !== "string")
    throw new Error("La nota del pedido debe ser texto.");
  const note = (raw.note ?? "").trim();
  if (note.length > 300)
    throw new Error("La nota del pedido admite hasta 300 caracteres.");
  if (
    typeof raw.requestId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      raw.requestId,
    )
  )
    throw new Error("Identificador del pedido inválido.");
  return {
    customer: raw.customer.trim(),
    phone,
    branch: raw.branch,
    items,
    note,
    // D1's original NOT NULL total retains the subtotal of fully priced lines.
    // Public responses derive the pending-price flag from the persisted item snapshots.
    total: items.reduce((sum, item) => sum + (item.total ?? 0), 0),
    requestId: raw.requestId,
  };
}
