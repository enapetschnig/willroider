/**
 * Globaler Cache für das `beforeinstallprompt`-Event.
 *
 * Chrome/Edge feuern das Event sofort nach Page-Load, oft bevor irgendein
 * React-Component gemountet ist. Wir müssen den Listener also so früh wie
 * möglich (in main.tsx) registrieren und das Event in einem Modul-Singleton
 * cachen — damit der Install-Dialog es später noch verwenden kann.
 */

export type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

let cachedEvent: BeforeInstallPromptEvent | null = null;
const listeners = new Set<(e: BeforeInstallPromptEvent | null) => void>();

export function setupInstallPromptCapture() {
  if (typeof window === "undefined") return;
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    cachedEvent = e as BeforeInstallPromptEvent;
    listeners.forEach((l) => l(cachedEvent));
  });
  window.addEventListener("appinstalled", () => {
    cachedEvent = null;
    listeners.forEach((l) => l(null));
  });
}

export function getCachedInstallPrompt(): BeforeInstallPromptEvent | null {
  return cachedEvent;
}

export function clearCachedInstallPrompt() {
  cachedEvent = null;
  listeners.forEach((l) => l(null));
}

export function subscribeInstallPrompt(
  fn: (e: BeforeInstallPromptEvent | null) => void,
): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
