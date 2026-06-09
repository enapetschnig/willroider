import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { setupInstallPromptCapture } from "./lib/pwaInstall";

// Sofort registrieren — bevor React den Tree baut, weil Chrome das
// `beforeinstallprompt`-Event sehr früh nach Page-Load feuert.
setupInstallPromptCapture();

createRoot(document.getElementById("root")!).render(<App />);
