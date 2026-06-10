import { useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogFooter,
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
  FolderPlus,
  File as FileIcon,
  ArrowLeft,
  ChevronRight,
  Home,
  Mail,
} from "lucide-react";
import { DocViewerDialog, type DocViewerItem } from "@/components/dokumente/DocViewerDialog";
import { DocSendDialog, type DocSendItem } from "@/components/dokumente/DocSendDialog";
import { Thumbnail } from "@/components/dokumente/Thumbnail";
import type { Database } from "@/integrations/supabase/types";
import { useAuth } from "@/contexts/AuthContext";
import {
  BAUSTELLEN_ORDNER,
  DEFAULT_VISIBILITY,
  type OrdnerKey,
  type Visibility,
} from "@/lib/baustellenOrdner";
import {
  MAX_UPLOAD_BYTES,
  sanitizeStorageName,
  joinSubpath,
  sanitizeFolderName,
  getDirectSubfolders,
  readDropFiles,
} from "@/lib/uploadHelpers";

// Einheitliche, dezente Folder-Farbe (Windows-Yellow)
const FOLDER_COLOR = "#eab308";

type Dokument = Database["public"]["Tables"]["dokumente"]["Row"];
type OrdnerMarker = Database["public"]["Tables"]["dokument_ordner"]["Row"];

// Wrapper für Icon-Auswahl analog zu vorher (alle FileText außer Fotos)
const FOLDERS = BAUSTELLEN_ORDNER.map((o) => ({
  ...o,
  icon: o.key === "fotos" ? ImageIcon : o.key === "92-sonstiges" ? FolderOpen : FileText,
}));

