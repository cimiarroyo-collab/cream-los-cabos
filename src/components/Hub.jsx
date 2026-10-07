import React, { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api.js";
import {
  BRANCHES,
  STATUSES,
  STATIONS,
  formatMoney,
  formatTime,
} from "../../shared/catalog.js";
import { Brand, Icon } from "./UI.jsx";
import "./Hub.css";

const statusActions = {
  Nuevo: "Confirmar pedido",
  Confirmado: "Iniciar preparación",
  "En preparación": "Marcar listo",
  Listo: "Marcar entregado",
};
const statusDescriptions = {
  Nuevo: "Recién llegados",
  Confirmado: "Aceptados por el equipo",
  "En preparación": "Manos a la obra",
  Listo: "Esperando al cliente",
  Entregado: "Un buen momento servido",
};
const statusKeys = {
  Nuevo: "new",
  Confirmado: "confirmed",
  "En preparación": "preparing",
  Listo: "ready",
  Entregado: "delivered",
};
const stationIcons = {
  Barra: "coffee",
  Cocina: "utensils",
  Panadería: "bread",
};
const branchName = (branch) =>
  typeof branch === "string" ? branch : branch.name;
const timestamp = (value) =>
  typeof value === "number" ? value : new Date(value).getTime();
const normalized = (value) =>
  String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
const dayFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Mazatlan",
});
const localDay = (value) => dayFormatter.format(timestamp(value));
const hasPendingPricing = (order) =>
  order.pricingPending === true || order.total == null;

function orderAge(createdAt, now) {
  const minutes = Math.max(0, Math.floor((now - timestamp(createdAt)) / 60000));
  if (minutes < 1) return "Ahora";
  if (minutes < 60) return `Hace ${minutes} min`;
  if (minutes < 1440) return `Hace ${Math.floor(minutes / 60)} h`;
  return `Hace ${Math.floor(minutes / 1440)} d`;
}

function OrderCard({ order, station, pending, onAdvance, now }) {
  const items = order.items.filter(
    (item) => station === "Todas" || item.station === station,
  );
  const stations = STATIONS.filter((name) =>
    items.some((item) => item.station === name),
  );
  const otherStations =
    station === "Todas"
      ? []
      : STATIONS.filter(
          (name) =>
            name !== station &&
            order.items.some((item) => item.station === name),
        );
  const action = statusActions[order.status];
  const pricingPending = hasPendingPricing(order);

  return (
    <article
      className={`hub-order hub-order-${statusKeys[order.status]}`}
      aria-label={`Pedido #${order.id}`}
    >
      <div className="hub-order-heading">
        <strong className="hub-order-number">#{order.id}</strong>
        <span className="hub-order-age">
          <Icon name="clock" size={13} />
          {orderAge(order.createdAt, now)}
        </span>
      </div>
      <h3>{order.customer}</h3>
      <div className="hub-order-meta">
        <Icon name="location" size={13} />
        <span>{order.branch}</span>
        <span aria-hidden="true">·</span>
        <time dateTime={new Date(timestamp(order.createdAt)).toISOString()}>
          {formatTime(order.createdAt)}
        </time>
      </div>
      {stations.map((name) => (
        <section className="hub-order-station" key={name} aria-label={name}>
          <div className="hub-order-station-title">
            <Icon name={stationIcons[name]} size={14} />
            <span>{name}</span>
          </div>
          <ul className="hub-order-items">
            {items
              .filter((item) => item.station === name)
              .map((item, index) => (
                <li key={`${item.productId}-${index}`}>
                  <span className="hub-order-quantity">{item.quantity}×</span>
                  <div>
                    <strong>{item.name}</strong>
                    {item.options?.length > 0 && (
                      <p>
                        {item.options.map((option) => option.label).join(" · ")}
                      </p>
                    )}
                    {item.note && (
                      <p className="hub-item-note">“{item.note}”</p>
                    )}
                    {(item.pricePending || item.unitPrice === null) && (
                      <p className="hub-item-price-pending">
                        Precio por confirmar
                      </p>
                    )}
                  </div>
                </li>
              ))}
          </ul>
        </section>
      ))}
      {otherStations.length > 0 && (
        <p className="hub-other-stations">
          También incluye {otherStations.join(" y ")}.
        </p>
      )}
      {order.note && (
        <div className="hub-order-note">
          <strong>Nota del cliente</strong>
          <p>{order.note}</p>
        </div>
      )}
      <div className="hub-order-total">
        <span>Total del pedido</span>
        <strong>
          {pricingPending ? "Por confirmar" : formatMoney(order.total)}
        </strong>
      </div>
      {pricingPending && (
        <div className="hub-order-pricing-note">
          <p>Precio pendiente de confirmar en sucursal.</p>
          {Number.isFinite(order.knownTotal) && order.knownTotal > 0 && (
            <small>Subtotal con precio: {formatMoney(order.knownTotal)}</small>
          )}
        </div>
      )}
      {action ? (
        <div className="hub-order-action">
          <button
            className="hub-advance-button"
            type="button"
            disabled={pending}
            onClick={() => onAdvance(order)}
          >
            {pending ? "Actualizando…" : action}
            {!pending && (
              <Icon
                name={order.status === "Listo" ? "check" : "arrow"}
                size={16}
              />
            )}
          </button>
          {station !== "Todas" && (
            <small>El estado se aplica al pedido completo.</small>
          )}
        </div>
      ) : (
        <div className="hub-delivered-label">
          <Icon name="check" size={15} />
          Entregado · {formatTime(order.updatedAt || order.createdAt)}
        </div>
      )}
    </article>
  );
}

