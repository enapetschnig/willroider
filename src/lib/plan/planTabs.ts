/**
 * Offene Pläne (Tabs) des Plan-Viewers — app-weit, im Browser gemerkt.
 * Beim nächsten Start bzw. Zurückkehren sind dieselben Pläne wieder offen
 * (Wunsch S. Egger, 18.11.2026). Gemerkt werden nur Angaben zur Datei,
 * keine kurzlebigen Adressen.
 */
import { useSyncExternalStore } from "react";

export type PlanTab = {
  /** „sp:<sharepoint_dateien.id>“ oder „dok:<dokumente.id>“ */
  key: string;
  dateiname: string;
  mimetype: string | null;
  baustelleId: string;
  baustelleName?: string | null;
  storagePath?: string | null;
  /** Ordner des Originals wie im Dokumente-Reiter (für „Als Kopie speichern“) */
  ordnerKey?: string | null;
  subpath?: string | null;
};

export type PlanViewerZustand = {
  tabs: PlanTab[];
  links: string | null;
  rechts: string | null;
  /** Nebeneinander-Ansicht an */
  split: boolean;
  offen: boolean;
  /** Wem diese Tabs gehören (geteiltes Tablet). */
  nutzer?: string | null;
};

const LS = "willroider:planViewer";
const leer: PlanViewerZustand = { tabs: [], links: null, rechts: null, split: false, offen: false };

function lesen(): PlanViewerZustand {
  try {
    const roh = localStorage.getItem(LS);
    if (!roh) return leer;
    const z = JSON.parse(roh) as PlanViewerZustand;
    if (!Array.isArray(z.tabs)) return leer;
    return { ...leer, ...z };
  } catch {
    return leer;
  }
}

let zustand: PlanViewerZustand = typeof localStorage === "undefined" ? leer : lesen();
const zuhoerer = new Set<() => void>();

function setzen(neu: PlanViewerZustand) {
  // Aktive Tabs müssen existieren
  const gibt = (k: string | null) => (k && neu.tabs.some((t) => t.key === k) ? k : null);
  const links = gibt(neu.links) ?? neu.tabs[0]?.key ?? null;
  let rechts = gibt(neu.rechts);
  if (neu.split && !rechts) rechts = neu.tabs.find((t) => t.key !== links)?.key ?? null;
  if (!links) rechts = null;
  // Derselbe Plan nie in beiden Hälften (sonst zwei Ebenen, die sich überschreiben)
  if (rechts && rechts === links) rechts = neu.tabs.find((t) => t.key !== links)?.key ?? null;
  zustand = { ...neu, links, rechts, split: neu.split && !!rechts, offen: neu.offen && neu.tabs.length > 0 };
  if (!zustand.split) zustand.rechts = null;
  try {
    localStorage.setItem(LS, JSON.stringify(zustand));
  } catch {
    /* voll — egal */
  }
  zuhoerer.forEach((f) => f());
}

export const planViewer = {
  get: () => zustand,
  abonnieren: (f: () => void) => {
    zuhoerer.add(f);
    return () => {
      zuhoerer.delete(f);
    };
  },
  /** Plan öffnen (oder zu ihm wechseln) — in der Seite, die gerade bedient wird. */
  oeffnen(tab: PlanTab, seite: "links" | "rechts" = "links") {
    const tabs = zustand.tabs.some((t) => t.key === tab.key)
      ? zustand.tabs.map((t) => (t.key === tab.key ? { ...t, ...tab } : t))
      : [...zustand.tabs, tab];
    const andere = seite === "links" ? "rechts" : "links";
    if (zustand.split && zustand[andere] === tab.key) setzen({ ...zustand, tabs, offen: true });
    else setzen({ ...zustand, tabs, [seite]: tab.key, offen: true });
  },
  aktivieren(key: string, seite: "links" | "rechts") {
    const andere = seite === "links" ? "rechts" : "links";
    // Steht der Plan schon in der anderen Hälfte → Seiten tauschen
    if (zustand[andere] === key) setzen({ ...zustand, [seite]: key, [andere]: zustand[seite] });
    else setzen({ ...zustand, [seite]: key });
  },
  schliessenTab(key: string) {
    const idx = zustand.tabs.findIndex((t) => t.key === key);
    const tabs = zustand.tabs.filter((t) => t.key !== key);
    const nachbar = tabs[Math.min(idx, tabs.length - 1)]?.key ?? null;
    const ersetze = (k: string | null) => (k === key ? nachbar : k);
    let links = ersetze(zustand.links);
    let rechts = ersetze(zustand.rechts);
    if (rechts && rechts === links) rechts = tabs.find((t) => t.key !== links)?.key ?? null;
    if (!links) {
      links = rechts;
      rechts = null;
    }
    setzen({ ...zustand, tabs, links, rechts });
  },
  nebeneinander(an: boolean) {
    const rechts = an ? zustand.tabs.find((t) => t.key !== zustand.links)?.key ?? null : null;
    setzen({ ...zustand, split: an, rechts });
  },
  /** Nächster/voriger Tab (Wischen am Tablet). */
  blaettern(seite: "links" | "rechts", richtung: 1 | -1) {
    const akt = zustand[seite];
    const andere = seite === "links" ? zustand.rechts : zustand.links;
    const liste = zustand.tabs.filter((t) => t.key === akt || t.key !== andere);
    if (liste.length < 2) return;
    const i = liste.findIndex((t) => t.key === akt);
    const n = liste[(i + richtung + liste.length) % liste.length];
    setzen({ ...zustand, [seite]: n.key });
  },
  zeigen() {
    setzen({ ...zustand, offen: true });
  },
  schliessen() {
    setzen({ ...zustand, offen: false });
  },
  allesSchliessen() {
    setzen({ ...leer, nutzer: zustand.nutzer ?? null });
  },
  /** Beim Anmelden: Tabs eines anderen Benutzers nicht zeigen. */
  fuerNutzer(id: string) {
    if (zustand.nutzer === id) return;
    setzen(zustand.nutzer ? { ...leer, nutzer: id } : { ...zustand, nutzer: id });
  },
};

export function usePlanViewer(): PlanViewerZustand {
  return useSyncExternalStore(planViewer.abonnieren, planViewer.get, planViewer.get);
}

/** Lässt sich die Datei im Plan-Viewer zeigen? PDFs und gängige Bilder. */
export function planFaehig(dateiname: string, mimetype?: string | null): boolean {
  const mt = (mimetype ?? "").toLowerCase();
  const ext = (dateiname.split(".").pop() ?? "").toLowerCase();
  if (mt === "application/pdf" || ext === "pdf") return true;
  return ["image/jpeg", "image/png", "image/webp", "image/gif"].includes(mt) || ["jpg", "jpeg", "png", "webp", "gif"].includes(ext);
}