type FolderKey = OrdnerKey;

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
  const [folderMarkers, setFolderMarkers] = useState<OrdnerMarker[]>([]);
  const [loading, setLoading] = useState(true);
  // "root" = Top-Level-Übersicht (alle 14 Ordner). Sonst = im Ordner drin.
  const [currentFolder, setCurrentFolder] = useState<"root" | FolderKey>("root");
  const [currentSubpath, setCurrentSubpath] = useState<string>(""); // Unterordner-Pfad
  const [uploadFolder, setUploadFolder] = useState<FolderKey>("fotos");
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [viewerItem, setViewerItem] = useState<DocViewerItem | null>(null);
  const [sendItems, setSendItems] = useState<DocSendItem[] | null>(null);
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
    const [d, m] = await Promise.all([
      supabase
        .from("dokumente")
        .select("*")
        .eq("baustelle_id", baustelleId)
        .order("created_at", { ascending: false }),
      supabase
        .from("dokument_ordner")
        .select("*")
        .eq("baustelle_id", baustelleId),
    ]);
    setDocs((d.data as Dokument[]) ?? []);
    setFolderMarkers((m.data as OrdnerMarker[]) ?? []);
    setLoading(false);
  };

  // Subpath zurücksetzen, wenn der Top-Level-Ordner wechselt
  useEffect(() => {
    setCurrentSubpath("");
  }, [currentFolder]);

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

  // Letzte hochgeladene Datei pro Top-Level-Ordner (für „aktualisiert" Datum in Wurzel)
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

  // Dateien im aktuellen Top-Folder + Subpath (exakt)
  const filtered = useMemo(() => {
    if (currentFolder === "root") return [] as Dokument[];
    return docs.filter(
      (d) =>
        (d.ordner ?? "92-sonstiges") === currentFolder &&
        (d.subpath ?? "") === currentSubpath
    );
  }, [docs, currentFolder, currentSubpath]);

  // Direkte Unterordner im aktuellen Pfad (aus Files + leeren Folder-Markern)
  const subfolders = useMemo(() => {
    if (currentFolder === "root") return [];
    const allSubpaths: (string | null)[] = [];
    docs.forEach((d) => {
      if ((d.ordner ?? "92-sonstiges") === currentFolder) allSubpaths.push(d.subpath);
    });
    folderMarkers.forEach((m) => {
      if (m.ordner === currentFolder) allSubpaths.push(m.subpath);
    });
    return getDirectSubfolders(allSubpaths, currentSubpath);
  }, [docs, folderMarkers, currentFolder, currentSubpath]);

  // Statistik pro Unterordner (Anzahl darunter, latest)
  const subfolderStats = useMemo(() => {
    if (currentFolder === "root") return {} as Record<string, { count: number; latest: string | null }>;
    const stats: Record<string, { count: number; latest: string | null }> = {};
    subfolders.forEach((s) => (stats[s] = { count: 0, latest: null }));
    const prefix = currentSubpath ? currentSubpath + "/" : "";
    docs.forEach((d) => {
      if ((d.ordner ?? "92-sonstiges") !== currentFolder) return;
      const sp = d.subpath ?? "";
      if (currentSubpath && !sp.startsWith(prefix)) return;
      if (!currentSubpath && !sp) return;
      const rest = currentSubpath ? sp.slice(prefix.length) : sp;
      const first = rest.split("/")[0];
      if (!first || !stats[first]) return;
      stats[first].count++;
      if (!stats[first].latest || d.created_at > stats[first].latest!) {
        stats[first].latest = d.created_at;
      }
    });
    return stats;
  }, [docs, subfolders, currentFolder, currentSubpath]);

  type UploadItem = { file: File; subpath: string };

  const uploadItems = async (items: UploadItem[], folder: FolderKey) => {
    if (items.length === 0) return;
    const { data: u } = await supabase.auth.getUser();
    let success = 0;
    let skipped = 0;
    for (let i = 0; i < items.length; i++) {
      const { file, subpath } = items[i];
      if (file.size > MAX_UPLOAD_BYTES) {
        toast({
          variant: "destructive",
          title: `„${file.name}" zu groß`,
          description: `Maximal 50 MB pro Datei (${(file.size / 1024 / 1024).toFixed(1)} MB).`,
        });
        skipped++;
        continue;
      }
      setUploading({ name: file.name, idx: i + 1, total: items.length });
      const safeName = sanitizeStorageName(file.name);
      const sub = subpath ? subpath.split("/").map(sanitizeFolderName).filter(Boolean).join("/") : "";
      const subStorageSegment = sub ? `${sub}/` : "";
      const path = `${baustelleId}/${folder}/${subStorageSegment}${Date.now()}_${safeName}`;
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
        subpath: sub || null,
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
      setCurrentFolder(folder);
    }
    load();
  };

  // Convenience: alte upload-Signatur weiterhin nutzbar (lädt in currentSubpath)
  const upload = (files: FileList | File[] | null, folder: FolderKey) => {
    if (!files || files.length === 0) return;
    const list = Array.from(files);
    const items: UploadItem[] = list.map((f) => ({ file: f, subpath: currentSubpath }));
    return uploadItems(items, folder);
  };

  const open = (d: Dokument) => {
    setViewerItem({
      bucket: "baustellen",
      storage_path: d.storage_path,
      dateiname: d.dateiname,
      mimetype: d.mimetype,
    });
  };

  const sendOne = (d: Dokument, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setSendItems([
      {
        bucket: "baustellen",
        storage_path: d.storage_path,
        dateiname: d.dateiname,
        groesse: d.groesse,
        mimetype: d.mimetype,
      },
    ]);
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
  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const dropped = await readDropFiles(e);
    if (dropped.length === 0) return;
    const items: UploadItem[] = dropped.map((d) => ({
      file: d.file,
      subpath: joinSubpath(currentSubpath, d.relativePath),
    }));
    uploadItems(items, defaultDropFolder);
  };

  // Drop direkt auf eine Top-Folder-Zeile (Wurzel) ODER Unterordner-Zeile
  const dropOnTopFolder = (folder: FolderKey) => async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    const dropped = await readDropFiles(e);
    if (dropped.length === 0) return;
    const items: UploadItem[] = dropped.map((d) => ({
      file: d.file,
      subpath: d.relativePath,
    }));
    uploadItems(items, folder);
  };

  const dropOnSubfolder = (folderName: string) => async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    if (currentFolder === "root") return;
    const target = joinSubpath(currentSubpath, folderName);
    const dropped = await readDropFiles(e);
    if (dropped.length === 0) return;
    const items: UploadItem[] = dropped.map((d) => ({
      file: d.file,
      subpath: joinSubpath(target, d.relativePath),
    }));
    uploadItems(items, currentFolder);
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
  }, [baustelleId, currentFolder, currentSubpath]);

  // Neuer Unterordner anlegen (Marker in DB)
  const createSubfolder = async () => {
    if (currentFolder === "root") return;
    const name = sanitizeFolderName(newFolderName);
    if (!name) {
      toast({ variant: "destructive", title: "Ungültiger Name" });
      return;
    }
    const newSub = joinSubpath(currentSubpath, name);
    // Schon vorhanden?
    if (subfolders.includes(name)) {
      toast({ variant: "destructive", title: `„${name}" existiert bereits` });
      return;
    }
    const { data: u } = await supabase.auth.getUser();
    const { error } = await supabase.from("dokument_ordner").insert({
      baustelle_id: baustelleId,
      ordner: currentFolder,
      subpath: newSub,
      created_by: u.user?.id ?? null,
    } as any);
    if (error) {
      toast({ variant: "destructive", title: "Fehler", description: error.message });
      return;
    }
    setNewFolderOpen(false);
    setNewFolderName("");
    toast({ title: `Ordner „${name}" erstellt` });
    load();
  };

  const enterSubfolder = (name: string) => {
    setCurrentSubpath((p) => joinSubpath(p, name));
  };

  const breadcrumbSegments = currentSubpath ? currentSubpath.split("/").filter(Boolean) : [];
  const goToBreadcrumb = (idx: number) => {
    // -1 = Top-Folder-Wurzel (kein subpath), 0..n = Index der Segmente
    if (idx < 0) {
      setCurrentSubpath("");
    } else {
      setCurrentSubpath(breadcrumbSegments.slice(0, idx + 1).join("/"));
    }
  };

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
            <Home className="h-4 w-4 text-muted-foreground" />
            Dokumente
          </div>
        ) : (
          <>
            <Button
              variant="outline"
              size="sm"
              className="h-8"
              onClick={() => {
                if (currentSubpath) {
                  // eine Ebene hoch
                  const seg = breadcrumbSegments.slice(0, -1).join("/");
                  setCurrentSubpath(seg);
                } else {
                  setCurrentFolder("root");
                }
              }}
            >
              <ArrowLeft className="h-4 w-4 mr-1" />
              Zurück
            </Button>
            <div className="flex items-center gap-1 text-sm flex-wrap">
              <button
                onClick={() => setCurrentFolder("root")}
                className="text-muted-foreground hover:text-foreground hover:underline inline-flex items-center gap-1"
              >
                <Home className="h-3.5 w-3.5" />
                Dokumente
              </button>
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
              <button
                onClick={() => setCurrentSubpath("")}
                className={`hover:underline ${
                  currentSubpath ? "text-muted-foreground" : "font-semibold"
                }`}
              >
                {folderMeta(currentFolder).label}
              </button>
              {breadcrumbSegments.map((seg, i) => (
                <span key={i} className="flex items-center gap-1">
                  <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                  <button
                    onClick={() => goToBreadcrumb(i)}
                    className={`hover:underline ${
                      i === breadcrumbSegments.length - 1
                        ? "font-semibold"
                        : "text-muted-foreground"
                    }`}
                  >
                    {seg}
                  </button>
                </span>
              ))}
              <span className="text-xs text-muted-foreground ml-1">
                ({filtered.length + subfolders.length})
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
            <>
              <Button
                onClick={() => {
                  setNewFolderName("");
                  setNewFolderOpen(true);
                }}
                variant="outline"
                className="h-9"
              >
                <FolderPlus className="h-4 w-4 mr-2" />
                Neuer Ordner
              </Button>
              <Button onClick={triggerUpload} variant="default" className="h-9">
                <Upload className="h-4 w-4 mr-2" />
                Hochladen
              </Button>
            </>
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

      {/* Inhalt: Wurzel = Top-Level-Ordner-Liste, sonst = Subfolders + Datei-Grid */}
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
                      count={stats.count}
                      latest={stats.latest}
                      onOpen={() => setCurrentFolder(f.key)}
                      onDrop={dropOnTopFolder(f.key)}
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
      ) : filtered.length === 0 && subfolders.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center space-y-2">
            <FolderOpen className="h-8 w-8 mx-auto text-muted-foreground opacity-50" />
            <div className="text-sm text-muted-foreground">
              Noch leer in {folderMeta(currentFolder).label}
              {currentSubpath ? ` / ${currentSubpath}` : ""}.
            </div>
            <div className="text-xs text-muted-foreground">
              Dateien oder ganze Ordner hierher ziehen, oder „Neuer Ordner" /
              „Hochladen" oben rechts.
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {subfolders.length > 0 && (
            <Card>
              <CardContent className="p-0">
                <ul className="divide-y">
                  {subfolders.map((name) => {
                    const st = subfolderStats[name] ?? { count: 0, latest: null };
                    return (
                      <FolderRow
                        key={name}
                        label={name}
                        count={st.count}
                        latest={st.latest}
                        onOpen={() => enterSubfolder(name)}
                        onDrop={dropOnSubfolder(name)}
                      />
                    );
                  })}
                </ul>
              </CardContent>
            </Card>
          )}
          {filtered.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 sm:gap-3">
              {filtered.map((d) => (
                <FileCard
                  key={d.id}
                  d={d}
                  onOpen={() => open(d)}
                  onDelete={(e) => remove(d, e)}
                  onSend={(e) => sendOne(d, e)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Neuer-Ordner-Dialog */}
      <Dialog open={newFolderOpen} onOpenChange={setNewFolderOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Neuer Ordner</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Input
              autoFocus
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") createSubfolder();
              }}
              placeholder="Ordnername"
            />
            <p className="text-[11px] text-muted-foreground">
              Wird angelegt in:{" "}
              <strong>
                {folderMeta(currentFolder === "root" ? "92-sonstiges" : currentFolder).label}
                {currentSubpath ? ` / ${currentSubpath}` : ""}
              </strong>
            </p>
          </div>
          <DialogFooter className="flex-row gap-2">
            <Button
              variant="outline"
              onClick={() => setNewFolderOpen(false)}
              className="flex-1"
            >
              Abbrechen
            </Button>
            <Button onClick={createSubfolder} className="flex-1">
              Anlegen
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <DocViewerDialog
        open={!!viewerItem}
        onOpenChange={(o) => !o && setViewerItem(null)}
        item={viewerItem}
      />
      <DocSendDialog
        open={!!sendItems}
        onOpenChange={(o) => !o && setSendItems(null)}
        items={sendItems ?? []}
      />
    </div>
  );
}

function FolderRow({
  label,
  count,
  latest,
  onOpen,
  onDrop,
}: {
  label: string;
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
      <Folder
        className="h-5 w-5 shrink-0"
        style={{ color: FOLDER_COLOR }}
        fill={FOLDER_COLOR}
        fillOpacity={0.25}
      />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium truncate">{label}</div>
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
  onSend,
}: {
  d: Dokument;
  onOpen: () => void;
  onDelete: (e: React.MouseEvent) => void;
  onSend: (e: React.MouseEvent) => void;
}) {
  return (
    <div className="group relative">
      <button
        onClick={onOpen}
        className="block w-full text-left rounded-md border bg-card overflow-hidden hover:shadow-md hover:border-primary/40 transition-all"
      >
        {/* Visual */}
        <div className="aspect-square bg-muted relative">
          <Thumbnail
            bucket="baustellen"
            storagePath={d.storage_path}
            dateiname={d.dateiname}
            mimetype={d.mimetype}
          />
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
      {/* Action-Buttons */}
      <div className="absolute top-1.5 right-1.5 flex gap-1 sm:opacity-0 sm:group-hover:opacity-100 opacity-100 transition">
        <button
          onClick={onSend}
          className="bg-background/90 hover:bg-primary hover:text-primary-foreground rounded p-1.5 shadow"
          aria-label="Per Mail senden"
          title="Per Mail senden"
        >
          <Mail className="h-4 w-4" />
        </button>
        <button
          onClick={onDelete}
          className="bg-background/90 hover:bg-destructive hover:text-white rounded p-1.5 shadow"
          aria-label="Löschen"
          title="Löschen"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
