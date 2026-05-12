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
  Camera,
  Upload,
  FileText,
  Image as ImageIcon,
  Trash2,
  FolderOpen,
  Folder,
  File as FileIcon,
  ArrowLeft,
  ChevronRight,
} from "lucide-react";
import type { Database } from "@/integrations/supabase/types";
import { useAuth } from "@/contexts/AuthContext";
import {
  BAUSTELLEN_ORDNER,
  DEFAULT_VISIBILITY,
  type OrdnerKey,
  type Visibility,
} from "@/lib/baustellenOrdner";

type Dokument = Database["public"]["Tables"]["dokumente"]["Row"];

// Wrapper für Icon-Auswahl analog zu vorher (alle FileText außer Fotos)
const FOLDERS = BAUSTELLEN_ORDNER.map((o) => ({
  ...o,
  icon: o.key === "fotos" ? ImageIcon : o.key === "92-sonstiges" ? FolderOpen : FileText,
}));

type FolderKey = OrdnerKey;

const MAX_UPLOAD_BYTES = 50 * 1024 * 1024; // 50 MB

// Storage-Pfad-sanitization: Umlaut-Translit, ASCII-only, mehrfach-_ kombiniert.
// Original-Dateiname bleibt in der DB-Spalte `dateiname` erhalten.
function sanitizeStorageName(name: string): string {
  const translit: Record<string, string> = {
    ä: "ae", ö: "oe", ü: "ue", Ä: "Ae", Ö: "Oe", Ü: "Ue", ß: "ss",
  };
  const ascii = name.replace(/[äöüÄÖÜß]/g, (c) => translit[c] ?? c);
  const safe = ascii.replace(/[^\w.-]+/g, "_").replace(/_+/g, "_");
  const trimmed = safe.replace(/^_+|_+$/g, "");
  if (!trimmed || trimmed === "." || trimmed === "..") {
    return `file-${Date.now()}`;
  }
  return trimmed.length > 120 ? trimmed.slice(0, 120) : trimmed;
}

function isImage(mimetype?: string | null) {
  return !!mimetype && mimetype.startsWith("image/");
}
function isPdf(mimetype?: string | null) {
  return !!mimetype && mimetype === "application/pdf";
}
function folderMeta(key: string | null | undefined) {
  return (
    FOLDERS.find((f) => f.key === (key ?? "92-sonstiges")) ??
    FOLDERS.find((f) => f.key === "92-sonstiges")!
  );
}

