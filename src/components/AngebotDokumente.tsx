import { useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import {
  Upload,
  FileText,
  Image as ImageIcon,
  Trash2,
  Folder,
  FolderOpen,
  File as FileIcon,
  ArrowLeft,
  ChevronRight,
} from "lucide-react";
import type { Database, AngebotOrdnerEnum } from "@/integrations/supabase/types";
import {
  ANGEBOT_ORDNER,
  angebotOrdnerDef,
  type AngebotOrdnerKey,
} from "@/lib/angebotOrdner";
import {
  MAX_UPLOAD_BYTES,
  sanitizeStorageName,
} from "@/lib/uploadHelpers";

type Dokument = Database["public"]["Tables"]["angebot_dokumente"]["Row"];

function isImage(mimetype?: string | null) {
  return !!mimetype && mimetype.startsWith("image/");
}
function isPdf(mimetype?: string | null) {
  return !!mimetype && mimetype === "application/pdf";
}
function iconFor(key: AngebotOrdnerKey) {
  if (key === "plaene") return ImageIcon;
  return FileText;
}
function meta(key: string | null | undefined) {
  return angebotOrdnerDef(key) ?? ANGEBOT_ORDNER[3];
}

export function AngebotDokumente({ angebotId }: { angebotId: string }) {
  const { toast } = useToast();
  const [docs, setDocs] = useState<Dokument[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentFolder, setCurrentFolder] = useState<"root" | AngebotOrdnerKey>("root");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewName, setPreviewName] = useState<string>("");
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState<{
    name: string;
    idx: number;
    total: number;
  } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("angebot_dokumente")
      .select("*")
      .eq("angebot_id", angebotId)
      .order("created_at", { ascending: false });
    setDocs((data as Dokument[]) ?? []);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, [angebotId]);

  const folderStats = useMemo(() => {
    const stats: Record<string, { count: number; latest: string | null }> = {};
    ANGEBOT_ORDNER.forEach((f) => {
      stats[f.key] = { count: 0, latest: null };
    });
    docs.forEach((d) => {
      const k = d.ordner;
      if (!stats[k]) return;
      stats[k].count++;
      if (!stats[k].latest || d.created_at > stats[k].latest!) {
        stats[k].latest = d.created_at;
      }
    });
    return stats;
  }, [docs]);

  const filtered = useMemo(() => {
    if (currentFolder === "root") return [] as Dokument[];
    return docs.filter((d) => d.ordner === currentFolder);
  }, [docs, currentFolder]);

  const upload = async (
    files: FileList | File[] | null,
    folder: AngebotOrdnerKey
  ) => {
    if (!files || files.length === 0) return;
    const list = Array.from(files);
    const { data: u } = await supabase.auth.getUser();
    let success = 0;
    let skipped = 0;
    for (let i = 0; i < list.length; i++) {
      const file = list[i];
      if (file.size > MAX_UPLOAD_BYTES) {
        toast({
          variant: "destructive",
          title: `„${file.name}" zu groß`,
          description: `Maximal 50 MB pro Datei (${(file.size / 1024 / 1024).toFixed(1)} MB).`,
        });
        skipped++;
        continue;
      }
      setUploading({ name: file.name, idx: i + 1, total: list.length });
      const safeName = sanitizeStorageName(file.name);
      const path = `${angebotId}/${folder}/${Date.now()}_${safeName}`;
      const { error: upErr } = await supabase.storage
        .from("angebote")
        .upload(path, file, { contentType: file.type || undefined });
      if (upErr) {
        toast({
          variant: "destructive",
          title: `Upload-Fehler: ${file.name}`,
          description: upErr.message,
        });
        continue;
      }
      const { error: dbErr } = await supabase.from("angebot_dokumente").insert({
        angebot_id: angebotId,
        ordner: folder as AngebotOrdnerEnum,
        dateiname: file.name,
        storage_path: path,
        mimetype: file.type,
        groesse: file.size,
        hochgeladen_von: u.user?.id ?? null,
      });
      if (dbErr) {
        toast({
          variant: "destructive",
          title: "DB-Fehler",
          description: dbErr.message,
        });
        await supabase.storage.from("angebote").remove([path]);
        continue;
      }
      success++;
    }
    setUploading(null);
    if (success > 0) {
      toast({
        title: `${success} Datei${success > 1 ? "en" : ""} hochgeladen${
          skipped > 0 ? ` · ${skipped} übersprungen` : ""
        }`,
      });
      setCurrentFolder(folder);
    }
    load();
  };

  const openFile = async (d: Dokument) => {
    if (isImage(d.mimetype)) {
      const { data, error } = await supabase.storage
        .from("angebote")
        .createSignedUrl(d.storage_path, 300);
      if (error || !data) {
        toast({ variant: "destructive", title: "Fehler", description: error?.message });
        return;
      }
      setPreviewUrl(data.signedUrl);
      setPreviewName(d.dateiname);
    } else {
      const { data, error } = await supabase.storage
        .from("angebote")
        .createSignedUrl(d.storage_path, 300, { download: d.dateiname });
      if (error || !data) {
        toast({ variant: "destructive", title: "Fehler", description: error?.message });
        return;
      }
      window.open(data.signedUrl, "_blank");
    }
  };

  const remove = async (d: Dokument, e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (!confirm(`Datei "${d.dateiname}" löschen?`)) return;
    await supabase.storage.from("angebote").remove([d.storage_path]);
    await supabase.from("angebot_dokumente").delete().eq("id", d.id);
    toast({ title: "Datei gelöscht" });
    load();
  };

  const triggerUpload = () => fileRef.current?.click();

  const defaultDropFolder: AngebotOrdnerKey =
    currentFolder === "root" ? "angebotsunterlagen" : currentFolder;

  const onDragOver = (e: React.DragEvent) => {
    if (e.dataTransfer?.types?.includes("Files")) {
      e.preventDefault();
      setDragOver(true);
    }
  };
  const onDragLeave = (e: React.DragEvent) => {
    if (e.currentTarget === e.target) setDragOver(false);
  };
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const files = e.dataTransfer?.files;
    if (files && files.length > 0) upload(files, defaultDropFolder);
  };
  const dropOnFolder = (folder: AngebotOrdnerKey) => (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    const files = e.dataTransfer?.files;
    if (files && files.length > 0) upload(files, folder);
  };

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      const files = e.clipboardData?.files;
      if (!files || files.length === 0) return;
      e.preventDefault();
      upload(files, defaultDropFolder);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [angebotId, currentFolder]);

  return (
    <div
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={`space-y-3 relative rounded-lg transition ${
        dragOver ? "ring-2 ring-primary ring-offset-2 bg-primary/5" : ""
      }`}
    >
      {dragOver && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-lg bg-primary/10 border-2 border-dashed border-primary">
          <div className="text-center bg-background/95 px-4 py-3 rounded-md shadow">
            <Upload className="h-6 w-6 mx-auto mb-1 text-primary" />
            <div className="text-sm font-semibold">Dateien hier ablegen</div>
            <div className="text-[11px] text-muted-foreground">
              → Ordner: {meta(defaultDropFolder).label}
            </div>
          </div>
        </div>
      )}
      <input
        type="file"
        multiple
        ref={fileRef}
        className="hidden"
        onChange={(e) => {
          upload(e.target.files, defaultDropFolder);
          if (fileRef.current) fileRef.current.value = "";
        }}
      />

      {/* Breadcrumb / Header */}
      <div className="flex items-center gap-2 flex-wrap">
        {currentFolder === "root" ? (
          <div className="flex items-center gap-1.5 text-sm font-semibold">
            <FolderOpen className="h-4 w-4 text-primary" />
            Angebot-Dokumente
          </div>
        ) : (
          <>
            <Button
              variant="outline"
              size="sm"
              className="h-8"
              onClick={() => setCurrentFolder("root")}
            >
              <ArrowLeft className="h-4 w-4 mr-1" />
              Zurück
            </Button>
            <div className="flex items-center gap-1 text-sm">
              <button
                onClick={() => setCurrentFolder("root")}
                className="text-muted-foreground hover:text-foreground hover:underline"
              >
                Dokumente
              </button>
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
              <span
                className="font-semibold"
                style={{ color: meta(currentFolder).color }}
              >
                {meta(currentFolder).label}
              </span>
              <span className="text-xs text-muted-foreground ml-1">
                ({filtered.length})
              </span>
            </div>
          </>
        )}

        <div className="ml-auto">
          {currentFolder !== "root" && (
            <Button onClick={triggerUpload} variant="default" className="h-9">
              <Upload className="h-4 w-4 mr-2" />
              Hochladen
            </Button>
          )}
        </div>
      </div>

      {currentFolder === "root" && (
        <div className="text-[11px] text-muted-foreground -mt-1 px-1">
          Klicke auf einen Ordner oder ziehe Dateien direkt darauf. Auch{" "}
          <kbd className="px-1 py-0.5 rounded border bg-muted text-[10px]">Cmd/Strg+V</kbd>{" "}
          aus der Zwischenablage. Max. 50 MB pro Datei.
        </div>
      )}

      {/* Upload-Progress */}
      {uploading && (
        <div className="rounded-md border bg-primary/5 border-primary/20 px-3 py-2 flex items-center gap-2 text-xs">
          <Upload className="h-4 w-4 text-primary animate-pulse shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="font-medium truncate">{uploading.name}</div>
            <div className="text-[10px] text-muted-foreground">
              Datei {uploading.idx} von {uploading.total} wird hochgeladen…
            </div>
          </div>
        </div>
      )}

      {/* Inhalt */}
      {currentFolder === "root" ? (
        <Card>
          <CardContent className="p-0">
            {loading ? (
              <div className="p-6 text-center text-sm text-muted-foreground">
                Lädt…
              </div>
            ) : (
              <ul className="divide-y">
                {ANGEBOT_ORDNER.map((f) => {
                  const stats = folderStats[f.key] ?? { count: 0, latest: null };
                  return (
                    <FolderRow
                      key={f.key}
                      label={f.label}
                      color={f.color}
                      count={stats.count}
                      latest={stats.latest}
                      onOpen={() => setCurrentFolder(f.key)}
                      onDrop={dropOnFolder(f.key)}
                    />
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      ) : loading ? (
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            Lädt…
          </CardContent>
        </Card>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center space-y-2">
            <FolderOpen className="h-8 w-8 mx-auto text-muted-foreground opacity-50" />
            <div className="text-sm text-muted-foreground">
              Noch keine Dateien in {meta(currentFolder).label}.
            </div>
            <div className="text-xs text-muted-foreground">
              Dateien hierher ziehen oder oben rechts „Hochladen" klicken.
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 sm:gap-3">
          {filtered.map((d) => (
            <FileCard key={d.id} d={d} onOpen={() => openFile(d)} onDelete={(e) => remove(d, e)} />
          ))}
        </div>
      )}

      <Dialog open={!!previewUrl} onOpenChange={(o) => !o && setPreviewUrl(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="text-sm">{previewName}</DialogTitle>
          </DialogHeader>
          {previewUrl && (
            <img
              src={previewUrl}
              alt={previewName}
              className="w-full max-h-[70vh] object-contain rounded"
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function FolderRow({
  label,
  color,
  count,
  latest,
  onOpen,
  onDrop,
}: {
  label: string;
  color: string;
  count: number;
  latest: string | null;
  onOpen: () => void;
  onDrop: (e: React.DragEvent) => void;
}) {
  const [hover, setHover] = useState(false);
  return (
    <li
      onClick={onOpen}
      onDragOver={(e) => {
        if (e.dataTransfer?.types?.includes("Files")) {
          e.preventDefault();
          e.stopPropagation();
          setHover(true);
        }
      }}
      onDragLeave={() => setHover(false)}
      onDrop={(e) => {
        setHover(false);
        onDrop(e);
      }}
      className={`flex items-center gap-3 px-3 sm:px-4 py-2.5 cursor-pointer transition ${
        hover ? "bg-primary/10" : "hover:bg-muted/50"
      }`}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
    >
      <Folder className="h-5 w-5 shrink-0" style={{ color }} fill={color} fillOpacity={0.15} />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium truncate" style={{ color }}>
          {label}
        </div>
        <div className="text-[11px] text-muted-foreground">
          {count === 0
            ? "leer"
            : `${count} Datei${count > 1 ? "en" : ""}${
                latest ? ` · zuletzt ${new Date(latest).toLocaleDateString("de-AT")}` : ""
              }`}
        </div>
      </div>
      <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
    </li>
  );
}

function FileCard({
  d,
  onOpen,
  onDelete,
}: {
  d: Dokument;
  onOpen: () => void;
  onDelete: (e: React.MouseEvent) => void;
}) {
  const [thumb, setThumb] = useState<string | null>(null);
  const isImg = isImage(d.mimetype);
  const m = meta(d.ordner);

  useEffect(() => {
    if (!isImg) return;
    let active = true;
    supabase.storage
      .from("angebote")
      .createSignedUrl(d.storage_path, 600)
      .then(({ data }) => {
        if (active && data) setThumb(data.signedUrl);
      });
    return () => {
      active = false;
    };
  }, [d.storage_path, isImg]);

  return (
    <div className="group relative">
      <button
        onClick={onOpen}
        className="block w-full text-left rounded-md border bg-card overflow-hidden hover:shadow-md hover:border-primary/40 transition-all"
      >
        <div className="aspect-square bg-muted relative">
          {isImg && thumb ? (
            <img src={thumb} alt={d.dateiname} loading="lazy" className="h-full w-full object-cover" />
          ) : (
            <div className="h-full w-full flex flex-col items-center justify-center gap-1 p-2">
              {isPdf(d.mimetype) ? (
                <FileText className="h-10 w-10" style={{ color: m.color }} />
              ) : (
                <FileIcon className="h-10 w-10" style={{ color: m.color }} />
              )}
              <div className="text-[10px] uppercase font-bold tracking-wide" style={{ color: m.color }}>
                {(d.dateiname.split(".").pop() ?? "").slice(0, 4) || "FILE"}
              </div>
            </div>
          )}
        </div>
        <div className="p-2">
          <div className="text-xs font-medium truncate">{d.dateiname}</div>
          <div className="text-[10px] text-muted-foreground">
            {new Date(d.created_at).toLocaleDateString("de-AT")}
            {d.groesse ? ` · ${(d.groesse / 1024).toFixed(0)} KB` : ""}
          </div>
        </div>
      </button>
      <button
        onClick={onDelete}
        className="absolute top-1.5 right-1.5 bg-background/90 hover:bg-destructive hover:text-white rounded p-1.5 sm:opacity-0 sm:group-hover:opacity-100 opacity-100 transition shadow"
        aria-label="Löschen"
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </div>
  );
}