export default function Hub() {
  const [session, setSession] = useState({
    loading: true,
    authenticated: false,
    configured: true,
  });
  const [accessCode, setAccessCode] = useState("");
  const [loggingIn, setLoggingIn] = useState(false);
  const [loginError, setLoginError] = useState("");
  const [orders, setOrders] = useState([]);
  const [branch, setBranch] = useState("Todas");
  const [station, setStation] = useState("Todas");
  const [search, setSearch] = useState("");
  const [view, setView] = useState("all");
  const [refreshing, setRefreshing] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [lastUpdated, setLastUpdated] = useState(null);
  const [pendingIds, setPendingIds] = useState(new Set());
  const requestVersion = useRef(0);
  const refreshesInFlight = useRef(new Map());
  const refreshRef = useRef(null);
  const pendingRef = useRef(new Set());
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    let live = true;
    api
      .getSession()
      .then((result) => {
        if (live) setSession({ ...result, loading: false });
      })
      .catch((failure) => {
        if (live) {
          setSession({
            loading: false,
            authenticated: false,
            configured: true,
          });
          setLoginError(
            failure.message ||
              "No pudimos comprobar el acceso. Intenta de nuevo.",
          );
        }
      });
    return () => {
      live = false;
      alive.current = false;
      requestVersion.current += 1;
    };
  }, []);

  const refreshOrders = useCallback(
    async (force = false) => {
      if (!session.authenticated) return;
      if (!force && refreshesInFlight.current.has(branch)) return;
      const version = ++requestVersion.current;
      refreshesInFlight.current.set(
        branch,
        (refreshesInFlight.current.get(branch) || 0) + 1,
      );
      setRefreshing(true);
      try {
        const result = await api.getOrders(
          branch === "Todas" ? undefined : branch,
        );
        if (!alive.current || version !== requestVersion.current) return;
        setOrders(result);
        setLoaded(true);
        setLastUpdated(Date.now());
        setError("");
      } catch (failure) {
        if (!alive.current || version !== requestVersion.current) return;
        if (failure.status === 401) {
          setSession((previous) => ({ ...previous, authenticated: false }));
          setOrders([]);
          setLoginError("Tu sesión venció. Ingresa de nuevo para continuar.");
        } else {
          setError(
            failure.message ||
              "No pudimos actualizar los pedidos. Revisa tu conexión e intenta de nuevo.",
          );
        }
      } finally {
        const remaining = (refreshesInFlight.current.get(branch) || 1) - 1;
        if (remaining) refreshesInFlight.current.set(branch, remaining);
        else refreshesInFlight.current.delete(branch);
        if (alive.current && version === requestVersion.current)
          setRefreshing(false);
      }
    },
    [branch, session.authenticated],
  );
  refreshRef.current = refreshOrders;

  useEffect(() => {
    if (!session.authenticated) return undefined;
    refreshOrders();
    const onVisible = () => {
      if (document.visibilityState === "visible") refreshOrders();
    };
    const timer = window.setInterval(onVisible, 5000);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      requestVersion.current += 1;
    };
  }, [refreshOrders, session.authenticated]);

  async function login(event) {
    event.preventDefault();
    if (loggingIn || !accessCode.trim()) return;
    setLoggingIn(true);
    setLoginError("");
    try {
      const result = await api.login(accessCode);
      if (!alive.current) return;
      if (!result.authenticated)
        throw new Error("El código de acceso no es válido.");
      setSession({ loading: false, configured: true, authenticated: true });
      setAccessCode("");
      setLoaded(false);
    } catch (failure) {
      if (alive.current)
        setLoginError(
          failure.message || "No pudimos iniciar sesión. Intenta de nuevo.",
        );
    } finally {
      if (alive.current) setLoggingIn(false);
    }
  }

  async function logout() {
    setNotice("");
    try {
      await api.logout();
      if (!alive.current) return;
      requestVersion.current += 1;
      setSession((previous) => ({ ...previous, authenticated: false }));
      setOrders([]);
      setLoaded(false);
      setLastUpdated(null);
      setError("");
      setLoginError("");
    } catch (failure) {
      if (alive.current)
        setError(
          failure.message || "No pudimos cerrar la sesión. Intenta de nuevo.",
        );
    }
  }

  async function advance(order) {
    if (pendingRef.current.has(order.id)) return;
    const next = STATUSES[STATUSES.indexOf(order.status) + 1];
    if (!next) return;
    pendingRef.current.add(order.id);
    setPendingIds(new Set(pendingRef.current));
    setNotice("");
    requestVersion.current += 1;
    try {
      const result = await api.updateOrder(order.id, next, order.status);
      if (!alive.current) return;
      setOrders((previous) =>
        previous.map((current) =>
          current.id === result.id ? result : current,
        ),
      );
      setNotice(`Pedido #${order.id}: ${next.toLowerCase()}.`);
      await refreshRef.current(true);
    } catch (failure) {
      if (!alive.current) return;
      if (failure.status === 409) {
        setNotice(
          "Este pedido cambió en otro dispositivo. Actualizamos el tablero; revísalo antes de continuar.",
        );
        await refreshRef.current(true);
      } else if (failure.status === 401) {
        setSession((previous) => ({ ...previous, authenticated: false }));
        setOrders([]);
        setLoginError("Tu sesión venció. Ingresa de nuevo para continuar.");
      } else
        setError(
          failure.message ||
            "No pudimos cambiar el estado. El pedido conserva su estado anterior.",
        );
    } finally {
      pendingRef.current.delete(order.id);
      if (alive.current) {
        setPendingIds(new Set(pendingRef.current));
        setRefreshing(false);
      }
    }
  }

  async function checkConfiguration() {
    setLoginError("");
    setSession((previous) => ({ ...previous, loading: true }));
    try {
      const result = await api.getSession();
      if (alive.current) setSession({ ...result, loading: false });
    } catch (failure) {
      if (alive.current) {
        setSession((previous) => ({ ...previous, loading: false }));
        setLoginError(
          failure.message ||
            "No pudimos comprobar el acceso. Intenta de nuevo.",
        );
      }
    }
  }

  if (!session.authenticated) {
    return (
      <main className="hub-login">
        <div className="hub-login-scene">
          <Brand hub />
          <div>
            <span className="hub-eyebrow">
              EL EQUIPO DETRÁS DE CADA BUEN DÍA
            </span>
            <h1>
              Hecho con calma.
              <br />
              Servido con cariño.
            </h1>
            <p>
              Dos sucursales, un mismo cuidado.
              <br />
              Bienvenido a la operación de Cream Los Cabos.
            </p>
          </div>
          <span className="hub-login-locations">
            PALMILLA <span aria-hidden="true">·</span> ÁNIMA VILLAGE
          </span>
        </div>
        <section className="hub-login-panel">
          <a className="hub-back-to-club" href="/club">
            <Icon name="arrow" size={17} />
            Cream Club
          </a>
          <div className="hub-login-form-wrap">
            <span className="hub-eyebrow">ACCESO AL EQUIPO</span>
            <h2>Bienvenido a Cream Hub</h2>
            <p>
              Todo listo para un gran servicio. Ingresa con el código de acceso
              de tu equipo.
            </p>
            {session.loading ? (
              <div className="hub-login-loading" role="status">
                <span className="hub-spinner" />
                Comprobando acceso…
              </div>
            ) : !session.configured ? (
              <div className="hub-configuration-message" role="status">
                <Icon name="clock" size={22} />
                <h3>El acceso aún no está habilitado</h3>
                <p>
                  Pide al administrador de Cream que configure el acceso de
                  operación y vuelve a intentarlo.
                </p>
                <button
                  className="hub-outline-button"
                  type="button"
                  onClick={checkConfiguration}
                >
                  Revisar acceso
                </button>
              </div>
            ) : (
              <form onSubmit={login}>
                <label htmlFor="hub-access-code">Código de acceso</label>
                <input
                  id="hub-access-code"
                  name="access-code"
                  type="password"
                  autoComplete="current-password"
                  value={accessCode}
                  onChange={(event) => setAccessCode(event.target.value)}
                  placeholder="Ingresa tu código"
                  required
                  disabled={loggingIn}
                  aria-describedby={loginError ? "hub-login-error" : undefined}
                />
                <button
                  className="hub-login-button"
                  type="submit"
                  disabled={loggingIn || !accessCode.trim()}
                >
                  {loggingIn ? "Ingresando…" : "Entrar a Cream Hub"}
                  {!loggingIn && <Icon name="arrow" size={18} />}
                </button>
              </form>
            )}
            {loginError && (
              <p className="hub-login-error" id="hub-login-error" role="alert">
                {loginError}
              </p>
            )}
            <span className="hub-login-footnote">
              Acceso exclusivo para el equipo de Cream.
            </span>
          </div>
          <span className="hub-login-bottom">
            GOOD FOOD. GOOD PEOPLE. BRIGHTER DAYS.
          </span>
        </section>
      </main>
    );
  }

  const branchOrders = orders.filter(
    (order) => branch === "Todas" || order.branch === branch,
  );
  const today = localDay(Date.now());
  const todaysOrders = branchOrders.filter(
    (order) => localDay(order.createdAt) === today,
  );
  const activeCount = branchOrders.filter(
    (order) => order.status !== "Entregado",
  ).length;
  const readyCount = branchOrders.filter(
    (order) => order.status === "Listo",
  ).length;
  const deliveredCount = branchOrders.filter(
    (order) =>
      order.status === "Entregado" &&
      localDay(order.updatedAt || order.createdAt) === today,
  ).length;
  const pricedTodaysOrders = todaysOrders.filter(
    (order) => !hasPendingPricing(order) && Number.isFinite(order.total),
  );
  const pendingPricingCount = todaysOrders.length - pricedTodaysOrders.length;
  const sales = pricedTodaysOrders.reduce((sum, order) => sum + order.total, 0);
  const query = normalized(search.trim()).replace(/^#/, "");
  const filteredOrders = branchOrders.filter((order) => {
    if (
      station !== "Todas" &&
      !order.items.some((item) => item.station === station)
    )
      return false;
    if (view === "active" && order.status === "Entregado") return false;
    if (view === "delivered" && order.status !== "Entregado") return false;
    return (
      !query ||
      normalized(order.customer).includes(query) ||
      String(order.id).includes(query)
    );
  });
  const visibleStatuses = STATUSES.filter((status) =>
    view === "delivered"
      ? status === "Entregado"
      : view === "active"
        ? status !== "Entregado"
        : true,
  );
  const now = lastUpdated || Date.now();

  return (
    <div className="hub-app">
      <aside className="hub-sidebar">
        <div className="hub-brand-link">
          <Brand hub />
        </div>
        <span className="hub-sidebar-caption">OPERACIÓN</span>
        <a
          className="hub-sidebar-link is-active"
          href="/hub"
          aria-current="page"
        >
          <Icon name="grid" size={20} />
          Pedidos<span>{activeCount}</span>
        </a>
        <div className="hub-sidebar-bottom">
          <span className="hub-sidebar-locations">
            <Icon name="location" size={18} />
            Palmilla &amp; Ánima Village
          </span>
          <a className="hub-sidebar-link" href="/club">
            <Icon name="coffee" size={19} />
            Ir a Cream Club
            <Icon name="arrow" size={16} />
          </a>
          <button className="hub-sidebar-link" type="button" onClick={logout}>
            <Icon name="logout" size={19} />
            Cerrar sesión
          </button>
        </div>
      </aside>
      <main className="hub-main">
        <header className="hub-topbar">
          <div className="hub-mobile-brand">
            <Brand hub />
          </div>
          <span className="hub-topbar-label">
            CREAM LOS CABOS <span aria-hidden="true">/</span> OPERACIÓN
          </span>
          <div className="hub-topbar-actions">
            <span
              className={`hub-connection ${error ? "is-offline" : ""}`}
              role="status"
            >
              <i />
              {error ? "Sin conexión" : loaded ? "En vivo" : "Conectando…"}
            </span>
            <button
              type="button"
              className={`hub-icon-button ${refreshing ? "is-refreshing" : ""}`}
              aria-label="Actualizar pedidos"
              title="Actualizar pedidos"
              onClick={() => refreshOrders()}
              disabled={refreshing}
            >
              <Icon name="refresh" size={18} />
            </button>
            <button
              type="button"
              className="hub-icon-button hub-mobile-logout"
              aria-label="Cerrar sesión"
              onClick={logout}
            >
              <Icon name="logout" size={18} />
            </button>
          </div>
        </header>
        <div className="hub-content">
          <div className="hub-page-heading">
            <div>
              <span className="hub-eyebrow">CADA DETALLE CUENTA</span>
              <h1>
                Pedidos en tiempo real<span>.</span>
              </h1>
              <p>Todo lo que llega, todo lo que está por servir.</p>
            </div>
            <label className="hub-branch-control">
              <Icon name="location" size={18} />
              <select
                aria-label="Sucursal de operación"
                value={branch}
                onChange={(event) => {
                  setBranch(event.target.value);
                  setNotice("");
                }}
              >
                <option value="Todas">Todas las sucursales</option>
                {BRANCHES.map((item) => (
                  <option key={branchName(item)} value={branchName(item)}>
                    {branchName(item)}
                  </option>
                ))}
              </select>
              <Icon name="chevron" size={16} />
            </label>
          </div>
          <section className="hub-metrics" aria-label="Resumen de operación">
            <div className="hub-metric">
              <span className="hub-metric-icon">
                <Icon name="bag" size={21} />
              </span>
              <div>
                <span>En curso</span>
                <strong>{loaded ? activeCount : "—"}</strong>
              </div>
            </div>
            <div className="hub-metric hub-metric-ready">
              <span className="hub-metric-icon">
                <Icon name="coffee" size={21} />
              </span>
              <div>
                <span>Listos para entregar</span>
                <strong>{loaded ? readyCount : "—"}</strong>
              </div>
            </div>
            <div className="hub-metric">
              <span className="hub-metric-icon">
                <Icon name="check" size={21} />
              </span>
              <div>
                <span>Entregados hoy</span>
                <strong>{loaded ? deliveredCount : "—"}</strong>
              </div>
            </div>
            <div className="hub-metric">
              <span className="hub-metric-icon">
                <Icon name="leaf" size={21} />
              </span>
              <div>
                <span>Total con precio · hoy</span>
                <strong className="hub-metric-money">
                  {loaded && (pricedTodaysOrders.length || !pendingPricingCount)
                    ? formatMoney(sales)
                    : "—"}
                </strong>
                {loaded && pendingPricingCount > 0 && (
                  <small className="hub-metric-pricing-note">
                    {pendingPricingCount}{" "}
                    {pendingPricingCount === 1 ? "pedido sin" : "pedidos sin"}{" "}
                    precio final
                  </small>
                )}
              </div>
            </div>
          </section>
          {error && (
            <div className="hub-alert" role="alert">
              <div>
                <strong>No pudimos actualizar el tablero.</strong>
                <p>
                  {error}
                  {loaded && " Conservamos los últimos pedidos recibidos."}
                </p>
              </div>
              <button
                type="button"
                onClick={() => refreshOrders()}
                disabled={refreshing}
              >
                Reintentar
                <Icon name="refresh" size={16} />
              </button>
            </div>
          )}
          {notice && (
            <div className="hub-notice" role="status">
              <Icon name="check" size={17} />
              <span>{notice}</span>
              <button
                type="button"
                aria-label="Cerrar aviso"
                onClick={() => setNotice("")}
              >
                <Icon name="close" size={16} />
              </button>
            </div>
          )}
          <section
            className="hub-orders-section"
            aria-label="Tablero de pedidos"
          >
            <div className="hub-board-toolbar">
              <div
                className="hub-station-tabs"
                role="group"
                aria-label="Filtrar por estación"
              >
                <button
                  type="button"
                  className={station === "Todas" ? "is-active" : ""}
                  aria-label="Todas las estaciones"
                  aria-pressed={station === "Todas"}
                  onClick={() => setStation("Todas")}
                >
                  <Icon name="grid" size={16} />
                  Todas
                </button>
                {STATIONS.map((name) => (
                  <button
                    key={name}
                    type="button"
                    className={station === name ? "is-active" : ""}
                    aria-pressed={station === name}
                    onClick={() => setStation(name)}
                  >
                    <Icon name={stationIcons[name]} size={17} />
                    {name}
                  </button>
                ))}
              </div>
              <label className="hub-search">
                <Icon name="search" size={18} />
                <input
                  type="search"
                  aria-label="Buscar cliente o número de pedido"
                  placeholder="Buscar cliente o #pedido"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </label>
            </div>
            <div className="hub-board-subtoolbar">
              <div
                className="hub-view-tabs"
                role="group"
                aria-label="Filtrar por estado"
              >
                <button
                  type="button"
                  className={view === "all" ? "is-active" : ""}
                  aria-pressed={view === "all"}
                  onClick={() => setView("all")}
                >
                  Todos
                </button>
                <button
                  type="button"
                  className={view === "active" ? "is-active" : ""}
                  aria-pressed={view === "active"}
                  onClick={() => setView("active")}
                >
                  En curso
                </button>
                <button
                  type="button"
                  className={view === "delivered" ? "is-active" : ""}
                  aria-pressed={view === "delivered"}
                  onClick={() => setView("delivered")}
                >
                  Entregados
                </button>
              </div>
              <span className="hub-board-hint">
                {loaded
                  ? `${filteredOrders.length} ${filteredOrders.length === 1 ? "pedido" : "pedidos"}`
                  : "Cargando pedidos"}{" "}
                <span aria-hidden="true">·</span> Más antiguos primero
              </span>
            </div>
            {!loaded ? (
              <div className="hub-board-empty" role="status">
                {error ? (
                  <>
                    <Icon name="refresh" size={34} />
                    <h2>Los pedidos están por llegar</h2>
                    <p>
                      Restablece la conexión para ver el tablero de operación.
                    </p>
                  </>
                ) : (
                  <>
                    <span className="hub-spinner" />
                    <h2>Preparando el tablero</h2>
                    <p>Estamos consultando los pedidos de Cream Club.</p>
                  </>
                )}
              </div>
            ) : filteredOrders.length === 0 ? (
              <div className="hub-board-empty">
                <span className="hub-empty-icon">
                  <Icon
                    name={search || station !== "Todas" ? "search" : "coffee"}
                    size={33}
                  />
                </span>
                <h2>
                  {search || station !== "Todas"
                    ? "No encontramos pedidos"
                    : view === "delivered"
                      ? "Aún no hay pedidos entregados"
                      : view === "active"
                        ? "Todo está al día"
                        : "Listos para un buen día"}
                </h2>
                <p>
                  {search || station !== "Todas"
                    ? "Prueba con otro cliente, número de pedido o estación."
                    : view === "delivered"
                      ? "Los pedidos aparecerán aquí al completar su entrega."
                      : "Los nuevos pedidos de Cream Club aparecerán aquí automáticamente."}
                </p>
                {(search || station !== "Todas" || view !== "all") && (
                  <button
                    className="hub-outline-button"
                    type="button"
                    onClick={() => {
                      setSearch("");
                      setStation("Todas");
                      setView("all");
                    }}
                  >
                    Ver todos los pedidos
                  </button>
                )}
              </div>
            ) : (
              <div
                className={`hub-board ${view === "delivered" ? "hub-board-history" : ""}`}
                tabIndex={0}
                aria-label="Pedidos por estado; desplaza horizontalmente para ver todas las columnas"
              >
                <div
                  className="hub-board-columns"
                  style={{ "--hub-columns": visibleStatuses.length }}
                >
                  {visibleStatuses.map((status) => {
                    const columnOrders = filteredOrders
                      .filter((order) => order.status === status)
                      .sort((a, b) =>
                        status === "Entregado"
                          ? timestamp(b.updatedAt || b.createdAt) -
                            timestamp(a.updatedAt || a.createdAt)
                          : timestamp(a.createdAt) - timestamp(b.createdAt),
                      );
                    return (
                      <section
                        key={status}
                        className={`hub-column hub-column-${statusKeys[status]}`}
                        aria-label={status}
                      >
                        <header className="hub-column-heading">
                          <div>
                            <span className="hub-column-dot" />
                            <h2>{status}</h2>
                            <span className="hub-column-count">
                              {columnOrders.length}
                            </span>
                          </div>
                          <p>{statusDescriptions[status]}</p>
                        </header>
                        <div className="hub-column-orders">
                          {columnOrders.map((order) => (
                            <OrderCard
                              key={order.id}
                              order={order}
                              station={station}
                              pending={pendingIds.has(order.id)}
                              onAdvance={advance}
                              now={now}
                            />
                          ))}
                          {columnOrders.length === 0 && (
                            <div className="hub-column-empty">
                              <Icon name="check" size={18} />
                              <span>Sin pedidos</span>
                            </div>
                          )}
                        </div>
                      </section>
                    );
                  })}
                </div>
              </div>
            )}
          </section>
          <footer className="hub-footer">
            <span>Un buen servicio empieza por un gran equipo.</span>
            <span>
              {lastUpdated
                ? `Última actualización: ${formatTime(lastUpdated)}`
                : "Actualización automática cada 5 segundos"}
            </span>
          </footer>
        </div>
      </main>
    </div>
  );
}
