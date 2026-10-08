import React, { useEffect, useRef, useState } from "react";
import { api } from "../api.js";
import { BRANCHES, STATUSES } from "../../shared/catalog.js";
import { Icon, Modal } from "./UI.jsx";
import "./HubMemberCard.css";

const UUID_V4 = /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i;
const branches = BRANCHES.map((branch) => typeof branch === "string" ? branch : branch.name);
const dateFormatter = new Intl.DateTimeFormat("es-MX", {
  dateStyle: "medium", timeZone: "America/Mazatlan",
});

function cardId(value) {
  const input = String(value || "").trim();
  if (UUID_V4.test(input)) return input.toLowerCase();
  try {
    const url = new URL(input);
    if (url.origin !== window.location.origin || url.pathname !== "/hub") return null;
    const id = url.searchParams.get("member");
    return UUID_V4.test(id || "") ? id.toLowerCase() : null;
  } catch {
    return null;
  }
}

function validProfile(profile, id) {
  return profile?.id === id &&
    typeof profile.customer === "string" && profile.customer.trim().length >= 2 &&
    profile.customer.length <= 80 && typeof profile.phone === "string" &&
    Number.isFinite(profile.createdAt) && profile.createdAt > 0 &&
    Number.isInteger(profile.deliveredCount) && profile.deliveredCount >= 0 &&
    Array.isArray(profile.recentOrders) && profile.recentOrders.length <= 30 &&
    profile.recentOrders.every((order) => Number.isInteger(order.id) && order.id > 0 &&
      STATUSES.includes(order.status) && branches.includes(order.branch) &&
      Number.isFinite(order.createdAt) && order.createdAt > 0 &&
      Number.isFinite(order.updatedAt) && order.updatedAt > 0);
}

export default function HubMemberCard({ initialId = "", onClose }) {
  const [input, setInput] = useState(initialId);
  const [requestedId, setRequestedId] = useState(() => cardId(initialId));
  const [refreshKey, setRefreshKey] = useState(0);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(initialId && !cardId(initialId)
    ? "El identificador de tarjeta no es válido. Revisa el QR o el código." : "");
  const inputRef = useRef(null);

  useEffect(() => {
    if (!requestedId) {
      inputRef.current?.focus();
      return undefined;
    }
    let live = true;
    setLoading(true);
    setError("");
    setProfile(null);
    // This component is mounted only inside an authenticated Hub session.
    // Authentication uses the HttpOnly Hub cookie; a member secret is never needed here.
    api.getMember(requestedId).then((result) => {
      if (!live) return;
      if (!validProfile(result, requestedId)) {
        throw new Error("No pudimos leer esta tarjeta. Intenta actualizarla.");
      }
      setProfile(result);
    }).catch((failure) => {
      if (live) setError(failure.status === 404
        ? "No encontramos esa tarjeta. Revisa el identificador y tu sesión de equipo."
        : failure.message || "No pudimos consultar la tarjeta. Intenta de nuevo.");
    }).finally(() => {
      if (live) setLoading(false);
    });
    return () => { live = false; };
  }, [requestedId, refreshKey]);

  function lookup(event) {
    event.preventDefault();
    const id = cardId(input);
    if (!id) {
      setError("Pega el identificador de la tarjeta o el enlace de su QR.");
      return;
    }
    setInput(id);
    setRequestedId(id);
    setRefreshKey((value) => value + 1);
  }

  return (
    <Modal title="Tarjeta Cream Club" className="hub-member-modal" onClose={onClose}>
      <div className="hub-member-heading">
        <span className="hub-member-symbol"><Icon name="card" size={24} /></span>
        <div><span className="hub-eyebrow">CREAM CLUB</span><h2>Consulta de tarjeta</h2></div>
      </div>
      <p className="hub-member-intro">Consulta el nombre y los pedidos vinculados al QR del cliente.</p>
      <form className="hub-member-form" onSubmit={lookup}>
        <label htmlFor="hub-member-id">Identificador de tarjeta</label>
        <div>
          <input ref={inputRef} id="hub-member-id" value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="Identificador o enlace del QR" autoComplete="off"
            autoCapitalize="none" spellCheck={false} maxLength={512} required
            aria-describedby={error ? "hub-member-error" : undefined} />
          <button type="submit" disabled={loading || !input.trim()}>Consultar</button>
        </div>
      </form>
      {error && <div className="hub-member-error" id="hub-member-error" role="alert">
        <p>{error}</p>
        {requestedId && <button type="button" onClick={() => setRefreshKey((value) => value + 1)}>Reintentar</button>}
      </div>}
      {loading && <div className="hub-member-loading" role="status"><span className="hub-spinner" />Consultando tarjeta…</div>}
      {profile && <>
        <section className="hub-member-profile" aria-label="Datos de la tarjeta">
          <div><span>CLIENTE</span><h3>{profile.customer}</h3>
            {profile.phone && <p><a href={`tel:${profile.phone.replace(/[^+\d]/g, "")}`}>{profile.phone}</a></p>}
            <small>Club desde {dateFormatter.format(profile.createdAt)}</small>
          </div>
          <div className="hub-member-count"><strong>{profile.deliveredCount}</strong><span>Pedidos entregados</span></div>
        </section>
        <section className="hub-member-history" aria-label="Historial de la tarjeta">
          <div className="hub-member-history-heading"><h3>Pedidos recientes</h3>
            <button type="button" onClick={() => setRefreshKey((value) => value + 1)} aria-label="Actualizar tarjeta"><Icon name="refresh" size={16} /></button>
          </div>
          {profile.recentOrders.length ? <ol>
            {profile.recentOrders.map((order) => <li key={order.id}>
              <div><strong>#{order.id}</strong><span>{order.branch}</span><time dateTime={new Date(order.createdAt).toISOString()}>{dateFormatter.format(order.createdAt)}</time></div>
              <span className={`hub-member-order-status ${order.status === "Entregado" ? "is-delivered" : ""}`} aria-label={`Estado del pedido #${order.id}`}>{order.status}</span>
            </li>)}
          </ol> : <p className="hub-member-no-orders">Esta tarjeta todavía no tiene pedidos vinculados.</p>}
        </section>
      </>}
    </Modal>
  );
}
