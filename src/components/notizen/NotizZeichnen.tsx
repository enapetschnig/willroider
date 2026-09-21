/**
 * Zeichenfläche für Notizen — „wie GoodNotes“ (Wunsch 21.09.2026).
 *
 * Baut auf Excalidraw auf: Stift mit Druck (Apple Pencil), Marker,
 * Radierer, Formen, Pfeile, Text, Bilder, Lasso, Rückgängig, Zoom —
 * unendliche Fläche statt fester Seiten. Dazu von uns:
 *   - Plan oder Foto aus der Baustelle als Hintergrund einfügen (PDF wird
 *     seitenweise zu Bildern), darauf lässt sich zeichnen
 *   - Foto/PDF vom Gerät einfügen
 *   - Bild (PNG) und PDF herunterladen
 *   - Speichern in der Notiz (Szene + Vorschaubild) — sichtbar für alle
 *
 * Die Szene liegt in notizen.skizze (jsonb), das Vorschaubild unter
 * notizen-anhaenge/<notiz>/skizze.png.
 */

import { Suspense, lazy, useCallback, useEffect, useRef, useState } from "react";
import "@excalidraw/excalidraw/index.css";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { compressImage } from "@/lib/imageCompress";
import { SP_PREFIX, ladeSharePointDateien, sharePointDateiUrl } from "@/lib/sharepoint";
import { Download, FileText, Image as ImageIcon, Loader2, Save, X, MapPinned, Upload } from "lucide-react";

const ExcalidrawLazy = lazy(() =>
  import("@excalidraw/excalidraw").then((m) => ({ default: m.Excalidraw })),
);

// Typen bewusst locker — die Excalidraw-Typen sind tief verschachtelt und
// bringen für unsere paar Aufrufe nichts.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Api = any;

export type SkizzeDaten = {
  elements: unknown[];
  appState?: Record<string, unknown>;
  files?: Record<string, unknown>;
};

const MAX_BILD_BREITE = 1400;