export function BaustelleDokumente({ baustelleId }: { baustelleId: string }) {
  const { toast } = useToast();
  const { role } = useAuth();
  const [docs, setDocs] = useState<Dokument[]>([]);
  const [loading, setLoading] = useState(true);
  // "root" = Ordner-Übersicht (Listenansicht), sonst = im Ordner drin
  const [currentFolder, setCurrentFolder] = useState<"root" | FolderKey>("root");
  const [uploadFolder, setUploadFolder] = useState<FolderKey>("fotos");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewName, setPreviewName] = useState<string>("");
  const [visibility, setVisibility] = useState<Visibility>(DEFAULT_VISIBILITY);
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState<{
    name: string;
    idx: number;
    total: number;
  } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Sichtbare Ordner anhand Rolle + DB-Settings filtern
  const visibleFolders = useMemo(() => {
    const r = role ?? "mitarbeiter";
    const allowed = visibility[r] ?? DEFAULT_VISIBILITY[r] ?? DEFAULT_VISIBILITY.mitarbeiter;
    const allowedSet = new Set(allowed);
    return FOLDERS.filter((f) => allowedSet.has(f.key));
  }, [role, visibility]);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("dokumente")
      .select("*")
      .eq("baustelle_id", baustelleId)
      .order("created_at", { ascending: false });
    setDocs((data as Dokument[]) ?? []);
    setLoading(false);
  };

  // Visibility-Settings laden (einmalig)
  useEffect(() => {
    supabase
      .from("app_settings")
      .select("value")
      .eq("key", "ordner_visibility")
      .maybeSingle()
      .then(({ data }) => {
        if (data?.value) setVisibility(data.value as Visibility);
      });
  }, []);

  useEffect(() => {
    load();
  }, [baustelleId]);

  // upload-Folder zurücksetzen falls aktueller Default nicht erlaubt
  useEffect(() => {
    if (visibleFolders.length === 0) return;
    if (!visibleFolders.some((f) => f.key === uploadFolder)) {
      setUploadFolder(visibleFolders[0].key);
    }
  }, [visibleFolders]);

  // Wenn im aktuellen Ordner kein Recht mehr → zurück zur Wurzel
  useEffect(() => {
    if (currentFolder === "root") return;
    if (!visibleFolders.some((f) => f.key === currentFolder)) {
      setCurrentFolder("root");
    }
  }, [visibleFolders, currentFolder]);

  // Letzte hochgeladene Datei pro Ordner (für „aktualisiert" Datum in Liste)
  const folderStats = useMemo(() => {
    const stats: Record<string, { count: number; latest: string | null }> = {};
    visibleFolders.forEach((f) => {
      stats[f.key] = { count: 0, latest: null };
    });
    docs.forEach((d) => {
      const k = (d.ordner ?? "92-sonstiges") as OrdnerKey;
      if (!stats[k]) return;
      stats[k].count++;
      if (!stats[k].latest || d.created_at > stats[k].latest) {
        stats[k].latest = d.created_at;
      }
    });
    return stats;
  }, [docs, visibleFolders]);

  // Dateien im aktuellen Ordner
  const filtered = useMemo(() => {
    if (currentFolder === "root") return [] as Dokument[];
    return docs.filter((d) => (d.ordner ?? "92-sonstiges") === currentFolder);
  }, [docs, currentFolder]);

  const upload = async (
    files: FileList | File[] | null,
    folder: FolderKey
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
      const path = `${baustelleId}/${folder}/${Date.now()}_${safeName}`;
      const { error: upErr } = await supabase.storage
        .from("baustellen")
        .upload(path, file, { contentType: file.type || undefined });
      if (upErr) {
        toast({
          variant: "destructive",
          title: `Upload-Fehler: ${file.name}`,
          description: upErr.message,
        });
        continue;
      }
      const { error: dbErr } = await supabase.from("dokumente").insert({
        baustelle_id: baustelleId,
        ordner: folder,
        dateiname: file.name,
        storage_path: path,
        mimetype: file.type,
        groesse: file.size,
        hochgeladen_von: u.user?.id ?? null,
      } as any);
      if (dbErr) {
        toast({
          variant: "destructive",
          title: "DB-Fehler",
          description: dbErr.message,
        });
        // Storage-Datei wieder entfernen, damit kein Waisenrest bleibt
        await supabase.storage.from("baustellen").remove([path]);
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
      // direkt in den Ordner springen, damit die Datei sichtbar ist
      setCurrentFolder(folder);
    }
    load();
  };

  const open = async (d: Dokument) => {
    // Bilder ohne `download`-Param → werden inline angezeigt.
    // Andere Dateien mit `download: d.dateiname` → Browser nimmt den
    // Original-Filename (inkl. Umlauten) für den Download.
    if (isImage(d.mimetype)) {
      const { data, error } = await supabase.storage
        .from("baustellen")
        .createSignedUrl(d.storage_path, 300);
      if (error || !data) {
        toast({ variant: "destructive", title: "Fehler", description: error?.message });
        return;
      }
      setPreviewUrl(data.signedUrl);
      setPreviewName(d.dateiname);
    } else {
      const { data, error } = await supabase.storage
        .from("baustellen")
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
    await supabase.storage.from("baustellen").remove([d.storage_path]);
    await supabase.from("dokumente").delete().eq("id", d.id);
    toast({ title: "Datei gelöscht" });
    load();
  };

  const triggerCamera = () => {
    setUploadFolder("fotos");
    cameraRef.current?.click();
  };

  const triggerUpload = () => {
    // In der Ordner-Ansicht → in diesen Ordner. In Wurzel → fotos als Default.
    setUploadFolder(currentFolder === "root" ? "fotos" : currentFolder);
    fileRef.current?.click();
  };

  // Aktueller Drop-Target-Ordner (z.B. für Paste oder globalen Drop)
  const defaultDropFolder: FolderKey =
    currentFolder === "root" ? "fotos" : currentFolder;

  // Drag&Drop für die gesamte Component
  const onDragOver = (e: React.DragEvent) => {
    if (e.dataTransfer?.types?.includes("Files")) {
      e.preventDefault();
      setDragOver(true);
    }
  };
  const onDragLeave = (e: React.DragEvent) => {
    // Nur leaven wenn wir wirklich den Wrapper verlassen (nicht ein Kind-Element)
    if (e.currentTarget === e.target) setDragOver(false);
  };
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const files = e.dataTransfer?.files;
    if (files && files.length > 0) upload(files, defaultDropFolder);
  };

  // Drop direkt auf eine Filter-Pill → in genau diesen Ordner uploaden
  const dropOnFolder = (folder: FolderKey) => (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    const files = e.dataTransfer?.files;
    if (files && files.length > 0) upload(files, folder);
  };

  // Paste aus Zwischenablage (z.B. Screenshot)
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      // Nicht hijacken, wenn der User gerade in einem Input/Textarea tippt
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
  }, [baustelleId, currentFolder]);

  return (
    <div
      ref={wrapperRef}
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
              → Ordner: {folderMeta(defaultDropFolder).label}
            </div>
          </div>
        </div>
      )}
      <input
        type="file"
        accept="image/*"
        capture="environment"
        ref={cameraRef}
        className="hidden"
        onChange={(e) => {
          upload(e.target.files, "fotos");
          if (cameraRef.current) cameraRef.current.value = "";
        }}
      />
      <input
        type="file"
        multiple
        ref={fileRef}
        className="hidden"
        onChange={(e) => {
          upload(e.target.files, uploadFolder);
          if (fileRef.current) fileRef.current.value = "";
        }}
      />

      {/* Breadcrumb / Header-Zeile */}
      <div className="flex items-center gap-2 flex-wrap">
        {currentFolder === "root" ? (
          <div className="flex items-center gap-1.5 text-sm font-semibold">
            <FolderOpen className="h-4 w-4 text-primary" />
            Dokumente
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
                style={{ color: folderMeta(currentFolder).color }}
              >
                {folderMeta(currentFolder).label}
              </span>
              <span className="text-xs text-muted-foreground ml-1">
                ({filtered.length})
              </span>
            </div>
          </>
        )}

        <div className="ml-auto flex items-center gap-2">
          {currentFolder === "fotos" || currentFolder === "root" ? (
            <Button onClick={triggerCamera} variant="default" className="h-9">
              <Camera className="h-4 w-4 mr-2" />
              Foto aufnehmen
            </Button>
          ) : null}
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
          Klicke auf einen Ordner, um die Inhalte zu sehen — oder ziehe Dateien
          direkt auf einen Ordner. Auch{" "}
          <kbd className="px-1 py-0.5 rounded border bg-muted text-[10px]">Cmd/Strg+V</kbd>{" "}
          aus der Zwischenablage. Max. 50 MB pro Datei.
        </div>
      )}

      {/* Upload-Progress-Banner */}
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

      {/* Inhalt: Wurzel = Ordner-Liste, sonst = Datei-Grid */}
      {currentFolder === "root" ? (
        <Card>
          <CardContent className="p-0">
            {loading ? (
              <div className="p-6 text-center text-sm text-muted-foreground">
                Lädt…
              </div>
            ) : visibleFolders.length === 0 ? (
              <div className="p-6 text-center text-sm text-muted-foreground">
                Keine Ordner sichtbar für deine Rolle.
              </div>
            ) : (
              <ul className="divide-y">
                {visibleFolders.map((f) => {
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
              Noch keine Dateien in {folderMeta(currentFolder).label}.
            </div>
            <div className="text-xs text-muted-foreground">
              Dateien hierher ziehen oder oben rechts „Hochladen" klicken.
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 sm:gap-3">
          {filtered.map((d) => (
            <FileCard key={d.id} d={d} onOpen={() => open(d)} onDelete={(e) => remove(d, e)} />
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
  const meta = folderMeta(d.ordner);

  useEffect(() => {
    if (!isImg) return;
    let active = true;
    supabase.storage
      .from("baustellen")
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
        {/* Visual */}
        <div className="aspect-square bg-muted relative">
          {isImg && thumb ? (
            <img src={thumb} alt={d.dateiname} loading="lazy" className="h-full w-full object-cover" />
          ) : (
            <div className="h-full w-full flex flex-col items-center justify-center gap-1 p-2">
              {isPdf(d.mimetype) ? (
                <FileText className="h-10 w-10" style={{ color: meta.color }} />
              ) : (
                <FileIcon className="h-10 w-10" style={{ color: meta.color }} />
              )}
              <div className="text-[10px] uppercase font-bold tracking-wide" style={{ color: meta.color }}>
                {(d.dateiname.split(".").pop() ?? "").slice(0, 4) || "FILE"}
              </div>
            </div>
          )}
          {/* Folder badge */}
          <div
            className="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase tracking-wide text-white shadow"
            style={{ background: meta.color }}
          >
            {meta.label}
          </div>
        </div>
        {/* Meta */}
        <div className="p-2">
          <div className="text-xs font-medium truncate">{d.dateiname}</div>
          <div className="text-[10px] text-muted-foreground">
            {new Date(d.created_at).toLocaleDateString("de-AT")}
            {d.groesse ? ` · ${(d.groesse / 1024).toFixed(0)} KB` : ""}
          </div>
        </div>
      </button>
      {/* Delete */}
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
