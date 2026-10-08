import React, { useEffect, useRef } from "react";
export function Icon({ name, size = 20, ...props }) {
  const paths = {
    home: <><path d="m3 10 9-7 9 7M5 9v12h14V9M9 21v-7h6v7" /></>,
    user: <><circle cx="12" cy="7" r="4" /><path d="M4 21v-2a8 8 0 0 1 16 0v2" /></>,
    card: <><rect x="2" y="5" width="20" height="14" rx="3" /><path d="M2 10h20M6 15h4" /></>,
    qr: <><rect x="3" y="3" width="6" height="6" rx="1" /><rect x="15" y="3" width="6" height="6" rx="1" /><rect x="3" y="15" width="6" height="6" rx="1" /><path d="M15 15h3v3h3v3h-6v-3M12 3v5M3 12h5M12 12h4M12 18v3M21 12h-2" /></>,
    bag: (
      <>
        <path d="M6 7h12l1 14H5L6 7Z" />
        <path d="M9 8V6a3 3 0 0 1 6 0v2" />
      </>
    ),
    coffee: (
      <>
        <path d="M4 8h13v7a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5V8Z" />
        <path d="M17 9h2a3 3 0 0 1 0 6h-2M7 2v3m4-3v3m4-3v3" />
      </>
    ),
    arrow: <path d="M4 12h16m-6-6 6 6-6 6" />,
    check: <path d="m5 12 4 4L19 6" />,
    clock: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </>
    ),
    search: (
      <>
        <circle cx="10" cy="10" r="6" />
        <path d="m15 15 5 5" />
      </>
    ),
    refresh: (
      <>
        <path d="M20 7v5h-5M4 17v-5h5" />
        <path d="M6 7a7 7 0 0 1 12-1l2 3M4 15l2 3a7 7 0 0 0 12-1" />
      </>
    ),
    close: <path d="m6 6 12 12M6 18 18 6" />,
    plus: <path d="M12 5v14M5 12h14" />,
    minus: <path d="M5 12h14" />,
    chevron: <path d="m8 10 4 4 4-4" />,
    leaf: (
      <>
        <path d="M20 3C10 2 3 8 5 15c2 7 16 4 15-12Z" />
        <path d="M4 21 15 10" />
      </>
    ),
    grid: (
      <>
        <rect x="3" y="3" width="7" height="7" rx="1" />
        <rect x="14" y="3" width="7" height="7" rx="1" />
        <rect x="3" y="14" width="7" height="7" rx="1" />
        <rect x="14" y="14" width="7" height="7" rx="1" />
      </>
    ),
    logout: (
      <>
        <path d="M9 3H4v18h5M8 12h13m-5-5 5 5-5 5" />
      </>
    ),
    menu: <path d="M4 6h16M4 12h16M4 18h16" />,
    location: (
      <>
        <path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z" />
        <circle cx="12" cy="10" r="2" />
      </>
    ),
    utensils: (
      <>
        <path d="M5 3v6m3-6v6M2 3v6a3 3 0 0 0 6 0M5 12v9M19 3c-4 1-5 5-5 9h5V3Zm0 9v9" />
      </>
    ),
    bread: (
      <>
        <path d="M4 10C0 6 5 2 9 4c2-2 5-2 7 0 5-2 9 3 4 6v10H4V10Z" />
        <path d="m9 9-1 4m6-4-1 4" />
      </>
    ),
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {paths[name] ?? paths.coffee}
    </svg>
  );
}
export function Brand({ hub = false }) {
  return (
    <a
      className={`brand ${hub ? "brand-hub" : ""}`}
      href={hub ? "/hub" : "/club"}
      aria-label={hub ? "Cream Hub inicio" : "Cream Club inicio"}
    >
      <span className="brand-lockup">
        <img className="brand-logo" src="/brand/logo-cream-azul.svg" alt="" width="142" height="77" />
        <img className="brand-bird" src="/brand/icon-pato-azul.svg" alt="" width="127" height="105" />
      </span>
      <span className="brand-sub">{hub ? "HUB · OPERACIÓN" : "CLUB · LOS CABOS"}</span>
    </a>
  );
}
export function Modal({ title, children, onClose, className = "" }) {
  const ref = useRef(null);
  useEffect(() => {
    const previous = document.activeElement;
    const dialog = ref.current;
    dialog.showModal();
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = oldOverflow;
      previous?.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={`modal ${className}`}
      aria-label={title}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === ref.current) onClose();
      }}
    >
      <div className="modal-content">
        <button
          className="icon-button modal-close"
          aria-label="Cerrar"
          onClick={onClose}
        >
          <Icon name="close" />
        </button>
        {children}
      </div>
    </dialog>
  );
}
export function Quantity({ value, onChange, name, max = 20 }) {
  return (
    <div className="quantity">
      <button
        type="button"
        aria-label={`Disminuir cantidad de ${name}`}
        disabled={value <= 1}
        onClick={() => onChange(value - 1)}
      >
        <Icon name="minus" size={16} />
      </button>
      <span aria-live="polite">{value}</span>
      <button
        type="button"
        aria-label={`Aumentar cantidad de ${name}`}
        disabled={value >= max}
        onClick={() => onChange(value + 1)}
      >
        <Icon name="plus" size={16} />
      </button>
    </div>
  );
}
