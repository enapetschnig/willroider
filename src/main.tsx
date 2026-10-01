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
// Daher stündlich UND beim Zurückkehren in die App nach einer neuen
// Service-Worker-Version fragen.
//
// Übernommen wird eine neue Version aber erst, wenn die App NICHT sichtbar
// ist. Vorher lud sie sich gleich nach dem Öffnen ein zweites Mal neu,
// mitten in der ersten Bewegung (Änderungswunsch J. Maurer 01.10.).
let updateWartet = false;
const updateSW = registerSW({
  onNeedRefresh() {
    updateWartet = true;
    if (document.visibilityState === "hidden") void updateSW(true);
  },
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
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden" && updateWartet) void updateSW(true);
});

// Fehlt ein nachgeladener Baustein der alten Version (nach einem Update
// gelöscht), einmal neu laden statt einen Fehler zu zeigen.
window.addEventListener("vite:preloadError", (e) => {
  e.preventDefault();
  if (sessionStorage.getItem("preload-reload")) return;
  sessionStorage.setItem("preload-reload", "1");
  window.location.reload();
});
window.addEventListener("load", () => {
  window.setTimeout(() => sessionStorage.removeItem("preload-reload"), 10000);
});

createRoot(document.getElementById("root")!).render(<App />);
