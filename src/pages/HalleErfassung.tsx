/**
 * Halle/Werkstatt-Zeiterfassung — schlanke Self-Erfassung für Mitarbeiter,
 * die täglich an mehreren Maschinen arbeiten. Maschinen sind `baustellen`
 * mit `kategorie='maschine'`. Bewusst ohne Polier-Fahrt, Zulagen oder
 * Kilometergeld — alles, was hier nicht hingehört, ist weggelassen.
 */

import { Fragment, useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import {
  ChevronLeft,
  ChevronRight,
  Edit,
  Loader2,
  Plus,
  Wrench,
} from "lucide-react";
import type { Database, TagStatus } from "@/integrations/supabase/types";
import { localIso } from "@/lib/dateFmt";
import { fmtH } from "@/lib/zeiterfassung";
import {
  useStundenTageList,
  useSaveStundenTag,
  type SaveEintrag,
} from "@/hooks/useStundenTag";
import { useSollHoursForDayBulk } from "@/hooks/useSollHoursForDayBulk";
import { useTaetigkeitenStamm } from "@/hooks/useStammdatenStunden";
import { StatusButtonsLeiste } from "@/components/stunden/StatusButtonsLeiste";
import { ArtSection } from "@/components/stunden/ArtSection";
import {
  gruppiereSections,
  istArbeitArt,
  newKey,
  type EintragRow,
} from "@/components/stunden/zeiterfassungUi";

type Baustelle = Database["public"]["Tables"]["baustellen"]["Row"];

const HALLE_STATUS_OPTIONS: TagStatus[] = [
  "baustelle", // = Maschine
  "krank",
  "urlaub",
  "schlechtwetter",
];

/** Erkennt, ob ein Eintrag in den Halle-„Bereich" gehört (Maschine oder
 *  Abwesenheit, die hier erfasst wird). Wird beim Merge-Save verwendet. */
function gehoertZurHalle(
  e: { art: TagStatus; baustelle_id: string | null },
  maschinenIds: Set<string>,
): boolean {
  if (e.art === "baustelle") {
    return !!e.baustelle_id && maschinenIds.has(e.baustelle_id);
  }
  return ["krank", "urlaub", "schlechtwetter"].includes(e.art);
}

export default function HalleErfassung() {
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [date, setDate] = useState<string>(localIso);
  const [maschinen, setMaschinen] = useState<Baustelle[]>([]);

  // Maschinen laden
  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("baustellen")
        .select("*")
        .eq("kategorie", "maschine")
        .eq("status", "aktiv")
        .order("kostenstelle");
      setMaschinen((data as Baustelle[]) ?? []);
    })();
  }, []);

  const maschinenIds = useMemo(
    () => new Set(maschinen.map((m) => m.id)),
    [maschinen],
  );

  const primaryUserId = user?.id ?? "";

  const { data: taetigkeitenStamm = [] } = useTaetigkeitenStamm({
    bereich: "halle",
  });
  const { sollPerMa } = useSollHoursForDayBulk(
    primaryUserId ? [primaryUserId] : [],
    date,
  );

  // Eigene letzten Tage (top)
  const fromDate = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 14);
    return localIso(d);
  }, []);
  const { data: tageList = [], refetch: refetchTage } = useStundenTageList({
    fromDate,
    mitarbeiterIds: primaryUserId ? [primaryUserId] : [],
    enabled: !!primaryUserId,
  });
  const aktuellerEigenerTag = useMemo(
    () => tageList.find((t) => t.tag.datum === date),
    [tageList, date],
  );

  // Form-State (nur Halle-Einträge: Maschinen oder Abwesenheiten)
  const [eintraege, setEintraege] = useState<EintragRow[]>([]);
  const [arbeitsbeginn, setArbeitsbeginn] = useState<string>("");
  const [anmerkung, setAnmerkung] = useState<string>("");

  // Laden: nur Halle-relevante Einträge in den Form-State, der Rest wird
  // beim Speichern unverändert bewahrt.
  useEffect(() => {
    if (!aktuellerEigenerTag) {
      setEintraege([]);
      setArbeitsbeginn("");
      setAnmerkung("");
      return;
    }
    const t = aktuellerEigenerTag;
    const halleEntries = t.taetigkeiten.filter((tt) =>
      gehoertZurHalle(tt, maschinenIds),
    );
    setEintraege(
      halleEntries.map((tt) => ({
        key: newKey(),
        art: tt.art,
        baustelle_id: tt.baustelle_id,
        taetigkeit_id: tt.taetigkeit_id,
        taetigkeit_freitext: tt.taetigkeit_freitext ?? "",
        stunden: Number(tt.stunden),
        notiz: tt.notiz ?? "",
      })),
    );
    setArbeitsbeginn(t.tag.arbeitsbeginn?.slice(0, 5) ?? "");
    setAnmerkung(t.tag.anmerkung ?? "");
  }, [aktuellerEigenerTag, maschinenIds]);

  const aktiveArten = useMemo(() => {
    const s = new Set<TagStatus>();
    for (const r of eintraege) s.add(r.art);
    return s;
  }, [eintraege]);

  const sections = useMemo(() => gruppiereSections(eintraege), [eintraege]);
  const lastBaustelleIdx = sections.reduce(
    (last, s, idx) => (s.art === "baustelle" ? idx : last),
    -1,
  );

  const sollH = sollPerMa.get(primaryUserId) ?? 0;

  // Default-Eintrag bei Toggle-On
  const defaultEintrag = (art: TagStatus): EintragRow => ({
    key: newKey(),
    art,
    baustelle_id: null,
    taetigkeit_id: null,
    taetigkeit_freitext: "",
    stunden: eintraege.length === 0 ? sollH : 0,
    notiz: "",
  });

  const toggleArt = (art: TagStatus) => {
    if (aktiveArten.has(art)) {
      setEintraege((es) => es.filter((r) => r.art !== art));
    } else {
      setEintraege((es) => [...es, defaultEintrag(art)]);
    }
  };

  const updateEintrag = (key: string, patch: Partial<EintragRow>) =>
    setEintraege((es) =>
      es.map((r) => (r.key === key ? { ...r, ...patch } : r)),
    );
  const removeEintrag = (key: string) =>
    setEintraege((es) => es.filter((r) => r.key !== key));
  const addSplit = (art: TagStatus, baustelle_id: string | null) =>
    setEintraege((es) => [
      ...es,
      {
        key: newKey(),
        art,
        baustelle_id: art === "baustelle" ? baustelle_id : null,
        taetigkeit_id: null,
        taetigkeit_freitext: "",
        stunden: 0,
        notiz: "",
      },
    ]);
  const setSectionBaustelle = (rowKeys: string[], baustelle_id: string | null) => {
    const set = new Set(rowKeys);
    setEintraege((es) =>
      es.map((r) => (set.has(r.key) ? { ...r, baustelle_id } : r)),
    );
  };
  const addWeitereMaschine = () =>
    setEintraege((es) => [
      ...es,
      {
        key: newKey(),
        art: "baustelle",
        baustelle_id: null,
        taetigkeit_id: null,
        taetigkeit_freitext: "",
        stunden: 0,
        notiz: "",
      },
    ]);

  const saveMut = useSaveStundenTag();
  const [busy, setBusy] = useState(false);

  const total = eintraege.reduce((s, r) => s + Number(r.stunden || 0), 0);

  // Submit: Halle-Einträge speichern, fremde Einträge (echte Baustellen,
  // Firma, Feiertag) unverändert übernehmen.
  const submit = async () => {
    if (!primaryUserId) return;
    // Freigegebene/exportierte Tage sind gesperrt — gleiche Regel wie
    // TagBearbeitenDialog. Die RLS blockt das inzwischen auch DB-seitig,
    // aber ohne diesen Guard käme ein verwirrender Fehler statt Klartext.
    const tagStatus = aktuellerEigenerTag?.tag.status;
    if (tagStatus === "buero_freigabe" || tagStatus === "exportiert") {
      toast({
        variant: "destructive",
        title: "Tag ist freigegeben",
        description:
          "Dieser Tag wurde vom Büro bereits freigegeben und kann nicht mehr geändert werden.",
      });
      return;
    }
    setBusy(true);
    try {
      // Halle-Einträge aus dem Form
      const halleSaveRows: SaveEintrag[] = eintraege
        .filter(
          (e) =>
            Number(e.stunden) > 0 ||
            e.taetigkeit_id ||
            e.taetigkeit_freitext.trim(),
        )
        .map((e) => {
          const arbeit = istArbeitArt(e.art);
          return {
            position: 0, // wird gleich neu nummeriert
            art: e.art,
            taetigkeit_id: arbeit ? e.taetigkeit_id : null,
            taetigkeit_freitext:
              arbeit && !e.taetigkeit_id
                ? e.taetigkeit_freitext.trim() || null
                : null,
            baustelle_id: e.art === "baustelle" ? e.baustelle_id : null,
            stunden: Number(e.stunden),
            notiz: e.notiz.trim() || null,
          };
        });

      // Fremde Einträge (echte Baustellen / Firma / Feiertag) erhalten —
      // direkt aus dem existierenden Tag laden.
      const fremde: SaveEintrag[] =
        aktuellerEigenerTag?.taetigkeiten
          .filter((tt) => !gehoertZurHalle(tt, maschinenIds))
          .map((tt) => ({
            position: 0,
            art: tt.art,
            taetigkeit_id: tt.taetigkeit_id,
            taetigkeit_freitext: tt.taetigkeit_freitext,
            baustelle_id: tt.baustelle_id,
            stunden: Number(tt.stunden),
            notiz: tt.notiz,
          })) ?? [];

      const taetigkeiten: SaveEintrag[] = [...fremde, ...halleSaveRows].map(
        (e, idx) => ({ ...e, position: idx + 1 }),
      );

      // Zulagen + Fahrt unverändert übernehmen (Halle-Seite verwaltet die nicht)
      const zulagen =
        aktuellerEigenerTag?.zulagen.map((z) => ({
          zulagen_typ_id: z.zulagen_typ_id,
          stunden: z.stunden != null ? Number(z.stunden) : null,
          notiz: z.notiz,
        })) ?? [];
      const fahrt = aktuellerEigenerTag?.fahrt
        ? {
            fahrtgeld_eur: Number(aktuellerEigenerTag.fahrt.fahrtgeld_eur ?? 0),
            privat_pkw: aktuellerEigenerTag.fahrt.privat_pkw,
            km_gefahren:
              aktuellerEigenerTag.fahrt.km_gefahren != null
                ? Number(aktuellerEigenerTag.fahrt.km_gefahren)
                : null,
            taggeld_kurz: Number(aktuellerEigenerTag.fahrt.taggeld_kurz ?? 0),
            taggeld_lang: Number(aktuellerEigenerTag.fahrt.taggeld_lang ?? 0),
            taggeld_manuell: aktuellerEigenerTag.fahrt.taggeld_manuell,
          }
        : null;

      await saveMut.mutateAsync({
        id: aktuellerEigenerTag?.tag.id,
        mitarbeiter_id: primaryUserId,
        datum: date,
        arbeitsbeginn: arbeitsbeginn || null,
        anmerkung: anmerkung.trim() || null,
        taetigkeiten,
        zulagen,
        fahrt,
      });
      toast({ title: "Halle-Stunden gespeichert" });
      refetchTage();
      qc.invalidateQueries({ queryKey: ["stunden_tage_list"] });
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

  const moveDate = (d: number) => {
    const nd = new Date(date);
    nd.setDate(nd.getDate() + d);
    setDate(localIso(nd));
  };

  return (
    <div className="space-y-4 max-w-2xl mx-auto pb-24 lg:pb-0">
      <PageHeader title="Halle / Werkstatt" />

      {/* Datum */}
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="icon"
              className="h-11 w-11 shrink-0"
              onClick={() => moveDate(-1)}
            >
              <ChevronLeft className="h-5 w-5" />
            </Button>
            <Input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="text-center font-medium h-11"
            />
            <Button
              variant="outline"
              size="icon"
              className="h-11 w-11 shrink-0"
              onClick={() => moveDate(1)}
            >
              <ChevronRight className="h-5 w-5" />
            </Button>
          </div>
          <div className="text-xs text-muted-foreground text-center">
            {new Date(date).toLocaleDateString("de-AT", {
              weekday: "long",
              day: "2-digit",
              month: "long",
              year: "numeric",
            })}
          </div>
        </CardContent>
      </Card>

      {/* Form */}
      <Card>
        <CardContent className="p-4 space-y-4">
          <h3 className="text-base font-bold flex items-center gap-2">
            {aktuellerEigenerTag ? (
              <>
                <Edit className="h-4 w-4 text-primary" />
                Tag bearbeiten
              </>
            ) : (
              <>
                <Wrench className="h-4 w-4 text-primary" />
                Tag erfassen
              </>
            )}
            <span className="ml-auto text-sm tabular-nums font-bold">
              {fmtH(total)}
            </span>
            {sollH > 0 && (
              <span className="text-[11px] text-muted-foreground tabular-nums">
                / Soll {sollH}
              </span>
            )}
          </h3>

          <StatusButtonsLeiste
            fuerAnzahl={1}
            aktiveArten={aktiveArten}
            onToggle={toggleArt}
            optionen={HALLE_STATUS_OPTIONS}
            kategorie="maschine"
          />

          {sections.length === 0 && (
            <div className="text-xs text-muted-foreground italic text-center py-2">
              Oben „Werk/Maschine" antippen, um Stunden einzutragen.
            </div>
          )}

          {sections.map((s, idx) => (
            <Fragment key={s.key}>
              <ArtSection
                art={s.art}
                rows={s.rows}
                baustellen={maschinen}
                taetigkeitenStamm={taetigkeitenStamm}
                onUpdate={updateEintrag}
                onRemove={removeEintrag}
                onAddSplit={() =>
                  addSplit(
                    s.art,
                    s.rows[s.rows.length - 1]?.baustelle_id ?? null,
                  )
                }
                onSectionBaustelle={(b) =>
                  setSectionBaustelle(s.rows.map((r) => r.key), b)
                }
                kategorie="maschine"
              />
              {idx === lastBaustelleIdx && (
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full h-11"
                  onClick={addWeitereMaschine}
                >
                  <Plus className="h-4 w-4 mr-1.5" />
                  weiteres Werk / weitere Maschine
                </Button>
              )}
            </Fragment>
          ))}

          {/* Anmerkung */}
          <div className="space-y-1 border-t pt-3">
            <Label className="text-sm">Anmerkung (optional)</Label>
            <Textarea
              value={anmerkung}
              onChange={(e) => setAnmerkung(e.target.value)}
              rows={2}
              className="text-sm"
            />
          </div>

          {/* Submit Desktop */}
          <Button
            onClick={submit}
            disabled={busy}
            className="w-full h-12 text-base hidden lg:flex"
          >
            {busy && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {aktuellerEigenerTag ? "Änderungen speichern" : "Tag speichern"}
          </Button>
        </CardContent>
      </Card>

      {/* Mobile Sticky Submit */}
      <div
        className="lg:hidden fixed left-0 right-0 z-20 px-3 py-2 bg-card border-t shadow-lg"
        style={{ bottom: "calc(env(safe-area-inset-bottom, 0px) + 56px)" }}
      >
        <Button
          onClick={submit}
          disabled={busy}
          className="w-full h-12 text-base"
        >
          {busy && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
          {aktuellerEigenerTag ? "Änderungen speichern" : "Tag speichern"}
        </Button>
      </div>
    </div>
  );
}
