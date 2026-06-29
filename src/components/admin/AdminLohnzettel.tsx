import { useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import {
  FileText,
  Paperclip,
  Trash2,
  Upload,
  Loader2,
  Search,
  CheckCircle2,
} from "lucide-react";
import {
  uploadMaDokument,
  getMaDokumentSignedUrl,
  deleteMaDokument,
} from "@/lib/maUpload";
import type { Database } from "@/integrations/supabase/types";

type Lohnzettel = Database["public"]["Tables"]["lohnzettel"]["Row"];
type Dokument = Database["public"]["Tables"]["dokumente"]["Row"];
type Profile = Database["public"]["Tables"]["profiles"]["Row"];

const MONATE = [
  "Januar",
  "Februar",
  "März",
  "April",
  "Mai",
  "Juni",
  "Juli",
  "August",
  "September",
  "Oktober",
  "November",
  "Dezember",
];

function fmtMonatJahr(l: Lohnzettel): string {
  if (l.monat && l.jahr) return `${MONATE[l.monat - 1]} ${l.jahr}`;
  if (l.titel) return l.titel;
  return new Date(l.hochgeladen_am).toLocaleDateString("de-AT");
}

export function AdminLohnzettel() {
  const { toast } = useToast();
  const { hasPermission } = useAuth();
  const canManage = hasPermission("admin.lohnzettel_verwalten");
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [selectedMa, setSelectedMa] = useState<Profile | null>(null);
  const [items, setItems] = useState<Lohnzettel[]>([]);
  const [doks, setDoks] = useState<Record<string, Dokument>>({});
  const [search, setSearch] = useState("");

  // Upload-Form
  const today = new Date();
  const [monat, setMonat] = useState<number>(today.getMonth() + 1);
  const [jahr, setJahr] = useState<number>(today.getFullYear());
  const [titel, setTitel] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Load profiles
  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("profiles")
        .select("*")
        .eq("is_active", true)
        .order("nachname");
      setProfiles((data as Profile[]) ?? []);
    })();
  }, []);

  // Load items for selected MA
  useEffect(() => {
    if (!selectedMa) {
      setItems([]);
      setDoks({});
      return;
    }
    (async () => {
      const { data } = await supabase
        .from("lohnzettel")
        .select("*")
        .eq("mitarbeiter_id", selectedMa.id)
        .order("jahr", { ascending: false })
        .order("monat", { ascending: false })
        .order("hochgeladen_am", { ascending: false });
      const list = (data as Lohnzettel[]) ?? [];
      setItems(list);
      const dokIds = list.map((l) => l.dokument_id);
      if (dokIds.length > 0) {
        const { data: d } = await supabase
          .from("dokumente")
          .select("*")
          .in("id", dokIds);
        const map: Record<string, Dokument> = {};
        (d ?? []).forEach((x: any) => (map[x.id] = x));
        setDoks(map);
      } else {
        setDoks({});
      }
    })();
  }, [selectedMa]);

  // Realtime
  useEffect(() => {
    if (!selectedMa) return;
    const ch = supabase
      .channel(`admin-lohn-${selectedMa.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "lohnzettel",
          filter: `mitarbeiter_id=eq.${selectedMa.id}`,
        },
        async () => {
          // Re-fetch
          const { data } = await supabase
            .from("lohnzettel")
            .select("*")
            .eq("mitarbeiter_id", selectedMa.id)
            .order("jahr", { ascending: false })
            .order("monat", { ascending: false });
          setItems((data as Lohnzettel[]) ?? []);
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [selectedMa]);

  const filteredProfiles = useMemo(() => {
    const s = search.trim().toLowerCase();
    if (!s) return profiles;
    return profiles.filter((p) =>
      `${p.vorname} ${p.nachname}`.toLowerCase().includes(s),
    );
  }, [profiles, search]);

  const submit = async () => {
    if (!selectedMa || !file) {
      toast({
        variant: "destructive",
        title: "Datei oder Mitarbeiter fehlt",
      });
      return;
    }
    setBusy(true);
    try {
      const r = await uploadMaDokument({
        mitarbeiterId: selectedMa.id,
        subpath: "lohnzettel",
        file,
        ordnerLabel: "lohnzettel",
      });
      const { data: u } = await supabase.auth.getUser();
      const { error } = await supabase.from("lohnzettel").insert({
        mitarbeiter_id: selectedMa.id,
        dokument_id: r.dokumentId,
        monat: monat || null,
        jahr: jahr || null,
        titel: titel.trim() || null,
        hochgeladen_von: u.user?.id ?? null,
      });
      if (error) {
        // Cleanup wenn UNIQUE-Verletzung
        await deleteMaDokument(r.dokumentId, r.storagePath);
        if (error.code === "23505") {
          throw new Error(
            `Für ${MONATE[monat - 1]} ${jahr} existiert bereits ein Lohnzettel.`,
          );
        }
        throw error;
      }
      toast({
        title: "Lohnzettel hochgeladen",
        description: `${selectedMa.vorname} ${selectedMa.nachname} · ${MONATE[monat - 1]} ${jahr}`,
      });
      setFile(null);
      setTitel("");
      if (fileRef.current) fileRef.current.value = "";
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Fehler",
        description: (e as Error).message,
      });
    } finally {
      setBusy(false);
    }
  };

  const openDokument = async (l: Lohnzettel) => {
    const d = doks[l.dokument_id];
    if (!d) return;
    const url = await getMaDokumentSignedUrl(d.storage_path);
    if (url) window.open(url, "_blank");
  };

  const remove = async (l: Lohnzettel) => {
    if (!window.confirm("Lohnzettel wirklich löschen?")) return;
    const d = doks[l.dokument_id];
    try {
      if (d) await deleteMaDokument(d.id, d.storage_path);
      await supabase.from("lohnzettel").delete().eq("id", l.id);
      toast({ title: "Lohnzettel gelöscht" });
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Fehler",
        description: (e as Error).message,
      });
    }
  };

  return (
    <div className="grid lg:grid-cols-[260px_1fr] gap-3">
      {/* MA-Liste links */}
      <Card className="lg:max-h-[80vh] lg:overflow-y-auto">
        <CardContent className="p-3 space-y-2">
          <div className="flex items-center gap-1.5 text-sm font-semibold">
            <FileText className="h-4 w-4 text-primary" />
            Mitarbeiter
          </div>
          <div className="flex items-center gap-1.5">
            <Search className="h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Suchen…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-8 text-sm"
            />
          </div>
          <div className="space-y-0.5">
            {filteredProfiles.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setSelectedMa(p)}
                className={`w-full text-left text-sm px-2 py-1.5 rounded transition ${
                  selectedMa?.id === p.id
                    ? "bg-primary/10 text-primary font-medium"
                    : "hover:bg-muted"
                }`}
              >
                {p.nachname} {p.vorname}
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Rechte Spalte */}
      <div className="space-y-3">
        {selectedMa ? (
          <>
            {/* Upload-Form */}
            {canManage && (
            <Card>
              <CardContent className="p-4 space-y-3">
                <div className="flex items-center gap-1.5 text-sm font-semibold">
                  <Upload className="h-4 w-4 text-primary" />
                  Neuer Lohnzettel für {selectedMa.vorname} {selectedMa.nachname}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label className="text-sm">Monat</Label>
                    <select
                      value={monat}
                      onChange={(e) => setMonat(Number(e.target.value))}
                      className="h-10 w-full rounded-md border bg-background px-2 text-sm"
                    >
                      {MONATE.map((m, i) => (
                        <option key={i} value={i + 1}>
                          {m}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <Label className="text-sm">Jahr</Label>
                    <Input
                      type="number"
                      min={2020}
                      max={2099}
                      value={jahr}
                      onChange={(e) => setJahr(Number(e.target.value))}
                    />
                  </div>
                </div>
                <div>
                  <Label className="text-sm">Titel (optional, z.B. „Sonderzahlung")</Label>
                  <Input
                    value={titel}
                    onChange={(e) => setTitel(e.target.value)}
                    placeholder="leer = Standard-Lohnzettel"
                  />
                </div>
                <div>
                  <Label className="text-sm">Datei (PDF empfohlen)</Label>
                  <div className="flex items-center gap-2 mt-1">
                    <input
                      ref={fileRef}
                      type="file"
                      onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                      className="flex-1 text-sm"
                    />
                  </div>
                  {file && (
                    <div className="text-xs text-muted-foreground mt-1">
                      {file.name} ({Math.round(file.size / 1024)} KB)
                    </div>
                  )}
                </div>
                <Button onClick={submit} disabled={busy || !file} className="w-full">
                  {busy && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
                  Hochladen
                </Button>
              </CardContent>
            </Card>
            )}

            {/* Liste */}
            <Card>
              <CardContent className="p-3">
                <div className="text-sm font-semibold mb-2">
                  Lohnzettel ({items.length})
                </div>
                {items.length === 0 ? (
                  <div className="text-xs text-muted-foreground italic py-3 text-center">
                    Noch kein Lohnzettel hochgeladen.
                  </div>
                ) : (
                  <div className="divide-y">
                    {items.map((l) => (
                      <div
                        key={l.id}
                        className="py-2 flex items-center gap-2 flex-wrap"
                      >
                        <div className="flex-1 min-w-[150px]">
                          <div className="text-sm font-medium">
                            {fmtMonatJahr(l)}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            Hochgeladen{" "}
                            {new Date(l.hochgeladen_am).toLocaleDateString(
                              "de-AT",
                            )}
                          </div>
                        </div>
                        {l.gelesen_am ? (
                          <Badge
                            variant="outline"
                            className="bg-emerald-50 text-emerald-700 border-emerald-200 text-[10px]"
                          >
                            <CheckCircle2 className="h-3 w-3 mr-1" /> gelesen
                          </Badge>
                        ) : (
                          <Badge
                            variant="outline"
                            className="bg-amber-50 text-amber-700 border-amber-200 text-[10px]"
                          >
                            noch nicht gelesen
                          </Badge>
                        )}
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => openDokument(l)}
                        >
                          <Paperclip className="h-3.5 w-3.5 mr-1.5" />
                          Öffnen
                        </Button>
                        {canManage && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-destructive h-8 w-8 p-0"
                            onClick={() => remove(l)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </>
        ) : (
          <Card>
            <CardContent className="p-8 text-center text-sm text-muted-foreground">
              Mitarbeiter aus der Liste wählen, um Lohnzettel hochzuladen oder
              einzusehen.
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
