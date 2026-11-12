import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { CssBaseline, ThemeProvider } from "@mui/material";
import { BrowserRouter, useNavigate } from "react-router-dom";

import App from "./app/App.jsx";
import "./app/app.css";
import { SessionProvider } from "./app/session-context.jsx";
import { theme } from "./app/theme.js";

function ServiceWorkerNavigation() {
  const navigate = useNavigate();

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return undefined;

    const handleMessage = (event) => {
      if (event.data?.type !== "NAVIGATE" || typeof event.data.url !== "string") return;
      const destination = new URL(event.data.url, window.location.origin);
      if (destination.origin !== window.location.origin) return;
      const isFoodieRoute = /^\/(?:feed|reviews|visits|evaluations|photos)(?:\/|$)/.test(destination.pathname);
      if (!isFoodieRoute) return;
      navigate(`${destination.pathname}${destination.search}${destination.hash}`);
    };

    navigator.serviceWorker.addEventListener("message", handleMessage);
    return () => navigator.serviceWorker.removeEventListener("message", handleMessage);
  }, [navigate]);

  return null;
}

function Root() {
  return (
    <StrictMode>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <BrowserRouter>
          <SessionProvider>
            <ServiceWorkerNavigation />
            <App />
          </SessionProvider>
        </BrowserRouter>
      </ThemeProvider>
    </StrictMode>
  );
}

const root = document.getElementById("app-root");
if (!root) throw new Error("No se encontró el punto de montaje de Foodie.");
createRoot(root).render(<Root />);

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch((error) => {
      console.warn("No se pudo registrar el service worker:", error);
    });
  }, { once: true });
}
