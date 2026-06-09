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

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import {
  Loader2,
  Download,
  ExternalLink,
  FileWarning,
} from "lucide-react";

export interface DocViewerItem {
  bucket: string;
  storage_path: string;
  dateiname: string;
  mimetype?: string | null;
}

interface DocViewerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item: DocViewerItem | null;
}

type ViewKind = "image" | "pdf" | "office" | "text" | "other";

function detectKind(item: DocViewerItem): ViewKind {
  const mt = (item.mimetype ?? "").toLowerCase();
  const ext = (item.dateiname.split(".").pop() ?? "").toLowerCase();
  if (mt.startsWith("image/") || ["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"].includes(ext))
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
}: DocViewerDialogProps) {
  const { toast } = useToast();
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [textContent, setTextContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
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
    };
  }, [open, item, kind, toast]);

  const handleDownload = async () => {
    if (!item) return;
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

        <div className="flex-1 min-h-[60vh] bg-muted/30 overflow-hidden">
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
              <Button onClick={handleDownload} className="mt-1">
                <Download className="h-4 w-4 mr-2" />
                Herunterladen
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
