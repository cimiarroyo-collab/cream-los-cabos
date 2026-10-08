import React, { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { BRANCHES, STATUSES } from "../../shared/catalog.js";
import { api } from "../api.js";
import { storage } from "../storage.js";
import { Icon } from "./UI.jsx";
import "./ClubMember.css";

const PENDING_MEMBER_KEY = "cream-member-pending-v1";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const dateLabel = (value) => {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short", year: "numeric" }).format(date)
    : "Fecha no disponible";
};
function validPending(value) {
  return value && UUID.test(value.requestId || "") && UUID.test(value.accessToken || "")
    && typeof value.customer === "string" && typeof value.phone === "string";
}
function validProfile(value, expectedId) {
  const validTimestamp = (timestamp) => Number.isFinite(timestamp) && timestamp > 0
    && Number.isFinite(new Date(timestamp).getTime());
  return value && UUID.test(value.id || "")
    && (!expectedId || value.id === expectedId)
    && typeof value.customer === "string" && typeof value.phone === "string"
    && validTimestamp(value.createdAt) && validTimestamp(value.updatedAt)
    && Number.isInteger(value.deliveredCount) && value.deliveredCount >= 0
    && Array.isArray(value.recentOrders)
    && value.recentOrders.every((order) => order
      && Number.isSafeInteger(order.id) && order.id > 0
      && STATUSES.includes(order.status) && BRANCHES.includes(order.branch)
      && validTimestamp(order.createdAt) && validTimestamp(order.updatedAt));
}
function MemberQr({ id }) {
  const canvas = useRef(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    let active = true;
    setError("");
    const value = `${window.location.origin}/hub?member=${encodeURIComponent(id)}`;
    QRCode.toCanvas(canvas.current, value, {
      width: 256,
      margin: 4,
      errorCorrectionLevel: "M",
      color: { dark: "#293B99", light: "#FFFFFF" },
    }).catch(() => {
      if (active) setError("No pudimos generar tu QR. Puedes mostrar tu número de tarjeta al equipo.");
    });
    return () => { active = false; };
  }, [id]);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 3000);
    return () => clearTimeout(timer);
  }, [copied]);
  async function copyId() {
    try {
      await navigator.clipboard.writeText(id);
      setCopied(true);
      setError("");
    } catch {
      setError("No pudimos copiar el número. Puedes seleccionarlo debajo del QR.");
    }
  }
  return (
    <div className="club-member-qr">
      <span className="eyebrow">TU TARJETA, SIEMPRE CONTIGO</span>
      <h2>Un momento Cream comienza aquí.</h2>
      <p>Presenta tu tarjeta al equipo en sucursal.</p>
      <div className="club-member-qr-frame">
        <canvas ref={canvas} role="img" aria-label="Código QR de tu tarjeta Cream Club" />
      </div>
      <span className="club-member-id-label">Número de tarjeta</span>
      <code className="club-member-id">{id}</code>
      <button type="button" className="text-button club-member-copy" onClick={copyId}>
        <Icon name={copied ? "check" : "grid"} size={16} />
        {copied ? "Número copiado" : "Copiar número de tarjeta"}
      </button>
      {error && <p className="inline-error" role="alert">{error}</p>}
    </div>
  );
}
function MemberCard({ customer, id, createdAt }) {
  return (
    <article className="club-member-card" aria-label="Tu tarjeta Cream Club">
      <div className="club-member-card-brand">
        <img src="/brand/logo-cream-blanco-01.svg" alt="Cream" width="142" height="77" />
        <span>CLUB · LOS CABOS</span>
      </div>
      <img className="club-member-card-bird" src="/brand/icon_pato.svg" alt="" width="127" height="105" />
      <div className="club-member-card-name">
        <span>UN LUGAR PARA ENCONTRARNOS</span>
        <h2>{customer}</h2>
        <p>Good food. Brighter days.</p>
      </div>
      <div className="club-member-card-bottom">
        <span>Miembro desde {dateLabel(createdAt)}</span>
        <span aria-label={`Tarjeta terminada en ${id.slice(-8)}`}>{id.slice(-8).toUpperCase()}</span>
      </div>
    </article>
  );
}
export default function ClubMember({ view, member, customer = "", phone = "", onMemberSaved, onExplore, onTrackOrder }) {
  const [profile, setProfile] = useState(null);
  const [name, setName] = useState(member?.customer || customer);
  const [contact, setContact] = useState(member?.phone || phone);
  const [loading, setLoading] = useState(Boolean(member));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [refresh, setRefresh] = useState(0);
  const callbacks = useRef({ onMemberSaved });
  const mounted = useRef(true);
  const saveLock = useRef(false);
  const readVersion = useRef(0);
  callbacks.current.onMemberSaved = onMemberSaved;
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; readVersion.current += 1; };
  }, []);
  useEffect(() => {
    setName(member?.customer || customer);
    setContact(member?.phone || phone);
  }, [member?.customer, member?.phone, customer, phone]);
  useEffect(() => {
    const version = ++readVersion.current;
    let active = true;
    if (!member?.id || !member?.token) {
      setProfile(null);
      setLoading(false);
      return () => { active = false; };
    }
    setLoading(true);
    setError("");
    if (profile?.id !== member.id) setProfile(null);
    api.getMember(member.id, member.token).then((result) => {
      if (!active || version !== readVersion.current) return;
      if (!validProfile(result, member.id)) throw new Error("No pudimos verificar tu tarjeta. Intenta actualizarla.");
      setProfile(result);
      callbacks.current.onMemberSaved({ ...result, token: member.token });
    }).catch((failure) => {
      if (active && version === readVersion.current) setError(failure.message || "No pudimos cargar tu tarjeta.");
    }).finally(() => {
      if (active && version === readVersion.current) setLoading(false);
    });
    return () => { active = false; };
  }, [member?.id, member?.token, refresh, view]);
  async function saveProfile(event) {
    event.preventDefault();
    if (saveLock.current) return;
    const cleanName = name.trim().replace(/\s+/g, " ");
    const cleanPhone = contact.trim();
    if (cleanName.length < 2 || cleanName.length > 80) {
      setError("Escribe tu nombre usando entre 2 y 80 caracteres.");
      return;
    }
    const phoneDigits = cleanPhone.replace(/\D/g, "").length;
    if (cleanPhone && (cleanPhone.length > 30 || !/^[+\d\s()-]+$/.test(cleanPhone) || phoneDigits < 10 || phoneDigits > 15)) {
      setError("Revisa el teléfono o déjalo vacío si prefieres.");
      return;
    }
    saveLock.current = true;
    setSaving(true);
    setError("");
    setNotice("");
    const operationVersion = ++readVersion.current;
    try {
      let token = member?.token;
      let result;
      if (member?.id && token) {
        result = await api.updateMember(member.id, token, { customer: cleanName, phone: cleanPhone });
      } else {
        const saved = storage.get(PENDING_MEMBER_KEY, null);
        const intent = validPending(saved) ? saved : {
          requestId: crypto.randomUUID(),
          accessToken: crypto.randomUUID(),
          customer: cleanName,
          phone: cleanPhone,
        };
        if (!storage.set(PENDING_MEMBER_KEY, intent)) {
          throw new Error("Este navegador no permite guardar tu tarjeta. Habilita el almacenamiento para conservar tu acceso.");
        }
        token = intent.accessToken;
        result = await api.createMember(intent);
        if (!validProfile(result)) throw new Error("No pudimos verificar la tarjeta creada. Puedes intentar de nuevo de forma segura.");
        if (result.customer !== cleanName || result.phone !== cleanPhone) {
          result = await api.updateMember(result.id, token, { customer: cleanName, phone: cleanPhone });
        }
      }
      if (!validProfile(result, member?.id)) throw new Error("No pudimos verificar tus datos. Intenta de nuevo.");
      if (!mounted.current || operationVersion !== readVersion.current) return;
      const saved = callbacks.current.onMemberSaved({ ...result, token });
      setProfile(result);
      setName(result.customer);
      setContact(result.phone);
      if (saved === false) {
        throw new Error("Tu tarjeta se creó, pero este navegador no pudo guardar el acceso. Conservaremos la solicitud para recuperarla al reintentar.");
      }
      storage.remove(PENDING_MEMBER_KEY);
      setNotice(member ? "Tus datos se guardaron." : "Tu tarjeta Cream Club está lista.");
    } catch (failure) {
      if (mounted.current && operationVersion === readVersion.current) setError(failure.message || "No pudimos guardar tus datos. Intenta de nuevo.");
    } finally {
      saveLock.current = false;
      if (mounted.current) setSaving(false);
    }
  }
  const registered = Boolean(member?.id && member?.token);
  const data = profile?.id === member?.id ? profile : null;
  const titles = { rewards: "Tu lugar en Cream.", profile: "Un gusto conocerte.", qr: "Tu tarjeta Cream Club." };
  const descriptions = {
    rewards: "Tu tarjeta y los momentos que compartes con nosotros, en un mismo lugar.",
    profile: "Tus datos, a tu manera. Así preparamos cada momento para ti.",
    qr: "Lleva Cream contigo y presenta tu tarjeta en sucursal.",
  };
  const showForm = !registered || view === "profile";
  return (
    <section className={`club-member-page club-member-page-${view}`} aria-label={view === "profile" ? "Perfil Cream Club" : "Tarjeta Cream Club"}>
      <header className="club-member-heading">
        <span className="eyebrow">CREAM CLUB · LOS CABOS</span>
        <h1>{titles[view] || titles.rewards}</h1>
        <p>{descriptions[view] || descriptions.rewards}</p>
      </header>
      {notice && <div className="club-member-notice" role="status"><Icon name="check" size={19} />{notice}</div>}
      {error && <div className="inline-error club-member-error" role="alert"><span>{error}</span>{registered && !saving && <button type="button" className="text-button" onClick={() => setRefresh((value) => value + 1)}>Actualizar tarjeta</button>}</div>}
      {registered && loading && <div className="club-member-loading" role="status"><Icon name="refresh" size={17} />Actualizando tu tarjeta…</div>}
      {showForm ? (
        <div className="club-member-profile-layout">
          <form className="club-member-form" onSubmit={saveProfile}>
            <span className="eyebrow">{registered ? "TU PERFIL" : "BIENVENIDO A CREAM CLUB"}</span>
            <h2>{registered ? "Los detalles importan." : "Un buen momento empieza contigo."}</h2>
            <p>{registered ? "Actualiza el nombre y teléfono que utilizas para tus pedidos." : "Crea tu tarjeta para consultar tu historial y presentarte en sucursal."}</p>
            <label className="field" htmlFor="cream-member-name"><span>Nombre</span><input id="cream-member-name" name="customer" autoComplete="name" minLength={2} maxLength={80} required placeholder="¿Cómo te llamas?" value={name} disabled={saving || (registered && loading)} onChange={(event) => setName(event.target.value)} /></label>
            <label className="field" htmlFor="cream-member-phone"><span>Teléfono <small>(opcional)</small></span><input id="cream-member-phone" name="phone" type="tel" autoComplete="tel" maxLength={30} placeholder="Tu número de contacto" value={contact} disabled={saving || (registered && loading)} onChange={(event) => setContact(event.target.value)} /></label>
            <button type="submit" className="btn btn-primary" disabled={saving || (registered && loading)}>{saving ? "Guardando…" : registered ? "Guardar cambios" : "Crear mi tarjeta"}<Icon name={saving ? "clock" : "arrow"} size={18} /></button>
            <p className="club-member-device-note">Tu acceso a esta tarjeta se guarda en este navegador. Consérvalo para volver a consultar tu perfil e historial.</p>
          </form>
          <aside className="club-member-profile-aside">
            {registered ? <MemberCard customer={data?.customer || member.customer} id={member.id} createdAt={data?.createdAt || member.createdAt} /> : <div className="club-member-invitation"><img src="/brand/icon-pato-azul.svg" alt="" width="127" height="105" /><span className="eyebrow">GOOD FOOD. BRIGHTER DAYS.</span><h2>El café nos reúne.<br />Cream nos conecta.</h2><p>Tu tarjeta, tu historial y tu próximo favorito.</p></div>}
            <div className="club-member-benefits"><span className="eyebrow">CREAM CLUB</span><h3>Beneficios por definir</h3><p>Tu tarjeta y tu historial ya tienen su lugar aquí. Compartiremos los beneficios cuando estén disponibles.</p></div>
          </aside>
        </div>
      ) : (
        <>
          <div className="club-member-card-layout">
            <div><MemberCard customer={data?.customer || member.customer} id={member.id} createdAt={data?.createdAt || member.createdAt} /><p className="club-member-device-note">Esta tarjeta está guardada en este navegador. No compartas el acceso a tu dispositivo.</p>{view === "rewards" && <div className="club-member-benefits"><span className="eyebrow">CREAM CLUB</span><h3>Beneficios por definir</h3><p>Por ahora, disfruta tu tarjeta y consulta tu historial. Los beneficios se anunciarán cuando estén disponibles.</p></div>}</div>
            <MemberQr id={member.id} />
          </div>
          {view === "rewards" && <section className="club-member-history" aria-label="Historial de Cream Club"><div className="club-member-history-heading"><div><span className="eyebrow">TUS MOMENTOS CREAM</span><h2>Tu historial.</h2></div>{data && <div className="club-member-visit-count"><strong>{data.deliveredCount}</strong><span>{data.deliveredCount === 1 ? "pedido entregado" : "pedidos entregados"}</span></div>}</div>{!data ? <div className="club-member-history-empty"><Icon name="clock" size={27} /><p>{loading ? "Consultando tus pedidos…" : "Actualiza tu tarjeta para consultar el historial."}</p></div> : data.recentOrders.length ? <ul className="club-member-history-list">{data.recentOrders.map((order) => <li key={order.id}><div className="club-member-history-icon"><Icon name="bag" size={20} /></div><div className="club-member-history-order"><strong>Pedido #{order.id}</strong><span>{order.branch} · {dateLabel(order.createdAt)}</span></div><span className={`club-member-history-status ${order.status === "Entregado" ? "is-delivered" : ""}`}>{order.status}</span>{onTrackOrder && <button type="button" className="club-member-history-link" aria-label={`Consultar pedido ${order.id}`} onClick={() => onTrackOrder(order.id)}><Icon name="arrow" size={18} /></button>}</li>)}</ul> : <div className="club-member-history-empty"><Icon name="coffee" size={29} /><h3>Tu próximo favorito te espera.</h3><p>Los pedidos que hagas con tu tarjeta aparecerán aquí.</p><button type="button" className="btn btn-secondary" onClick={onExplore}>Explorar el menú<Icon name="arrow" size={17} /></button></div>}<p className="club-member-history-footnote">El historial muestra los pedidos vinculados a esta tarjeta.</p></section>}
        </>
      )}
    </section>
  );
}
