/**
 * Inline-Viewer für Dokumente aus Supabase Storage.
 *
 *  - Bilder            → `<img>` mit Zoom
 *  - PDF               → `<iframe>` mit der Signed-URL
 *  - DOCX/XLSX/PPTX    → Microsoft Office Online Viewer
 *                        (`view.officeapps.live.com/op/embed.aspx?src=…`).
 *                        Voraussetzung: die Signed-URL muss vom Office-
 *                        Server abrufbar sein → wir verwenden eine länger
 *                        gültige Signed-URL (5 min) und prozentual
 *                        kodieren sie.
 *  - TXT/CSV/HTML/JSON → Inhalt als Text holen und in `<pre>` zeigen
 *  - sonst             → Download-Button als Fallback
 *
 * Alle Datei-Typen können zusätzlich heruntergeladen oder in einem neuen
 * Tab geöffnet werden.
 */

import { useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { istHeic, ladeBildAlsBrowserBlob } from "@/lib/heic";
import { useToast } from "@/hooks/use-toast";
import {
  Loader2,
  Download,
  ExternalLink,
  FileWarning,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";

export interface DocViewerItem {
  bucket: string;
  storage_path: string;
  dateiname: string;
  mimetype?: string | null;
  /** Fertige Adresse statt Storage — für Dateien, die in SharePoint liegen. */
  direkt_url?: string | null;
  /** Adresse für „Download" — bei Office das unveränderte Original. */
  download_url?: string | null;
  /** Datei in SharePoint öffnen — für Pläne (.dwg, .ifc …), die kein Browser zeigt. */
  web_url?: string | null;
}

interface DocViewerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item: DocViewerItem | null;
  /** Vorige/nächste Datei der Liste (z. B. Fotos im Bericht) — Pfeile, Tasten ← →, Wischen. */
  onVorher?: (() => void) | null;
  onWeiter?: (() => void) | null;
  /** z. B. „3 / 5“ */
  position?: string | null;
}

type ViewKind = "image" | "pdf" | "office" | "text" | "other";

function detectKind(item: DocViewerItem): ViewKind {
  const mt = (item.mimetype ?? "").toLowerCase();
  const ext = (item.dateiname.split(".").pop() ?? "").toLowerCase();
  // Word und Excel aus SharePoint kommen bereits als PDF zum Ansehen —
  // dann zählt die Art des Inhalts, nicht die Endung des Namens.
  if (item.direkt_url && mt === "application/pdf") return "pdf";
  if (mt.startsWith("image/") || ["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "heic", "heif"].includes(ext))
    return "image";
  if (mt === "application/pdf" || ext === "pdf") return "pdf";
  if (
    [
      "doc",
      "docx",
      "xls",
      "xlsx",
      "ppt",
      "pptx",
      "odt",
      "ods",
      "odp",
    ].includes(ext)
  )
    return "office";
  if (
    mt.startsWith("text/") ||
    ["txt", "csv", "log", "md", "html", "htm", "xml", "json", "yml", "yaml"].includes(ext)
  )
    return "text";
  return "other";
}

export function DocViewerDialog({
  open,
  onOpenChange,
  item,
  onVorher,
  onWeiter,
  position,
}: DocViewerDialogProps) {
  const { toast } = useToast();
  const wischStart = useRef<{ x: number; y: number } | null>(null);

  // Pfeiltasten am PC: ← vorige, → nächste Datei
  useEffect(() => {
    if (!open || (!onVorher && !onWeiter)) return;
    const taste = (e: KeyboardEvent) => {
      const ziel = e.target as HTMLElement | null;
      if (ziel && (ziel.tagName === "INPUT" || ziel.tagName === "TEXTAREA" || ziel.isContentEditable)) return;
      if (e.key === "ArrowLeft" && onVorher) {
        e.preventDefault();
        onVorher();
      } else if (e.key === "ArrowRight" && onWeiter) {
        e.preventDefault();
        onWeiter();
      }
    };
    window.addEventListener("keydown", taste);
    return () => window.removeEventListener("keydown", taste);
  }, [open, onVorher, onWeiter]);
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [textContent, setTextContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  /** Adresse des zwischengespeicherten Inhalts — muss wieder freigegeben werden. */
  const blobUrl = useRef<string | null>(null);
  const kind = item ? detectKind(item) : "other";

  useEffect(() => {
    if (!open || !item) {
      setSignedUrl(null);
      setTextContent(null);
      return;
    }
    let active = true;
    setLoading(true);
    setSignedUrl(null);
    setTextContent(null);

    (async () => {
      // Office-Viewer braucht eine länger erreichbare URL (Microsoft holt
      // sie serverseitig). 10 min sollten reichen, der User schließt
      // den Dialog sowieso vorher.
      const ttl = kind === "office" ? 600 : 300;
      // Dateien aus SharePoint kommen mit „als Anhang herunterladen" —
      // damit zeigt ein iframe nichts an. Deshalb den Inhalt einmal holen
      // und aus dem Speicher anzeigen.
      if (item.direkt_url) {
        try {
          const antwort = await fetch(item.direkt_url);
          if (!antwort.ok) throw new Error(`Status ${antwort.status}`);
          const blob = await antwort.blob();
          if (!active) return;
          const objektUrl = URL.createObjectURL(blob);
          blobUrl.current = objektUrl;
          setSignedUrl(objektUrl);
          if (kind === "text") setTextContent(await blob.text());
          setLoading(false);
        } catch (e) {
          if (!active) return;
          toast({
            variant: "destructive",
            title: "Vorschau-Fehler",
            description: (e as Error).message,
          });
          setLoading(false);
        }
        return;
      }
      const { data, error } = await supabase.storage
        .from(item.bucket)
        .createSignedUrl(item.storage_path, ttl);
      if (!active) return;
      if (error || !data) {
        toast({
          variant: "destructive",
          title: "Vorschau-Fehler",
          description: error?.message ?? "Datei nicht erreichbar.",
        });
        setLoading(false);
        return;
      }
      if (kind === "image" && (istHeic(item.dateiname) || istHeic(item.mimetype) || istHeic(item.storage_path))) {
        // HEIC (Handy-Format) zeigt Chrome/Edge nicht an → im Browser in JPG umwandeln
        const blob = await ladeBildAlsBrowserBlob(data.signedUrl, "image/heic");
        if (!active) return;
        if (blob) {
          const objektUrl = URL.createObjectURL(blob);
          blobUrl.current = objektUrl;
          setSignedUrl(objektUrl);
        } else {
          toast({ variant: "destructive", title: "Vorschau-Fehler", description: "Foto konnte nicht umgewandelt werden." });
          setSignedUrl(data.signedUrl);
        }
        setLoading(false);
        return;
      }
      setSignedUrl(data.signedUrl);

      if (kind === "text") {
        try {
          const res = await fetch(data.signedUrl);
          const txt = await res.text();
          if (active) setTextContent(txt);
        } catch {
          /* ignore */
        }
      }
      if (active) setLoading(false);
    })();

    return () => {
      active = false;
      if (blobUrl.current) {
        URL.revokeObjectURL(blobUrl.current);
        blobUrl.current = null;
      }
    };
  }, [open, item, kind, toast]);

  const handleDownload = async () => {
    if (!item) return;
    if (item.direkt_url || item.download_url) {
      const a = document.createElement("a");
      a.href = item.download_url ?? item.direkt_url!;
      a.download = item.dateiname;
      a.rel = "noopener";
      a.target = "_blank";
      document.body.appendChild(a);
      a.click();
      a.remove();
      return;
    }
    const { data, error } = await supabase.storage
      .from(item.bucket)
      .createSignedUrl(item.storage_path, 60, { download: item.dateiname });
    if (error || !data) {
      toast({
        variant: "destructive",
        title: "Download fehlgeschlagen",
        description: error?.message,
      });
      return;
    }
    window.open(data.signedUrl, "_blank");
  };

  const officeUrl =
    kind === "office" && signedUrl
      ? `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(signedUrl)}`
      : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl w-[95vw] max-h-[92vh] p-0 flex flex-col gap-0">
        <DialogHeader className="px-4 py-3 border-b flex flex-row items-center justify-between gap-2 space-y-0">
          <DialogTitle className="text-sm font-semibold truncate flex-1">
            {position && (
              <span className="mr-2 text-muted-foreground font-normal" data-testid="viewer-position">
                {position}
              </span>
            )}
            {item?.dateiname ?? "Dokument"}
          </DialogTitle>
          <div className="flex items-center gap-1.5 shrink-0">
            {signedUrl && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => window.open(signedUrl, "_blank")}
                className="h-8"
              >
                <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
                Neuer Tab
              </Button>
            )}
            {item?.web_url && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => window.open(item.web_url!, "_blank", "noopener")}
                className="h-8"
              >
                <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
                In SharePoint
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              onClick={handleDownload}
              className="h-8"
            >
              <Download className="h-3.5 w-3.5 mr-1.5" />
              Download
            </Button>
          </div>
        </DialogHeader>

        <div
          className="relative flex-1 min-h-[60vh] bg-muted/30 overflow-hidden"
          onTouchStart={(e) => {
            if (e.touches.length !== 1) {
              wischStart.current = null;
              return;
            }
            wischStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
          }}
          onTouchEnd={(e) => {
            const start = wischStart.current;
            wischStart.current = null;
            if (!start || e.changedTouches.length !== 1) return;
            const dx = e.changedTouches[0].clientX - start.x;
            const dy = e.changedTouches[0].clientY - start.y;
            // nur deutliches waagrechtes Wischen zählt
            if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
            if (dx < 0) onWeiter?.();
            else onVorher?.();
          }}
        >
          {onVorher && (
            <button
              type="button"
              onClick={onVorher}
              aria-label="Vorige Datei"
              title="Vorige (←)"
              className="absolute left-2 top-1/2 -translate-y-1/2 z-10 h-12 w-12 rounded-full bg-black/50 text-white flex items-center justify-center hover:bg-black/70"
            >
              <ChevronLeft className="h-7 w-7" />
            </button>
          )}
          {onWeiter && (
            <button
              type="button"
              onClick={onWeiter}
              aria-label="Nächste Datei"
              title="Nächste (→)"
              className="absolute right-2 top-1/2 -translate-y-1/2 z-10 h-12 w-12 rounded-full bg-black/50 text-white flex items-center justify-center hover:bg-black/70"
            >
              <ChevronRight className="h-7 w-7" />
            </button>
          )}
          {loading || !signedUrl ? (
            <div className="h-full min-h-[60vh] flex items-center justify-center text-muted-foreground">
              <Loader2 className="h-6 w-6 animate-spin mr-2" />
              Vorschau wird geladen…
            </div>
          ) : kind === "image" ? (
            <div className="h-full overflow-auto p-3 flex items-center justify-center bg-black/5">
              <img
                src={signedUrl}
                alt={item?.dateiname ?? ""}
                className="max-h-full max-w-full object-contain"
              />
            </div>
          ) : kind === "pdf" ? (
            <iframe
              src={signedUrl}
              title={item?.dateiname ?? "PDF"}
              className="w-full h-[80vh] border-0"
            />
          ) : kind === "office" && officeUrl ? (
            <iframe
              src={officeUrl}
              title={item?.dateiname ?? "Office-Datei"}
              className="w-full h-[80vh] border-0"
              referrerPolicy="no-referrer"
            />
          ) : kind === "text" ? (
            <pre className="text-xs p-4 max-h-[80vh] overflow-auto whitespace-pre-wrap bg-background m-3 rounded border">
              {textContent ?? "(leer)"}
            </pre>
          ) : (
            <div className="h-full min-h-[40vh] flex flex-col items-center justify-center gap-3 text-center p-6">
              <FileWarning className="h-10 w-10 text-muted-foreground" />
              <div className="text-sm font-medium">
                Vorschau für diesen Dateityp nicht verfügbar
              </div>
              <div className="text-xs text-muted-foreground max-w-md">
                Datei herunterladen oder in einem neuen Tab öffnen, um sie mit
                der passenden Anwendung anzuzeigen.
              </div>
              <div className="flex flex-wrap justify-center gap-2 mt-1">
                {item?.web_url && (
                  <Button variant="outline" onClick={() => window.open(item.web_url!, "_blank", "noopener")}>
                    <ExternalLink className="h-4 w-4 mr-2" />
                    In SharePoint öffnen
                  </Button>
                )}
                <Button onClick={handleDownload}>
                  <Download className="h-4 w-4 mr-2" />
                  Herunterladen
                </Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
