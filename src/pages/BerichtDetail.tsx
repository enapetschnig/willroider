/**
 * Detail-/Edit-Seite eines einzelnen Berichts.
 *
 * Eine Page, mehrere Inline-Sektionen:
 *   - Header (Datum/Baustelle/Typ, Read-Only-Display)
 *   - Besonderes-Augenmerk-Card (wenn auf Baustelle gepflegt)
 *   - Zeiterfassungs-Reload-Banner (wenn neuer als Snapshot)
 *   - Wetter (Auto-Fetch + Manual-Override)
 *   - Mitarbeiter-Editor
 *   - Tätigkeiten-Editor
 *   - Foto-Uploader (Compress + EXIF + Doppelablage-Vermeidung)
 *   - Aufmaß-Editor (Pflicht bei Regiebericht)
 *   - Freitext-Besonderheiten
 *   - Audit-Log
 *   - Status-Bar (Einreichen → Freigeben → Archivieren; PDF wird bei Freigabe generiert)
 *
 * Schreibrechte folgen RLS: Polier nur in `entwurf`, Bauleiter/Admin auch in
 * `eingereicht`. Nach `freigegeben` nur Admin.
 */

import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { MicButton } from "@/components/MicButton";
import {
  AlertTriangle,
  ArrowLeft,
  Building2,
  Cloud,
  CloudRain,
  Edit,
  FileDown,
  FileText,
  Loader2,
  Mail,
  Plus,
  Send,
  Sun,
  Trash2,
  Camera,
  ImagePlus,
  CheckCircle2,
  Image as ImageIcon,
  X,
  History,
  RefreshCw,
} from "lucide-react";
import type {
  Database,
  BerichtStatus,
  BerichtTyp,
} from "@/integrations/supabase/types";
import {
  useBericht,
  useSetBerichtStatus,
  useUpdateBerichtFelder,
  useDeleteBericht,
} from "@/hooks/useBericht";
import {
  ladeVorausfuellung,
  uebernehmeVorausfuellung,
  pruefeZeiterfassungNeuer,
} from "@/hooks/useBerichtVorausfuellung";
import { fetchWetterFuerTag, geocodeAdresse } from "@/lib/wetter";
import { compressImage } from "@/lib/imageCompress";
import { readFotoMeta } from "@/lib/exif";
import { generateAndUploadBerichtPdf } from "@/lib/berichtPdf";

type Baustelle = Database["public"]["Tables"]["baustellen"]["Row"];
type Profile = Database["public"]["Tables"]["profiles"]["Row"];

const TYP_LABEL: Record<BerichtTyp, string> = {
  bautagesbericht: "Bautagesbericht",
  regiebericht: "Regiebericht",
};
const STATUS_BADGE: Record<BerichtStatus, { label: string; cls: string }> = {
  entwurf: { label: "Entwurf", cls: "bg-slate-100 text-slate-900 border-slate-300" },
  eingereicht: { label: "Eingereicht", cls: "bg-blue-100 text-blue-900 border-blue-300" },
  freigegeben: { label: "Freigegeben", cls: "bg-emerald-100 text-emerald-900 border-emerald-300" },
  archiviert: { label: "Archiviert", cls: "bg-gray-200 text-gray-900 border-gray-400" },
};

const fmtNum = (n: number | null | undefined) =>
  n == null ? "" : Number(n).toFixed(2).replace(".", ",");

