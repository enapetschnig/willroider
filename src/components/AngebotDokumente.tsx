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
  Upload,
  FileText,
  Trash2,
  Folder,
  FolderOpen,
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
import type {
  Database,
  AngebotOrdnerEnum,
} from "@/integrations/supabase/types";
import {
  ANGEBOT_ORDNER,
  angebotOrdnerDef,
  type AngebotOrdnerKey,
} from "@/lib/angebotOrdner";
import {
  MAX_UPLOAD_BYTES,
  sanitizeStorageName,
  joinSubpath,
  sanitizeFolderName,
  getDirectSubfolders,
  readDropFiles,
} from "@/lib/uploadHelpers";

type Dokument = Database["public"]["Tables"]["angebot_dokumente"]["Row"];
type Marker = Database["public"]["Tables"]["angebot_ordner_unterordner"]["Row"];

const FOLDER_COLOR = "#eab308";

function isImage(mimetype?: string | null) {
  return !!mimetype && mimetype.startsWith("image/");
}
function isPdf(mimetype?: string | null) {
  return !!mimetype && mimetype === "application/pdf";
}
function meta(key: string | null | undefined) {
  return angebotOrdnerDef(key) ?? ANGEBOT_ORDNER[3];
}

type UploadItem = { file: File; subpath: string };

