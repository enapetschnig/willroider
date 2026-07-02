/// <reference types="vite-plugin-pwa/client" />
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import App from "./App.tsx";
import "./index.css";
import { setupInstallPromptCapture } from "./lib/pwaInstall";

// Sofort registrieren — bevor React den Tree baut, weil Chrome das
// `beforeinstallprompt`-Event sehr früh nach Page-Load feuert.
setupInstallPromptCapture();

// PWA-Update-Check: installierte Clients (Handy-Homescreen) laufen sonst
// tagelang mit altem JS-Bundle (Schema-Drift gegen neue Edge-Functions/DB).
// Daher stündlich UND beim Zurückkehren in die App aktiv nach einer neuen
// Service-Worker-Version fragen — autoUpdate übernimmt dann den Rest.
registerSW({
  onRegisteredSW(_swUrl, registration) {
    if (!registration) return;
    const checkForUpdate = () => {
      registration.update().catch(() => {
        // Offline / Netzwerkfehler beim Update-Check bewusst ignorieren
      });
    };
    setInterval(checkForUpdate, 60 * 60 * 1000); // stündlich
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") checkForUpdate();
    });
  },
});

createRoot(document.getElementById("root")!).render(<App />);
