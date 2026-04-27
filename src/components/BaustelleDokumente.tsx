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
  Download,
  Layers,
  FolderOpen,
  File as FileIcon,
} from "lucide-react";
import type { Database } from "@/integrations/supabase/types";

type Dokument = Database["public"]["Tables"]["dokumente"]["Row"];

const FOLDERS = [
  { key: "fotos", label: "Fotos", icon: ImageIcon, color: "#3b82f6" },
  { key: "plaene", label: "Pläne", icon: FileText, color: "#8b5cf6" },
  { key: "berichte", label: "Berichte", icon: FileText, color: "#10b981" },
  { key: "stundenzettel", label: "Stundenzettel", icon: FileText, color: "#f59e0b" },
  { key: "rechnungen", label: "Rechnungen", icon: FileText, color: "#ef4444" },
  { key: "lieferscheine", label: "Lieferscheine", icon: FileText, color: "#06b6d4" },
  { key: "evaluierung", label: "Evaluierung", icon: FileText, color: "#84cc16" },
  { key: "sonstige", label: "Sonstige", icon: FolderOpen, color: "#6b7280" },
] as const;

type FolderKey = typeof FOLDERS[number]["key"];

function isImage(mimetype?: string | null) {
  return !!mimetype && mimetype.startsWith("image/");
}
function isPdf(mimetype?: string | null) {
  return !!mimetype && mimetype === "application/pdf";
}
function folderMeta(key: string | null | undefined) {
  return FOLDERS.find((f) => f.key === (key ?? "sonstige")) ?? FOLDERS[FOLDERS.length - 1];
}

export function BaustelleDokumente({ baustelleId }: { baustelleId: string }) {
  const { toast } = useToast();
  const [docs, setDocs] = useState<Dokument[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeFilter, setActiveFilter] = useState<"alle" | FolderKey>("alle");
  const [uploadFolder, setUploadFolder] = useState<FolderKey>("fotos");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewName, setPreviewName] = useState<string>("");
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);

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

  useEffect(() => {
    load();
  }, [baustelleId]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { alle: docs.length };
    FOLDERS.forEach((f) => {
      c[f.key] = docs.filter((d) => (d.ordner ?? "sonstige") === f.key).length;
    });
    return c;
  }, [docs]);

  const filtered = useMemo(() => {
    if (activeFilter === "alle") return docs;
    return docs.filter((d) => (d.ordner ?? "sonstige") === activeFilter);
  }, [docs, activeFilter]);

  const upload = async (files: FileList | null, folder: FolderKey) => {
    if (!files || files.length === 0) return;
    const { data: u } = await supabase.auth.getUser();
    let success = 0;
    for (const file of Array.from(files)) {
      const path = `${baustelleId}/${folder}/${Date.now()}_${file.name.replace(/[^\w.-]/g, "_")}`;
      const { error: upErr } = await supabase.storage.from("baustellen").upload(path, file);
      if (upErr) {
        toast({ variant: "destructive", title: "Upload-Fehler", description: upErr.message });
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
        toast({ variant: "destructive", title: "Fehler", description: dbErr.message });
        continue;
      }
      success++;
    }
    if (success > 0) {
      toast({ title: `${success} Datei${success > 1 ? "en" : ""} hochgeladen` });
      // jump filter to that folder so it's visible
      setActiveFilter(folder);
    }
    load();
  };

  const open = async (d: Dokument) => {
    const { data, error } = await supabase.storage
      .from("baustellen")
      .createSignedUrl(d.storage_path, 300);
    if (error || !data) {
      toast({ variant: "destructive", title: "Fehler", description: error?.message });
      return;
    }
    if (isImage(d.mimetype)) {
      setPreviewUrl(data.signedUrl);
      setPreviewName(d.dateiname);
    } else {
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
    // upload-target ordner = der aktuell gefilterte (außer "alle" → fotos default)
    setUploadFolder(activeFilter === "alle" ? "fotos" : (activeFilter as FolderKey));
    fileRef.current?.click();
  };

  return (
    <div className="space-y-3">
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

      {/* Action Buttons */}
      <div className="grid grid-cols-2 gap-2">
        <Button
          onClick={triggerCamera}
          variant="default"
          className="h-12"
          size="lg"
        >
          <Camera className="h-5 w-5 mr-2" />
          Foto aufnehmen
        </Button>
        <Button
          onClick={triggerUpload}
          variant="outline"
          className="h-12"
          size="lg"
        >
          <Upload className="h-5 w-5 mr-2" />
          {activeFilter === "alle" ? "Hochladen" : `Hochladen → ${folderMeta(activeFilter).label}`}
        </Button>
      </div>

      {/* Filter Pills */}
      <div className="flex flex-wrap gap-1.5 -mx-1 px-1 overflow-x-auto pb-1">
        <FilterPill
          label="Alle"
          icon={Layers}
          color="#374151"
          count={counts.alle}
          active={activeFilter === "alle"}
          onClick={() => setActiveFilter("alle")}
        />
        {FOLDERS.map((f) => (
          <FilterPill
            key={f.key}
            label={f.label}
            icon={f.icon}
            color={f.color}
            count={counts[f.key] ?? 0}
            active={activeFilter === f.key}
            onClick={() => setActiveFilter(f.key)}
          />
        ))}
      </div>

      {/* Card Grid */}
      {loading ? (
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
              {activeFilter === "alle"
                ? "Noch keine Dateien hochgeladen."
                : `Noch keine Dateien in ${folderMeta(activeFilter).label}.`}
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

function FilterPill({
  label,
  icon: Icon,
  color,
  count,
  active,
  onClick,
}: {
  label: string;
  icon: typeof Camera;
  color: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-medium border transition flex items-center gap-1.5 ${
        active ? "text-white border-transparent" : "bg-background hover:bg-muted"
      }`}
      style={active ? { background: color } : { color: count > 0 ? color : undefined }}
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
      <span className={`text-[10px] tabular-nums ${active ? "opacity-90" : "opacity-60"}`}>
        {count}
      </span>
    </button>
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
            <img src={thumb} alt={d.dateiname} className="h-full w-full object-cover" />
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
        className="absolute top-1.5 right-1.5 bg-background/90 hover:bg-destructive hover:text-white rounded p-1 sm:opacity-0 sm:group-hover:opacity-100 opacity-100 transition shadow"
        aria-label="Löschen"
      >
        <Trash2 className="h-3 w-3" />
      </button>
    </div>
  );
}