export function AngebotDokumente({ angebotId }: { angebotId: string }) {
  const { toast } = useToast();
  const [docs, setDocs] = useState<Dokument[]>([]);
  const [folderMarkers, setFolderMarkers] = useState<Marker[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentFolder, setCurrentFolder] = useState<"root" | AngebotOrdnerKey>("root");
  const [currentSubpath, setCurrentSubpath] = useState<string>("");
  const [viewerItem, setViewerItem] = useState<DocViewerItem | null>(null);
  const [sendItems, setSendItems] = useState<DocSendItem[] | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState<{
    name: string;
    idx: number;
    total: number;
  } | null>(null);
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    setLoading(true);
    const [d, m] = await Promise.all([
      supabase
        .from("angebot_dokumente")
        .select("*")
        .eq("angebot_id", angebotId)
        .order("created_at", { ascending: false }),
      supabase
        .from("angebot_ordner_unterordner")
        .select("*")
        .eq("angebot_id", angebotId),
    ]);
    setDocs((d.data as Dokument[]) ?? []);
    setFolderMarkers((m.data as Marker[]) ?? []);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, [angebotId]);

  useEffect(() => {
    setCurrentSubpath("");
  }, [currentFolder]);

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
    return docs.filter(
      (d) => d.ordner === currentFolder && (d.subpath ?? "") === currentSubpath
    );
  }, [docs, currentFolder, currentSubpath]);

  const subfolders = useMemo(() => {
    if (currentFolder === "root") return [];
    const all: (string | null)[] = [];
    docs.forEach((d) => {
      if (d.ordner === currentFolder) all.push(d.subpath);
    });
    folderMarkers.forEach((m) => {
      if (m.ordner === currentFolder) all.push(m.subpath);
    });
    return getDirectSubfolders(all, currentSubpath);
  }, [docs, folderMarkers, currentFolder, currentSubpath]);

  const subfolderStats = useMemo(() => {
    if (currentFolder === "root") return {} as Record<string, { count: number; latest: string | null }>;
    const stats: Record<string, { count: number; latest: string | null }> = {};
    subfolders.forEach((s) => (stats[s] = { count: 0, latest: null }));
    const prefix = currentSubpath ? currentSubpath + "/" : "";
    docs.forEach((d) => {
      if (d.ordner !== currentFolder) return;
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

  const uploadItems = async (items: UploadItem[], folder: AngebotOrdnerKey) => {
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
      const sub = subpath
        ? subpath.split("/").map(sanitizeFolderName).filter(Boolean).join("/")
        : "";
      const subStorageSegment = sub ? `${sub}/` : "";
      const path = `${angebotId}/${folder}/${subStorageSegment}${Date.now()}_${safeName}`;
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
        subpath: sub || null,
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

  const upload = (files: FileList | File[] | null, folder: AngebotOrdnerKey) => {
    if (!files || files.length === 0) return;
    const list = Array.from(files);
    const items: UploadItem[] = list.map((f) => ({
      file: f,
      subpath: currentSubpath,
    }));
    return uploadItems(items, folder);
  };

  const openFile = (d: Dokument) => {
    setViewerItem({
      bucket: "angebote",
      storage_path: d.storage_path,
      dateiname: d.dateiname,
      mimetype: d.mimetype,
    });
  };

  const sendFile = (d: Dokument, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setSendItems([
      {
        id: d.id,
        bucket: "angebote",
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
    await supabase.storage.from("angebote").remove([d.storage_path]);
    await supabase.from("angebot_dokumente").delete().eq("id", d.id);
    toast({ title: "Datei gelöscht" });
    load();
  };

  const triggerUpload = () => fileRef.current?.click();

  // Im Root-View KEIN Default-Ordner — User muss direkt auf eine
  // Folder-Zeile droppen. Sonst landet zu vieles versehentlich im
  // ersten Ordner (Windows-Explorer-Verhalten).
  const defaultDropFolder: AngebotOrdnerKey | null =
    currentFolder === "root" ? null : currentFolder;

  const onDragOver = (e: React.DragEvent) => {
    if (e.dataTransfer?.types?.includes("Files")) {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
      setDragOver(true);
    }
  };
  const onDragLeave = (e: React.DragEvent) => {
    if (e.currentTarget === e.target) setDragOver(false);
  };
  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (defaultDropFolder === null) {
      const dropped = await readDropFiles(e);
      if (dropped.length > 0) {
        toast({
          title: "Bitte direkt auf einen Ordner ziehen",
          description:
            "In der Übersicht haben wir keinen Default-Ordner — direkt auf einer Ordner-Zeile fallen lassen.",
        });
      }
      return;
    }
    const dropped = await readDropFiles(e);
    if (dropped.length === 0) return;
    const items: UploadItem[] = dropped.map((d) => ({
      file: d.file,
      subpath: joinSubpath(currentSubpath, d.relativePath),
    }));
    uploadItems(items, defaultDropFolder);
  };
  const dropOnTopFolder =
    (folder: AngebotOrdnerKey) => async (e: React.DragEvent) => {
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
      if (defaultDropFolder === null) {
        upload(files, "angebotsunterlagen");
      } else {
        upload(files, defaultDropFolder);
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [angebotId, currentFolder, currentSubpath]);

  const createSubfolder = async () => {
    if (currentFolder === "root") return;
    const name = sanitizeFolderName(newFolderName);
    if (!name) {
      toast({ variant: "destructive", title: "Ungültiger Name" });
      return;
    }
    const newSub = joinSubpath(currentSubpath, name);
    if (subfolders.includes(name)) {
      toast({ variant: "destructive", title: `„${name}" existiert bereits` });
      return;
    }
    const { data: u } = await supabase.auth.getUser();
    const { error } = await supabase.from("angebot_ordner_unterordner").insert({
      angebot_id: angebotId,
      ordner: currentFolder as AngebotOrdnerEnum,
      subpath: newSub,
      created_by: u.user?.id ?? null,
    });
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
    if (idx < 0) setCurrentSubpath("");
    else setCurrentSubpath(breadcrumbSegments.slice(0, idx + 1).join("/"));
  };

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
        <div
          className={`pointer-events-none absolute inset-0 z-10 flex items-start justify-center pt-4 rounded-lg border-2 border-dashed ${
            defaultDropFolder === null
              ? "bg-amber-50/70 border-amber-400"
              : "bg-primary/10 border-primary"
          }`}
        >
          <div className="text-center bg-background/95 px-4 py-3 rounded-md shadow">
            <Upload
              className={`h-6 w-6 mx-auto mb-1 ${
                defaultDropFolder === null ? "text-amber-700" : "text-primary"
              }`}
            />
            <div className="text-sm font-semibold">
              {defaultDropFolder === null
                ? "Auf einen Ordner unten ablegen"
                : "Dateien hier ablegen"}
            </div>
            <div className="text-[11px] text-muted-foreground">
              {defaultDropFolder === null
                ? "→ Whitespace zählt nicht — direkt auf eine Zeile ziehen"
                : `→ Ordner: ${meta(defaultDropFolder).label}${currentSubpath ? ` / ${currentSubpath}` : ""}`}
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
          // Hochladen-Button erscheint nur im Folder-View, daher ist
          // defaultDropFolder hier nie null. Fallback auf
          // 'angebotsunterlagen', falls jemand das hidden input
          // außerhalb des normalen Flows triggert.
          upload(e.target.files, defaultDropFolder ?? "angebotsunterlagen");
          if (fileRef.current) fileRef.current.value = "";
        }}
      />

      {/* Breadcrumb */}
      <div className="flex items-center gap-2 flex-wrap">
        {currentFolder === "root" ? (
          <div className="flex items-center gap-1.5 text-sm font-semibold">
            <Home className="h-4 w-4 text-muted-foreground" />
            Angebot-Dokumente
          </div>
        ) : (
          <>
            <Button
              variant="outline"
              size="sm"
              className="h-8"
              onClick={() => {
                if (currentSubpath) {
                  setCurrentSubpath(breadcrumbSegments.slice(0, -1).join("/"));
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
                {meta(currentFolder).label}
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
          Klicke auf einen Ordner, ziehe Dateien oder ganze Ordner darauf. Auch{" "}
          <kbd className="px-1 py-0.5 rounded border bg-muted text-[10px]">Cmd/Strg+V</kbd>{" "}
          aus der Zwischenablage. Max. 50 MB pro Datei.
        </div>
      )}

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
                      count={stats.count}
                      latest={stats.latest}
                      onOpen={() => setCurrentFolder(f.key)}
                      onDrop={dropOnTopFolder(f.key)}
                      dragActive={dragOver}
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
              Noch leer in {meta(currentFolder).label}
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
                        dragActive={dragOver}
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
                  onOpen={() => openFile(d)}
                  onDelete={(e) => remove(d, e)}
                  onSend={(e) => sendFile(d, e)}
                />
              ))}
            </div>
          )}
        </div>
      )}

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
                {meta(currentFolder === "root" ? "angebotsunterlagen" : currentFolder).label}
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
    </div>
  );
}

