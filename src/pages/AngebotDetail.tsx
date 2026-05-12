import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import {
  ArrowLeft,
  Building2,
  CheckCircle2,
  Save,
  Trash2,
} from "lucide-react";
import type { Database, AngebotStatus } from "@/integrations/supabase/types";
import { AngebotDokumente } from "@/components/AngebotDokumente";
import { copyStorageObject, sanitizeStorageName } from "@/lib/uploadHelpers";

type Angebot = Database["public"]["Tables"]["angebote"]["Row"];
type Profile = Database["public"]["Tables"]["profiles"]["Row"];
type AngebotDokument = Database["public"]["Tables"]["angebot_dokumente"]["Row"];

const STATUS_OPTIONS: AngebotStatus[] = [
  "offen",
  "in_verhandlung",
  "angenommen",
  "abgelehnt",
  "zurueckgezogen",
];

const STATUS_LABEL: Record<AngebotStatus, string> = {
  offen: "Offen",
  in_verhandlung: "In Verhandlung",
  angenommen: "Angenommen",
  abgelehnt: "Abgelehnt",
  zurueckgezogen: "Zurückgezogen",
};

export default function AngebotDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { isAdmin } = useAuth();
  const [angebot, setAngebot] = useState<Angebot | null>(null);
  const [bearbeiterOptions, setBearbeiterOptions] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [converting, setConverting] = useState(false);
  const [confirmConvertOpen, setConfirmConvertOpen] = useState(false);

  // Form-State (kontrolliert)
  const [form, setForm] = useState<Partial<Angebot>>({});

  const load = async () => {
    if (!id) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("angebote")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error || !data) {
      toast({ variant: "destructive", title: "Nicht gefunden" });
      navigate("/angebote");
      return;
    }
    setAngebot(data as Angebot);
    setForm(data as Angebot);
    setLoading(false);
  };

  useEffect(() => {
    if (!isAdmin) return;
    load();
    // Bearbeiter-Optionen (alle aktiven Profile — Admin entscheidet)
    supabase
      .from("profiles")
      .select("*")
      .eq("is_active", true)
      .order("nachname")
      .then(({ data }) => {
        setBearbeiterOptions((data as Profile[]) ?? []);
      });
  }, [id, isAdmin]);

  const dirty = useMemo(() => {
    if (!angebot) return false;
    const keys: (keyof Angebot)[] = [
      "angebots_nr",
      "datum_angebot",
      "bvh_name",
      "bauherr",
      "bauherr_adresse",
      "baustellen_adresse",
      "plz",
      "ort",
      "kontakt_telefon",
      "kontakt_email",
      "wert_euro",
      "status",
      "bearbeiter_id",
      "naechste_nachfrage",
      "notizen",
    ];
    return keys.some((k) => (form[k] ?? null) !== (angebot[k] ?? null));
  }, [form, angebot]);

  const save = async () => {
    if (!angebot) return;
    setSaving(true);
    const update: any = {
      angebots_nr: form.angebots_nr?.toString().trim() || null,
      datum_angebot: form.datum_angebot || null,
      bvh_name: form.bvh_name?.toString().trim() || angebot.bvh_name,
      bauherr: form.bauherr?.toString().trim() || null,
      bauherr_adresse: form.bauherr_adresse?.toString().trim() || null,
      baustellen_adresse: form.baustellen_adresse?.toString().trim() || null,
      plz: form.plz?.toString().trim() || null,
      ort: form.ort?.toString().trim() || null,
      kontakt_telefon: form.kontakt_telefon?.toString().trim() || null,
      kontakt_email: form.kontakt_email?.toString().trim() || null,
      wert_euro:
        form.wert_euro != null && form.wert_euro !== ""
          ? Number(form.wert_euro)
          : null,
      status: form.status ?? angebot.status,
      bearbeiter_id: form.bearbeiter_id ?? null,
      naechste_nachfrage: form.naechste_nachfrage || null,
      notizen: form.notizen?.toString() || null,
    };
    const { error } = await supabase.from("angebote").update(update).eq("id", angebot.id);
    setSaving(false);
    if (error) {
      toast({ variant: "destructive", title: "Fehler", description: error.message });
      return;
    }
    toast({ title: "Angebot aktualisiert" });
    load();
  };

  const deleteAngebot = async () => {
    if (!angebot) return;
    if (angebot.baustelle_id) {
      toast({
        variant: "destructive",
        title: "Nicht löschbar",
        description: "Angebot ist bereits zu einer Baustelle umgewandelt.",
      });
      return;
    }
    if (
      !confirm(
        `Angebot „${angebot.bvh_name}" wirklich löschen? Alle Dokumente werden mit gelöscht.`
      )
    )
      return;
    // Storage-Dateien sammeln und löschen
    const { data: docs } = await supabase
      .from("angebot_dokumente")
      .select("storage_path")
      .eq("angebot_id", angebot.id);
    const paths = (docs ?? []).map((d: any) => d.storage_path).filter(Boolean);
    if (paths.length > 0) {
      await supabase.storage.from("angebote").remove(paths);
    }
    await supabase.from("angebote").delete().eq("id", angebot.id);
    toast({ title: "Angebot gelöscht" });
    navigate("/angebote");
  };

  const convertToBaustelle = async () => {
    if (!angebot) return;
    setConverting(true);
    setConfirmConvertOpen(false);

    // 1) RPC: legt Baustelle an + setzt angebote.baustelle_id
    const { data: bid, error: rpcErr } = await supabase.rpc(
      "angebot_zu_baustelle" as any,
      { p_angebot_id: angebot.id }
    );
    if (rpcErr || !bid) {
      setConverting(false);
      toast({
        variant: "destructive",
        title: "Konvertierung fehlgeschlagen",
        description: rpcErr?.message,
      });
      return;
    }
    const baustelleId = bid as string;

    // 2) Dokumente in den Baustellen-Bucket „8-kalkulation" kopieren
    const { data: docs } = await supabase
      .from("angebot_dokumente")
      .select("*")
      .eq("angebot_id", angebot.id);
    const docList = (docs as AngebotDokument[]) ?? [];
    let copied = 0;
    let failed = 0;
    const { data: u } = await supabase.auth.getUser();
    for (const d of docList) {
      const safe = sanitizeStorageName(d.dateiname);
      // Pfad: <baustelle_id>/8-kalkulation/<timestamp>_<safe>
      const dstPath = `${baustelleId}/8-kalkulation/${Date.now()}_${safe}`;
      const cp = await copyStorageObject(
        "angebote",
        d.storage_path,
        "baustellen",
        dstPath,
        d.mimetype
      );
      if (cp.error) {
        failed++;
        continue;
      }
      const { error: insErr } = await supabase.from("dokumente").insert({
        baustelle_id: baustelleId,
        ordner: "8-kalkulation",
        dateiname: d.dateiname,
        storage_path: dstPath,
        mimetype: d.mimetype,
        groesse: d.groesse,
        hochgeladen_von: u.user?.id ?? null,
      } as any);
      if (insErr) {
        failed++;
        // rollback storage
        await supabase.storage.from("baustellen").remove([dstPath]);
        continue;
      }
      copied++;
    }

    setConverting(false);
    toast({
      title: "Zu Baustelle umgewandelt",
      description: `${copied} Dokument${copied !== 1 ? "e" : ""} kopiert${
        failed > 0 ? ` · ${failed} fehlgeschlagen` : ""
      }.`,
    });
    navigate(`/baustellen/${baustelleId}`);
  };

  if (!isAdmin) {
    return (
      <div className="space-y-4">
        <PageHeader title="Angebot" />
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            Keine Berechtigung.
          </CardContent>
        </Card>
      </div>
    );
  }

  if (loading || !angebot) {
    return (
      <div className="space-y-4">
        <PageHeader title="Angebot" />
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            Lädt…
          </CardContent>
        </Card>
      </div>
    );
  }

  const upd = (k: keyof Angebot, v: any) => setForm((p) => ({ ...p, [k]: v }));

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => navigate("/angebote")}>
          <ArrowLeft className="h-4 w-4 mr-1" />
          Zurück
        </Button>
      </div>
      <PageHeader
        title={form.bvh_name ?? angebot.bvh_name}
        description={
          angebot.angebots_nr ? `Angebots-Nr. ${angebot.angebots_nr}` : undefined
        }
        actions={
          <div className="flex flex-wrap gap-2">
            <Button onClick={save} disabled={!dirty || saving}>
              <Save className="h-4 w-4 mr-2" />
              {saving ? "Speichert…" : "Speichern"}
            </Button>
            {!angebot.baustelle_id && angebot.status !== "angenommen" && (
              <Button
                variant="default"
                className="bg-emerald-600 hover:bg-emerald-700"
                onClick={() => setConfirmConvertOpen(true)}
              >
                <CheckCircle2 className="h-4 w-4 mr-2" />
                Auftrag bekommen → Baustelle
              </Button>
            )}
            {!angebot.baustelle_id && (
              <Button variant="destructive" onClick={deleteAngebot}>
                <Trash2 className="h-4 w-4 mr-2" />
                Löschen
              </Button>
            )}
          </div>
        }
      />

      {/* Banner wenn schon konvertiert */}
      {angebot.baustelle_id && (
        <Card className="border-emerald-300 bg-emerald-50">
          <CardContent className="p-3 flex items-center gap-3">
            <Building2 className="h-5 w-5 text-emerald-700" />
            <div className="flex-1 text-sm text-emerald-900">
              Dieses Angebot wurde zu einer Baustelle umgewandelt.
            </div>
            <Link to={`/baustellen/${angebot.baustelle_id}`}>
              <Button variant="outline" size="sm">
                Baustelle öffnen →
              </Button>
            </Link>
          </CardContent>
        </Card>
      )}

      {/* Stammdaten */}
      <Card>
        <CardContent className="p-4 space-y-3">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Stammdaten
          </h3>

          {/* Status-Buttons */}
          <div>
            <Label className="text-xs">Status</Label>
            <div className="flex flex-wrap gap-1.5 mt-1.5">
              {STATUS_OPTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => upd("status", s)}
                  className={`px-3 py-1.5 rounded-md text-xs font-semibold border transition ${
                    (form.status ?? angebot.status) === s
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-background hover:bg-muted"
                  }`}
                >
                  {STATUS_LABEL[s]}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="col-span-2">
              <Label className="text-xs">BV-Name</Label>
              <Input
                value={form.bvh_name ?? ""}
                onChange={(e) => upd("bvh_name", e.target.value)}
              />
            </div>
            <div>
              <Label className="text-xs">Angebots-Nr.</Label>
              <Input
                value={form.angebots_nr ?? ""}
                onChange={(e) => upd("angebots_nr", e.target.value)}
              />
            </div>
            <div>
              <Label className="text-xs">Datum Angebot</Label>
              <Input
                type="date"
                value={form.datum_angebot ?? ""}
                onChange={(e) => upd("datum_angebot", e.target.value)}
              />
            </div>

            <div className="col-span-2 mt-1 text-[10px] uppercase tracking-wide font-semibold text-muted-foreground">
              Bauherr
            </div>
            <div className="col-span-2">
              <Label className="text-xs">Bauherr</Label>
              <Input
                value={form.bauherr ?? ""}
                onChange={(e) => upd("bauherr", e.target.value)}
              />
            </div>
            <div className="col-span-2">
              <Label className="text-xs">Bauherr-Adresse</Label>
              <Input
                value={form.bauherr_adresse ?? ""}
                onChange={(e) => upd("bauherr_adresse", e.target.value)}
              />
            </div>
            <div>
              <Label className="text-xs">Telefon</Label>
              <Input
                value={form.kontakt_telefon ?? ""}
                onChange={(e) => upd("kontakt_telefon", e.target.value)}
              />
            </div>
            <div>
              <Label className="text-xs">E-Mail</Label>
              <Input
                type="email"
                value={form.kontakt_email ?? ""}
                onChange={(e) => upd("kontakt_email", e.target.value)}
              />
            </div>

            <div className="col-span-2 mt-1 text-[10px] uppercase tracking-wide font-semibold text-muted-foreground">
              Baustelle
            </div>
            <div className="col-span-2">
              <Label className="text-xs">Baustellen-Adresse</Label>
              <Input
                value={form.baustellen_adresse ?? ""}
                onChange={(e) => upd("baustellen_adresse", e.target.value)}
              />
            </div>
            <div>
              <Label className="text-xs">PLZ</Label>
              <Input value={form.plz ?? ""} onChange={(e) => upd("plz", e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Ort</Label>
              <Input value={form.ort ?? ""} onChange={(e) => upd("ort", e.target.value)} />
            </div>

            <div className="col-span-2 mt-1 text-[10px] uppercase tracking-wide font-semibold text-muted-foreground">
              Sonstiges
            </div>
            <div>
              <Label className="text-xs">Wert (€)</Label>
              <Input
                inputMode="decimal"
                value={form.wert_euro ?? ""}
                onChange={(e) => upd("wert_euro", e.target.value)}
              />
            </div>
            <div>
              <Label className="text-xs">Nächste Nachfrage</Label>
              <Input
                type="date"
                value={form.naechste_nachfrage ?? ""}
                onChange={(e) => upd("naechste_nachfrage", e.target.value)}
              />
            </div>
            <div className="col-span-2">
              <Label className="text-xs">Bearbeiter</Label>
              <select
                value={form.bearbeiter_id ?? ""}
                onChange={(e) => upd("bearbeiter_id", e.target.value || null)}
                className="w-full h-9 rounded-md border bg-background px-2 text-sm"
              >
                <option value="">— wählen —</option>
                {bearbeiterOptions.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.vorname} {p.nachname}
                  </option>
                ))}
              </select>
            </div>
            <div className="col-span-2">
              <Label className="text-xs">Notizen</Label>
              <Textarea
                value={form.notizen ?? ""}
                onChange={(e) => upd("notizen", e.target.value)}
                rows={3}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Dokumente */}
      <Card>
        <CardContent className="p-4">
          <AngebotDokumente angebotId={angebot.id} />
        </CardContent>
      </Card>

      {/* Konvertieren-Dialog */}
      <Dialog open={confirmConvertOpen} onOpenChange={setConfirmConvertOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Auftrag bekommen?</DialogTitle>
          </DialogHeader>
          <div className="text-sm space-y-2">
            <p>
              Aus dem Angebot „<strong>{angebot.bvh_name}</strong>" wird eine neue
              Baustelle angelegt.
            </p>
            <p>
              Alle Dokumente werden in den Baustellen-Ordner{" "}
              <strong>8-Kalkulation</strong> kopiert.
            </p>
            <p className="text-xs text-muted-foreground">
              Das Angebot bleibt mit Verweis auf die neue Baustelle erhalten.
            </p>
          </div>
          <DialogFooter className="flex-row gap-2">
            <Button
              variant="outline"
              onClick={() => setConfirmConvertOpen(false)}
              className="flex-1"
            >
              Abbrechen
            </Button>
            <Button
              className="flex-1 bg-emerald-600 hover:bg-emerald-700"
              onClick={convertToBaustelle}
              disabled={converting}
            >
              {converting ? "Konvertiere…" : "Ja, Baustelle anlegen"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
