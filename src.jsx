import React from "react";
import { createRoot } from "react-dom/client";
import Club from "./src/components/Club.jsx";
import Hub from "./src/components/Hub.jsx";
import "./style.css";
const hub =
  location.pathname === "/hub" || location.pathname.startsWith("/hub/");
document.title = hub ? "Cream Hub · Los Cabos" : "Cream Club · Los Cabos";
class ErrorBoundary extends React.Component {
  state = { error: false };
  static getDerivedStateFromError() {
    return { error: true };
  }
  render() {
    return this.state.error ? (
      <main className="fatal-error">
        <h1>Necesitamos un momento</h1>
        <p>Recarga la página para volver a Cream.</p>
        <button className="btn btn-primary" onClick={() => location.reload()}>
          Volver a intentar
        </button>
      </main>
    ) : (
      this.props.children
    );
  }
}
createRoot(document.getElementById("root")).render(
  <ErrorBoundary>{hub ? <Hub /> : <Club />}</ErrorBoundary>,
);