function FolderRow({
  label,
  count,
  latest,
  onOpen,
  onDrop,
  dragActive = false,
}: {
  label: string;
  count: number;
  latest: string | null;
  onOpen: () => void;
  onDrop: (e: React.DragEvent) => void;
  dragActive?: boolean;
}) {
  const [hover, setHover] = useState(false);
  return (
    <li
      onClick={onOpen}
      onDragOver={(e) => {
        if (e.dataTransfer?.types?.includes("Files")) {
          e.preventDefault();
          e.stopPropagation();
          if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
          setHover(true);
        }
      }}
      onDragLeave={() => setHover(false)}
      onDrop={(e) => {
        setHover(false);
        onDrop(e);
      }}
      className={`flex items-center gap-3 px-3 sm:px-4 py-2.5 cursor-pointer transition ${
        hover
          ? "bg-primary/15 ring-2 ring-primary"
          : dragActive
            ? "bg-primary/[0.04] ring-1 ring-primary/30"
            : "hover:bg-muted/50"
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
        <div className="aspect-square bg-muted relative">
          <Thumbnail
            bucket="angebote"
            storagePath={d.storage_path}
            dateiname={d.dateiname}
            mimetype={d.mimetype}
          />
        </div>
        <div className="p-2">
          <div className="text-xs font-medium truncate">{d.dateiname}</div>
          <div className="text-[10px] text-muted-foreground">
            {new Date(d.created_at).toLocaleDateString("de-AT")}
            {d.groesse ? ` · ${(d.groesse / 1024).toFixed(0)} KB` : ""}
          </div>
        </div>
      </button>
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
