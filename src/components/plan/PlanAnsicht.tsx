/**
 * Eine Hälfte des Plan-Viewers: zeigt einen Plan (PDF oder Bild), Zoomen
 * und Verschieben mit Maus, Finger und Stift, Anmerkungen als eigene Ebene.
 *
 * Darstellung: Die ganze Seite liegt einmal in mittlerer Auflösung als
 * Grundbild vor (verschiebt/zoomt per CSS flüssig). Steht das Bild still,
 * wird nur der sichtbare Ausschnitt scharf nachgezeichnet — so bleiben auch
 * A0-Pläne am Tablet unter der Größengrenze für Zeichenflächen.
 *
 * Stift: Sobald ein Eingabestift erkannt wurde, zeichnet nur noch der Stift;
 * Finger (auch die aufgelegte Hand) verschieben und zoomen nur.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Hand,
  Pencil,
  Type,
  MoveUpRight,
  Square,
  Cloud,
  Ruler,
  Pentagon,
  Camera,
  Eraser,
  Undo2,
  Redo2,
  Eye,
  EyeOff,
  Maximize2,
  ChevronLeft,
  ChevronRight,
  Loader2,
  EllipsisVertical,
  Scaling,
  Check,
  X,
  CloudOff,
  CloudUpload,
  Save,
  Share2,
  Download,
  ExternalLink,
  HardDriveDownload,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useToast } from "@/hooks/use-toast";
import { dateiHerunterladen } from "@/lib/sharepoint";
import {
  type AnmerkungsDaten,
  type Form,
  type Massstab,
  type SyncStatus,
  PUNKT_IN_METER,
  beiSyncAenderung,
  flaecheText,
  laengeText,
  ladeAnmerkungen,
  leereDaten,
  polygonFlaeche,
  speichereAnmerkungen,
  syncStatus,
  wolkenPunkte,
} from "@/lib/plan/anmerkungen";
import { ladePlan, istOffline, offlineSpeichern, offlineEntfernen, type PlanInhalt } from "@/lib/plan/planQuelle";
import type { PlanTab } from "@/lib/plan/planTabs";

type Werkzeug =
  | "hand"
  | "stift"
  | "text"
  | "pfeil"
  | "rechteck"
  | "wolke"
  | "laenge"
  | "flaeche"
  | "foto"
  | "radierer"
  | "kalibrieren";

const WERKZEUGE: { w: Werkzeug; icon: typeof Hand; label: string }[] = [
  { w: "hand", icon: Hand, label: "Verschieben" },
  { w: "stift", icon: Pencil, label: "Freihand" },
  { w: "text", icon: Type, label: "Text" },
  { w: "pfeil", icon: MoveUpRight, label: "Pfeil" },
  { w: "rechteck", icon: Square, label: "Rechteck" },
  { w: "wolke", icon: Cloud, label: "Revisionswolke" },
  { w: "laenge", icon: Ruler, label: "Länge messen" },
  { w: "flaeche", icon: Pentagon, label: "Fläche messen" },
  { w: "foto", icon: Camera, label: "Foto-Pin" },
  { w: "radierer", icon: Eraser, label: "Radierer" },
];
const FARBEN = ["#dc2626", "#2563eb", "#16a34a", "#f59e0b", "#9333ea", "#111827"];
const STAERKEN = [2, 4, 8];

type View = { s: number; tx: number; ty: number };

let pdfjsVersprechen: Promise<typeof import("pdfjs-dist")> | null = null;
function pdfjs() {
  if (!pdfjsVersprechen) {
    pdfjsVersprechen = (async () => {
      const lib = await import("pdfjs-dist");
      const workerUrl = (await import("pdfjs-dist/build/pdf.worker.mjs?url")).default;
      (lib.GlobalWorkerOptions as any).workerSrc = workerUrl;
      return lib;
    })();
  }
  return pdfjsVersprechen;
}

const neueId = () => Math.random().toString(36).slice(2, 10);

function abstandZuStrecke(px: number, py: number, x1: number, y1: number, x2: number, y2: number) {
  const dx = x2 - x1, dy = y2 - y1;
  const l2 = dx * dx + dy * dy;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / l2));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}
function abstandZuLinie(px: number, py: number, p: number[], zu = false) {
  let m = Infinity;
  for (let i = 0; i + 3 < p.length; i += 2) m = Math.min(m, abstandZuStrecke(px, py, p[i], p[i + 1], p[i + 2], p[i + 3]));
  if (zu && p.length >= 4) m = Math.min(m, abstandZuStrecke(px, py, p[p.length - 2], p[p.length - 1], p[0], p[1]));
  if (p.length === 2) m = Math.hypot(px - p[0], py - p[1]);
  return m;
}
function imPolygon(px: number, py: number, p: number[]) {
  let inn = false;
  for (let i = 0, j = p.length / 2 - 1; i < p.length / 2; j = i++) {
    const xi = p[2 * i], yi = p[2 * i + 1], xj = p[2 * j], yj = p[2 * j + 1];
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inn = !inn;
  }
  return inn;
}
function textBox(f: Extract<Form, { typ: "text" }>) {
  const zeilen = f.text.split("\n");
  const w = Math.max(...zeilen.map((z) => z.length)) * f.groesse * 0.56;
  return { x: f.x, y: f.y, w: Math.max(w, f.groesse), h: zeilen.length * f.groesse * 1.2 };
}
function trifft(f: Form, x: number, y: number, tol: number): boolean {
  switch (f.typ) {
    case "stift":
      return abstandZuLinie(x, y, f.punkte) <= tol + f.breite / 2;
    case "pfeil":
    case "laenge":
      return abstandZuStrecke(x, y, f.x1, f.y1, f.x2, f.y2) <= tol + f.breite / 2;
    case "rechteck":
    case "wolke":
      return abstandZuLinie(x, y, [f.x1, f.y1, f.x2, f.y1, f.x2, f.y2, f.x1, f.y2], true) <= tol + f.breite;
    case "flaeche":
      return imPolygon(x, y, f.punkte) || abstandZuLinie(x, y, f.punkte, true) <= tol;
    case "text": {
      const b = textBox(f);
      return x >= b.x - tol && x <= b.x + b.w + tol && y >= b.y - tol && y <= b.y + b.h + tol;
    }
    case "foto":
      return Math.hypot(x - f.x, y - f.y) <= tol * 1.6;
  }
}

async function fotoAlsDataUrl(file: File): Promise<string> {
  const bmp = await createImageBitmap(file).catch(() => null);
  let quelle: CanvasImageSource;
  let w: number, h: number;
  if (bmp) {
    quelle = bmp;
    w = bmp.width;
    h = bmp.height;
  } else {
    const url = URL.createObjectURL(file);
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = rej;
      i.src = url;
    });
    URL.revokeObjectURL(url);
    quelle = img;
    w = img.naturalWidth;
    h = img.naturalHeight;
  }
  const k = Math.min(1, 1280 / Math.max(w, h));
  const c = document.createElement("canvas");
  c.width = Math.round(w * k);
  c.height = Math.round(h * k);
  c.getContext("2d")!.drawImage(quelle, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", 0.72);
}

export type PlanAktion = {
  tab: PlanTab;
  inhalt: PlanInhalt;
  daten: AnmerkungsDaten;
};

export function PlanAnsicht({
  tab,
  aktiv,
  onFokus,
  onWischen,
  onKopieSpeichern,
  onPerMail,
  onLinkTeilen,
}: {
  tab: PlanTab;
  aktiv: boolean;
  onFokus: () => void;
  onWischen: (richtung: 1 | -1) => void;
  onKopieSpeichern: (a: PlanAktion) => void;
  onPerMail: (a: PlanAktion, mitAnmerkungen: boolean) => void;
  onLinkTeilen: (a: PlanAktion) => void;
}) {
  const { toast } = useToast();
  const boxRef = useRef<HTMLDivElement>(null);
  const untenRef = useRef<HTMLDivElement>(null);
  const obenRef = useRef<HTMLDivElement>(null);
  const scharfRef = useRef<HTMLCanvasElement>(null);
  const grundRef = useRef<HTMLCanvasElement>(null);
  const fotoInputRef = useRef<HTMLInputElement>(null);

  const [inhalt, setInhalt] = useState<PlanInhalt | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);
  const [pdf, setPdf] = useState<any>(null);
  const [seite, setSeite] = useState(1);
  const [seitenAnzahl, setSeitenAnzahl] = useState(1);
  const [groesse, setGroesse] = useState<{ w: number; h: number } | null>(null);
  const [bildUrl, setBildUrl] = useState<string | null>(null);
  const grundK = useRef(1);

  const view = useRef<View>({ s: 1, tx: 0, ty: 0 });
  const fitS = useRef(1);
  const [viewVersion, setViewVersion] = useState(0);

  const [werkzeug, setWerkzeug] = useState<Werkzeug>("hand");
  const [farbe, setFarbe] = useState(FARBEN[0]);
  const [staerke, setStaerke] = useState(STAERKEN[1]);
  const [ebeneSichtbar, setEbeneSichtbar] = useState(true);

  const [daten, setDaten] = useState<AnmerkungsDaten>(leereDaten());
  const datenRef = useRef(daten);
  datenRef.current = daten;
  const [undo, setUndo] = useState<AnmerkungsDaten[]>([]);
  const [redo, setRedo] = useState<AnmerkungsDaten[]>([]);
  const [geladen, setGeladen] = useState(false);
  const [status, setStatus] = useState<SyncStatus>("synchronisiert");
  const speicherTimer = useRef<number | null>(null);
  const ungespeichert = useRef(false);

  const [entwurf, setEntwurf] = useState<Form | null>(null);
  const entwurfRef = useRef<Form | null>(null);
  entwurfRef.current = entwurf;

  const [textDialog, setTextDialog] = useState<{ x: number; y: number; id?: string; text: string } | null>(null);
  const [fotoZeigen, setFotoZeigen] = useState<Extract<Form, { typ: "foto" }> | null>(null);
  const fotoPos = useRef<{ x: number; y: number } | null>(null);
  const [massDialog, setMassDialog] = useState(false);
  const [massN, setMassN] = useState("");
  const [kalibrierStrecke, setKalibrierStrecke] = useState<number | null>(null);
  const [kalibrierMeter, setKalibrierMeter] = useState("");
  const [offline, setOffline] = useState(false);
  const [offlineLaeuft, setOfflineLaeuft] = useState(false);

  // ───────────── Laden ─────────────
  useEffect(() => {
    let aktivLaden = true;
    setInhalt(null);
    setFehler(null);
    setPdf(null);
    setGroesse(null);
    setSeite(1);
    setGeladen(false);
    setUndo([]);
    setRedo([]);
    (async () => {
      try {
        const [i, a] = await Promise.all([ladePlan(tab), ladeAnmerkungen(tab.key)]);
        if (!aktivLaden) return;
        setDaten(a.daten);
        setStatus(a.status);
        setGeladen(true);
        setInhalt(i);
        if (i.istPdf) {
          const lib = await pdfjs();
          const doc = await lib.getDocument({ data: new Uint8Array(await i.blob.arrayBuffer()) }).promise;
          if (!aktivLaden) return;
          setSeitenAnzahl(doc.numPages);
          setPdf(doc);
        } else {
          const url = URL.createObjectURL(i.blob);
          const img = new Image();
          await new Promise((res, rej) => {
            img.onload = res;
            img.onerror = () => rej(new Error("Bild lässt sich nicht anzeigen"));
            img.src = url;
          });
          if (!aktivLaden) return;
          setSeitenAnzahl(1);
          setBildUrl(url);
          setGroesse({ w: img.naturalWidth, h: img.naturalHeight });
        }
      } catch (e) {
        if (aktivLaden) setFehler((e as Error).message);
      }
    })();
    istOffline(tab.key).then((o) => aktivLaden && setOffline(o));
    return () => {
      aktivLaden = false;
    };
  }, [tab.key]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => {
    if (bildUrl) URL.revokeObjectURL(bildUrl);
  }, [bildUrl]);

  useEffect(() => () => {
    pdf?.destroy?.();
  }, [pdf]);

  // Sync-Status aktuell halten (z. B. wenn im Hintergrund nachgeholt wurde)
  useEffect(
    () =>
      beiSyncAenderung(() => {
        if (!ungespeichert.current) syncStatus(tab.key).then(setStatus);
      }),
    [tab.key],
  );

  // ───────────── Ansicht ─────────────
  const anwenden = useCallback(() => {
    const { s, tx, ty } = view.current;
    const t = `translate(${tx}px, ${ty}px) scale(${s})`;
    if (untenRef.current) untenRef.current.style.transform = t;
    if (obenRef.current) obenRef.current.style.transform = t;
    if (scharfRef.current) scharfRef.current.style.visibility = "hidden";
  }, []);

  const einpassen = useCallback(() => {
    const box = boxRef.current;
    if (!box || !groesse) return;
    const cw = box.clientWidth, ch = box.clientHeight;
    const s = Math.min(cw / groesse.w, ch / groesse.h) * 0.97;
    fitS.current = s;
    view.current = { s, tx: (cw - groesse.w * s) / 2, ty: (ch - groesse.h * s) / 2 };
    anwenden();
    setViewVersion((v) => v + 1);
  }, [groesse, anwenden]);

  useEffect(() => {
    einpassen();
  }, [einpassen]);

  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    let letzte = { w: box.clientWidth, h: box.clientHeight };
    const ro = new ResizeObserver(() => {
      const w = box.clientWidth, h = box.clientHeight;
      if (Math.abs(w - letzte.w) < 2 && Math.abs(h - letzte.h) < 2) return;
      letzte = { w, h };
      einpassen();
    });
    ro.observe(box);
    return () => ro.disconnect();
  }, [einpassen]);

  // Seite des PDFs: Größe + Grundbild
  useEffect(() => {
    if (!pdf) return;
    let ab = false;
    let task: any = null;
    (async () => {
      const p = await pdf.getPage(seite);
      if (ab) return;
      const vp1 = p.getViewport({ scale: 1 });
      setGroesse({ w: vp1.width, h: vp1.height });
      // Grundbild: höchstens ~5 Mio. Bildpunkte (Tablet-Grenze 16 Mio.)
      const k = Math.min(3, Math.sqrt(5_000_000 / (vp1.width * vp1.height)));
      grundK.current = k;
      const vp = p.getViewport({ scale: k });
      const c = grundRef.current;
      if (!c) return;
      c.width = Math.floor(vp.width);
      c.height = Math.floor(vp.height);
      task = p.render({ canvasContext: c.getContext("2d")!, viewport: vp, canvas: c } as any);
      await task.promise.catch(() => undefined);
      if (!ab) setViewVersion((v) => v + 1);
    })();
    return () => {
      ab = true;
      task?.cancel?.();
    };
  }, [pdf, seite]);

  // Scharfer Ausschnitt, wenn das Bild stillsteht
  useEffect(() => {
    if (!pdf || !groesse) return;
    let task: any = null;
    let ab = false;
    const timer = window.setTimeout(async () => {
      const c = scharfRef.current;
      const box = boxRef.current;
      if (!c || !box) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const { s, tx, ty } = view.current;
      if (s * dpr <= grundK.current * 1.05) {
        c.style.visibility = "hidden";
        return;
      }
      const p = await pdf.getPage(seite);
      if (ab) return;
      const cw = box.clientWidth, ch = box.clientHeight;
      const off = document.createElement("canvas");
      off.width = Math.floor(cw * dpr);
      off.height = Math.floor(ch * dpr);
      const vp = p.getViewport({ scale: s * dpr });
      task = p.render({
        canvasContext: off.getContext("2d")!,
        viewport: vp,
        canvas: off,
        transform: [1, 0, 0, 1, tx * dpr, ty * dpr],
      } as any);
      try {
        await task.promise;
      } catch {
        return;
      }
      if (ab) return;
      const v = view.current;
      if (v.s !== s || v.tx !== tx || v.ty !== ty) return;
      c.width = off.width;
      c.height = off.height;
      c.style.width = `${cw}px`;
      c.style.height = `${ch}px`;
      c.getContext("2d")!.drawImage(off, 0, 0);
      c.style.visibility = "visible";
    }, 180);
    return () => {
      ab = true;
      window.clearTimeout(timer);
      task?.cancel?.();
    };
  }, [viewVersion, pdf, seite, groesse]);

  const zoomUm = useCallback(
    (faktor: number, cx: number, cy: number) => {
      const v = view.current;
      const s = Math.max(fitS.current * 0.5, Math.min(v.s * faktor, Math.max(fitS.current * 40, 8)));
      const k = s / v.s;
      view.current = { s, tx: cx - (cx - v.tx) * k, ty: cy - (cy - v.ty) * k };
      anwenden();
    },
    [anwenden],
  );

  // Mausrad (nicht passiv, sonst scrollt die Seite)
  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    let t: number | null = null;
    const rad = (e: WheelEvent) => {
      e.preventDefault();
      const r = box.getBoundingClientRect();
      const f = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0018));
      zoomUm(f, e.clientX - r.left, e.clientY - r.top);
      if (t) window.clearTimeout(t);
      t = window.setTimeout(() => setViewVersion((v) => v + 1), 120);
    };
    box.addEventListener("wheel", rad, { passive: false });
    return () => box.removeEventListener("wheel", rad);
  }, [zoomUm]);

  // ───────────── Anmerkungen ändern / speichern ─────────────
  const speichernBald = useCallback(() => {
    ungespeichert.current = true;
    setStatus("speichert");
    if (speicherTimer.current) window.clearTimeout(speicherTimer.current);
    speicherTimer.current = window.setTimeout(async () => {
      speicherTimer.current = null;
      const st = await speichereAnmerkungen(tab.key, datenRef.current, {
        baustelleId: tab.baustelleId,
        dateiname: tab.dateiname,
      }).catch(() => "ausstehend" as SyncStatus);
      ungespeichert.current = false;
      setStatus(st);
    }, 600);
  }, [tab.key, tab.baustelleId, tab.dateiname]);

  // Beim Schließen/Wechseln sofort sichern
  useEffect(
    () => () => {
      if (speicherTimer.current) {
        window.clearTimeout(speicherTimer.current);
        void speichereAnmerkungen(tab.key, datenRef.current, { baustelleId: tab.baustelleId, dateiname: tab.dateiname });
      }
    },
    [tab.key, tab.baustelleId, tab.dateiname],
  );

  const aendern = useCallback(
    (fn: (d: AnmerkungsDaten) => AnmerkungsDaten) => {
      const alt = datenRef.current;
      const neu = fn(alt);
      if (neu === alt) return;
      setUndo((u) => [...u.slice(-99), alt]);
      setRedo([]);
      datenRef.current = neu;
      setDaten(neu);
      speichernBald();
    },
    [speichernBald],
  );
  const formen = daten.seiten[String(seite)] ?? [];
  const seitenFormenSetzen = (fn: (f: Form[]) => Form[]) =>
    aendern((d) => ({ ...d, seiten: { ...d.seiten, [String(seite)]: fn(d.seiten[String(seite)] ?? []) } }));

  const rueckgaengig = () => {
    if (!undo.length) return;
    const vorher = undo[undo.length - 1];
    const jetzt = datenRef.current;
    setUndo(undo.slice(0, -1));
    setRedo((r) => [...r, jetzt]);
    datenRef.current = vorher;
    setDaten(vorher);
    speichernBald();
  };
  const wiederholen = () => {
    if (!redo.length) return;
    const nach = redo[redo.length - 1];
    const jetzt = datenRef.current;
    setRedo(redo.slice(0, -1));
    setUndo((u) => [...u, jetzt]);
    datenRef.current = nach;
    setDaten(nach);
    speichernBald();
  };

  // Tastenkürzel nur in der aktiven Hälfte
  useEffect(() => {
    if (!aktiv) return;
    const taste = (e: KeyboardEvent) => {
      const ziel = e.target as HTMLElement;
      if (ziel?.closest?.("input, textarea, [contenteditable]")) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) wiederholen();
        else rueckgaengig();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
        e.preventDefault();
        wiederholen();
      } else if (e.key === "Escape" && entwurfRef.current) {
        setEntwurf(null);
      }
    };
    window.addEventListener("keydown", taste);
    return () => window.removeEventListener("keydown", taste);
  });

  // ───────────── Zeiger (Maus, Finger, Stift) ─────────────
  const zeiger = useRef(new Map<number, { x: number; y: number; typ: string }>());
  const stiftGesehen = useRef(false);
  const geste = useRef<
    | null
    | { art: "pan"; x0: number; y0: number; v0: View; t0: number; id: number; typ: string }
    | { art: "pinch"; d0: number; mx: number; my: number; v0: View }
    | { art: "zeichnen"; id: number; typ: string; x0: number; y0: number; bewegt: boolean; textId?: string; radiert?: Set<string> }
  >(null);

  const zuPlan = (clientX: number, clientY: number) => {
    const r = boxRef.current!.getBoundingClientRect();
    const { s, tx, ty } = view.current;
    return { x: (clientX - r.left - tx) / s, y: (clientY - r.top - ty) / s };
  };
  const tol = () => 10 / view.current.s;
  const linienBreite = () => staerke / view.current.s;

  const pinchStart = () => {
    const pts = [...zeiger.current.values()].slice(0, 2);
    const r = boxRef.current!.getBoundingClientRect();
    geste.current = {
      art: "pinch",
      d0: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1,
      mx: (pts[0].x + pts[1].x) / 2 - r.left,
      my: (pts[0].y + pts[1].y) / 2 - r.top,
      v0: { ...view.current },
    };
  };

  const gestenEnde = () => {
    setViewVersion((v) => v + 1);
  };

  const formUnter = (x: number, y: number, nurTyp?: Form["typ"]) => {
    for (let i = formen.length - 1; i >= 0; i--) {
      const f = formen[i];
      if (nurTyp && f.typ !== nurTyp) continue;
      if (trifft(f, x, y, tol())) return f;
    }
    return null;
  };

  const onPointerDown = (e: React.PointerEvent) => {
    onFokus();
    if (!groesse) return;
    if (e.pointerType === "pen") stiftGesehen.current = true;
    // Handballen: während der Stift zeichnet, zählen Finger gar nicht
    const g = geste.current;
    if (g?.art === "zeichnen" && g.typ === "pen" && e.pointerType === "touch") return;
    try {
      boxRef.current?.setPointerCapture?.(e.pointerId);
    } catch {
      /* Zeiger schon weg — egal */
    }
    zeiger.current.set(e.pointerId, { x: e.clientX, y: e.clientY, typ: e.pointerType });
    const finger = [...zeiger.current.values()].filter((z) => z.typ === "touch").length;
    if (e.pointerType === "touch" && finger >= 2) {
      // zweiter Finger → Zoomen; begonnener Fingerstrich verfällt
      if (g?.art === "zeichnen") setEntwurf(null);
      pinchStart();
      return;
    }
    const p = zuPlan(e.clientX, e.clientY);
    const nurBewegen =
      werkzeug === "hand" || e.button === 1 || (e.pointerType === "touch" && stiftGesehen.current);
    if (nurBewegen) {
      geste.current = { art: "pan", x0: e.clientX, y0: e.clientY, v0: { ...view.current }, t0: Date.now(), id: e.pointerId, typ: e.pointerType };
      return;
    }
    if (e.button !== 0 && e.pointerType === "mouse") return;
    geste.current = { art: "zeichnen", id: e.pointerId, typ: e.pointerType, x0: e.clientX, y0: e.clientY, bewegt: false };
    const basis = { id: neueId(), farbe, breite: linienBreite() };
    switch (werkzeug) {
      case "stift":
        setEntwurf({ ...basis, typ: "stift", punkte: [p.x, p.y] });
        break;
      case "pfeil":
      case "rechteck":
      case "wolke":
      case "laenge":
        setEntwurf({ ...basis, typ: werkzeug, x1: p.x, y1: p.y, x2: p.x, y2: p.y });
        break;
      case "kalibrieren":
        setEntwurf({ ...basis, farbe: "#0ea5e9", typ: "laenge", x1: p.x, y1: p.y, x2: p.x, y2: p.y });
        break;
      case "text": {
        const t = formUnter(p.x, p.y, "text");
        if (t) (geste.current as any).textId = t.id;
        break;
      }
      case "foto": {
        // Maus: Dateiauswahl schon beim Drücken öffnen — nur dann gilt der
        // Klick sicher als Nutzeraktion (Finger/Stift: beim Loslassen).
        if (e.pointerType === "mouse" && !formUnter(p.x, p.y, "foto")) {
          fotoPos.current = p;
          (geste.current as any).fotoOffen = true;
          fotoInputRef.current?.click();
        }
        break;
      }
      case "radierer": {
        const set = new Set<string>();
        const f = formUnter(p.x, p.y);
        if (f) set.add(f.id);
        (geste.current as any).radiert = set;
        break;
      }
      default:
        break;
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!zeiger.current.has(e.pointerId)) return;
    zeiger.current.set(e.pointerId, { x: e.clientX, y: e.clientY, typ: e.pointerType });
    const g = geste.current;
    if (!g) return;
    if (g.art === "pinch") {
      const pts = [...zeiger.current.values()].filter((z) => z.typ === "touch").slice(0, 2);
      if (pts.length < 2) return;
      const r = boxRef.current!.getBoundingClientRect();
      const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1;
      const mx = (pts[0].x + pts[1].x) / 2 - r.left;
      const my = (pts[0].y + pts[1].y) / 2 - r.top;
      const s = Math.max(fitS.current * 0.5, Math.min(g.v0.s * (d / g.d0), Math.max(fitS.current * 40, 8)));
      // Der Planpunkt unter der Anfangsmitte bleibt unter den Fingern
      const px = (g.mx - g.v0.tx) / g.v0.s, py = (g.my - g.v0.ty) / g.v0.s;
      view.current = { s, tx: mx - px * s, ty: my - py * s };
      anwenden();
      return;
    }
    if (g.art === "pan") {
      if (e.pointerId !== g.id) return;
      view.current = { ...g.v0, tx: g.v0.tx + e.clientX - g.x0, ty: g.v0.ty + e.clientY - g.y0 };
      anwenden();
      return;
    }
    if (e.pointerId !== g.id) return;
    if (Math.hypot(e.clientX - g.x0, e.clientY - g.y0) > 4) g.bewegt = true;
    const p = zuPlan(e.clientX, e.clientY);
    if (werkzeug === "radierer") {
      const f = formUnter(p.x, p.y);
      if (f && g.radiert && !g.radiert.has(f.id)) {
        g.radiert.add(f.id);
        setViewVersion((v) => v + 1);
      }
      return;
    }
    if (werkzeug === "text" && g.textId && g.bewegt) {
      // Text verschieben (Vorschau über den Entwurf)
      const t = formen.find((f) => f.id === g.textId);
      if (t && t.typ === "text") {
        const a = zuPlan(g.x0, g.y0);
        setEntwurf({ ...t, x: t.x + p.x - a.x, y: t.y + p.y - a.y });
      }
      return;
    }
    const en = entwurfRef.current;
    if (!en) return;
    if (en.typ === "stift") {
      const n = en.punkte.length;
      if (Math.hypot(p.x - en.punkte[n - 2], p.y - en.punkte[n - 1]) * view.current.s < 1.5) return;
      // Stift: zusammengefasste Bewegungen mitnehmen (glattere Linie)
      const extra: number[] = [];
      const ev = e.nativeEvent as PointerEvent;
      const zus = typeof ev.getCoalescedEvents === "function" ? ev.getCoalescedEvents() : [];
      for (const c of zus.slice(0, -1)) {
        const q = zuPlan(c.clientX, c.clientY);
        extra.push(q.x, q.y);
      }
      setEntwurf({ ...en, punkte: [...en.punkte, ...extra, p.x, p.y] });
    } else if ("x2" in en) {
      setEntwurf({ ...en, x2: p.x, y2: p.y });
    }
  };

  const flaecheFertig = () => {
    const en = entwurfRef.current;
    if (!en || en.typ !== "flaeche") return;
    setEntwurf(null);
    if (en.punkte.length < 6) return;
    if (!datenRef.current.massstab) {
      toast({ title: "Maßstab fehlt", description: "Bitte zuerst den Maßstab einstellen oder eine bekannte Strecke kalibrieren." });
      setMassDialog(true);
    }
    seitenFormenSetzen((fs) => [...fs, en]);
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const war = zeiger.current.get(e.pointerId);
    zeiger.current.delete(e.pointerId);
    const g = geste.current;
    if (!g || !war) return;
    if (g.art === "pinch") {
      const rest = [...zeiger.current.values()].filter((z) => z.typ === "touch").length;
      if (rest < 2) {
        geste.current = null;
        gestenEnde();
      }
      return;
    }
    if (g.art === "pan") {
      if (e.pointerId !== g.id) return;
      geste.current = null;
      const dx = e.clientX - g.x0, dy = e.clientY - g.y0, dt = Date.now() - g.t0;
      // Wischen zum nächsten Plan: nur in der Gesamtansicht, schnell und waagrecht
      if (
        g.typ !== "mouse" &&
        g.v0.s <= fitS.current * 1.08 &&
        Math.abs(dx) > 70 &&
        Math.abs(dx) > Math.abs(dy) * 2 &&
        dt < 600
      ) {
        onWischen(dx < 0 ? 1 : -1);
        return;
      }
      // Antippen eines Foto-Pins
      if (Math.hypot(dx, dy) < 5) {
        const p = zuPlan(e.clientX, e.clientY);
        const f = formUnter(p.x, p.y, "foto");
        if (f && f.typ === "foto") setFotoZeigen(f);
      }
      gestenEnde();
      return;
    }
    if (e.pointerId !== g.id) return;
    geste.current = null;
    const p = zuPlan(e.clientX, e.clientY);
    switch (werkzeug) {
      case "radierer": {
        const ids = g.radiert ?? new Set();
        if (ids.size) seitenFormenSetzen((fs) => fs.filter((f) => !ids.has(f.id)));
        break;
      }
      case "text": {
        if (g.textId) {
          const t = formen.find((f) => f.id === g.textId);
          if (t && t.typ === "text") {
            if (g.bewegt && entwurfRef.current) {
              const neu = entwurfRef.current;
              seitenFormenSetzen((fs) => fs.map((f) => (f.id === t.id ? neu : f)));
            } else {
              setTextDialog({ x: t.x, y: t.y, id: t.id, text: t.text });
            }
          }
          setEntwurf(null);
        } else if (!g.bewegt) {
          setTextDialog({ x: p.x, y: p.y, text: "" });
        }
        break;
      }
      case "foto": {
        if (g.bewegt || (g as any).fotoOffen) break;
        const f = formUnter(p.x, p.y, "foto");
        if (f && f.typ === "foto") {
          setFotoZeigen(f);
          break;
        }
        fotoPos.current = p;
        fotoInputRef.current?.click();
        break;
      }
      case "flaeche": {
        if (g.bewegt) break;
        const en = entwurfRef.current;
        if (en && en.typ === "flaeche") {
          // Antippen des ersten Punkts schließt die Fläche
          if (en.punkte.length >= 6 && Math.hypot(p.x - en.punkte[0], p.y - en.punkte[1]) <= tol() * 1.5) {
            flaecheFertig();
          } else {
            setEntwurf({ ...en, punkte: [...en.punkte, p.x, p.y] });
          }
        } else {
          setEntwurf({ id: neueId(), farbe, breite: linienBreite(), typ: "flaeche", punkte: [p.x, p.y] });
        }
        break;
      }
      default: {
        const en = entwurfRef.current;
        if (!en) break;
        setEntwurf(null);
        if (en.typ === "stift") {
          const punkte = en.punkte.length === 2 ? [...en.punkte, en.punkte[0] + 0.01, en.punkte[1]] : en.punkte;
          seitenFormenSetzen((fs) => [...fs, { ...en, punkte }]);
        } else if ("x2" in en) {
          const lang = Math.hypot(en.x2 - en.x1, en.y2 - en.y1) * view.current.s;
          if (lang < 6) break;
          if (werkzeug === "kalibrieren") {
            setKalibrierStrecke(Math.hypot(en.x2 - en.x1, en.y2 - en.y1));
            setKalibrierMeter("");
            break;
          }
          if (en.typ === "laenge" && !datenRef.current.massstab) {
            toast({ title: "Maßstab fehlt", description: "Bitte zuerst den Maßstab einstellen oder eine bekannte Strecke kalibrieren." });
            setMassDialog(true);
          }
          seitenFormenSetzen((fs) => [...fs, en]);
        }
      }
    }
  };

  // Werkzeugwechsel bricht offene Entwürfe ab
  useEffect(() => {
    setEntwurf(null);
  }, [werkzeug, seite]);

  const fotoGewaehlt = async (file: File | undefined) => {
    const pos = fotoPos.current;
    fotoPos.current = null;
    if (!file || !pos) return;
    try {
      const bild = await fotoAlsDataUrl(file);
      seitenFormenSetzen((fs) => [
        ...fs,
        { id: neueId(), typ: "foto", x: pos.x, y: pos.y, bild, farbe: "#b0353c", breite: 3 / view.current.s },
      ]);
    } catch {
      toast({ variant: "destructive", title: "Foto konnte nicht gelesen werden" });
    }
  };

  const textSpeichern = () => {
    const td = textDialog;
    if (!td) return;
    setTextDialog(null);
    const text = td.text.trimEnd();
    if (td.id) {
      seitenFormenSetzen((fs) =>
        text ? fs.map((f) => (f.id === td.id && f.typ === "text" ? { ...f, text } : f)) : fs.filter((f) => f.id !== td.id),
      );
    } else if (text) {
      seitenFormenSetzen((fs) => [
        ...fs,
        { id: neueId(), typ: "text", x: td.x, y: td.y, text, farbe, breite: 1, groesse: (12 + staerke * 2) / view.current.s },
      ]);
    }
  };

  const massstabSetzen = (m: Massstab | null) => aendern((d) => ({ ...d, massstab: m }));

  // ───────────── Darstellung der Formen ─────────────
  const s = view.current.s;
  const zeichneForm = (f: Form, vorschau = false) => {
    const strich = { stroke: f.farbe, strokeWidth: f.breite, fill: "none", strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
    const masstabText = (t: string, x: number, y: number) => {
      const g = 13 / s;
      return (
        <text
          x={x}
          y={y}
          fontSize={g}
          fontWeight={700}
          fill={f.farbe}
          stroke="#fff"
          strokeWidth={g / 4}
          paintOrder="stroke"
          textAnchor="middle"
          style={{ userSelect: "none" }}
        >
          {t}
        </text>
      );
    };
    switch (f.typ) {
      case "stift": {
        let d = "";
        for (let i = 0; i < f.punkte.length; i += 2) d += `${i ? "L" : "M"}${f.punkte[i]} ${f.punkte[i + 1]}`;
        return <path key={f.id} d={d} {...strich} />;
      }
      case "pfeil": {
        const w = Math.atan2(f.y2 - f.y1, f.x2 - f.x1);
        const l = Math.max(f.breite * 5, 8 / s);
        return (
          <g key={f.id} {...strich}>
            <line x1={f.x1} y1={f.y1} x2={f.x2} y2={f.y2} />
            <polyline
              points={`${f.x2 - l * Math.cos(w - 0.45)},${f.y2 - l * Math.sin(w - 0.45)} ${f.x2},${f.y2} ${f.x2 - l * Math.cos(w + 0.45)},${f.y2 - l * Math.sin(w + 0.45)}`}
            />
          </g>
        );
      }
      case "rechteck":
        return (
          <rect key={f.id} x={Math.min(f.x1, f.x2)} y={Math.min(f.y1, f.y2)} width={Math.abs(f.x2 - f.x1)} height={Math.abs(f.y2 - f.y1)} {...strich} />
        );
      case "wolke": {
        const bogen = Math.max(f.breite * 6, 10 / s);
        return (
          <g key={f.id} {...strich}>
            {wolkenPunkte(f.x1, f.y1, f.x2, f.y2, bogen).map((b, i) => (
              <polyline key={i} points={b.reduce((a, v, j) => a + (j % 2 ? `,${v} ` : `${v}`), "")} />
            ))}
          </g>
        );
      }
      case "laenge": {
        const w = Math.atan2(f.y2 - f.y1, f.x2 - f.x1) + Math.PI / 2;
        const q = Math.max(f.breite * 4, 6 / s);
        const len = Math.hypot(f.x2 - f.x1, f.y2 - f.y1);
        const label = werkzeug === "kalibrieren" && vorschau ? "Bekannte Strecke" : laengeText(len, daten.massstab);
        return (
          <g key={f.id}>
            <g {...strich}>
              <line x1={f.x1} y1={f.y1} x2={f.x2} y2={f.y2} />
              {[[f.x1, f.y1], [f.x2, f.y2]].map(([px, py], i) => (
                <line key={i} x1={px - q * Math.cos(w)} y1={py - q * Math.sin(w)} x2={px + q * Math.cos(w)} y2={py + q * Math.sin(w)} />
              ))}
            </g>
            {masstabText(label, (f.x1 + f.x2) / 2, (f.y1 + f.y2) / 2 - 8 / s)}
          </g>
        );
      }
      case "flaeche": {
        const pts = f.punkte.reduce((a, v, j) => a + (j % 2 ? `,${v} ` : `${v}`), "");
        const n = f.punkte.length / 2;
        let cx = 0, cy = 0;
        for (let i = 0; i < n; i++) { cx += f.punkte[2 * i]; cy += f.punkte[2 * i + 1]; }
        return (
          <g key={f.id}>
            {vorschau ? (
              <polyline points={pts} {...strich} />
            ) : (
              <polygon points={pts} {...strich} fill={f.farbe} fillOpacity={0.15} />
            )}
            {vorschau &&
              Array.from({ length: n }).map((_, i) => (
                <circle key={i} cx={f.punkte[2 * i]} cy={f.punkte[2 * i + 1]} r={4 / s} fill={f.farbe} />
              ))}
            {!vorschau && n >= 3 && masstabText(flaecheText(polygonFlaeche(f.punkte), daten.massstab), cx / n, cy / n)}
          </g>
        );
      }
      case "text":
        return (
          <text key={f.id} x={f.x} y={f.y} fontSize={f.groesse} fill={f.farbe} fontFamily="Helvetica, Arial, sans-serif" style={{ userSelect: "none" }}>
            {f.text.split("\n").map((z, i) => (
              <tspan key={i} x={f.x} dy={i === 0 ? f.groesse * 0.85 : f.groesse * 1.2}>
                {z || " "}
              </tspan>
            ))}
          </text>
        );
      case "foto": {
        const nr = formen.filter((x) => x.typ === "foto").findIndex((x) => x.id === f.id) + 1;
        return (
          <g key={f.id} transform={`translate(${f.x} ${f.y}) scale(${1 / s})`} style={{ cursor: "pointer" }} data-foto-pin={nr}>
            <path d="M0 0 C -4 -10 -12 -14 -12 -22 A 12 12 0 1 1 12 -22 C 12 -14 4 -10 0 0 Z" fill="#b0353c" stroke="#fff" strokeWidth={2} />
            <text x={0} y={-17} fontSize={12} fontWeight={700} fill="#fff" textAnchor="middle" style={{ userSelect: "none" }}>
              {nr}
            </text>
          </g>
        );
      }
    }
  };

  const radiertIds = geste.current?.art === "zeichnen" ? geste.current.radiert : undefined;
  const sichtbareFormen = useMemo(
    () =>
      formen.filter((f) => {
        if (radiertIds?.has(f.id)) return false;
        if (entwurf && entwurf.id === f.id) return false; // Text wird gerade verschoben
        return true;
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [formen, entwurf, viewVersion],
  );

  const aktion = (): PlanAktion | null => (inhalt ? { tab, inhalt, daten: datenRef.current } : null);
  const anzahlAnmerkungen = Object.values(daten.seiten).reduce((a, f) => a + f.length, 0);

  const cursor =
    werkzeug === "hand" ? "grab" : werkzeug === "text" ? "text" : werkzeug === "radierer" ? "cell" : "crosshair";

  return (
    <div
      className={`relative flex flex-col h-full min-h-0 min-w-0 bg-neutral-200 ${aktiv ? "" : "opacity-[0.97]"}`}
      onPointerDownCapture={onFokus}
    >
      {/* Werkzeugleiste */}
      <div className="flex items-center gap-1 px-1.5 py-1 bg-background border-b overflow-x-auto shrink-0 [scrollbar-width:thin]">
        {WERKZEUGE.map(({ w, icon: I, label }) => (
          <Button
            key={w}
            size="icon"
            variant={werkzeug === w ? "default" : "ghost"}
            className="h-9 w-9 shrink-0"
            title={label}
            aria-label={label}
            aria-pressed={werkzeug === w}
            onClick={() => setWerkzeug(w)}
          >
            <I className="h-4 w-4" />
          </Button>
        ))}
        <div className="w-px h-6 bg-border mx-0.5 shrink-0" />
        <Popover>
          <PopoverTrigger asChild>
            <Button size="icon" variant="ghost" className="h-9 w-9 shrink-0" title="Farbe und Strichstärke" aria-label="Farbe und Strichstärke">
              <span className="h-5 w-5 rounded-full border-2 border-white shadow ring-1 ring-black/20" style={{ background: farbe }} />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-56 p-3 space-y-3" align="start">
            <div className="flex gap-2 flex-wrap">
              {FARBEN.map((f) => (
                <button
                  key={f}
                  className={`h-8 w-8 rounded-full border-2 ${farbe === f ? "border-foreground" : "border-transparent"}`}
                  style={{ background: f }}
                  onClick={() => setFarbe(f)}
                  aria-label={`Farbe ${f}`}
                />
              ))}
            </div>
            <div className="flex gap-2">
              {STAERKEN.map((st) => (
                <button
                  key={st}
                  className={`flex-1 h-9 rounded border flex items-center justify-center ${staerke === st ? "border-primary bg-primary/10" : ""}`}
                  onClick={() => setStaerke(st)}
                  aria-label={`Strichstärke ${st}`}
                >
                  <span className="rounded-full bg-foreground" style={{ width: 24, height: st }} />
                </button>
              ))}
            </div>
          </PopoverContent>
        </Popover>
        <Button size="icon" variant="ghost" className="h-9 w-9 shrink-0" title="Rückgängig" aria-label="Rückgängig" disabled={!undo.length} onClick={rueckgaengig}>
          <Undo2 className="h-4 w-4" />
        </Button>
        <Button size="icon" variant="ghost" className="h-9 w-9 shrink-0" title="Wiederholen" aria-label="Wiederholen" disabled={!redo.length} onClick={wiederholen}>
          <Redo2 className="h-4 w-4" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="h-9 w-9 shrink-0"
          title={ebeneSichtbar ? "Anmerkungen ausblenden" : "Anmerkungen einblenden"}
          aria-label={ebeneSichtbar ? "Anmerkungen ausblenden" : "Anmerkungen einblenden"}
          onClick={() => setEbeneSichtbar(!ebeneSichtbar)}
        >
          {ebeneSichtbar ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="h-9 w-9 shrink-0"
          title="Maßstab"
          aria-label="Maßstab"
          onClick={() => {
            setMassN(daten.massstab?.quelle === "massstab" && daten.massstab.n ? String(daten.massstab.n) : "");
            setMassDialog(true);
          }}
        >
          <Scaling className="h-4 w-4" />
        </Button>
        <Button size="icon" variant="ghost" className="h-9 w-9 shrink-0" title="Ganzer Plan" aria-label="Ganzer Plan" onClick={einpassen}>
          <Maximize2 className="h-4 w-4" />
        </Button>
        <div className="flex-1" />
        <span
          className="shrink-0 inline-flex items-center gap-1 text-[11px] text-muted-foreground px-1"
          title={status === "synchronisiert" ? "Anmerkungen gespeichert" : status === "speichert" ? "Wird gespeichert…" : "Noch nicht hochgeladen — wird nachgeholt, sobald Netz da ist"}
          data-sync={status}
        >
          {status === "synchronisiert" ? (
            <Check className="h-3.5 w-3.5 text-green-600" />
          ) : status === "speichert" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <CloudOff className="h-3.5 w-3.5 text-amber-600" />
          )}
          <span className="hidden sm:inline">
            {status === "synchronisiert" ? "synchronisiert" : status === "speichert" ? "speichert" : "ausstehend"}
          </span>
        </span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="icon" variant="ghost" className="h-9 w-9 shrink-0" aria-label="Weitere Aktionen" disabled={!inhalt}>
              <EllipsisVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            <DropdownMenuItem onClick={() => { const a = aktion(); if (a) onKopieSpeichern(a); }}>
              <Save className="h-4 w-4 mr-2" /> Als Kopie speichern
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => { const a = aktion(); if (a) onLinkTeilen(a); }}>
              <Share2 className="h-4 w-4 mr-2" /> SharePoint-Link teilen
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => { const a = aktion(); if (a) onPerMail(a, false); }}>
              <Share2 className="h-4 w-4 mr-2" /> Plan per E-Mail senden
            </DropdownMenuItem>
            <DropdownMenuItem disabled={anzahlAnmerkungen === 0} onClick={() => { const a = aktion(); if (a) onPerMail(a, true); }}>
              <Share2 className="h-4 w-4 mr-2" /> Mit Anmerkungen per E-Mail
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {offline ? (
              <DropdownMenuItem
                onClick={async () => {
                  await offlineEntfernen(tab.key);
                  setOffline(false);
                  toast({ title: "Offline-Fassung entfernt", description: "In SharePoint bleibt alles, wie es ist." });
                }}
              >
                <HardDriveDownload className="h-4 w-4 mr-2" /> Offline-Fassung entfernen
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem
                disabled={offlineLaeuft}
                onClick={async () => {
                  setOfflineLaeuft(true);
                  try {
                    await offlineSpeichern(tab);
                    setOffline(true);
                    toast({ title: "Offline gespeichert", description: "Der Plan geht jetzt auch ohne Netz." });
                  } catch (e) {
                    toast({ variant: "destructive", title: "Offline speichern fehlgeschlagen", description: (e as Error).message });
                  } finally {
                    setOfflineLaeuft(false);
                  }
                }}
              >
                <HardDriveDownload className="h-4 w-4 mr-2" /> Offline speichern
              </DropdownMenuItem>
            )}
            <DropdownMenuItem
              onClick={() => {
                if (!inhalt) return;
                const url = URL.createObjectURL(inhalt.blob);
                dateiHerunterladen(url, tab.dateiname);
                window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
              }}
            >
              <Download className="h-4 w-4 mr-2" /> Herunterladen
            </DropdownMenuItem>
            {inhalt?.webUrl && (
              <DropdownMenuItem onClick={() => window.open(inhalt.webUrl!, "_blank", "noopener")}>
                <ExternalLink className="h-4 w-4 mr-2" /> In SharePoint öffnen
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Zeichenfläche */}
      <div
        ref={boxRef}
        className="relative flex-1 min-h-0 overflow-hidden select-none"
        style={{ touchAction: "none", cursor }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onContextMenu={(e) => e.preventDefault()}
        data-testid="plan-flaeche"
      >
        {fehler ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-center p-6 text-sm">
            <CloudOff className="h-8 w-8 text-muted-foreground" />
            <div className="font-medium">Plan konnte nicht geladen werden</div>
            <div className="text-muted-foreground max-w-sm">{fehler}</div>
          </div>
        ) : !groesse || !geladen ? (
          <div className="absolute inset-0 flex items-center justify-center text-muted-foreground text-sm">
            <Loader2 className="h-5 w-5 animate-spin mr-2" /> Plan wird geladen…
          </div>
        ) : null}
        <div
          ref={untenRef}
          className="absolute left-0 top-0 origin-top-left bg-white shadow-lg"
          style={{ width: groesse?.w ?? 0, height: groesse?.h ?? 0, visibility: groesse ? "visible" : "hidden" }}
        >
          {inhalt?.istPdf ? (
            <canvas ref={grundRef} style={{ width: "100%", height: "100%", display: "block" }} />
          ) : bildUrl ? (
            <img src={bildUrl} alt={tab.dateiname} draggable={false} style={{ width: "100%", height: "100%", display: "block" }} />
          ) : null}
        </div>
        <canvas ref={scharfRef} className="absolute left-0 top-0 pointer-events-none" style={{ visibility: "hidden" }} />
        <div
          ref={obenRef}
          className="absolute left-0 top-0 origin-top-left pointer-events-none"
          style={{ width: groesse?.w ?? 0, height: groesse?.h ?? 0 }}
        >
          {groesse && (
            <svg
              width={groesse.w}
              height={groesse.h}
              viewBox={`0 0 ${groesse.w} ${groesse.h}`}
              style={{ overflow: "visible", display: "block" }}
              data-testid="plan-ebene"
              data-anzahl={formen.length}
            >
              {ebeneSichtbar && sichtbareFormen.map((f) => zeichneForm(f))}
              {entwurf && zeichneForm(entwurf, true)}
            </svg>
          )}
        </div>

        {/* Seiten bei mehrseitigen PDFs */}
        {seitenAnzahl > 1 && (
          <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex items-center gap-1 bg-background/95 border rounded-full shadow px-1 py-0.5 text-xs">
            <Button size="icon" variant="ghost" className="h-8 w-8" disabled={seite <= 1} onClick={() => setSeite(seite - 1)} aria-label="Vorige Seite">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="tabular-nums px-1">
              Seite {seite} / {seitenAnzahl}
            </span>
            <Button size="icon" variant="ghost" className="h-8 w-8" disabled={seite >= seitenAnzahl} onClick={() => setSeite(seite + 1)} aria-label="Nächste Seite">
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        )}
        {entwurf?.typ === "flaeche" && (
          <div className="absolute top-2 left-1/2 -translate-x-1/2 flex items-center gap-1 bg-background/95 border rounded-full shadow px-2 py-1 text-xs">
            <span className="px-1">Eckpunkte antippen</span>
            <Button size="sm" className="h-7" disabled={entwurf.punkte.length < 6} onClick={flaecheFertig}>
              <Check className="h-3.5 w-3.5 mr-1" /> Fläche fertig
            </Button>
            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setEntwurf(null)} aria-label="Abbrechen">
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        )}
        {werkzeug === "kalibrieren" && (
          <div className="absolute top-2 left-1/2 -translate-x-1/2 bg-sky-50 border border-sky-200 text-sky-900 rounded-full shadow px-3 py-1 text-xs">
            Eine bekannte Strecke im Plan nachziehen
          </div>
        )}
        {inhalt?.ausSpeicher && (
          <div className="absolute bottom-2 right-2 inline-flex items-center gap-1 bg-amber-50 border border-amber-200 text-amber-900 rounded-full px-2 py-0.5 text-[11px]">
            <CloudUpload className="h-3 w-3" /> Offline-Fassung
          </div>
        )}
      </div>

      <input
        ref={fotoInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          void fotoGewaehlt(e.target.files?.[0]);
          e.target.value = "";
        }}
      />

      {/* Text eingeben / ändern */}
      <Dialog open={!!textDialog} onOpenChange={(o) => !o && setTextDialog(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{textDialog?.id ? "Text ändern" : "Text einfügen"}</DialogTitle>
          </DialogHeader>
          <Textarea
            autoFocus
            rows={3}
            value={textDialog?.text ?? ""}
            onChange={(e) => textDialog && setTextDialog({ ...textDialog, text: e.target.value })}
            placeholder="Text"
          />
          <p className="text-[11px] text-muted-foreground">
            Verschieben: mit dem Text-Werkzeug auf den Text drücken und ziehen. Leer lassen löscht den Text.
          </p>
          <DialogFooter className="flex-row gap-2">
            <Button variant="outline" className="flex-1" onClick={() => setTextDialog(null)}>
              Abbrechen
            </Button>
            <Button className="flex-1" onClick={textSpeichern}>
              Übernehmen
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Foto eines Pins */}
      <Dialog open={!!fotoZeigen} onOpenChange={(o) => !o && setFotoZeigen(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Foto</DialogTitle>
          </DialogHeader>
          {fotoZeigen && <img src={fotoZeigen.bild} alt="Foto zum Plan" className="max-h-[70vh] w-auto mx-auto rounded" />}
          <Input
            placeholder="Notiz zum Foto (optional)"
            defaultValue={fotoZeigen?.notiz ?? ""}
            key={fotoZeigen?.id}
            onBlur={(e) => {
              const id = fotoZeigen?.id;
              const notiz = e.target.value.trim();
              if (!id || notiz === (fotoZeigen?.notiz ?? "")) return;
              seitenFormenSetzen((fs) => fs.map((f) => (f.id === id && f.typ === "foto" ? { ...f, notiz } : f)));
            }}
          />
          <DialogFooter className="flex-row gap-2">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => {
                const id = fotoZeigen?.id;
                setFotoZeigen(null);
                if (id) seitenFormenSetzen((fs) => fs.filter((f) => f.id !== id));
              }}
            >
              Pin entfernen
            </Button>
            <Button className="flex-1" onClick={() => setFotoZeigen(null)}>
              Schließen
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Maßstab */}
      <Dialog open={massDialog} onOpenChange={setMassDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Maßstab für Messungen</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            {daten.massstab && (
              <div className="rounded border bg-muted/40 px-2 py-1.5 text-xs">
                Aktuell:{" "}
                {daten.massstab.quelle === "massstab"
                  ? `1:${daten.massstab.n}`
                  : "über bekannte Strecke kalibriert"}
              </div>
            )}
            {inhalt?.istPdf && (
              <div className="space-y-1.5">
                <div className="font-medium">Planmaßstab</div>
                <div className="flex items-center gap-2">
                  <span>1 :</span>
                  <Input
                    inputMode="numeric"
                    value={massN}
                    onChange={(e) => setMassN(e.target.value.replace(/[^\d]/g, ""))}
                    placeholder="z. B. 100"
                    className="h-9"
                  />
                  <Button
                    className="h-9"
                    disabled={!massN || Number(massN) <= 0}
                    onClick={() => {
                      const n = Number(massN);
                      massstabSetzen({ meterProEinheit: PUNKT_IN_METER * n, quelle: "massstab", n });
                      setMassDialog(false);
                    }}
                  >
                    Setzen
                  </Button>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Stimmt nur, wenn das PDF in Originalgröße gespeichert ist (z. B. A1-Plan als A1-PDF). Sicherer ist die bekannte Strecke.
                </p>
              </div>
            )}
            <div className="space-y-1.5">
              <div className="font-medium">Bekannte Strecke</div>
              <Button
                variant="outline"
                className="w-full"
                onClick={() => {
                  setMassDialog(false);
                  setWerkzeug("kalibrieren");
                }}
              >
                <Ruler className="h-4 w-4 mr-2" /> Strecke im Plan nachziehen
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Kalibrieren: wirkliche Länge */}
      <Dialog
        open={kalibrierStrecke !== null}
        onOpenChange={(o) => {
          if (!o) {
            setKalibrierStrecke(null);
            setWerkzeug("laenge");
          }
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Wie lang ist die Strecke in Wirklichkeit?</DialogTitle>
          </DialogHeader>
          <div className="flex items-center gap-2">
            <Input
              autoFocus
              inputMode="decimal"
              value={kalibrierMeter}
              onChange={(e) => setKalibrierMeter(e.target.value)}
              placeholder="z. B. 5,00"
              className="h-9"
            />
            <span className="text-sm">m</span>
          </div>
          <DialogFooter className="flex-row gap-2">
            <Button
              className="flex-1"
              disabled={!(Number(kalibrierMeter.replace(",", ".")) > 0)}
              onClick={() => {
                const m = Number(kalibrierMeter.replace(",", "."));
                if (kalibrierStrecke && m > 0) massstabSetzen({ meterProEinheit: m / kalibrierStrecke, quelle: "kalibriert" });
                setKalibrierStrecke(null);
                setWerkzeug("laenge");
                toast({ title: "Maßstab übernommen", description: "Länge und Fläche messen jetzt mit diesem Maßstab." });
              }}
            >
              Übernehmen
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
