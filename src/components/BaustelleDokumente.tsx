import { useEffect, useRef, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  Folder,
  FileText,
  Image as ImageIcon,
  Trash2,
  Download,
  ChevronLeft,
  FolderOpen,
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
  { key: "sonstige", label: "Sonstige", icon: Folder, color: "#6b7280" },
] as const;

type FolderKey = typeof FOLDERS[number]["key"];

function isImage(mimetype?: string | null) {
  return !!mimetype && mimetype.startsWith("image/");
}

export function BaustelleDokumente({ baustelleId }: { baustelleId: string }) {
  const { toast } = useToast();
  const [docs, setDocs] = useState<Dokument[]>([]);
  const [loading, setLoading] = useState(true);
  const [openFolder, setOpenFolder] = useState<FolderKey | null>(null);
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

  const counts = FOLDERS.reduce<Record<string, number>>((acc, f) => {
    acc[f.key] = docs.filter((d) => (d.ordner ?? "sonstige") === f.key).length;
    return acc;
  }, {});

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
    if (success > 0) toast({ title: `${success} Datei${success > 1 ? "en" : ""} hochgeladen` });
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

  const remove = async (d: Dokument) => {
    if (!confirm(`Datei "${d.dateiname}" löschen?`)) return;
    await supabase.storage.from("baustellen").remove([d.storage_path]);
    await supabase.from("dokumente").delete().eq("id", d.id);
    toast({ title: "Datei gelöscht" });
    load();
  };

  // ----- Folder grid (root view) -----
  if (!openFolder) {
    return (
      <div className="space-y-3">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2 sm:gap-3">
          {FOLDERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setOpenFolder(f.key)}
              className="text-left"
            >
              <Card className="hover:shadow-md hover:border-primary/40 transition-all">
                <CardContent className="p-3 sm:p-4 flex items-center gap-3">
                  <div
                    className="h-10 w-10 sm:h-12 sm:w-12 rounded-lg flex items-center justify-center shrink-0"
                    style={{ background: `${f.color}1a`, color: f.color }}
                  >
                    <f.icon className="h-5 w-5 sm:h-6 sm:w-6" />
                  </div>
                  <div className="min-w-0">
                    <div className="font-semibold text-sm truncate">{f.label}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {counts[f.key] ?? 0} Datei{counts[f.key] === 1 ? "" : "en"}
                    </div>
                  </div>
                </CardContent>
              </Card>
            </button>
          ))}
        </div>

        {loading && (
          <div className="text-center text-sm text-muted-foreground">Lädt…</div>
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

  // ----- Folder content view -----
  const folder = FOLDERS.find((f) => f.key === openFolder)!;
  const folderDocs = docs.filter((d) => (d.ordner ?? "sonstige") === folder.key);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" size="sm" onClick={() => setOpenFolder(null)}>
          <ChevronLeft className="h-4 w-4 mr-1" /> Ordner
        </Button>
        <div className="flex items-center gap-2">
          <div
            className="h-8 w-8 rounded flex items-center justify-center"
            style={{ background: `${folder.color}1a`, color: folder.color }}
          >
            <folder.icon className="h-4 w-4" />
          </div>
          <div>
            <div className="font-semibold text-sm">{folder.label}</div>
            <div className="text-[11px] text-muted-foreground">{folderDocs.length} Dateien</div>
          </div>
        </div>
        <div className="flex-1" />

        <input
          type="file"
          accept="image/*"
          capture="environment"
          ref={cameraRef}
          className="hidden"
          onChange={(e) => {
            upload(e.target.files, folder.key);
            if (cameraRef.current) cameraRef.current.value = "";
          }}
        />
        <input
          type="file"
          multiple
          ref={fileRef}
          className="hidden"
          onChange={(e) => {
            upload(e.target.files, folder.key);
            if (fileRef.current) fileRef.current.value = "";
          }}
        />

        <Button
          size="sm"
          variant="outline"
          onClick={() => cameraRef.current?.click()}
          className="sm:hidden"
        >
          <Camera className="h-4 w-4 mr-1" /> Foto
        </Button>
        <Button size="sm" onClick={() => fileRef.current?.click()}>
          <Upload className="h-4 w-4 mr-1" /> Hochladen
        </Button>
      </div>

      {folderDocs.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            <FolderOpen className="h-8 w-8 mx-auto mb-2 opacity-50" />
            Noch keine Dateien in <strong>{folder.label}</strong>.
          </CardContent>
        </Card>
      ) : folder.key === "fotos" ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
          {folderDocs.map((d) => (
            <PhotoTile key={d.id} d={d} onOpen={() => open(d)} onDelete={() => remove(d)} />
          ))}
        </div>
      ) : (
        <div className="space-y-2">
          {folderDocs.map((d) => (
            <Card key={d.id}>
              <CardContent className="p-3 flex items-center gap-3">
                <div
                  className="h-9 w-9 rounded flex items-center justify-center shrink-0"
                  style={{ background: `${folder.color}1a`, color: folder.color }}
                >
                  {isImage(d.mimetype) ? (
                    <ImageIcon className="h-4 w-4" />
                  ) : (
                    <FileText className="h-4 w-4" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-sm truncate">{d.dateiname}</div>
                  <div className="text-[11px] text-muted-foreground">
                    {new Date(d.created_at).toLocaleDateString("de-AT")}
                    {d.groesse ? ` · ${(d.groesse / 1024).toFixed(0)} KB` : ""}
                  </div>
                </div>
                <Button variant="ghost" size="icon" onClick={() => open(d)} aria-label="Öffnen">
                  <Download className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="icon" onClick={() => remove(d)} aria-label="Löschen">
                  <Trash2 className="h-4 w-4" />
                </Button>
              </CardContent>
            </Card>
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

function PhotoTile({
  d,
  onOpen,
  onDelete,
}: {
  d: Dokument;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const [thumb, setThumb] = useState<string | null>(null);
  useEffect(() => {
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
  }, [d.storage_path]);

  return (
    <div className="relative group">
      <button
        onClick={onOpen}
        className="aspect-square w-full rounded-md bg-muted overflow-hidden border hover:border-primary block"
      >
        {thumb ? (
          <img src={thumb} alt={d.dateiname} className="h-full w-full object-cover" />
        ) : (
          <div className="h-full w-full flex items-center justify-center">
            <ImageIcon className="h-6 w-6 text-muted-foreground" />
          </div>
        )}
      </button>
      <button
        onClick={onDelete}
        className="absolute top-1 right-1 bg-background/80 hover:bg-destructive hover:text-white rounded p-1 opacity-0 group-hover:opacity-100 transition"
        aria-label="Löschen"
      >
        <Trash2 className="h-3 w-3" />
      </button>
      <div className="text-[10px] text-muted-foreground truncate mt-1">{d.dateiname}</div>
    </div>
  );
}
