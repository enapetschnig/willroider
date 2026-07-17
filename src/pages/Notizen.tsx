import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Folder,
  FolderPlus,
  NotebookPen,
  Plus,
  Trash2,
  Pencil,
  Paperclip,
  Loader2,
  ChevronLeft,
  Building2,
  Eraser,
  Save,
} from "lucide-react";

type Ordner = { id: string; name: string; sort_order: number };
type Notiz = {
  id: string;
  ordner_id: string | null;
  baustelle_id: string | null;
  titel: string;
  inhalt: string;
  updated_at: string;
};
type Anhang = {
  id: string;
  notiz_id: string;
  pfad: string;
  name: string;
  typ: string | null;
  ist_skizze: boolean;
};
type BaustelleLite = { id: string; bvh_name: string };

const fmtDatum = (s: string) =>
  new Date(s).toLocaleDateString("de-AT", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

/**
 * Notizen — gemeinsames Notizbuch für Büro/Bauleitung/GF.
 * Ordnerstruktur, optionaler Baustellen-Bezug, Datei-Anhänge und
 * Skizzen (Zeichnen mit Finger/Maus).
 */
export default function Notizen() {
  const { toast } = useToast();
  const [ordner, setOrdner] = useState<Ordner[]>([]);
  const [notizen, setNotizen] = useState<Notiz[]>([]);
  const [baustellen, setBaustellen] = useState<BaustelleLite[]>([]);
  const [selOrdner, setSelOrdner] = useState<string | "alle">("alle");
  const [selNotiz, setSelNotiz] = useState<string | null>(null);
  const [anhaenge, setAnhaenge] = useState<Anhang[]>([]);
  const [anhangUrls, setAnhangUrls] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Editor-State (entkoppelt, speichert auf Knopf/Blur)
  const [titel, setTitel] = useState("");
  const [inhalt, setInhalt] = useState("");
  const [baustelleId, setBaustelleId] = useState<string>("");
  const [dirty, setDirty] = useState(false);

  const [skizzeOpen, setSkizzeOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const load = async () => {
    const [o, n, b] = await Promise.all([
      supabase.from("notiz_ordner" as any).select("*").order("sort_order").order("name"),
      supabase.from("notizen" as any).select("*").order("updated_at", { ascending: false }),
      supabase.from("baustellen").select("id, bvh_name").order("bvh_name"),
    ]);
    setOrdner(((o.data as unknown as Ordner[]) ?? []));
    setNotizen(((n.data as unknown as Notiz[]) ?? []));
    setBaustellen(((b.data as unknown as BaustelleLite[]) ?? []));
    setLoading(false);
  };

  useEffect(() => {
    void load();
  }, []);

  const aktuelleNotiz = useMemo(
    () => notizen.find((n) => n.id === selNotiz) ?? null,
    [notizen, selNotiz],
  );

  // Editor mit Notiz befüllen
  useEffect(() => {
    if (!aktuelleNotiz) return;
    setTitel(aktuelleNotiz.titel);
    setInhalt(aktuelleNotiz.inhalt);
    setBaustelleId(aktuelleNotiz.baustelle_id ?? "");
    setDirty(false);
    void ladeAnhaenge(aktuelleNotiz.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aktuelleNotiz?.id]);

  const ladeAnhaenge = async (notizId: string) => {
    const { data } = await supabase
      .from("notiz_anhaenge" as any)
      .select("*")
      .eq("notiz_id", notizId)
      .order("created_at");
    const list = (data as unknown as Anhang[]) ?? [];
    setAnhaenge(list);
    const urls = new Map<string, string>();
    await Promise.all(
      list.map(async (a) => {
        const { data: signed } = await supabase.storage
          .from("notizen-anhaenge")
          .createSignedUrl(a.pfad, 3600);
        if (signed?.signedUrl) urls.set(a.id, signed.signedUrl);
      }),
    );
    setAnhangUrls(urls);
  };

  const sichtbareNotizen = useMemo(() => {
    if (selOrdner === "alle") return notizen;
    return notizen.filter((n) => n.ordner_id === selOrdner);
  }, [notizen, selOrdner]);

  // ── Ordner-Aktionen ──────────────────────────────────────────────
  const neuerOrdner = async () => {
    const name = window.prompt("Name des Ordners:");
    if (!name?.trim()) return;
    const { error } = await supabase
      .from("notiz_ordner" as any)
      .insert({ name: name.trim(), sort_order: ordner.length });
    if (error) toast({ variant: "destructive", title: "Fehler", description: error.message });
    void load();
  };

  const ordnerUmbenennen = async (o: Ordner) => {
    const name = window.prompt("Neuer Name:", o.name);
    if (!name?.trim() || name.trim() === o.name) return;
    await supabase.from("notiz_ordner" as any).update({ name: name.trim() }).eq("id", o.id);
    void load();
  };

  const ordnerLoeschen = async (o: Ordner) => {
    const anzahl = notizen.filter((n) => n.ordner_id === o.id).length;
    if (
      !window.confirm(
        `Ordner „${o.name}" löschen?${anzahl > 0 ? ` ${anzahl} Notiz(en) bleiben erhalten (ohne Ordner).` : ""}`,
      )
    )
      return;
    await supabase.from("notiz_ordner" as any).delete().eq("id", o.id);
    if (selOrdner === o.id) setSelOrdner("alle");
    void load();
  };

  // ── Notiz-Aktionen ───────────────────────────────────────────────
  const neueNotiz = async () => {
    const { data, error } = await supabase
      .from("notizen" as any)
      .insert({
        titel: "",
        inhalt: "",
        ordner_id: selOrdner === "alle" ? null : selOrdner,
      })
      .select("id")
      .single();
    if (error || !data) {
      toast({ variant: "destructive", title: "Fehler", description: error?.message });
      return;
    }
    await load();
    setSelNotiz((data as any).id);
  };

  const speichern = async () => {
    if (!selNotiz) return;
    setSaving(true);
    const { error } = await supabase
      .from("notizen" as any)
      .update({
        titel: titel.trim(),
        inhalt,
        baustelle_id: baustelleId || null,
      })
      .eq("id", selNotiz);
    setSaving(false);
    if (error) {
      toast({ variant: "destructive", title: "Speichern fehlgeschlagen", description: error.message });
      return;
    }
    setDirty(false);
    void load();
  };

  const notizLoeschen = async () => {
    if (!selNotiz || !aktuelleNotiz) return;
    if (!window.confirm(`Notiz „${aktuelleNotiz.titel || "Ohne Titel"}" löschen?`)) return;
    // Anhänge im Storage mit aufräumen
    if (anhaenge.length > 0) {
      await supabase.storage.from("notizen-anhaenge").remove(anhaenge.map((a) => a.pfad));
    }
    await supabase.from("notizen" as any).delete().eq("id", selNotiz);
    setSelNotiz(null);
    void load();
  };

  // ── Anhänge ──────────────────────────────────────────────────────
  const anhangHochladen = async (f: File | null, istSkizze = false, blob?: Blob) => {
    if (!selNotiz) return;
    const inhalt2 = blob ?? f;
    if (!inhalt2) return;
    const name = istSkizze
      ? `Skizze ${new Date().toLocaleDateString("de-AT")}.png`
      : (f?.name ?? "datei");
    if (inhalt2.size > 10 * 1024 * 1024) {
      toast({ variant: "destructive", title: "Datei zu groß", description: "Maximal 10 MB." });
      return;
    }
    const ext = istSkizze ? "png" : (f?.name.split(".").pop() || "bin");
    const pfad = `${selNotiz}/${crypto.randomUUID()}.${ext}`;
    const { error: upErr } = await supabase.storage
      .from("notizen-anhaenge")
      .upload(pfad, inhalt2, { contentType: istSkizze ? "image/png" : f?.type || undefined });
    if (upErr) {
      toast({ variant: "destructive", title: "Upload fehlgeschlagen", description: upErr.message });
      return;
    }
    const { error } = await supabase.from("notiz_anhaenge" as any).insert({
      notiz_id: selNotiz,
      pfad,
      name,
      typ: istSkizze ? "image/png" : f?.type ?? null,
      ist_skizze: istSkizze,
    });
    if (error) {
      void supabase.storage.from("notizen-anhaenge").remove([pfad]);
      toast({ variant: "destructive", title: "Fehler", description: error.message });
      return;
    }
    void ladeAnhaenge(selNotiz);
  };

  const anhangLoeschen = async (a: Anhang) => {
    if (!window.confirm(`„${a.name}" löschen?`)) return;
    await supabase.storage.from("notizen-anhaenge").remove([a.pfad]);
    await supabase.from("notiz_anhaenge" as any).delete().eq("id", a.id);
    if (selNotiz) void ladeAnhaenge(selNotiz);
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 justify-center py-16 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Lädt …
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader title="Notizen" description="Gemeinsames Notizbuch — allgemein oder je Baustelle, mit Skizzen." />

      <div className="grid grid-cols-1 lg:grid-cols-[220px_280px_1fr] gap-3">
        {/* Ordner-Spalte */}
        <Card className={selNotiz ? "hidden lg:block" : ""}>
          <CardContent className="p-2 space-y-0.5">
            <button
              onClick={() => {
                setSelOrdner("alle");
                setSelNotiz(null);
              }}
              className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-md text-sm text-left ${
                selOrdner === "alle" ? "bg-primary/10 text-primary font-medium" : "hover:bg-muted"
              }`}
            >
              <NotebookPen className="h-4 w-4 shrink-0" /> Alle Notizen
              <span className="ml-auto text-xs text-muted-foreground">{notizen.length}</span>
            </button>
            {ordner.map((o) => (
              <div
                key={o.id}
                className={`group w-full flex items-center gap-2 px-2.5 py-2 rounded-md text-sm ${
                  selOrdner === o.id ? "bg-primary/10 text-primary font-medium" : "hover:bg-muted"
                }`}
              >
                <button
                  onClick={() => {
                    setSelOrdner(o.id);
                    setSelNotiz(null);
                  }}
                  className="flex items-center gap-2 flex-1 min-w-0 text-left"
                >
                  <Folder className="h-4 w-4 shrink-0" />
                  <span className="truncate">{o.name}</span>
                  <span className="ml-auto text-xs text-muted-foreground">
                    {notizen.filter((n) => n.ordner_id === o.id).length}
                  </span>
                </button>
                <button
                  onClick={() => ordnerUmbenennen(o)}
                  className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-muted-foreground/10"
                  aria-label="Umbenennen"
                >
                  <Pencil className="h-3 w-3" />
                </button>
                <button
                  onClick={() => ordnerLoeschen(o)}
                  className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-muted-foreground/10 text-destructive"
                  aria-label="Löschen"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            ))}
            <Button variant="ghost" size="sm" className="w-full justify-start gap-2 mt-1" onClick={neuerOrdner}>
              <FolderPlus className="h-4 w-4" /> Neuer Ordner
            </Button>
          </CardContent>
        </Card>

        {/* Notizen-Liste */}
        <Card className={selNotiz ? "hidden lg:block" : ""}>
          <CardContent className="p-2 space-y-1">
            <Button size="sm" className="w-full gap-1.5 mb-1" onClick={neueNotiz}>
              <Plus className="h-4 w-4" /> Neue Notiz
            </Button>
            {sichtbareNotizen.length === 0 && (
              <div className="text-center text-sm text-muted-foreground py-8">Keine Notizen hier.</div>
            )}
            {sichtbareNotizen.map((n) => {
              const b = baustellen.find((x) => x.id === n.baustelle_id);
              return (
                <button
                  key={n.id}
                  onClick={() => setSelNotiz(n.id)}
                  className={`w-full text-left px-2.5 py-2 rounded-md ${
                    selNotiz === n.id ? "bg-primary/10" : "hover:bg-muted"
                  }`}
                >
                  <div className="text-sm font-medium truncate">{n.titel || "Ohne Titel"}</div>
                  <div className="text-[11px] text-muted-foreground truncate">
                    {fmtDatum(n.updated_at)}
                    {b ? ` · ${b.bvh_name}` : ""}
                  </div>
                </button>
              );
            })}
          </CardContent>
        </Card>

        {/* Editor */}
        <Card className={!selNotiz ? "hidden lg:block" : ""}>
          <CardContent className="p-3 space-y-3">
            {!aktuelleNotiz ? (
              <div className="text-center text-sm text-muted-foreground py-16">
                Notiz auswählen oder neu anlegen.
              </div>
            ) : (
              <>
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="lg:hidden px-2"
                    onClick={() => setSelNotiz(null)}
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <Input
                    value={titel}
                    onChange={(e) => {
                      setTitel(e.target.value);
                      setDirty(true);
                    }}
                    placeholder="Titel der Notiz"
                    className="font-semibold"
                  />
                  <Button size="sm" onClick={speichern} disabled={!dirty || saving}>
                    {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                    <span className="hidden sm:inline ml-1.5">Speichern</span>
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive px-2"
                    onClick={notizLoeschen}
                    aria-label="Notiz löschen"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>

                <div className="flex items-center gap-2">
                  <Building2 className="h-4 w-4 text-muted-foreground shrink-0" />
                  <select
                    value={baustelleId}
                    onChange={(e) => {
                      setBaustelleId(e.target.value);
                      setDirty(true);
                    }}
                    className="h-9 text-sm rounded-md border bg-background px-2 flex-1 min-w-0"
                  >
                    <option value="">Allgemein (keine Baustelle)</option>
                    {baustellen.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.bvh_name}
                      </option>
                    ))}
                  </select>
                </div>

                <Textarea
                  value={inhalt}
                  onChange={(e) => {
                    setInhalt(e.target.value);
                    setDirty(true);
                  }}
                  onBlur={() => dirty && speichern()}
                  placeholder="Notiz schreiben …"
                  rows={12}
                  className="resize-y min-h-[220px]"
                />

                {/* Anhänge + Skizzen */}
                <div className="space-y-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt"
                      className="hidden"
                      onChange={(e) => {
                        void anhangHochladen(e.target.files?.[0] ?? null);
                        e.target.value = "";
                      }}
                    />
                    <Button variant="outline" size="sm" className="gap-1.5" onClick={() => fileInputRef.current?.click()}>
                      <Paperclip className="h-4 w-4" /> Datei anheften
                    </Button>
                    <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setSkizzeOpen(true)}>
                      <Pencil className="h-4 w-4" /> Skizze zeichnen
                    </Button>
                  </div>
                  {anhaenge.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {anhaenge.map((a) => (
                        <div key={a.id} className="relative group">
                          {a.typ?.startsWith("image/") && anhangUrls.get(a.id) ? (
                            <a href={anhangUrls.get(a.id)} target="_blank" rel="noreferrer">
                              <img
                                src={anhangUrls.get(a.id)}
                                alt={a.name}
                                className="h-28 rounded-md border object-contain bg-white"
                              />
                            </a>
                          ) : (
                            <a
                              href={anhangUrls.get(a.id) ?? "#"}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1.5 rounded-md border bg-muted/50 px-2.5 py-2 text-xs hover:bg-muted"
                            >
                              <Paperclip className="h-3.5 w-3.5 text-primary" /> {a.name}
                            </a>
                          )}
                          <button
                            onClick={() => anhangLoeschen(a)}
                            className="absolute -top-1.5 -right-1.5 h-5 w-5 rounded-full bg-destructive text-destructive-foreground text-[10px] leading-none opacity-0 group-hover:opacity-100 shadow"
                            aria-label="Anhang löschen"
                          >
                            ✕
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <SkizzeDialog
        open={skizzeOpen}
        onOpenChange={setSkizzeOpen}
        onSave={(blob) => {
          setSkizzeOpen(false);
          void anhangHochladen(null, true, blob);
        }}
      />
    </div>
  );
}

// ── Skizzen-Canvas: Zeichnen mit Finger/Maus/Stift ────────────────────
const FARBEN = ["#111827", "#dc2626", "#2563eb", "#16a34a", "#f59e0b"];

function SkizzeDialog({
  open,
  onOpenChange,
  onSave,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSave: (blob: Blob) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);
  const [farbe, setFarbe] = useState(FARBEN[0]);
  const [dick, setDick] = useState(3);

  // Canvas beim Öffnen leeren (weißer Grund für PNG-Export)
  useEffect(() => {
    if (!open) return;
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, c.width, c.height);
  }, [open]);

  const pos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const c = canvasRef.current!;
    const r = c.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) / r.width) * c.width,
      y: ((e.clientY - r.top) / r.height) * c.height,
    };
  };

  const start = (e: React.PointerEvent<HTMLCanvasElement>) => {
    drawing.current = true;
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    const p = pos(e);
    ctx.strokeStyle = farbe;
    ctx.lineWidth = dick;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
  };

  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    const p = pos(e);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
  };

  const end = () => {
    drawing.current = false;
  };

  const leeren = () => {
    const c = canvasRef.current;
    const ctx = c?.getContext("2d");
    if (!c || !ctx) return;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, c.width, c.height);
  };

  const speichern = () => {
    canvasRef.current?.toBlob((blob) => {
      if (blob) onSave(blob);
    }, "image/png");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Skizze zeichnen</DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            {FARBEN.map((f) => (
              <button
                key={f}
                onClick={() => setFarbe(f)}
                className={`h-7 w-7 rounded-full border-2 ${farbe === f ? "border-primary scale-110" : "border-transparent"}`}
                style={{ background: f }}
                aria-label={`Farbe ${f}`}
              />
            ))}
            <div className="flex items-center gap-1 ml-2">
              {[2, 4, 8].map((w) => (
                <button
                  key={w}
                  onClick={() => setDick(w)}
                  className={`h-7 w-7 rounded border flex items-center justify-center ${dick === w ? "bg-primary/10 border-primary" : ""}`}
                  aria-label={`Strichstärke ${w}`}
                >
                  <span className="rounded-full bg-foreground" style={{ width: w + 2, height: w + 2 }} />
                </button>
              ))}
            </div>
            <Button variant="outline" size="sm" className="ml-auto gap-1.5" onClick={leeren}>
              <Eraser className="h-4 w-4" /> Leeren
            </Button>
          </div>
          <canvas
            ref={canvasRef}
            width={1000}
            height={620}
            className="w-full rounded-md border bg-white touch-none cursor-crosshair"
            onPointerDown={start}
            onPointerMove={move}
            onPointerUp={end}
            onPointerLeave={end}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Abbrechen
          </Button>
          <Button onClick={speichern}>
            <Save className="h-4 w-4 mr-1.5" /> Skizze speichern
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