export function NotizZeichnen({
  open,
  onOpenChange,
  notizId,
  titel,
  baustelleId,
  initial,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  notizId: string;
  titel: string;
  baustelleId: string | null;
  initial: SkizzeDaten | null;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [api, setApi] = useState<Api>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [planOffen, setPlanOffen] = useState(false);
  const dirtyRef = useRef(false);
  const geraetRef = useRef<HTMLInputElement>(null);

  // ── Speichern: Szene + Vorschau ───────────────────────────────────────
  const speichern = useCallback(async (): Promise<boolean> => {
    if (!api) return true;
    setBusy("speichern");
    try {
      const { exportToBlob } = await import("@excalidraw/excalidraw");
      const elements = (api.getSceneElements() as Array<Record<string, unknown>>).filter((e) => !e.isDeleted);
      const appState = api.getAppState() as Record<string, unknown>;
      const alleFiles = api.getFiles() as Record<string, unknown>;
      // Nur Bilder behalten, die noch verwendet werden.
      const genutzt = new Set(elements.map((e) => e.fileId as string | undefined).filter(Boolean));
      const files: Record<string, unknown> = {};
      for (const [id, f] of Object.entries(alleFiles)) if (genutzt.has(id)) files[id] = f;

      if (elements.length === 0) {
        await supabase.storage.from("notizen-anhaenge").remove([`${notizId}/skizze.png`]);
        const { error } = await supabase
          .from("notizen" as any)
          .update({ skizze: null, skizze_vorschau: null, skizze_am: null })
          .eq("id", notizId);
        if (error) throw error;
        dirtyRef.current = false;
        onSaved();
        return true;
      }

      const blob: Blob = await exportToBlob({
        elements: elements as any,
        appState: { ...appState, exportBackground: true, viewBackgroundColor: (appState.viewBackgroundColor as string) || "#ffffff" } as any,
        files: files as any,
        mimeType: "image/png",
        exportPadding: 24,
        maxWidthOrHeight: 1600,
      });
      const pfad = `${notizId}/skizze.png`;
      const { error: upErr } = await supabase.storage
        .from("notizen-anhaenge")
        .upload(pfad, blob, { contentType: "image/png", upsert: true });
      if (upErr) throw upErr;
      const { error } = await supabase
        .from("notizen" as any)
        .update({
          skizze: {
            elements,
            appState: { viewBackgroundColor: appState.viewBackgroundColor ?? "#ffffff" },
            files,
          },
          skizze_vorschau: pfad,
          skizze_am: new Date().toISOString(),
        })
        .eq("id", notizId);
      if (error) throw error;
      dirtyRef.current = false;
      onSaved();
      return true;
    } catch (e) {
      toast({ variant: "destructive", title: "Zeichnung nicht gespeichert", description: (e as Error).message });
      return false;
    } finally {
      setBusy(null);
    }
  }, [api, notizId, onSaved, toast]);

  // Alle 30 Sekunden sichern, wenn sich etwas getan hat.
  useEffect(() => {
    if (!open) return;
    const t = setInterval(() => {
      if (dirtyRef.current) void speichern();
    }, 30000);
    return () => clearInterval(t);
  }, [open, speichern]);

  const schliessen = async () => {
    if (dirtyRef.current) {
      const ok = await speichern();
      if (!ok && !window.confirm("Speichern hat nicht geklappt — trotzdem schließen? Änderungen gehen verloren.")) return;
    }
    onOpenChange(false);
  };

  // ── Bilder einfügen ───────────────────────────────────────────────────
  /** Fügt ein oder mehrere Bilder (DataURLs) untereinander als gesperrte
   *  Hintergründe ein — darauf wird gezeichnet. */
  const bilderEinfuegen = async (bilder: { dataURL: string; breite: number; hoehe: number; mimeType: string }[], sperren: boolean) => {
    if (!api || bilder.length === 0) return;
    const { convertToExcalidrawElements } = await import("@excalidraw/excalidraw");
    const vorhandene = api.getSceneElements() as Array<Record<string, number>>;
    // Unter dem bisherigen Inhalt anfangen.
    let y = vorhandene.length
      ? Math.max(...vorhandene.map((e) => (e.y ?? 0) + (e.height ?? 0))) + 60
      : 0;
    const files: Array<Record<string, unknown>> = [];
    const skeletons: Array<Record<string, unknown>> = [];
    for (const b of bilder) {
      const id = crypto.randomUUID().replace(/-/g, "");
      const faktor = Math.min(1, MAX_BILD_BREITE / b.breite);
      const w = Math.round(b.breite * faktor);
      const h = Math.round(b.hoehe * faktor);
      files.push({ id, dataURL: b.dataURL, mimeType: b.mimeType, created: Date.now() });
      skeletons.push({ type: "image", fileId: id, x: 0, y, width: w, height: h, locked: sperren });
      y += h + 40;
    }
    api.addFiles(files);
    const neu = convertToExcalidrawElements(skeletons as any);
    api.updateScene({ elements: [...api.getSceneElements(), ...neu] });
    api.scrollToContent(neu, { fitToContent: true, animate: false });
    dirtyRef.current = true;
  };

  const bildAusDatei = (f: File): Promise<{ dataURL: string; breite: number; hoehe: number; mimeType: string }> =>
    new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => {
        const img = new Image();
        img.onload = () => resolve({ dataURL: r.result as string, breite: img.naturalWidth, hoehe: img.naturalHeight, mimeType: f.type || "image/jpeg" });
        img.onerror = () => reject(new Error("Bild nicht lesbar"));
        img.src = r.result as string;
      };
      r.onerror = () => reject(new Error("Datei nicht lesbar"));
      r.readAsDataURL(f);
    });

  /** PDF → Seiten als Bilder (höchstens 8 Seiten, sonst wird die Szene zu schwer). */
  const pdfZuBildern = async (bytes: ArrayBuffer) => {
    const pdfjsLib = await import("pdfjs-dist");
    const workerUrl = (await import("pdfjs-dist/build/pdf.worker.mjs?url")).default;
    (pdfjsLib.GlobalWorkerOptions as any).workerSrc = workerUrl;
    const doc = await pdfjsLib.getDocument({ data: bytes }).promise;
    const seiten = Math.min(doc.numPages, 8);
    const out: { dataURL: string; breite: number; hoehe: number; mimeType: string }[] = [];
    for (let i = 1; i <= seiten; i++) {
      const page = await doc.getPage(i);
      const basis = page.getViewport({ scale: 1 });
      const scale = Math.min(2, 1800 / basis.width);
      const vp = page.getViewport({ scale });
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(vp.width);
      canvas.height = Math.ceil(vp.height);
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport: vp } as any).promise;
      out.push({ dataURL: canvas.toDataURL("image/jpeg", 0.85), breite: canvas.width, hoehe: canvas.height, mimeType: "image/jpeg" });
    }
    if (doc.numPages > seiten) toast({ title: `Nur die ersten ${seiten} von ${doc.numPages} Seiten eingefügt` });
    return out;
  };

  const dateiEinfuegen = async (f: File, sperren: boolean) => {
    setBusy("einfuegen");
    try {
      if (f.type === "application/pdf" || /\.pdf$/i.test(f.name)) {
        await bilderEinfuegen(await pdfZuBildern(await f.arrayBuffer()), sperren);
      } else if (f.type.startsWith("image/")) {
        const klein = await compressImage(f);
        await bilderEinfuegen([await bildAusDatei(klein)], sperren);
      } else {
        toast({ variant: "destructive", title: "Nur Bilder oder PDF" });
      }
    } catch (e) {
      toast({ variant: "destructive", title: "Einfügen fehlgeschlagen", description: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };

  // ── Herunterladen ─────────────────────────────────────────────────────
  const alsBild = async () => {
    if (!api) return;
    setBusy("export");
    try {
      const { exportToBlob } = await import("@excalidraw/excalidraw");
      const blob: Blob = await exportToBlob({
        elements: api.getSceneElements(),
        appState: { ...api.getAppState(), exportBackground: true },
        files: api.getFiles(),
        mimeType: "image/png",
        exportPadding: 24,
      });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${titel || "Notiz"}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    } catch (e) {
      toast({ variant: "destructive", title: "Export fehlgeschlagen", description: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };

  const alsPdf = async () => {
    if (!api) return;
    setBusy("export");
    try {
      const { exportToBlob } = await import("@excalidraw/excalidraw");
      const { default: jsPDF } = await import("jspdf");
      const blob: Blob = await exportToBlob({
        elements: api.getSceneElements(),
        appState: { ...api.getAppState(), exportBackground: true },
        files: api.getFiles(),
        mimeType: "image/png",
        exportPadding: 24,
        maxWidthOrHeight: 3000,
      });
      const dataURL = await new Promise<string>((res) => {
        const r = new FileReader();
        r.onload = () => res(r.result as string);
        r.readAsDataURL(blob);
      });
      const img = new Image();
      await new Promise((res) => { img.onload = res; img.src = dataURL; });
      const quer = img.width > img.height;
      const doc = new jsPDF({ orientation: quer ? "landscape" : "portrait", unit: "mm", format: "a4" });
      const pw = doc.internal.pageSize.getWidth() - 20;
      const ph = doc.internal.pageSize.getHeight() - 20;
      const f = Math.min(pw / img.width, ph / img.height);
      doc.addImage(dataURL, "PNG", 10, 10, img.width * f, img.height * f);
      doc.save(`${titel || "Notiz"}.pdf`);
    } catch (e) {
      toast({ variant: "destructive", title: "PDF fehlgeschlagen", description: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? onOpenChange(true) : void schliessen())}>
      <DialogContent className="max-w-[100vw] w-screen h-[100dvh] p-0 gap-0 rounded-none border-0 flex flex-col [&>button]:hidden">
        <DialogTitle className="sr-only">Zeichnen</DialogTitle>
        <div className="flex items-center gap-2 px-2 sm:px-3 py-1.5 border-b bg-background shrink-0 flex-wrap">
          <div className="font-semibold text-sm truncate min-w-0 flex-1">{titel || "Notiz"}</div>
          <input
            ref={geraetRef}
            type="file"
            accept="image/*,application/pdf"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void dateiEinfuegen(f, true);
              e.target.value = "";
            }}
          />
          <Button size="sm" variant="outline" className="h-8" onClick={() => setPlanOffen(true)} disabled={!api || !!busy}>
            <MapPinned className="h-3.5 w-3.5 sm:mr-1.5" />
            <span className="hidden sm:inline">Plan / Foto aus Baustelle</span>
          </Button>
          <Button size="sm" variant="outline" className="h-8" onClick={() => geraetRef.current?.click()} disabled={!api || !!busy}>
            <Upload className="h-3.5 w-3.5 sm:mr-1.5" />
            <span className="hidden sm:inline">Vom Gerät</span>
          </Button>
          <Button size="sm" variant="outline" className="h-8" onClick={alsBild} disabled={!api || !!busy} title="Als Bild herunterladen">
            <ImageIcon className="h-3.5 w-3.5 sm:mr-1.5" />
            <span className="hidden sm:inline">Bild</span>
          </Button>
          <Button size="sm" variant="outline" className="h-8" onClick={alsPdf} disabled={!api || !!busy} title="Als PDF herunterladen">
            <FileText className="h-3.5 w-3.5 sm:mr-1.5" />
            <span className="hidden sm:inline">PDF</span>
          </Button>
          <Button size="sm" className="h-8" onClick={schliessen} disabled={!!busy}>
            {busy === "speichern" ? <Loader2 className="h-3.5 w-3.5 sm:mr-1.5 animate-spin" /> : <Save className="h-3.5 w-3.5 sm:mr-1.5" />}
            <span className="hidden sm:inline">Speichern & schließen</span>
            <X className="h-3.5 w-3.5 sm:hidden" />
          </Button>
        </div>
        <div className="flex-1 min-h-0 relative">
          {busy === "einfuegen" && (
            <div className="absolute inset-0 z-20 bg-background/60 flex items-center justify-center text-sm">
              <Loader2 className="h-4 w-4 animate-spin mr-2" /> Wird eingefügt…
            </div>
          )}
          <Suspense
            fallback={
              <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin mr-2" /> Zeichenfläche lädt…
              </div>
            }
          >
            <ExcalidrawLazy
              excalidrawAPI={(a: Api) => setApi(a)}
              langCode="de-DE"
              initialData={{
                elements: (initial?.elements ?? []) as any,
                appState: { viewBackgroundColor: (initial?.appState?.viewBackgroundColor as string) ?? "#ffffff", currentItemFontFamily: 1 },
                files: (initial?.files ?? {}) as any,
                scrollToContent: true,
              }}
              onChange={() => {
                dirtyRef.current = true;
              }}
              UIOptions={{
                canvasActions: {
                  loadScene: false,
                  saveToActiveFile: false,
                  export: false,
                  saveAsImage: false,
                  clearCanvas: true,
                  changeViewBackgroundColor: true,
                  toggleTheme: false,
                },
                tools: { image: true },
              }}
            />
          </Suspense>
        </div>
      </DialogContent>

      <PlanAuswahl
        open={planOffen}
        onOpenChange={setPlanOffen}
        baustelleId={baustelleId}
        onDatei={(f) => {
          setPlanOffen(false);
          void dateiEinfuegen(f, true);
        }}
      />
    </Dialog>
  );
}

// ── Plan/Foto aus der Baustelle wählen ───────────────────────────────────
type Auswahl = { id: string; name: string; mimetype: string | null; quelle: "app" | "sp"; storage_path?: string; groesse: number | null };

function PlanAuswahl({
  open,
  onOpenChange,
  baustelleId,
  onDatei,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  baustelleId: string | null;
  onDatei: (f: File) => void;
}) {
  const { toast } = useToast();
  const [liste, setListe] = useState<Auswahl[]>([]);
  const [laden, setLaden] = useState(false);
  const [suche, setSuche] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !baustelleId) return;
    setLaden(true);
    (async () => {
      const [{ data: docs }, sp] = await Promise.all([
        supabase.from("dokumente").select("id, dateiname, mimetype, storage_path, groesse").eq("baustelle_id", baustelleId),
        ladeSharePointDateien(baustelleId, true),
      ]);
      const passt = (m: string | null, n: string) => (m ?? "").startsWith("image/") || m === "application/pdf" || /\.(pdf|png|jpe?g|webp)$/i.test(n);
      const out: Auswahl[] = [];
      ((docs as any[]) ?? []).filter((d) => passt(d.mimetype, d.dateiname) && !d.sharepoint_item_id).forEach((d) =>
        out.push({ id: d.id, name: d.dateiname, mimetype: d.mimetype, quelle: "app", storage_path: d.storage_path, groesse: d.groesse }),
      );
      sp.filter((s) => passt(s.mimetype, s.dateiname)).forEach((s) =>
        out.push({ id: SP_PREFIX + s.id, name: `${s.sp_pfad}`, mimetype: s.mimetype, quelle: "sp", groesse: s.groesse }),
      );
      setListe(out.sort((a, b) => a.name.localeCompare(b.name, "de-AT")));
      setLaden(false);
    })();
  }, [open, baustelleId]);

  const holen = async (a: Auswahl) => {
    setBusy(a.id);
    try {
      let url: string | null = null;
      if (a.quelle === "app" && a.storage_path) {
        const { data } = await supabase.storage.from("baustellen").createSignedUrl(a.storage_path, 120);
        url = data?.signedUrl ?? null;
      } else {
        const z = await sharePointDateiUrl(a.id);
        url = z?.download_url ?? null;
      }
      if (!url) throw new Error("Datei nicht erreichbar");
      const blob = await (await fetch(url)).blob();
      const name = a.name.split("/").pop() ?? "datei";
      onDatei(new File([blob], name, { type: a.mimetype ?? blob.type }));
    } catch (e) {
      toast({ variant: "destructive", title: "Datei nicht geladen", description: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };

  const gefiltert = liste.filter((a) => a.name.toLowerCase().includes(suche.toLowerCase()));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogTitle>Plan oder Foto einfügen</DialogTitle>
        {!baustelleId ? (
          <div className="text-sm text-muted-foreground">
            Diese Notiz gehört zu keiner Baustelle. Oben in der Notiz eine Baustelle wählen, dann stehen ihre Pläne und Fotos hier.
          </div>
        ) : (
          <div className="space-y-2">
            <input
              value={suche}
              onChange={(e) => setSuche(e.target.value)}
              placeholder="Suchen…"
              className="w-full h-9 rounded-md border bg-background px-3 text-sm"
            />
            <div className="text-[11px] text-muted-foreground">
              PDF und Bilder aus dem Baustellenordner. Das Bild wird als Hintergrund eingefügt, darauf kannst du zeichnen.
            </div>
            {laden ? (
              <div className="text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Lade…</div>
            ) : gefiltert.length === 0 ? (
              <div className="text-sm text-muted-foreground">Keine Pläne oder Bilder gefunden.</div>
            ) : (
              <div className="max-h-[50vh] overflow-y-auto divide-y rounded border">
                {gefiltert.slice(0, 200).map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => holen(a)}
                    disabled={!!busy}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-muted/50 flex items-center gap-2 disabled:opacity-50"
                  >
                    {a.mimetype === "application/pdf" ? <FileText className="h-4 w-4 text-primary shrink-0" /> : <ImageIcon className="h-4 w-4 text-primary shrink-0" />}
                    <span className="flex-1 truncate">{a.name}</span>
                    {a.groesse ? <span className="text-[11px] text-muted-foreground">{Math.round(a.groesse / 1024)} KB</span> : null}
                    {busy === a.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4 text-muted-foreground" />}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