export default function BerichtDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user, isAdmin } = useAuth();
  const { data: bericht, isLoading, refetch } = useBericht(id);
  const updateMut = useUpdateBerichtFelder();
  const statusMut = useSetBerichtStatus();

  const [baustelle, setBaustelle] = useState<Baustelle | null>(null);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [zeiterfassungNeuer, setZeiterfassungNeuer] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!bericht) return;
    (async () => {
      const [{ data: bs }, { data: ps }] = await Promise.all([
        supabase.from("baustellen").select("*").eq("id", bericht.bericht.baustelle_id).maybeSingle(),
        supabase.from("profiles").select("*").eq("is_active", true).order("nachname"),
      ]);
      setBaustelle((bs as Baustelle) ?? null);
      setProfiles((ps as Profile[]) ?? []);
    })();
  }, [bericht?.bericht.baustelle_id]);

  // Prüfe ob Zeiterfassung neuer ist als Snapshot
  useEffect(() => {
    if (!bericht?.bericht.zeiterfassung_quelle_am) return;
    pruefeZeiterfassungNeuer(
      bericht.bericht.baustelle_id,
      bericht.bericht.datum,
      bericht.bericht.zeiterfassung_quelle_am,
    ).then(setZeiterfassungNeuer);
  }, [bericht?.bericht.id, bericht?.bericht.zeiterfassung_quelle_am]);

  // Auto-Vorausfüllung beim ersten Öffnen — Hook MUSS vor Early-Returns stehen
  // (Rules of Hooks); Null-Check + Bedingungen im Effect-Body.
  // Läuft auch wenn `zeiterfassung_quelle_am` zwar gesetzt ist, der Bericht
  // aber faktisch leer ist (frühere Snapshot-Marker-Bug-Sessions) — nachfüllen
  // nur dann, wenn MAs UND Tätigkeiten noch leer sind, sodass manuelle
  // Einträge nicht überschrieben werden.
  useEffect(() => {
    if (!bericht) return;
    const b0 = bericht.bericht;
    if (b0.status !== "entwurf") return;
    if (bericht.mitarbeiter.length > 0 || bericht.taetigkeiten.length > 0) return;
    setBusy(true);
    (async () => {
      try {
        const r = await ladeVorausfuellung(b0.baustelle_id, b0.datum);
        await uebernehmeVorausfuellung(b0.id, r);
        toast({
          title:
            r.mitarbeiter.length > 0
              ? `${r.mitarbeiter.length} Mitarbeiter aus Zeiterfassung übernommen`
              : "Keine Zeiterfassung gefunden — manuell ergänzen",
        });
        refetch();
      } catch (e) {
        toast({
          variant: "destructive",
          title: "Fehler",
          description: (e as Error).message,
        });
      } finally {
        setBusy(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bericht?.bericht.id]);

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-8 flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Lade Bericht…
        </CardContent>
      </Card>
    );
  }
  if (!bericht) {
    return (
      <Card>
        <CardContent className="p-8 text-center text-sm text-muted-foreground">
          Bericht nicht gefunden.
        </CardContent>
      </Card>
    );
  }

  const b = bericht.bericht;
  const istEntwurf = b.status === "entwurf";
  const istEingereicht = b.status === "eingereicht";
  const istFreigegeben = b.status === "freigegeben";
  const istArchiviert = b.status === "archiviert";
  const istEigen = b.erfasst_von === user?.id;
  const kannEditieren =
    isAdmin ||
    (istEntwurf && istEigen) ||
    (istEingereicht && (isAdmin || istEigen)); // Polier kann auch nach Einreichung nochmal
  const istRegie = b.typ === "regiebericht";
  const sb = STATUS_BADGE[b.status];

  // Manueller "Daten neu übernehmen" Trigger (vom Reload-Banner)
  const erstvorausfuellen = async () => {
    setBusy(true);
    try {
      const r = await ladeVorausfuellung(b.baustelle_id, b.datum);
      await uebernehmeVorausfuellung(b.id, r);
      toast({
        title:
          r.mitarbeiter.length > 0
            ? `${r.mitarbeiter.length} Mitarbeiter aus Zeiterfassung übernommen`
            : "Keine Zeiterfassung gefunden — manuell ergänzen",
      });
      refetch();
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

  return (
    <div className="space-y-4 max-w-3xl mx-auto">
      <PageHeader
        title={
          <div className="flex items-center gap-2 flex-wrap">
            <Link to="/berichte" className="text-muted-foreground hover:text-foreground">
              <ArrowLeft className="h-5 w-5" />
            </Link>
            {TYP_LABEL[b.typ]}
            <Badge variant="outline" className={`text-xs ${sb.cls}`}>
              {sb.label}
            </Badge>
          </div>
        }
        description={`${new Date(b.datum).toLocaleDateString("de-AT", {
          weekday: "long",
          day: "2-digit",
          month: "long",
          year: "numeric",
        })} · ${baustelle?.bvh_name ?? ""}`}
      />

      {/* Besonderes Augenmerk */}
      {baustelle?.besonderes_augenmerk && (
        <Card className="border-amber-300 bg-amber-50">
          <CardContent className="p-3 sm:p-4 flex items-start gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-700 shrink-0 mt-0.5" />
            <div>
              <div className="font-semibold text-amber-900 text-sm">
                Besonderes Augenmerk auf dieser Baustelle
              </div>
              <div className="text-sm text-amber-800 mt-0.5 whitespace-pre-line">
                {baustelle.besonderes_augenmerk}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Zeiterfassung-Reload-Banner */}
      {zeiterfassungNeuer && kannEditieren && (
        <Card className="border-amber-300 bg-amber-50">
          <CardContent className="p-3 flex items-center gap-2 flex-wrap">
            <RefreshCw className="h-4 w-4 text-amber-700 shrink-0" />
            <span className="text-sm text-amber-900 flex-1">
              Die Zeiterfassung wurde nach Erstellung dieses Berichts geändert.
            </span>
            <Button
              size="sm"
              variant="outline"
              className="border-amber-400 text-amber-900"
              onClick={erstvorausfuellen}
              disabled={busy}
            >
              {busy && <Loader2 className="h-3 w-3 mr-1.5 animate-spin" />}
              Daten neu übernehmen
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Wetter */}
      <WetterCard
        bericht={b}
        baustelle={baustelle}
        kannEditieren={kannEditieren}
        onSave={(patch) =>
          updateMut.mutate({ id: b.id, patch }, { onSuccess: () => refetch() })
        }
      />

      {/* Mitarbeiter */}
      <MitarbeiterEditor
        berichtId={b.id}
        mitarbeiter={bericht.mitarbeiter}
        profiles={profiles}
        kannEditieren={kannEditieren}
        onChange={() => refetch()}
      />

      {/* Tätigkeiten */}
      <TaetigkeitenEditor
        berichtId={b.id}
        taetigkeiten={bericht.taetigkeiten}
        kannEditieren={kannEditieren}
        onChange={() => refetch()}
      />

      {/* Aufmaß (Pflicht bei Regie) */}
      {(istRegie || bericht.aufmass.length > 0) && (
        <AufmassEditor
          berichtId={b.id}
          aufmass={bericht.aufmass}
          pflicht={istRegie}
          kannEditieren={kannEditieren}
          onChange={() => refetch()}
        />
      )}

      {/* Fotos */}
      <FotosEditor
        bericht={b}
        baustelleId={b.baustelle_id}
        fotos={bericht.fotos}
        kannEditieren={kannEditieren}
        onChange={() => refetch()}
      />

      {/* Freitext */}
      <Card>
        <CardContent className="p-4 space-y-2">
          <Label className="text-sm font-semibold flex items-center gap-1.5">
            <Edit className="h-4 w-4 text-primary" />
            Besonderheiten / Freitext
          </Label>
          <div className="flex items-start gap-1.5">
            <Textarea
              defaultValue={b.freitext_besonderheiten ?? ""}
              onBlur={(e) => {
                const v = e.target.value.trim() || null;
                if (v !== (b.freitext_besonderheiten ?? null)) {
                  updateMut.mutate({
                    id: b.id,
                    patch: { freitext_besonderheiten: v },
                  });
                }
              }}
              disabled={!kannEditieren}
              rows={4}
              className="flex-1"
              placeholder="z.B. Lieferung verspätet, Anpassung am Plan…"
            />
            {kannEditieren && (
              <MicButton
                onText={(text) => {
                  const cur = b.freitext_besonderheiten ?? "";
                  const next = cur ? `${cur} ${text}` : text;
                  updateMut.mutate({
                    id: b.id,
                    patch: { freitext_besonderheiten: next },
                  });
                }}
                className="h-9 w-9 mt-1"
              />
            )}
          </div>
        </CardContent>
      </Card>

      {/* Status-Bar */}
      <StatusBar
        bericht={b}
        baustelle={baustelle}
        bericht_full={bericht}
        kannEditieren={kannEditieren}
        isAdmin={isAdmin}
        polierIstEigen={istEigen}
        onChange={() => refetch()}
      />

      {/* Audit-Log */}
      {bericht.aenderungen.length > 0 && (
        <Card>
          <CardContent className="p-3 sm:p-4">
            <div className="text-xs font-semibold uppercase text-muted-foreground flex items-center gap-1.5 mb-2">
              <History className="h-3.5 w-3.5" />
              Änderungs-Verlauf
            </div>
            <div className="space-y-1.5">
              {bericht.aenderungen.map((a) => {
                const autor = a.autor_id
                  ? profiles.find((p) => p.id === a.autor_id)
                  : null;
                return (
                  <div
                    key={a.id}
                    className="flex items-start gap-2 text-xs text-muted-foreground"
                  >
                    <span className="tabular-nums w-32 shrink-0">
                      {new Date(a.zeitpunkt).toLocaleString("de-AT", {
                        day: "2-digit",
                        month: "2-digit",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                    <span className="font-semibold w-32 shrink-0 truncate">
                      {autor ? `${autor.vorname} ${autor.nachname}` : "—"}
                    </span>
                    <span>
                      <span className="font-medium text-foreground">{a.art}</span>
                      {a.details && <span> · {a.details}</span>}
                    </span>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ─── Wetter-Card ──────────────────────────────────────────────────────────

function WetterCard({
  bericht,
  baustelle,
  kannEditieren,
  onSave,
}: {
  bericht: Database["public"]["Tables"]["berichte"]["Row"];
  baustelle: Baustelle | null;
  kannEditieren: boolean;
  onSave: (patch: Partial<Database["public"]["Tables"]["berichte"]["Row"]>) => void;
}) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);

  /**
   * Holt Wetter. Wenn Baustelle keine GPS-Koord. hat, wird zuerst per
   * Nominatim die Adresse geocoded und die Koord. zur Baustelle persistiert.
   * `silent=true` unterdrückt Toasts (für Auto-Fetch).
   */
  const fetchWetter = async (silent = false) => {
    if (!baustelle) return;
    let lat = baustelle.koordinaten_lat;
    let lng = baustelle.koordinaten_lng;
    setLoading(true);
    try {
      if (lat == null || lng == null) {
        const geo = await geocodeAdresse(
          baustelle.baustellen_adresse,
          baustelle.plz,
          baustelle.ort,
        );
        if (!geo) {
          if (!silent) {
            toast({
              variant: "destructive",
              title: "Adresse konnte nicht geocoded werden",
              description: "Bitte Adresse oder GPS-Koordinaten an der Baustelle pflegen.",
            });
          }
          return;
        }
        lat = geo.lat;
        lng = geo.lng;
        // Cache die Koordinaten in der Baustelle für die nächste Anfrage.
        await supabase
          .from("baustellen")
          .update({ koordinaten_lat: lat, koordinaten_lng: lng })
          .eq("id", baustelle.id);
      }
      const w = await fetchWetterFuerTag(lat, lng, bericht.datum);
      if (!w) {
        if (!silent) {
          toast({
            variant: "destructive",
            title: "Wetter konnte nicht geladen werden",
          });
        }
        return;
      }
      onSave({
        wetter_beschreibung: w.beschreibung,
        temperatur_min: w.temp_min,
        temperatur_max: w.temp_max,
        niederschlag_mm: w.niederschlag_mm,
        wetter_quelle: w.quelle,
      });
      if (!silent) toast({ title: "Wetter geladen" });
    } finally {
      setLoading(false);
    }
  };

  // Beim ersten Öffnen + wenn noch kein Wetter: auto-fetch (silent, best effort)
  useEffect(() => {
    if (
      kannEditieren &&
      !bericht.wetter_beschreibung &&
      baustelle &&
      // mindestens GPS oder Adresse muss vorhanden sein
      (baustelle.koordinaten_lat != null ||
        baustelle.baustellen_adresse ||
        baustelle.ort)
    ) {
      fetchWetter(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baustelle?.id]);

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <Label className="text-sm font-semibold flex items-center gap-1.5">
            {bericht.niederschlag_mm && bericht.niederschlag_mm > 0 ? (
              <CloudRain className="h-4 w-4 text-primary" />
            ) : (
              <Cloud className="h-4 w-4 text-primary" />
            )}
            Wetter
          </Label>
          {kannEditieren && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => fetchWetter(false)}
              disabled={
                loading ||
                (baustelle?.koordinaten_lat == null &&
                  !baustelle?.baustellen_adresse &&
                  !baustelle?.ort)
              }
            >
              {loading && <Loader2 className="h-3 w-3 mr-1.5 animate-spin" />}
              <RefreshCw className="h-3 w-3 mr-1.5" /> Aus Open-Meteo laden
            </Button>
          )}
        </div>
        {baustelle?.koordinaten_lat == null &&
          !baustelle?.baustellen_adresse &&
          !baustelle?.ort && (
            <div className="text-[11px] text-muted-foreground">
              Baustelle hat weder GPS-Koordinaten noch Adresse — Wetter manuell eintragen.
            </div>
          )}
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
          <div className="space-y-1 sm:col-span-2">
            <Label className="text-xs">Beschreibung</Label>
            <Input
              defaultValue={bericht.wetter_beschreibung ?? ""}
              onBlur={(e) => {
                const v = e.target.value.trim() || null;
                if (v !== (bericht.wetter_beschreibung ?? null))
                  onSave({ wetter_beschreibung: v, wetter_quelle: "manuell" });
              }}
              disabled={!kannEditieren}
              placeholder="z.B. Bewölkt, leichter Regen"
              className="h-9"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Temp. min/max (°C)</Label>
            <div className="flex gap-1">
              <Input
                type="number"
                step={0.5}
                defaultValue={bericht.temperatur_min ?? ""}
                onBlur={(e) => {
                  const v = e.target.value === "" ? null : Number(e.target.value);
                  if (v !== bericht.temperatur_min)
                    onSave({ temperatur_min: v, wetter_quelle: "manuell" });
                }}
                disabled={!kannEditieren}
                className="h-9"
                placeholder="min"
              />
              <Input
                type="number"
                step={0.5}
                defaultValue={bericht.temperatur_max ?? ""}
                onBlur={(e) => {
                  const v = e.target.value === "" ? null : Number(e.target.value);
                  if (v !== bericht.temperatur_max)
                    onSave({ temperatur_max: v, wetter_quelle: "manuell" });
                }}
                disabled={!kannEditieren}
                className="h-9"
                placeholder="max"
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Niederschlag (mm)</Label>
            <Input
              type="number"
              step={0.1}
              defaultValue={bericht.niederschlag_mm ?? ""}
              onBlur={(e) => {
                const v = e.target.value === "" ? null : Number(e.target.value);
                if (v !== bericht.niederschlag_mm)
                  onSave({ niederschlag_mm: v, wetter_quelle: "manuell" });
              }}
              disabled={!kannEditieren}
              className="h-9"
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Mitarbeiter-Editor ───────────────────────────────────────────────────

function MitarbeiterEditor({
  berichtId,
  mitarbeiter,
  profiles,
  kannEditieren,
  onChange,
}: {
  berichtId: string;
  mitarbeiter: Database["public"]["Tables"]["bericht_mitarbeiter"]["Row"][];
  profiles: Profile[];
  kannEditieren: boolean;
  onChange: () => void;
}) {
  const { toast } = useToast();
  const [adding, setAdding] = useState(false);
  const [newId, setNewId] = useState("");

  const profileById = new Map(profiles.map((p) => [p.id, p]));
  const verfuegbar = profiles.filter(
    (p) => !mitarbeiter.some((m) => m.mitarbeiter_id === p.id),
  );

  const add = async () => {
    if (!newId) return;
    const maxPos = mitarbeiter.reduce((m, x) => Math.max(m, x.position), 0);
    const { error } = await supabase.from("bericht_mitarbeiter").insert({
      bericht_id: berichtId,
      mitarbeiter_id: newId,
      position: maxPos + 1,
      stunden_netto: 0,
      aus_zeiterfassung: false,
    });
    if (error) {
      toast({ variant: "destructive", title: "Fehler", description: error.message });
      return;
    }
    setNewId("");
    setAdding(false);
    onChange();
  };

  const updateStd = async (id: string, neu: number) => {
    const { error } = await supabase
      .from("bericht_mitarbeiter")
      .update({ stunden_netto: neu })
      .eq("id", id);
    if (error) toast({ variant: "destructive", title: "Fehler", description: error.message });
    else onChange();
  };

  const updateNotiz = async (id: string, neu: string) => {
    const { error } = await supabase
      .from("bericht_mitarbeiter")
      .update({ taetigkeit_notiz: neu.trim() || null })
      .eq("id", id);
    if (error) toast({ variant: "destructive", title: "Fehler", description: error.message });
    else onChange();
  };

  const remove = async (id: string) => {
    const { error } = await supabase.from("bericht_mitarbeiter").delete().eq("id", id);
    if (error) {
      toast({ variant: "destructive", title: "Fehler", description: error.message });
      return;
    }
    onChange();
  };

  return (
    <Card>
      <CardContent className="p-4 space-y-2">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <Label className="text-sm font-semibold">Mitarbeiter ({mitarbeiter.length})</Label>
          {kannEditieren && !adding && verfuegbar.length > 0 && (
            <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
              <Plus className="h-3.5 w-3.5 mr-1" /> Hinzufügen
            </Button>
          )}
        </div>
        {adding && (
          <div className="flex gap-2 items-center">
            <select
              value={newId}
              onChange={(e) => setNewId(e.target.value)}
              className="h-9 flex-1 rounded-md border bg-background px-2 text-sm"
            >
              <option value="">— Mitarbeiter wählen —</option>
              {verfuegbar.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nachname} {p.vorname}
                </option>
              ))}
            </select>
            <Button size="sm" onClick={add} disabled={!newId}>
              Hinzufügen
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        )}
        {mitarbeiter.length === 0 && (
          <div className="text-xs text-muted-foreground italic">
            Keine Mitarbeiter — manuell hinzufügen oder „Daten neu übernehmen" klicken
            wenn Zeiterfassung-Daten existieren.
          </div>
        )}
        {mitarbeiter.map((m) => {
          const p = profileById.get(m.mitarbeiter_id);
          return (
            <div
              key={m.id}
              className="flex items-center gap-2 rounded-md border bg-card p-2"
            >
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">
                  {p ? `${p.nachname} ${p.vorname}` : "—"}
                  {m.aus_zeiterfassung && (
                    <Badge variant="outline" className="text-[9px] ml-1.5">
                      ZE
                    </Badge>
                  )}
                </div>
                <Input
                  placeholder="Notiz (optional)"
                  defaultValue={m.taetigkeit_notiz ?? ""}
                  onBlur={(e) => {
                    if ((e.target.value ?? "") !== (m.taetigkeit_notiz ?? ""))
                      updateNotiz(m.id, e.target.value);
                  }}
                  disabled={!kannEditieren}
                  className="h-7 text-xs mt-1"
                />
              </div>
              <Input
                type="number"
                step={0.25}
                min={0}
                defaultValue={m.stunden_netto}
                onBlur={(e) =>
                  Number(e.target.value) !== Number(m.stunden_netto) &&
                  updateStd(m.id, Number(e.target.value) || 0)
                }
                disabled={!kannEditieren}
                className="h-9 w-20 text-right"
              />
              <span className="text-xs text-muted-foreground">h</span>
              {kannEditieren && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 w-8 p-0 text-destructive"
                  onClick={() => remove(m.id)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

// ─── Tätigkeiten-Editor ───────────────────────────────────────────────────

function TaetigkeitenEditor({
  berichtId,
  taetigkeiten,
  kannEditieren,
  onChange,
}: {
  berichtId: string;
  taetigkeiten: Database["public"]["Tables"]["bericht_taetigkeiten"]["Row"][];
  kannEditieren: boolean;
  onChange: () => void;
}) {
  const { toast } = useToast();
  const [neuBezeichnung, setNeuBezeichnung] = useState("");
  const [neuStd, setNeuStd] = useState(0);

  const add = async () => {
    if (!neuBezeichnung.trim()) return;
    const maxPos = taetigkeiten.reduce((m, x) => Math.max(m, x.position), 0);
    await supabase.from("bericht_taetigkeiten").insert({
      bericht_id: berichtId,
      position: maxPos + 1,
      bezeichnung: neuBezeichnung.trim(),
      summe_stunden: neuStd,
      aus_zeiterfassung: false,
    });
    setNeuBezeichnung("");
    setNeuStd(0);
    onChange();
  };

  const update = async (
    id: string,
    patch: Partial<Database["public"]["Tables"]["bericht_taetigkeiten"]["Row"]>,
  ) => {
    await supabase.from("bericht_taetigkeiten").update(patch).eq("id", id);
    onChange();
  };

  const remove = async (id: string) => {
    const { error } = await supabase.from("bericht_taetigkeiten").delete().eq("id", id);
    if (error) {
      toast({ variant: "destructive", title: "Fehler", description: error.message });
      return;
    }
    onChange();
  };

  return (
    <Card>
      <CardContent className="p-4 space-y-2">
        <Label className="text-sm font-semibold">Tätigkeiten ({taetigkeiten.length})</Label>
        {taetigkeiten.map((t) => (
          <div key={t.id} className="flex items-center gap-1.5 rounded-md border bg-card p-2">
            <Input
              defaultValue={t.bezeichnung}
              onBlur={(e) =>
                e.target.value.trim() &&
                e.target.value !== t.bezeichnung &&
                update(t.id, { bezeichnung: e.target.value.trim() })
              }
              disabled={!kannEditieren}
              className="h-9 flex-1"
            />
            <Input
              type="number"
              step={0.25}
              min={0}
              defaultValue={t.summe_stunden}
              onBlur={(e) =>
                Number(e.target.value) !== Number(t.summe_stunden) &&
                update(t.id, { summe_stunden: Number(e.target.value) || 0 })
              }
              disabled={!kannEditieren}
              className="h-9 w-20 text-right"
            />
            <span className="text-xs text-muted-foreground">h</span>
            {t.aus_zeiterfassung && (
              <Badge variant="outline" className="text-[9px]">
                ZE
              </Badge>
            )}
            {kannEditieren && (
              <Button
                size="sm"
                variant="ghost"
                className="h-8 w-8 p-0 text-destructive"
                onClick={() => remove(t.id)}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        ))}
        {kannEditieren && (
          <div className="flex gap-1.5 items-end pt-1 border-t">
            <Input
              placeholder="Neue Tätigkeit"
              value={neuBezeichnung}
              onChange={(e) => setNeuBezeichnung(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && add()}
              className="h-9 flex-1"
            />
            <Input
              type="number"
              step={0.25}
              min={0}
              value={neuStd}
              onChange={(e) => setNeuStd(Number(e.target.value) || 0)}
              className="h-9 w-20 text-right"
            />
            <Button size="sm" onClick={add} disabled={!neuBezeichnung.trim()}>
              <Plus className="h-3.5 w-3.5 mr-1" /> hinzu
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Aufmaß-Editor ────────────────────────────────────────────────────────

function AufmassEditor({
  berichtId,
  aufmass,
  pflicht,
  kannEditieren,
  onChange,
}: {
  berichtId: string;
  aufmass: Database["public"]["Tables"]["bericht_aufmass"]["Row"][];
  pflicht: boolean;
  kannEditieren: boolean;
  onChange: () => void;
}) {
  const [neu, setNeu] = useState({
    beschreibung: "",
    menge: 0,
    einheit: "m",
  });

  const add = async () => {
    if (!neu.beschreibung.trim()) return;
    const maxPos = aufmass.reduce((m, x) => Math.max(m, x.position), 0);
    await supabase.from("bericht_aufmass").insert({
      bericht_id: berichtId,
      position: maxPos + 1,
      beschreibung: neu.beschreibung.trim(),
      menge: neu.menge || null,
      einheit: neu.einheit || null,
    });
    setNeu({ beschreibung: "", menge: 0, einheit: "m" });
    onChange();
  };

  const update = async (id: string, patch: any) => {
    await supabase.from("bericht_aufmass").update(patch).eq("id", id);
    onChange();
  };

  const remove = async (id: string) => {
    const { error } = await supabase.from("bericht_aufmass").delete().eq("id", id);
    if (error) {
      toast({ variant: "destructive", title: "Fehler", description: error.message });
      return;
    }
    onChange();
  };

  return (
    <Card className={pflicht && aufmass.length === 0 ? "border-amber-300" : undefined}>
      <CardContent className="p-4 space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-sm font-semibold">
            Aufmaß ({aufmass.length})
            {pflicht && (
              <span className="text-amber-700 ml-1.5 text-xs">
                Pflicht beim Regiebericht
              </span>
            )}
          </Label>
        </div>
        {aufmass.map((a, idx) => (
          <div key={a.id} className="rounded-md border bg-card p-2 space-y-1.5">
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground w-6 text-right tabular-nums">
                {idx + 1}.
              </span>
              <Input
                defaultValue={a.beschreibung}
                onBlur={(e) =>
                  e.target.value.trim() &&
                  e.target.value !== a.beschreibung &&
                  update(a.id, { beschreibung: e.target.value.trim() })
                }
                disabled={!kannEditieren}
                className="h-9 flex-1"
              />
              {kannEditieren && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 w-8 p-0 text-destructive"
                  onClick={() => remove(a.id)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
            <div className="grid grid-cols-3 gap-1.5">
              <Input
                type="number"
                step={0.01}
                defaultValue={a.menge ?? ""}
                placeholder="Menge"
                onBlur={(e) => {
                  const v = e.target.value === "" ? null : Number(e.target.value);
                  if (v !== a.menge) update(a.id, { menge: v });
                }}
                disabled={!kannEditieren}
                className="h-9"
              />
              <Input
                defaultValue={a.einheit ?? ""}
                placeholder="m, m², m³, Stk"
                onBlur={(e) =>
                  e.target.value !== (a.einheit ?? "") &&
                  update(a.id, { einheit: e.target.value.trim() || null })
                }
                disabled={!kannEditieren}
                className="h-9"
              />
              <Input
                defaultValue={a.notiz ?? ""}
                placeholder="Notiz"
                onBlur={(e) =>
                  e.target.value !== (a.notiz ?? "") &&
                  update(a.id, { notiz: e.target.value.trim() || null })
                }
                disabled={!kannEditieren}
                className="h-9"
              />
            </div>
          </div>
        ))}
        {kannEditieren && (
          <div className="flex gap-1.5 items-end pt-1 border-t">
            <Input
              placeholder="Neue Position"
              value={neu.beschreibung}
              onChange={(e) => setNeu({ ...neu, beschreibung: e.target.value })}
              className="h-9 flex-1"
            />
            <Input
              type="number"
              step={0.01}
              value={neu.menge}
              onChange={(e) => setNeu({ ...neu, menge: Number(e.target.value) || 0 })}
              className="h-9 w-20"
              placeholder="Menge"
            />
            <Input
              value={neu.einheit}
              onChange={(e) => setNeu({ ...neu, einheit: e.target.value })}
              className="h-9 w-16"
              placeholder="m"
            />
            <Button size="sm" onClick={add} disabled={!neu.beschreibung.trim()}>
              <Plus className="h-3.5 w-3.5" />
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Fotos-Editor ─────────────────────────────────────────────────────────

function FotosEditor({
  bericht,
  baustelleId,
  fotos,
  kannEditieren,
  onChange,
}: {
  bericht: Database["public"]["Tables"]["berichte"]["Row"];
  baustelleId: string;
  fotos: Database["public"]["Tables"]["bericht_fotos"]["Row"][];
  kannEditieren: boolean;
  onChange: () => void;
}) {
  const { toast } = useToast();
  const [uploading, setUploading] = useState(false);
  const [thumbs, setThumbs] = useState<Map<string, string>>(new Map());

  // Lade signed-URLs für Thumbnails
  useEffect(() => {
    (async () => {
      const docIds = fotos.map((f) => f.dokument_id);
      if (docIds.length === 0) return;
      const { data: docs } = await supabase
        .from("dokumente")
        .select("id, storage_path")
        .in("id", docIds);
      const newMap = new Map<string, string>();
      await Promise.all(
        (docs ?? []).map(async (d: any) => {
          const { data } = await supabase.storage
            .from("baustellen")
            .createSignedUrl(d.storage_path, 600);
          if (data?.signedUrl) newMap.set(d.id, data.signedUrl);
        }),
      );
      setThumbs(newMap);
    })();
  }, [fotos]);

  const upload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    let success = 0;
    let failed = 0;
    for (const file of Array.from(files)) {
      let uploadedPath: string | null = null;
      let createdDokId: string | null = null;
      try {
        const meta = await readFotoMeta(file);
        const compressed = await compressImage(file);
        const safeName = file.name
          .toLowerCase()
          .replace(/[ä]/g, "ae")
          .replace(/[ö]/g, "oe")
          .replace(/[ü]/g, "ue")
          .replace(/[ß]/g, "ss")
          .replace(/[^a-z0-9._-]/g, "_");
        const datum = bericht.datum;
        const storagePath = `${baustelleId}/fotos/${datum}/${Date.now()}_${safeName}`;
        const { error: upErr } = await supabase.storage
          .from("baustellen")
          .upload(storagePath, compressed, {
            contentType: compressed.type || "image/jpeg",
          });
        if (upErr) throw upErr;
        uploadedPath = storagePath;

        const { data: { user } } = await supabase.auth.getUser();
        const { data: doc, error: docErr } = await supabase
          .from("dokumente")
          .insert({
            baustelle_id: baustelleId,
            ordner: "fotos",
            subpath: datum,
            dateiname: file.name,
            storage_path: storagePath,
            groesse: compressed.size,
            mimetype: compressed.type,
            hochgeladen_von: user?.id ?? null,
          } as any)
          .select("id")
          .single();
        if (docErr) throw docErr;
        createdDokId = doc.id;

        const { error: bfErr } = await supabase.from("bericht_fotos").insert({
          bericht_id: bericht.id,
          dokument_id: doc.id,
          position: fotos.length + success + 1,
          geo_lat: meta.geo_lat,
          geo_lng: meta.geo_lng,
          aufgenommen_am: meta.aufgenommen_am,
        });
        if (bfErr) throw bfErr;
        success++;
      } catch (e) {
        console.error(e);
        // Cleanup: orphan-Dateien + dokumente-Eintrag bereinigen
        if (createdDokId) {
          try {
            await supabase.from("dokumente").delete().eq("id", createdDokId);
          } catch {
            /* ignore */
          }
        }
        if (uploadedPath) {
          try {
            await supabase.storage.from("baustellen").remove([uploadedPath]);
          } catch {
            /* ignore */
          }
        }
        failed++;
      }
    }
    setUploading(false);
    if (success > 0) {
      toast({
        title: `${success} Foto${success === 1 ? "" : "s"} hochgeladen`,
        description: failed > 0 ? `${failed} fehlgeschlagen` : undefined,
      });
      onChange();
    } else if (failed > 0) {
      toast({
        variant: "destructive",
        title: "Upload fehlgeschlagen",
        description: "Erneut versuchen oder Netz prüfen.",
      });
    }
  };

  const updateBildunterschrift = async (id: string, txt: string) => {
    await supabase
      .from("bericht_fotos")
      .update({ bildunterschrift: txt.trim() || null })
      .eq("id", id);
    onChange();
  };

  const remove = async (id: string) => {
    if (!window.confirm("Foto aus Bericht entfernen?")) return;
    await supabase.from("bericht_fotos").delete().eq("id", id);
    // Storage-Datei + dokument bleiben (Baustellen-Foto-Ordner)
    onChange();
  };

  return (
    <Card>
      <CardContent className="p-4 space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-sm font-semibold flex items-center gap-1.5">
            <ImageIcon className="h-4 w-4 text-primary" />
            Fotos ({fotos.length})
          </Label>
          {kannEditieren && (
            <div className="flex gap-1.5">
              <label className="cursor-pointer">
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    upload(e.target.files);
                    e.target.value = "";
                  }}
                  disabled={uploading}
                />
                <span className="inline-flex h-9 items-center justify-center rounded-md bg-primary text-primary-foreground px-3 text-sm font-medium hover:bg-primary/90">
                  {uploading ? (
                    <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                  ) : (
                    <Camera className="h-3.5 w-3.5 mr-1.5" />
                  )}
                  Foto machen
                </span>
              </label>
              <label className="cursor-pointer">
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    upload(e.target.files);
                    e.target.value = "";
                  }}
                  disabled={uploading}
                />
                <span className="inline-flex h-9 items-center justify-center rounded-md border bg-background px-3 text-sm font-medium hover:bg-muted">
                  <ImagePlus className="h-3.5 w-3.5 mr-1.5" />
                  Aus Galerie
                </span>
              </label>
            </div>
          )}
        </div>
        {fotos.length === 0 && (
          <div className="text-xs text-muted-foreground italic">Keine Fotos angehängt.</div>
        )}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {fotos.map((f) => {
            const url = thumbs.get(f.dokument_id);
            return (
              <div key={f.id} className="rounded-md border bg-card overflow-hidden">
                {url ? (
                  <img
                    src={url}
                    alt={f.bildunterschrift ?? ""}
                    className="w-full h-32 object-cover bg-muted"
                    loading="lazy"
                  />
                ) : (
                  <div className="w-full h-32 bg-muted flex items-center justify-center">
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  </div>
                )}
                <div className="p-1.5 space-y-1">
                  <Input
                    defaultValue={f.bildunterschrift ?? ""}
                    placeholder="Bildunterschrift"
                    onBlur={(e) =>
                      e.target.value !== (f.bildunterschrift ?? "") &&
                      updateBildunterschrift(f.id, e.target.value)
                    }
                    disabled={!kannEditieren}
                    className="h-7 text-xs"
                  />
                  {kannEditieren && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 w-full text-destructive text-xs"
                      onClick={() => remove(f.id)}
                    >
                      <Trash2 className="h-3 w-3 mr-1" /> Entfernen
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Status-Bar (Workflow + PDF-Generierung) ──────────────────────────────

function StatusBar({
  bericht,
  baustelle,
  bericht_full,
  kannEditieren,
  isAdmin,
  polierIstEigen,
  onChange,
}: {
  bericht: Database["public"]["Tables"]["berichte"]["Row"];
  baustelle: Baustelle | null;
  bericht_full: ReturnType<typeof useBericht>["data"];
  kannEditieren: boolean;
  isAdmin: boolean;
  polierIstEigen: boolean;
  onChange: () => void;
}) {
  const { toast } = useToast();
  const navigate = useNavigate();
  const statusMut = useSetBerichtStatus();
  const updateMut = useUpdateBerichtFelder();
  const deleteMut = useDeleteBericht();
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);

  const loeschen = () => {
    if (
      !window.confirm(
        "Bericht endgültig löschen? Alle Mitarbeiter-, Tätigkeits- und " +
          "Aufmaß-Zeilen, Fotos und das PDF werden mitgelöscht. Das kann " +
          "nicht rückgängig gemacht werden.",
      )
    )
      return;
    deleteMut.mutate(bericht.id, {
      onSuccess: () => {
        toast({ title: "Bericht gelöscht" });
        navigate("/berichte");
      },
      onError: (e) =>
        toast({
          variant: "destructive",
          title: "Fehler beim Löschen",
          description: (e as Error).message,
        }),
    });
  };

  // PDF-Signed-URL ziehen wenn freigegeben
  useEffect(() => {
    if (!bericht.pdf_dokument_id) {
      setPdfUrl(null);
      return;
    }
    (async () => {
      const { data: doc } = await supabase
        .from("dokumente")
        .select("storage_path")
        .eq("id", bericht.pdf_dokument_id!)
        .maybeSingle();
      if (doc?.storage_path) {
        const { data } = await supabase.storage
          .from("baustellen")
          .createSignedUrl(doc.storage_path, 3600);
        setPdfUrl(data?.signedUrl ?? null);
      }
    })();
  }, [bericht.pdf_dokument_id]);

  const generatePdf = async () => {
    if (!baustelle || !bericht_full) return;
    setPdfBusy(true);
    try {
      const fotoSignedUrls = await Promise.all(
        bericht_full.fotos.map(async (f) => {
          const { data: doc } = await supabase
            .from("dokumente")
            .select("storage_path")
            .eq("id", f.dokument_id)
            .maybeSingle();
          if (!doc?.storage_path) return null;
          const { data } = await supabase.storage
            .from("baustellen")
            .createSignedUrl(doc.storage_path, 3600);
          return {
            signedUrl: data?.signedUrl ?? "",
            bildunterschrift: f.bildunterschrift,
          };
        }),
      );

      // Profile für MA
      const profileIds = bericht_full.mitarbeiter.map((m) => m.mitarbeiter_id);
      const { data: profileData } = await supabase
        .from("profiles")
        .select("*")
        .in("id", profileIds.length > 0 ? profileIds : ["00000000-0000-0000-0000-000000000000"]);
      const profileMap = new Map(
        ((profileData as Profile[]) ?? []).map((p) => [p.id, p]),
      );
      const polierProfile = bericht.erfasst_von
        ? ((await supabase.from("profiles").select("*").eq("id", bericht.erfasst_von).maybeSingle()).data as Profile | null)
        : null;

      const { dokumentId } = await generateAndUploadBerichtPdf({
        bericht,
        baustelle,
        polier: polierProfile,
        mitarbeiter: bericht_full.mitarbeiter.map((m) => ({
          row: m,
          profil: profileMap.get(m.mitarbeiter_id) ?? null,
        })),
        taetigkeiten: bericht_full.taetigkeiten,
        aufmass: bericht_full.aufmass,
        fotos: fotoSignedUrls.filter((x): x is { signedUrl: string; bildunterschrift: string | null } => !!x),
      });

      await updateMut.mutateAsync({
        id: bericht.id,
        patch: { pdf_dokument_id: dokumentId },
      });
      await supabase.from("bericht_aenderungen").insert({
        bericht_id: bericht.id,
        art: "pdf_neu",
      });
      onChange();
      toast({ title: "PDF erstellt und im Schriftverkehr abgelegt" });
    } catch (e) {
      toast({
        variant: "destructive",
        title: "PDF-Erstellung fehlgeschlagen",
        description: (e as Error).message,
      });
    } finally {
      setPdfBusy(false);
    }
  };

  const einreichen = () =>
    statusMut.mutate(
      { id: bericht.id, newStatus: "eingereicht" },
      { onSuccess: () => onChange() },
    );

  const freigeben = async () => {
    // Validierung: Aufmaß-Pflicht beim Regiebericht
    if (bericht.typ === "regiebericht" && bericht_full && bericht_full.aufmass.length === 0) {
      if (
        !window.confirm(
          "Regiebericht ohne Aufmaß freigeben? Das ist meist nicht gewollt.",
        )
      )
        return;
    }
    // PDF zuerst generieren — wenn das fehlschlägt, NICHT auf "freigegeben" wechseln.
    // Sonst hätte der Bericht Status="freigegeben" ohne PDF, was den Workflow blockiert.
    try {
      await generatePdf();
    } catch (e) {
      toast({
        variant: "destructive",
        title: "PDF-Generierung fehlgeschlagen",
        description:
          "Bericht NICHT freigegeben — PDF muss erst erstellt werden können. " +
          (e as Error).message,
      });
      return;
    }
    await statusMut.mutateAsync({ id: bericht.id, newStatus: "freigegeben" });
    onChange();
  };

  const reopen = () =>
    statusMut.mutate(
      { id: bericht.id, newStatus: "entwurf" },
      { onSuccess: () => onChange() },
    );

  const archivieren = () =>
    statusMut.mutate(
      { id: bericht.id, newStatus: "archiviert" },
      { onSuccess: () => onChange() },
    );

  const mailto = () => {
    if (!baustelle) return;
    const subj = encodeURIComponent(
      `${bericht.typ === "bautagesbericht" ? "Bautagesbericht" : "Regiebericht"} ${baustelle.bvh_name} ${bericht.datum}`,
    );
    const body = encodeURIComponent(
      `Hallo,\n\nanbei der ${bericht.typ === "bautagesbericht" ? "Bautagesbericht" : "Regiebericht"} für ${baustelle.bvh_name} vom ${new Date(bericht.datum).toLocaleDateString("de-AT")}.\n\nPDF-Link (gültig 1 h):\n${pdfUrl ?? "(PDF noch nicht generiert)"}\n\nMit freundlichen Grüßen`,
    );
    window.open(`mailto:?subject=${subj}&body=${body}`);
  };

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="text-sm">
            <span className="font-semibold">Status:</span>{" "}
            <Badge variant="outline" className={`text-xs ${STATUS_BADGE[bericht.status].cls}`}>
              {STATUS_BADGE[bericht.status].label}
            </Badge>
          </div>
          {pdfUrl && (
            <a href={pdfUrl} target="_blank" rel="noreferrer">
              <Button size="sm" variant="outline">
                <FileDown className="h-3.5 w-3.5 mr-1.5" /> PDF öffnen
              </Button>
            </a>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {bericht.status === "entwurf" && (kannEditieren || isAdmin) && (
            <Button onClick={einreichen} disabled={statusMut.isPending}>
              <Send className="h-4 w-4 mr-1.5" /> Einreichen
            </Button>
          )}
          {bericht.status === "eingereicht" && isAdmin && (
            <Button onClick={freigeben} disabled={statusMut.isPending || pdfBusy}>
              {(statusMut.isPending || pdfBusy) && (
                <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
              )}
              <CheckCircle2 className="h-4 w-4 mr-1.5" /> Freigeben + PDF erstellen
            </Button>
          )}
          {bericht.status === "freigegeben" && isAdmin && (
            <>
              <Button onClick={generatePdf} disabled={pdfBusy} variant="outline">
                {pdfBusy && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
                <RefreshCw className="h-4 w-4 mr-1.5" /> PDF neu erstellen
              </Button>
              <Button onClick={mailto} variant="outline">
                <Mail className="h-4 w-4 mr-1.5" /> Per Mail teilen
              </Button>
              <Button onClick={archivieren} variant="outline">
                Archivieren
              </Button>
            </>
          )}
          {(bericht.status === "eingereicht" || bericht.status === "freigegeben") &&
            isAdmin && (
              <Button onClick={reopen} variant="ghost" className="text-amber-700">
                <RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Zurück auf Entwurf
              </Button>
            )}
          {isAdmin && (
            <Button
              onClick={loeschen}
              disabled={deleteMut.isPending}
              variant="ghost"
              className="text-destructive hover:bg-destructive/10"
            >
              {deleteMut.isPending && (
                <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
              )}
              <Trash2 className="h-4 w-4 mr-1.5" /> Bericht löschen
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
