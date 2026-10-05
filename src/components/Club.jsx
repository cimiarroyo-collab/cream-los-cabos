import React, { useEffect, useRef, useState } from "react";
import {
  BRANCHES,
  CATEGORIES,
  PRODUCTS,
  STATUSES,
  defaultSelections,
  findProduct,
  formatMoney,
  formatTime,
  normalizeOrderInput,
  priceItem,
} from "../../shared/catalog.js";
import { api } from "../api.js";
import { storage } from "../storage.js";
import { Brand, Icon, Modal, Quantity } from "./UI.jsx";

const CART_KEY = "cream-cart-v2";
const ORDERS_KEY = "cream-tracking-v2";
const PROFILE_KEY = "cream-profile-v2";
const PENDING_KEY = "cream-pending-v2";
const NOTE_KEY = "cream-checkout-note-v2";
function loadCart() {
  const data = storage.get(CART_KEY, []);
  if (!Array.isArray(data)) return [];
  return data.slice(0, 30).flatMap((item) => {
    try {
      return [
        {
          ...priceItem(item),
          key: typeof item.key === "string" ? item.key : crypto.randomUUID(),
        },
      ];
    } catch {
      return [];
    }
  });
}
function loadOrders() {
  const data = storage.get(ORDERS_KEY, []);
  if (!Array.isArray(data)) return [];
  return data
    .filter((entry) => {
      const order = entry?.order;
      return (
        entry &&
        Number.isSafeInteger(entry.id) &&
        entry.id > 0 &&
        typeof entry.token === "string" &&
        entry.token.length <= 128 &&
        order &&
        order.id === entry.id &&
        typeof order.customer === "string" &&
        BRANCHES.includes(order.branch) &&
        Number.isFinite(order.createdAt) &&
        Number.isFinite(new Date(order.createdAt).getTime()) &&
        order.createdAt > 0 &&
        Number.isFinite(order.total) &&
        order.total >= 0 &&
        STATUSES.includes(order.status) &&
        Array.isArray(order.items) &&
        order.items.length > 0 &&
        order.items.every(
          (item) =>
            item &&
            typeof item.name === "string" &&
            Number.isInteger(item.quantity) &&
            item.quantity > 0 &&
            Number.isFinite(item.total) &&
            Array.isArray(item.options) &&
            item.options.every(
              (option) => option && typeof option.label === "string",
            ) &&
            typeof item.note === "string",
        ) &&
        typeof order.note === "string"
      );
    })
    .slice(0, 8);
}
function ProductEditor({ product, item, onClose, onSave }) {
  const [selections, setSelections] = useState(
    item?.selections ?? defaultSelections(product),
  );
  const [quantity, setQuantity] = useState(item?.quantity ?? 1);
  const [note, setNote] = useState(item?.note ?? "");
  const priced = priceItem({
    productId: product.id,
    selections,
    quantity,
    note,
  });
  return (
    <Modal title={product.name} onClose={onClose} className="product-modal">
      <img
        className="product-modal-image"
        src={product.image}
        alt={product.name}
      />
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onSave({ ...priced, key: item?.key ?? crypto.randomUUID() });
        }}
      >
        <div className="product-modal-body">
          <span className="eyebrow">HECHO A TU GUSTO</span>
          <div className="product-title-row">
            <h2>{product.name}</h2>
            <strong>{formatMoney(product.price)}</strong>
          </div>
          <p className="muted">{product.description}</p>
          {product.options.map((group) => (
            <fieldset className="option-group" key={group.id}>
              <legend>{group.label}</legend>
              <div className="option-values">
                {group.values.map((option) => (
                  <label
                    className={`option-choice ${selections[group.id] === option.id ? "selected" : ""}`}
                    key={option.id}
                  >
                    <input
                      type="radio"
                      name={group.id}
                      value={option.id}
                      checked={selections[group.id] === option.id}
                      onChange={() =>
                        setSelections({ ...selections, [group.id]: option.id })
                      }
                    />
                    <span>{option.label}</span>
                    {option.price > 0 && (
                      <small>+{formatMoney(option.price)}</small>
                    )}
                  </label>
                ))}
              </div>
            </fieldset>
          ))}
          <label className="field">
            <span>
              Nota para este producto <small>(opcional)</small>
            </span>
            <textarea
              aria-label="Nota para este producto (opcional)"
              maxLength={200}
              rows={2}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Por ejemplo: sin sal, por favor"
            />
          </label>
          <p className="allergy-note">
            Si tienes alguna alergia, consulta con nuestro equipo antes de
            ordenar.
          </p>
        </div>
        <div className="product-modal-footer">
          <Quantity
            value={quantity}
            onChange={setQuantity}
            name={product.name}
          />
          <button className="btn btn-primary" type="submit">
            {item ? "Guardar cambios" : "Agregar al carrito"}
            <span>{formatMoney(priced.total)}</span>
          </button>
        </div>
      </form>
    </Modal>
  );
}
function TrackingCard({ entry, error, onRefresh }) {
  const order = entry.order;
  const step = STATUSES.indexOf(order.status);
  const messages = [
    "Recibimos tu pedido. La sucursal lo confirmará pronto.",
    "Tu pedido está confirmado. Enseguida nos ponemos manos a la obra.",
    "Estamos preparando algo rico para ti.",
    "¡Tu pedido está listo! Te esperamos en la sucursal.",
    "Gracias por compartir un momento Cream. ¡Hasta pronto!",
  ];
  return (
    <article
      className={`tracking-card ${step === 4 ? "tracking-delivered" : ""}`}
    >
      <div className="tracking-heading">
        <div>
          <span className="eyebrow">TU MOMENTO CREAM</span>
          <h2>Pedido #{order.id}</h2>
        </div>
        <span
          className={`status-pill status-${step}`}
          aria-label={`Estado del pedido #${order.id}`}
        >
          {order.status}
        </span>
      </div>
      <p className="tracking-message" aria-live="polite">
        {messages[step]}
      </p>
      <ol
        className="tracking-steps"
        aria-label={`Estado del pedido ${order.id}`}
      >
        {STATUSES.map((status, index) => (
          <li
            key={status}
            className={index <= step ? "complete" : ""}
            aria-current={index === step ? "step" : undefined}
          >
            <span>
              {index < step ? <Icon name="check" size={15} /> : index + 1}
            </span>
            <small>{status}</small>
          </li>
        ))}
      </ol>
      <div className="pickup-location">
        <Icon name="location" />
        <div>
          <strong>Recoge en {order.branch}</strong>
          <span>
            A nombre de {order.customer} · {formatTime(order.createdAt)}
          </span>
        </div>
      </div>
      <details className="tracking-details">
        <summary>
          Detalle del pedido <strong>{formatMoney(order.total)} MXN</strong>
        </summary>
        <ul>
          {order.items.map((item, index) => (
            <li key={index}>
              <div>
                <strong>
                  {item.quantity} × {item.name}
                </strong>
                {item.options?.length > 0 && (
                  <span>
                    {item.options.map((option) => option.label).join(" · ")}
                  </span>
                )}
                {item.note && <span>Nota: {item.note}</span>}
              </div>
              <b>{formatMoney(item.total)}</b>
            </li>
          ))}
        </ul>
        {order.note && <p className="muted">Nota del pedido: {order.note}</p>}
        <p className="muted">Pago al recoger en sucursal.</p>
      </details>
      {error ? (
        <div className="inline-error" role="alert">
          {error}
          <button className="text-button" onClick={onRefresh}>
            Actualizar estado
          </button>
        </div>
      ) : (
        <span className="tracking-sync">
          <span className="live-dot" />{" "}
          {step === 4
            ? "Pedido completado"
            : "El estado se actualiza automáticamente"}
        </span>
      )}
    </article>
  );
}
export default function Club() {
  const profile = useRef(storage.get(PROFILE_KEY, {})).current;
  const [cart, setCart] = useState(loadCart);
  const [branch, setBranch] = useState(
    BRANCHES.includes(profile?.branch) ? profile.branch : BRANCHES[0],
  );
  const [customer, setCustomer] = useState(
    typeof profile?.customer === "string" ? profile.customer : "",
  );
  const [phone, setPhone] = useState(
    typeof profile?.phone === "string" ? profile.phone : "",
  );
  const [orderNote, setOrderNote] = useState(() => {
    const note = storage.get(NOTE_KEY, "");
    return typeof note === "string" ? note.slice(0, 300) : "";
  });
  const [category, setCategory] = useState("Todo");
  const [search, setSearch] = useState("");
  const [view, setView] = useState("menu");
  const [editor, setEditor] = useState(null);
  const [cartOpen, setCartOpen] = useState(false);
  const [orders, setOrders] = useState(loadOrders);
  const [trackingErrors, setTrackingErrors] = useState({});
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [sending, setSending] = useState(false);
  const [success, setSuccess] = useState(false);
  const [receiptWarning, setReceiptWarning] = useState("");
  const pendingRef = useRef(storage.get(PENDING_KEY, null));
  const sendLock = useRef(false);
  const pollLock = useRef(false);
  const ordersRef = useRef(orders);
  ordersRef.current = orders;
  const total = cart.reduce((sum, item) => sum + item.total, 0);
  const count = cart.reduce((sum, item) => sum + item.quantity, 0);
  const filtered = PRODUCTS.filter(
    (product) =>
      (category === "Todo" || category === product.category) &&
      `${product.name} ${product.description}`
        .toLocaleLowerCase("es")
        .includes(search.toLocaleLowerCase("es").trim()),
  );
  const orderIds = orders.map((entry) => entry.id).join(",");
  useEffect(() => {
    storage.set(CART_KEY, cart);
  }, [cart]);
  useEffect(() => {
    storage.set(PROFILE_KEY, { branch, customer, phone });
  }, [branch, customer, phone]);
  useEffect(() => {
    storage.set(ORDERS_KEY, orders);
  }, [orders]);
  useEffect(() => {
    storage.set(NOTE_KEY, orderNote);
  }, [orderNote]);
  useEffect(() => {
    if (!toast) return;
    const timeout = setTimeout(() => setToast(""), 2500);
    return () => clearTimeout(timeout);
  }, [toast]);
  async function refreshOrders(singleId, isLive = () => true) {
    if (pollLock.current) return;
    pollLock.current = true;
    try {
      await Promise.all(
        ordersRef.current
          .filter((entry) =>
            singleId
              ? entry.id === singleId
              : entry.order.status !== "Entregado",
          )
          .map(async (entry) => {
            try {
              const order = await api.getOrder(entry.id, entry.token);
              if (isLive()) {
                setOrders((current) =>
                  current.map((item) =>
                    item.id === entry.id ? { ...item, order } : item,
                  ),
                );
                setTrackingErrors((current) => ({
                  ...current,
                  [entry.id]: "",
                }));
              }
            } catch (failure) {
              if (isLive())
                setTrackingErrors((current) => ({
                  ...current,
                  [entry.id]: failure.message,
                }));
            }
          }),
      );
    } finally {
      pollLock.current = false;
    }
  }
  useEffect(() => {
    let live = true;
    const refresh = () => {
      if (document.visibilityState === "visible")
        refreshOrders(undefined, () => live);
    };
    refresh();
    const interval = setInterval(refresh, 5000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      live = false;
      clearInterval(interval);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [orderIds]);
  function updateQuantity(key, quantity) {
    setCart((current) =>
      current.map((item) =>
        item.key === key
          ? { ...item, quantity, total: item.unitPrice * quantity }
          : item,
      ),
    );
    setError("");
  }
  function saveItem(item) {
    const next = editor?.item
      ? cart.map((current) => (current.key === item.key ? item : current))
      : [...cart, item];
    if (
      next.length > 30 ||
      next.reduce((sum, line) => sum + line.quantity, 0) > 50
    ) {
      setToast("Tu carrito admite hasta 50 unidades y 30 productos.");
      return;
    }
    setCart(next);
    setEditor(null);
    setError("");
    if (editor?.item) setCartOpen(true);
    else setToast(`${item.name} agregado a tu carrito`);
  }
  async function sendOrder(event) {
    event.preventDefault();
    if (sendLock.current || !cart.length) return;
    setError("");
    const payload = {
      customer,
      phone,
      branch,
      items: cart.map(({ productId, quantity, selections, note }) => ({
        productId,
        quantity,
        selections,
        note,
      })),
      note: orderNote,
    };
    const fingerprint = JSON.stringify(payload);
    const pending = pendingRef.current ?? storage.get(PENDING_KEY, null);
    payload.requestId =
      pending?.fingerprint === fingerprint &&
      typeof pending.requestId === "string"
        ? pending.requestId
        : crypto.randomUUID();
    try {
      normalizeOrderInput(payload);
    } catch (failure) {
      setError(failure.message);
      return;
    }
    sendLock.current = true;
    setSending(true);
    pendingRef.current = { fingerprint, requestId: payload.requestId };
    storage.set(PENDING_KEY, pendingRef.current);
    try {
      const result = await api.createOrder(payload);
      if (
        !Number.isSafeInteger(result?.id) ||
        typeof result.trackingToken !== "string" ||
        !STATUSES.includes(result.status)
      )
        throw new Error(
          "No pudimos verificar el envío. Intenta de nuevo para confirmar tu pedido.",
        );
      const { trackingToken, ...order } = result;
      const entry = { id: order.id, token: trackingToken, order };
      // Guardar el seguimiento antes de vaciar el carrito para tolerar recargas.
      const nextOrders = [
        entry,
        ...ordersRef.current.filter((item) => item.id !== order.id),
      ].slice(0, 8);
      const saved = storage.set(ORDERS_KEY, nextOrders);
      setOrders(nextOrders);
      setReceiptWarning(
        saved
          ? ""
          : `Tu pedido #${order.id} fue enviado. Este navegador no permite guardar el seguimiento: conserva esta página abierta y anota el número para recogerlo.`,
      );
      if (saved) storage.remove(PENDING_KEY);
      pendingRef.current = null;
      setCart([]);
      setOrderNote("");
      setCartOpen(false);
      setView("orders");
      setSuccess(true);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (failure) {
      setError(failure.message);
    } finally {
      sendLock.current = false;
      setSending(false);
    }
  }
  const activeOrder = orders.find(
    (entry) => entry.order.status !== "Entregado",
  );
  return (
    <div className="club-app">
      <header className="club-header">
        <div className="club-header-inner">
          <Brand />
          <nav className="club-nav" aria-label="Navegación Cream Club">
            <button
              className={view === "menu" ? "active" : ""}
              onClick={() => setView("menu")}
            >
              Menú
            </button>
            <button
              className={view === "orders" ? "active" : ""}
              onClick={() => {
                setView("orders");
                setSuccess(false);
              }}
            >
              Mis pedidos{activeOrder && <span className="nav-dot" />}
            </button>
          </nav>
          <button
            className="cart-trigger"
            onClick={() => setCartOpen(true)}
            aria-label="Ver carrito"
          >
            <Icon name="bag" />
            <span>Tu carrito</span>
            <b>{count}</b>
          </button>
        </div>
      </header>
      <main className="club-main">
        {view === "menu" ? (
          <>
            <section className="club-hero">
              <div className="hero-copy">
                <span className="eyebrow">
                  <span className="sun-symbol">✳</span> GOOD FOOD. GOOD PEOPLE.
                </span>
                <h1>
                  Los pequeños
                  <br />
                  momentos saben
                  <br />
                  <i>mejor aquí.</i>
                </h1>
                <p>
                  Tu café favorito, algo recién horneado
                  <br className="desktop-break" /> y un día que empieza bonito.
                </p>
                <a className="btn btn-primary hero-cta" href="#menu">
                  Encuentra tu favorito
                  <Icon name="arrow" size={18} />
                </a>
                <div className="hero-footnote">
                  <span className="live-dot" /> Preparado al momento · Hecho con
                  cariño
                </div>
              </div>
              <div className="hero-visual">
                <img
                  src="/images/cafe.jpg"
                  alt="Un espacio de café cálido y acogedor"
                  fetchPriority="high"
                />
                <span className="hero-stamp">
                  a little
                  <br />
                  <i>cream</i>
                  <br />a lot of joy
                </span>
                <div className="hero-caption">
                  <span>TU PAUSA FAVORITA</span>
                  <strong>Made for brighter days.</strong>
                </div>
              </div>
            </section>
            <section className="branch-strip" aria-label="Seleccionar sucursal">
              <div>
                <Icon name="location" />
                <div>
                  <span className="eyebrow">NOS VEMOS EN</span>
                  <label htmlFor="branch-menu">Sucursal de recolección</label>
                </div>
              </div>
              <div className="branch-select">
                <select
                  id="branch-menu"
                  value={branch}
                  onChange={(event) => setBranch(event.target.value)}
                >
                  {BRANCHES.map((value) => (
                    <option key={value}>{value}</option>
                  ))}
                </select>
                <Icon name="chevron" size={16} />
              </div>
              <span className="pickup-note">
                <Icon name="bag" size={16} /> Pide aquí. Recoge en sucursal.
              </span>
            </section>
            {activeOrder && (
              <button
                className="active-order-link"
                onClick={() => setView("orders")}
              >
                <Icon name="clock" />
                <span>
                  Pedido #{activeOrder.id} · {activeOrder.order.status}
                </span>
                <strong>Ver mi pedido</strong>
                <Icon name="arrow" size={16} />
              </button>
            )}
            <section id="menu" className="menu-section">
              <div className="section-heading">
                <div>
                  <span className="eyebrow">ALGO RICO TE ESPERA</span>
                  <h2>¿Qué se te antoja?</h2>
                </div>
                <span className="menu-subtitle">
                  Un favorito para cada momento.
                </span>
              </div>
              <div className="menu-tools">
                <div
                  className="category-tabs"
                  role="group"
                  aria-label="Categorías del menú"
                >
                  {CATEGORIES.map((value) => (
                    <button
                      aria-pressed={category === value}
                      className={category === value ? "active" : ""}
                      onClick={() => setCategory(value)}
                      key={value}
                    >
                      {value}
                    </button>
                  ))}
                </div>
                <label className="menu-search">
                  <Icon name="search" size={18} />
                  <input
                    type="search"
                    aria-label="Buscar en el menú"
                    placeholder="Busca tu favorito"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                  />
                </label>
              </div>
              {filtered.length ? (
                <div className="product-grid">
                  {filtered.map((product) => (
                    <article className="product-card" key={product.id}>
                      <button
                        className="product-image-button"
                        tabIndex={-1}
                        aria-hidden="true"
                        onClick={() => setEditor({ product })}
                      >
                        <img src={product.image} alt="" loading="lazy" />
                        <span className="product-category">
                          {product.category}
                        </span>
                      </button>
                      <div className="product-card-body">
                        <div className="product-card-heading">
                          <h3>{product.name}</h3>
                          <strong>{formatMoney(product.price)}</strong>
                        </div>
                        <p>{product.description}</p>
                        <button
                          className="product-add"
                          aria-label={`Personalizar ${product.name}`}
                          onClick={() => setEditor({ product })}
                        >
                          <span>Personalizar</span>
                          <span className="product-plus">
                            <Icon name="plus" size={18} />
                          </span>
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="club-empty">
                  <Icon name="search" size={32} />
                  <h3>No encontramos ese antojo</h3>
                  <p>Prueba otro nombre o explora todo el menú.</p>
                  <button
                    className="btn btn-secondary"
                    onClick={() => {
                      setSearch("");
                      setCategory("Todo");
                    }}
                  >
                    Ver todo el menú
                  </button>
                </div>
              )}
            </section>
            <section className="club-promise">
              <Icon name="leaf" size={28} />
              <div>
                <h3>La buena vida, un bocado a la vez.</h3>
                <p>Hecho al momento en Palmilla y Ánima Village.</p>
              </div>
              <span className="promise-word">see you at cream.</span>
            </section>
          </>
        ) : (
          <section className="orders-page">
            <span className="eyebrow">CONTIGO, HASTA EL ÚLTIMO BOCADO</span>
            <h1>Mis pedidos</h1>
            <p className="muted">
              Sigue tu pedido y pasa por él cuando esté listo.
            </p>
            {success && (
              <div className="success-banner" role="status">
                <Icon name="check" />
                ¡Pedido enviado! La sucursal ya puede recibirlo.
              </div>
            )}
            {receiptWarning && (
              <div className="inline-error" role="status">
                {receiptWarning}
              </div>
            )}
            {orders.length ? (
              <div className="tracking-list">
                {orders.map((entry) => (
                  <TrackingCard
                    key={entry.id}
                    entry={entry}
                    error={trackingErrors[entry.id]}
                    onRefresh={() => refreshOrders(entry.id)}
                  />
                ))}
              </div>
            ) : (
              <div className="club-empty">
                <Icon name="bag" size={40} />
                <h2>Tu próximo favorito te espera</h2>
                <p>Cuando hagas un pedido, podrás seguirlo aquí.</p>
                <button
                  className="btn btn-primary"
                  onClick={() => setView("menu")}
                >
                  Explorar el menú
                  <Icon name="arrow" />
                </button>
              </div>
            )}
            <p className="tracking-device-note">
              Tus pedidos se guardan en este navegador para que puedas volver a
              consultarlos.
            </p>
          </section>
        )}
      </main>
      <footer className="club-footer">
        <Brand />
        <p>Good food. Good people. Brighter days.</p>
        <a href="/hub">
          Acceso al equipo
          <Icon name="arrow" size={14} />
        </a>
        <span>PALMILLA · ÁNIMA VILLAGE</span>
      </footer>
      {count > 0 && !cartOpen && !editor && (
        <button className="mobile-cart-bar" onClick={() => setCartOpen(true)}>
          <span>
            <Icon name="bag" />
            {count} {count === 1 ? "producto" : "productos"}
          </span>
          <strong>Ver carrito · {formatMoney(total)}</strong>
          <Icon name="arrow" />
        </button>
      )}
      {toast && (
        <div className="toast" role="status">
          <Icon name="check" />
          {toast}
        </div>
      )}
      {editor && (
        <ProductEditor
          product={editor.product}
          item={editor.item}
          onClose={() => {
            const editing = Boolean(editor.item);
            setEditor(null);
            if (editing) setCartOpen(true);
          }}
          onSave={saveItem}
        />
      )}
      {cartOpen && (
        <Modal
          title="Tu carrito"
          onClose={() => {
            if (!sending) setCartOpen(false);
          }}
          className="cart-modal"
        >
          <div className="cart-modal-heading">
            <span className="eyebrow">UN MOMENTO PARA TI</span>
            <h2>
              Tu carrito <span>({count})</span>
            </h2>
            <p className="muted">Todo listo para preparar tus favoritos.</p>
          </div>
          {cart.length ? (
            <form onSubmit={sendOrder}>
              <div className="cart-lines">
                {cart.map((item) => (
                  <article className="cart-line" key={item.key}>
                    <img src={findProduct(item.productId).image} alt="" />
                    <div className="cart-line-content">
                      <div className="cart-line-heading">
                        <h3>{item.name}</h3>
                        <strong>{formatMoney(item.total)}</strong>
                      </div>
                      <p>
                        {item.options
                          .map((option) =>
                            option.label.split(": ").slice(1).join(": "),
                          )
                          .join(" · ")}
                      </p>
                      {item.note && (
                        <p className="cart-item-note">{item.note}</p>
                      )}
                      <div className="cart-line-actions">
                        <Quantity
                          value={item.quantity}
                          name={item.name}
                          onChange={(quantity) => {
                            if (!sending) updateQuantity(item.key, quantity);
                          }}
                        />
                        <button
                          type="button"
                          className="text-button"
                          disabled={sending}
                          aria-label={`Editar ${item.name}`}
                          onClick={() => {
                            setCartOpen(false);
                            setEditor({
                              product: findProduct(item.productId),
                              item,
                            });
                          }}
                        >
                          Editar
                        </button>
                        <button
                          type="button"
                          className="text-button remove-button"
                          disabled={sending}
                          aria-label={`Eliminar ${item.name}`}
                          onClick={() => {
                            setCart((current) =>
                              current.filter((line) => line.key !== item.key),
                            );
                            setError("");
                          }}
                        >
                          Eliminar
                        </button>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
              <div className="checkout-fields">
                <h3>¿Para quién preparamos?</h3>
                <label className="field">
                  <span>Nombre</span>
                  <input
                    autoComplete="given-name"
                    name="customer"
                    required
                    minLength={2}
                    maxLength={80}
                    placeholder="Tu nombre"
                    value={customer}
                    disabled={sending}
                    onChange={(event) => setCustomer(event.target.value)}
                  />
                </label>
                <label className="field">
                  <span>
                    Teléfono <small>(opcional)</small>
                  </span>
                  <input
                    type="tel"
                    autoComplete="tel"
                    maxLength={30}
                    placeholder="10 dígitos"
                    value={phone}
                    disabled={sending}
                    onChange={(event) => setPhone(event.target.value)}
                  />
                </label>
                <label className="field">
                  <span>Sucursal de recolección</span>
                  <select
                    aria-label="Sucursal de recolección"
                    value={branch}
                    disabled={sending}
                    onChange={(event) => setBranch(event.target.value)}
                  >
                    {BRANCHES.map((value) => (
                      <option key={value}>{value}</option>
                    ))}
                  </select>
                </label>
                <div className="checkout-branch-note">
                  <Icon name="location" size={17} /> Recogerás tu pedido en{" "}
                  <strong>{branch}</strong>.
                </div>
                <label className="field">
                  <span>
                    Nota del pedido <small>(opcional)</small>
                  </span>
                  <textarea
                    aria-label="Nota del pedido (opcional)"
                    maxLength={300}
                    rows={2}
                    placeholder="¿Algo que debamos saber?"
                    value={orderNote}
                    disabled={sending}
                    onChange={(event) => setOrderNote(event.target.value)}
                  />
                </label>
              </div>
              <div className="checkout-footer">
                <div className="cart-total">
                  <span>
                    Total <small>MXN</small>
                  </span>
                  <strong>{formatMoney(total)}</strong>
                </div>
                <p>
                  <Icon name="bag" size={16} /> Pago al recoger · Recolección en
                  sucursal
                </p>
                {error && (
                  <div className="inline-error" role="alert">
                    {error}
                  </div>
                )}
                <button
                  className="btn btn-primary checkout-submit"
                  disabled={sending}
                  type="submit"
                >
                  {sending ? "Enviando pedido…" : "Enviar pedido"}
                  <Icon name={sending ? "clock" : "arrow"} />
                </button>
                <small className="checkout-confirmation">
                  La sucursal confirmará tu pedido y podrás seguir su estado.
                </small>
              </div>
            </form>
          ) : (
            <div className="club-empty">
              <Icon name="bag" size={40} />
              <h3>Aquí van tus favoritos</h3>
              <p>Explora el menú y encuentra algo para ti.</p>
              <button
                className="btn btn-primary"
                onClick={() => {
                  setCartOpen(false);
                  setView("menu");
                }}
              >
                Explorar el menú
              </button>
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}
