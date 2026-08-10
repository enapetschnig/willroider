/**
 * Tätigkeitsbericht — Zeiterfassung der Angestellten.
 *
 * Nachbau der Excel-Vorlage (Tätigkeitsbericht_Vorlage.xlsx): Matrix
 * Kostenstelle × Tag, Periode 21.–20., darunter die Summenzeilen, dann
 * Taggeld, Kilometer und die Unterschrift. Farben und Rahmen kommen aus
 * TB_FARBEN — Bildschirm und PDF nutzen dieselben Werte.
 *
 * Zweiter Reiter: das Fahrtenbuch derselben Periode. Seine Kilometer
 * fließen direkt in die Zeile „gefahrene km" des Berichts.
 *
 * Gespeichert wird in `stunden_tage` + `stunden_taetigkeiten` — dieselben
 * Tabellen wie die herkömmliche Erfassung. Fremde Einträge desselben Tages
 * (Halle/Maschine, echte Baustellen aus /stunden) bleiben beim Speichern
 * erhalten; das Muster stammt aus HalleErfassung.tsx.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { ChevronLeft, ChevronRight, Loader2, Pen, Plus, Printer, Trash2, Users } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useStundenTageList, useSaveStundenTag, useDeleteStundenTag, type SaveEintrag } from "@/hooks/useStundenTag";
import { localIso } from "@/lib/dateFmt";
import {
  ANGESTELLTEN_SOLL,
  TB_FARBEN,
  UEBERSTUNDEN_GRENZE,
  UEBERSTUNDEN_WARNUNG,
  WOCHENTAG_KURZ,
  berechneSummen,
  ladeBerichtZeilen,
  periodeTitel,
  periodeVerschieben,
  periodeVonDatum,
  r2,
  tagSpaltenFarbe,
  tagesBeschriftung,
  wochentagIndex,
  type BerichtZeile,
  type Periode,
} from "@/lib/taetigkeitsbericht";
import {
  makeFahrtenbuchPdf,
  makeTaetigkeitsberichtPdf,
} from "@/lib/taetigkeitsberichtPdf";
import { aufStundenRaster } from "@/components/stunden/zeiterfassungUi";
import { UnterschriftDialog } from "@/components/UnterschriftDialog";
import { FahrtenbuchTab, type FahrtRow } from "@/components/taetigkeitsbericht/FahrtenbuchTab";
import type { Database, TagStatus } from "@/integrations/supabase/types";

type Profile = Database["public"]["Tables"]["profiles"]["Row"];

/** Stundenzahl: immer EINE Kommastelle („8,0"), 0 bleibt leer. Zwei
 *  Stellen nur, wenn ein Altwert wirklich auf die Viertelstunde geht. */
const z = (n: number | null | undefined): string => {
  if (n == null || n === 0) return "";
  const v = r2(n);
  const stellen = Math.round(Math.abs(v) * 100) % 10 !== 0 ? 2 : 1;
  return v.toFixed(stellen).replace(".", ",");
};

/** Zähler ohne Kommastellen — fürs Taggeld („1", nicht „1,0"). */
const zGanz = (n: number | null | undefined): string =>
  n == null || n === 0 ? "" : String(r2(n)).replace(".", ",");

// ─── Excel-Optik ───────────────────────────────────────────────────────
// Serifenschrift, feine schwarze Linien; die Blöcke (Kopf, Summen) trennen
// sich über stärkere Rahmen — wie in der Vorlage.
const SERIF = '"Times New Roman", Times, Georgia, serif';
const LINIE = "1px solid #000";
const td: React.CSSProperties = {
  border: LINIE,
  padding: "2px 4px",
  fontFamily: SERIF,
  // Auf Wunsch größer — die Werte waren am Bildschirm schwer lesbar.
  fontSize: 15,
  lineHeight: 1.3,
  whiteSpace: "nowrap",
};
const tdZahl: React.CSSProperties = { ...td, textAlign: "right", minWidth: 34 };
const tdLabel: React.CSSProperties = { ...td, textAlign: "left", fontWeight: 700 };

export default function Taetigkeitsbericht() {
  const { user, profile, isAdmin, hasPermission } = useAuth();
  const { toast } = useToast();
  const darfFremde = hasPermission("stunden.taetigkeitsbericht");

  const [periode, setPeriode] = useState<Periode>(() => periodeVonDatum(localIso()));
  const [tab, setTab] = useState<"bericht" | "fahrtenbuch">("bericht");
  const [maId, setMaId] = useState<string>("");
  const [angestellte, setAngestellte] = useState<Profile[]>([]);
  const [zeilenStamm, setZeilenStamm] = useState<BerichtZeile[]>([]);
  const [sichtbar, setSichtbar] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [pickerOffen, setPickerOffen] = useState(false);

  const zielMa = maId || user?.id || "";
  const istEigener = zielMa === user?.id;
  const kannBearbeiten = istEigener || isAdmin;

  // ─── Stammdaten ──────────────────────────────────────────────────────
  useEffect(() => {
    ladeBerichtZeilen().then(setZeilenStamm);
  }, []);

  useEffect(() => {
    if (!darfFremde) return;
    supabase
      .from("profiles")
      .select("*")
      .eq("is_active", true)
      .eq("zeiterfassung_typ", "angestellter" as any)
      .order("nachname")
      .then(({ data }) => setAngestellte((data as Profile[]) ?? []));
  }, [darfFremde]);

  // ─── Tage der Periode ────────────────────────────────────────────────
  const { data: tageList = [], refetch } = useStundenTageList({
    fromDate: periode.von,
    toDate: periode.bis,
    mitarbeiterIds: zielMa ? [zielMa] : [],
    enabled: !!zielMa,
  });

  /** iso → der geladene Tag */
  const tagByIso = useMemo(() => {
    const m = new Map<string, (typeof tageList)[number]>();
    tageList.forEach((t) => m.set(t.tag.datum, t));
    return m;
  }, [tageList]);

  // ─── Fahrtenbuch der Periode ─────────────────────────────────────────
  const [fahrten, setFahrten] = useState<FahrtRow[]>([]);
  const ladeFahrten = useCallback(async () => {
    if (!zielMa) return;
    const { data } = await supabase
      .from("fahrtenbuch_eintraege" as any)
      .select("*")
      .eq("mitarbeiter_id", zielMa)
      .gte("datum", periode.von)
      .lte("datum", periode.bis)
      .order("datum")
      .order("abfahrt", { ascending: true, nullsFirst: true });
    setFahrten((data as any as FahrtRow[]) ?? []);
  }, [zielMa, periode.von, periode.bis]);
  useEffect(() => {
    ladeFahrten();
  }, [ladeFahrten]);

  // ─── Unterschrift der Periode ────────────────────────────────────────
  const [unterschrift, setUnterschrift] = useState<{ data: string; am: string } | null>(null);
  const [signOffen, setSignOffen] = useState(false);
  const ladeUnterschrift = useCallback(async () => {
    if (!zielMa) return;
    const { data } = await supabase
      .from("taetigkeitsbericht_unterschriften" as any)
      .select("unterschrift_data, unterschrieben_am")
      .eq("mitarbeiter_id", zielMa)
      .eq("jahr", periode.jahr)
      .eq("monat", periode.monat)
      .maybeSingle();
    const row = data as any;
    setUnterschrift(
      row ? { data: row.unterschrift_data, am: row.unterschrieben_am } : null,
    );
  }, [zielMa, periode.jahr, periode.monat]);
  useEffect(() => {
    ladeUnterschrift();
  }, [ladeUnterschrift]);

  async function speichereUnterschrift(dataUrl: string) {
    const { error } = await supabase
      .from("taetigkeitsbericht_unterschriften" as any)
      .upsert(
        {
          mitarbeiter_id: zielMa,
          jahr: periode.jahr,
          monat: periode.monat,
          unterschrift_data: dataUrl,
          unterschrieben_am: new Date().toISOString(),
        },
        { onConflict: "mitarbeiter_id,jahr,monat" },
      );
    if (error) {
      toast({ variant: "destructive", title: "Nicht gespeichert", description: error.message });
      return;
    }
    setSignOffen(false);
    ladeUnterschrift();
    toast({ title: "Unterschrift gespeichert" });
  }

  // ─── Matrix aus den geladenen Tagen aufbauen ─────────────────────────
  /** `zellen[zeilenKey][iso]` = Stunden */
  const zellen = useMemo(() => {
    const out: Record<string, Record<string, number>> = {};
    for (const t of tageList) {
      for (const e of t.taetigkeiten) {
        const key = e.baustelle_id
          ? `bs:${e.baustelle_id}`
          : e.taetigkeit_id
          ? `int:${e.taetigkeit_id}`
          : null;
        // Abwesenheiten laufen über tag_status, nicht über die Matrix.
        if (!key || (e.art !== "baustelle" && e.art !== "firma")) continue;
        out[key] ??= {};
        out[key][t.tag.datum] = r2((out[key][t.tag.datum] ?? 0) + Number(e.stunden));
      }
    }
    return out;
  }, [tageList]);

  /** Abwesenheiten. Urlaub ist hier BEARBEITBAR (eigene Zeile in der
   *  Tabelle); Krankheit kommt aus der Krankmeldung, Feiertag aus dem
   *  Kalender, Sonderurlaub aus dem Stamm. */
  const sonder = useMemo(() => {
    const leer = () => ({} as Record<string, number>);
    const out: Record<string, Record<string, number>> = {
      urlaub: leer(),
      sonderurlaub: leer(),
      krankheit: leer(),
      feiertag: leer(),
    };
    const sollVon = (iso: string) => ANGESTELLTEN_SOLL[wochentagIndex(iso)];

    for (const iso of periode.tage) {
      const info = tagesBeschriftung(iso);
      if (!info) continue;
      const soll = sollVon(iso);
      if (soll === 0) continue;
      // 24./31.12. sind kein gesetzlicher Feiertag → Sonderurlaub, wie in der Excel.
      if (info.scope === "betrieblich") out.sonderurlaub[iso] = soll;
      else out.feiertag[iso] = soll;
    }

    for (const t of tageList) {
      const iso = t.tag.datum;
      const st = t.tag.tag_status;
      // Urlaub: erst die stundenweisen Einträge (bearbeitbar), dann der
      // 0-h-Marker aus dem genehmigten Antrag (zeigt das Tages-Soll).
      const urlaubStd = t.taetigkeiten
        .filter((e) => e.art === "urlaub")
        .reduce((a, e) => a + Number(e.stunden), 0);
      if (urlaubStd > 0) out.urlaub[iso] = r2(urlaubStd);
      else if (st === "urlaub") out.urlaub[iso] = Number(t.tag.netto_stunden) || sollVon(iso);
      if (st === "krank") out.krankheit[iso] = Number(t.tag.netto_stunden) || sollVon(iso);
      // Sonderurlaub-Einträge aus dem Stamm ergänzen die Feiertags-Ableitung.
      const sonderStd = t.taetigkeiten
        .filter((e) => e.taetigkeit_id && zeilenStamm.some(
          (zz) => zz.taetigkeitId === e.taetigkeit_id && zz.bezeichnung === "Sonderurlaub",
        ))
        .reduce((a, e) => a + Number(e.stunden), 0);
      if (sonderStd > 0) out.sonderurlaub[iso] = r2(sonderStd);
    }
    return out;
  }, [tageList, periode.tage, zeilenStamm]);

  // Zeilen, die angezeigt werden: alles mit Stunden plus manuell zugeschaltete.
  useEffect(() => {
    const mitStunden = Object.keys(zellen).filter((k) =>
      periode.tage.some((t) => (zellen[k]?.[t] ?? 0) > 0),
    );
    setSichtbar((cur) => Array.from(new Set([...cur, ...mitStunden])));
  }, [zellen, periode.tage]);

  const zeilen = useMemo(() => {
    const byKey = new Map(zeilenStamm.map((zz) => [zz.key, zz]));
    return sichtbar
      .map((k) => byKey.get(k))
      .filter((x): x is BerichtZeile => !!x)
      .sort((a, b) => {
        // Interne zuerst (wie in der Excel), dann nach Kostenstelle.
        const ia = a.art === "firma" ? 0 : 1;
        const ib = b.art === "firma" ? 0 : 1;
        if (ia !== ib) return ia - ib;
        return a.kst.localeCompare(b.kst) || a.bezeichnung.localeCompare(b.bezeichnung);
      });
  }, [sichtbar, zeilenStamm]);

  const summen = useMemo(
    () => berechneSummen(periode.tage, zellen, sonder),
    [periode.tage, zellen, sonder],
  );

  /** Taggeld aus stunden_fahrt; Kilometer aus dem FAHRTENBUCH — die alte
   *  stunden_fahrt-Quelle bleibt nur als Rückfall für Tage ohne Fahrten. */
  const fahrtWerte = useMemo(() => {
    const tg6: Record<string, number> = {};
    const tg11: Record<string, number> = {};
    const km: Record<string, number> = {};
    for (const t of tageList) {
      if (!t.fahrt) continue;
      if (t.fahrt.taggeld_kurz) tg6[t.tag.datum] = Number(t.fahrt.taggeld_kurz);
      if (t.fahrt.taggeld_lang) tg11[t.tag.datum] = Number(t.fahrt.taggeld_lang);
      if (t.fahrt.km_gefahren) km[t.tag.datum] = Number(t.fahrt.km_gefahren);
    }
    const kmFb: Record<string, number> = {};
    for (const f of fahrten) {
      kmFb[f.datum] = r2((kmFb[f.datum] ?? 0) + Number(f.km ?? 0));
    }
    return { tg6, tg11, km: { ...km, ...kmFb } };
  }, [tageList, fahrten]);

  const summeVon = (m: Record<string, number>) =>
    r2(periode.tage.reduce((a, t) => a + (m[t] ?? 0), 0));

  // ─── Speichern einer Zelle ───────────────────────────────────────────
  const saveMut = useSaveStundenTag();
  const deleteMut = useDeleteStundenTag();

  async function speichereZelle(zeile: BerichtZeile, iso: string, wert: number) {
    if (!zielMa) return;
    const key = `${zeile.key}|${iso}`;
    setBusy(key);
    try {
      const vorhanden = tagByIso.get(iso);

      // Bestehende Einträge übernehmen — nur den eigenen ersetzen. Sonst
      // gingen Halle-/Maschinen-Einträge und Zeilen anderer Kostenstellen
      // desselben Tages verloren.
      const gehoertZurZelle = (e: { baustelle_id: string | null; taetigkeit_id: string | null }) =>
        zeile.baustelleId
          ? e.baustelle_id === zeile.baustelleId
          : e.taetigkeit_id === zeile.taetigkeitId && !e.baustelle_id;

      const andere: SaveEintrag[] =
        vorhanden?.taetigkeiten
          .filter((e) => !gehoertZurZelle(e))
          .map((e) => ({
            position: 0,
            art: e.art,
            taetigkeit_id: e.taetigkeit_id,
            taetigkeit_freitext: e.taetigkeit_freitext,
            baustelle_id: e.baustelle_id,
            ziel_baustelle_id: (e as any).ziel_baustelle_id ?? null,
            stunden: Number(e.stunden),
            notiz: e.notiz,
          })) ?? [];

      const eigene: SaveEintrag[] =
        wert > 0
          ? [{
              position: 0,
              art: zeile.art,
              taetigkeit_id: zeile.taetigkeitId,
              taetigkeit_freitext: null,
              baustelle_id: zeile.baustelleId,
              stunden: wert,
              notiz: null,
            }]
          : [];

      const taetigkeiten = [...andere, ...eigene].map((e, i) => ({ ...e, position: i + 1 }));

      if (taetigkeiten.length === 0 && vorhanden?.tag.id) {
        // Letzter Eintrag entfernt: Tag leeren, nicht löschen — der Tag kann
        // eine Abwesenheit tragen, die woanders gepflegt wird.
        await saveMut.mutateAsync({
          id: vorhanden.tag.id,
          mitarbeiter_id: zielMa,
          datum: iso,
          arbeitsbeginn: vorhanden.tag.arbeitsbeginn?.slice(0, 5) ?? null,
          anmerkung: vorhanden.tag.anmerkung ?? null,
          taetigkeiten: [],
          zulagen: [],
          fahrt: null,
        });
      } else if (taetigkeiten.length > 0) {
        await saveMut.mutateAsync({
          id: vorhanden?.tag.id,
          mitarbeiter_id: zielMa,
          datum: iso,
          arbeitsbeginn: vorhanden?.tag.arbeitsbeginn?.slice(0, 5) ?? null,
          anmerkung: vorhanden?.tag.anmerkung ?? null,
          taetigkeiten,
          // Zulagen und Fahrt verwaltet diese Seite nicht — unverändert lassen.
          zulagen:
            vorhanden?.zulagen.map((zu) => ({
              zulagen_typ_id: zu.zulagen_typ_id,
              stunden: zu.stunden != null ? Number(zu.stunden) : null,
              notiz: zu.notiz,
            })) ?? [],
          fahrt: vorhanden?.fahrt
            ? {
                fahrtgeld_eur: Number(vorhanden.fahrt.fahrtgeld_eur ?? 0),
                privat_pkw: vorhanden.fahrt.privat_pkw,
                km_gefahren:
                  vorhanden.fahrt.km_gefahren != null ? Number(vorhanden.fahrt.km_gefahren) : null,
                taggeld_kurz: vorhanden.fahrt.taggeld_kurz,
                taggeld_lang: vorhanden.fahrt.taggeld_lang,
                taggeld_manuell: vorhanden.fahrt.taggeld_manuell,
              }
            : null,
        });
      }
      await refetch();
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Nicht gespeichert",
        description: (e as Error).message,
      });
    } finally {
      setBusy(null);
    }
  }

  // ─── Urlaub direkt in der Tabelle ändern ─────────────────────────────
  //
  // „Es kann sein, dass man den eingetragenen Urlaub dann doch nicht
  // konsumiert hat." Die Falle dabei: die Antrags-Genehmigung bucht das
  // Urlaubskonto PAUSCHAL ab und legt 0-Stunden-Marker an. Schriebe man
  // hier einfach Stunden hinein, würde der Auto-Buchungs-Trigger den Tag
  // ein ZWEITES Mal abziehen. Deshalb wird ein Antrags-Tag beim ersten
  // Bearbeiten einmalig mit +1 Tag neutralisiert — danach führt allein
  // der Stunden-Eintrag das Konto, und Ändern/Löschen stimmt automatisch.
  async function speichereUrlaub(iso: string, wert: number) {
    if (!zielMa) return;
    setBusy(`urlaub|${iso}`);
    try {
      const vorhanden = tagByIso.get(iso);
      const status = vorhanden?.tag.status;
      if (status && status !== "erfasst" && status !== "ma_bestaetigt") {
        toast({
          variant: "destructive",
          title: "Tag ist bereits freigegeben",
          description: "Dieser Tag wurde vom Büro abgezeichnet und kann hier nicht mehr geändert werden.",
        });
        return;
      }

      // Stammt der Tag aus einem genehmigten Antrag? Dann einmalig das
      // Konto neutralisieren (Guard über die Notiz-Markierung).
      const { data: antraege } = await supabase
        .from("urlaubsantraege")
        .select("id")
        .eq("mitarbeiter_id", zielMa)
        .eq("status", "genehmigt")
        .lte("von", iso)
        .gte("bis", iso)
        .limit(1);
      if ((antraege ?? []).length > 0) {
        const marker = `TB-STORNO:${iso}`;
        const { data: schon } = await supabase
          .from("urlaubs_buchungen")
          .select("id")
          .eq("mitarbeiter_id", zielMa)
          .like("notiz", `${marker}%`)
          .limit(1);
        if (!schon || schon.length === 0) {
          const { error: bErr } = await supabase.from("urlaubs_buchungen").insert({
            mitarbeiter_id: zielMa,
            art: "korrektur",
            tage: 1,
            wirksam_am: iso,
            notiz: `${marker} · Antrags-Tag neutralisiert — Urlaub im Tätigkeitsbericht geändert`,
          } as any);
          if (bErr) {
            // Ohne Admin-Recht darf man nicht ins Konto schreiben — der Tag
            // wird trotzdem geändert, aber das Büro muss korrigieren.
            toast({
              variant: "destructive",
              title: "Urlaubskonto bitte vom Büro korrigieren",
              description:
                "Der Tag stammt aus einem genehmigten Antrag. Damit er nicht doppelt abgezogen wird, muss das Büro dem Konto +1 Tag gutschreiben.",
            });
          }
        }
      }

      const andere: SaveEintrag[] =
        vorhanden?.taetigkeiten
          .filter((e) => e.art !== "urlaub")
          .map((e) => ({
            position: 0,
            art: e.art,
            taetigkeit_id: e.taetigkeit_id,
            taetigkeit_freitext: e.taetigkeit_freitext,
            baustelle_id: e.baustelle_id,
            ziel_baustelle_id: (e as any).ziel_baustelle_id ?? null,
            stunden: Number(e.stunden),
            notiz: e.notiz,
          })) ?? [];
      const eigene: SaveEintrag[] =
        wert > 0
          ? [{
              position: 0,
              art: "urlaub" as TagStatus,
              taetigkeit_id: null,
              taetigkeit_freitext: null,
              baustelle_id: null,
              stunden: wert,
              notiz: null,
            }]
          : [];
      const taetigkeiten = [...andere, ...eigene].map((e, i) => ({ ...e, position: i + 1 }));

      if (taetigkeiten.length === 0 && vorhanden?.tag.id) {
        // Ohne Urlaub und ohne andere Einträge bliebe der Tag als leerer
        // „urlaub"-Torso stehen und würde weiter als Urlaubstag angezeigt —
        // deshalb ganz löschen.
        await deleteMut.mutateAsync(vorhanden.tag.id);
      } else if (taetigkeiten.length > 0) {
        await saveMut.mutateAsync({
          id: vorhanden?.tag.id,
          mitarbeiter_id: zielMa,
          datum: iso,
          arbeitsbeginn: vorhanden?.tag.arbeitsbeginn?.slice(0, 5) ?? null,
          anmerkung: vorhanden?.tag.anmerkung ?? null,
          taetigkeiten,
          zulagen:
            vorhanden?.zulagen.map((zu) => ({
              zulagen_typ_id: zu.zulagen_typ_id,
              stunden: zu.stunden != null ? Number(zu.stunden) : null,
              notiz: zu.notiz,
            })) ?? [],
          fahrt: null,
        });
      }
      await refetch();
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Nicht gespeichert",
        description: (e as Error).message,
      });
    } finally {
      setBusy(null);
    }
  }

  // ─── Taggeld direkt in der Tabelle eintragen ─────────────────────────
  //
  // Wie in der Excel: man trägt eine 1 ein, rechts zählt die Summe, wie
  // oft es im Monat Taggeld gab. Gespeichert wird in stunden_fahrt
  // (Ganzzahl-Spalten taggeld_kurz/taggeld_lang), taggeld_manuell=true,
  // damit keine Automatik den Wert wieder überschreibt.
  async function speichereTaggeld(iso: string, feld: "kurz" | "lang", wert: number) {
    if (!zielMa) return;
    setBusy(`tg-${feld}|${iso}`);
    try {
      const vorhanden = tagByIso.get(iso);
      const status = vorhanden?.tag.status;
      if (status && status !== "erfasst" && status !== "ma_bestaetigt") {
        toast({
          variant: "destructive",
          title: "Tag ist bereits freigegeben",
          description: "Dieser Tag wurde vom Büro abgezeichnet und kann hier nicht mehr geändert werden.",
        });
        return;
      }
      const ganz = Math.max(0, Math.round(wert));
      if (!vorhanden && ganz === 0) return;

      await saveMut.mutateAsync({
        id: vorhanden?.tag.id,
        mitarbeiter_id: zielMa,
        datum: iso,
        arbeitsbeginn: vorhanden?.tag.arbeitsbeginn?.slice(0, 5) ?? null,
        anmerkung: vorhanden?.tag.anmerkung ?? null,
        // Alles andere am Tag bleibt unverändert stehen.
        taetigkeiten:
          vorhanden?.taetigkeiten.map((e, i) => ({
            position: i + 1,
            art: e.art,
            taetigkeit_id: e.taetigkeit_id,
            taetigkeit_freitext: e.taetigkeit_freitext,
            baustelle_id: e.baustelle_id,
            ziel_baustelle_id: (e as any).ziel_baustelle_id ?? null,
            stunden: Number(e.stunden),
            notiz: e.notiz,
          })) ?? [],
        zulagen:
          vorhanden?.zulagen.map((zu) => ({
            zulagen_typ_id: zu.zulagen_typ_id,
            stunden: zu.stunden != null ? Number(zu.stunden) : null,
            notiz: zu.notiz,
          })) ?? [],
        fahrt: {
          fahrtgeld_eur: Number(vorhanden?.fahrt?.fahrtgeld_eur ?? 0),
          privat_pkw: vorhanden?.fahrt?.privat_pkw ?? false,
          km_gefahren:
            vorhanden?.fahrt?.km_gefahren != null ? Number(vorhanden.fahrt.km_gefahren) : null,
          taggeld_kurz: feld === "kurz" ? ganz : Number(vorhanden?.fahrt?.taggeld_kurz ?? 0),
          taggeld_lang: feld === "lang" ? ganz : Number(vorhanden?.fahrt?.taggeld_lang ?? 0),
          taggeld_manuell: true,
        },
      });
      await refetch();
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Nicht gespeichert",
        description: (e as Error).message,
      });
    } finally {
      setBusy(null);
    }
  }

  // ─── Realtime ────────────────────────────────────────────────────────
  useEffect(() => {
    const ch = supabase
      .channel("taetigkeitsbericht")
      .on("postgres_changes", { event: "*", schema: "public", table: "stunden_tage" }, () => refetch())
      .on("postgres_changes", { event: "*", schema: "public", table: "stunden_taetigkeiten" }, () => refetch())
      .on("postgres_changes", { event: "*", schema: "public", table: "urlaubsantraege" }, () => refetch())
      .on("postgres_changes", { event: "*", schema: "public", table: "krankmeldungen" }, () => refetch())
      .on("postgres_changes", { event: "*", schema: "public", table: "fahrtenbuch_eintraege" }, () => ladeFahrten())
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zielMa, periode.von]);

  // ─── PDF ─────────────────────────────────────────────────────────────
  const maName = useMemo(() => {
    if (zielMa === user?.id) {
      return `${(profile as any)?.vorname ?? ""} ${(profile as any)?.nachname ?? ""}`.trim();
    }
    const m = angestellte.find((a) => a.id === zielMa);
    return m ? `${m.vorname} ${m.nachname}`.trim() : "";
  }, [zielMa, user, profile, angestellte]);

  const kennzeichen = useMemo(() => {
    if (zielMa === user?.id) return ((profile as any)?.fahrtenbuch_kennzeichen as string) ?? "";
    return ((angestellte.find((a) => a.id === zielMa) as any)?.fahrtenbuch_kennzeichen as string) ?? "";
  }, [zielMa, user, profile, angestellte]);

  function druck() {
    if (tab === "fahrtenbuch") {
      const doc = makeFahrtenbuchPdf({
        name: maName,
        kennzeichen,
        periode,
        fahrten,
      });
      doc.save(`Fahrtenbuch_${maName.replace(/\s+/g, "_")}_${periode.jahr}-${String(periode.monat).padStart(2, "0")}.pdf`);
      return;
    }
    const doc = makeTaetigkeitsberichtPdf({
      name: maName,
      titel: periodeTitel(periode),
      tage: periode.tage,
      zeilen: zeilen.map((zz) => ({
        kst: zz.kst,
        bezeichnung: zz.bezeichnung,
        werte: zellen[zz.key] ?? {},
      })),
      sonder,
      summen,
      taggeld6: fahrtWerte.tg6,
      taggeld11: fahrtWerte.tg11,
      km: fahrtWerte.km,
      kmSatz: KM_SATZ,
      unterschrift: unterschrift?.data ?? null,
      unterschriebenAm: unterschrift
        ? new Date(unterschrift.am).toLocaleDateString("de-AT")
        : null,
    });
    doc.save(`Taetigkeitsbericht_${maName.replace(/\s+/g, "_")}_${periode.jahr}-${String(periode.monat).padStart(2, "0")}.pdf`);
  }

  // ─── Render ──────────────────────────────────────────────────────────
  /** Spaltenfarbe: Feiertag/So dunkel, Sa hell — über die GANZE Spalte. */
  const spalte = tagSpaltenFarbe;

  return (
    <div className="p-3 sm:p-6 pb-safe-nav">
      <PageHeader
        title="Tätigkeitsbericht"
        description="Zeiterfassung für Angestellte"
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => setPeriode((p) => periodeVerschieben(p, -1))}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            {/* Die Periode steht GROSS zwischen den Pfeilen — vorher stand
                hier nur „Heute" und man wusste nie, wo man gerade ist. */}
            <span className="px-1 text-sm sm:text-base font-bold whitespace-nowrap tabular-nums">
              {periodeTitel(periode)}
            </span>
            <Button variant="outline" size="sm" onClick={() => setPeriode((p) => periodeVerschieben(p, 1))}>
              <ChevronRight className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="sm" onClick={() => setPeriode(periodeVonDatum(localIso()))}>
              Heute
            </Button>
            <Button size="sm" onClick={druck} disabled={tab === "bericht" && zeilen.length === 0}>
              <Printer className="h-4 w-4 mr-1.5" /> PDF
            </Button>
          </>
        }
      />

      <div className="mb-3 flex items-center gap-3 flex-wrap">
        {/* Reiter wie in der Jahresplanung (Poliereinsatz ↔ Mitarbeiter) */}
        <div className="inline-flex rounded-lg border p-0.5 bg-muted/40">
          {(
            [
              ["bericht", "Tätigkeitsbericht"],
              ["fahrtenbuch", "Fahrtenbuch"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={`px-4 h-9 rounded-md text-sm font-medium transition ${
                tab === key
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {darfFremde && angestellte.length > 0 && (
          <div className="flex items-center gap-2 text-sm">
            <Users className="h-4 w-4 text-muted-foreground" />
            <select
              className="h-9 rounded-md border bg-background px-2 text-sm"
              value={zielMa}
              onChange={(e) => setMaId(e.target.value)}
            >
              {angestellte.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.nachname} {a.vorname}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      <Card className="overflow-hidden">
        <CardContent className="p-0">
          {tab === "fahrtenbuch" ? (
            <FahrtenbuchTab
              mitarbeiterId={zielMa}
              periode={periode}
              fahrten={fahrten}
              onReload={ladeFahrten}
              kennzeichen={kennzeichen}
              fahrerName={maName}
              kannBearbeiten={kannBearbeiten}
              kostenstellen={Array.from(new Set(zeilenStamm.map((s) => s.kst))).sort()}
            />
          ) : (
          <div className="overflow-auto max-h-[calc(100vh-15rem)]">
            <table style={{ borderCollapse: "collapse", background: "#fff", color: "#000", width: "100%" }}>
              {/* Titelband wie in der Excel: silbergrau, über alles */}
              <thead>
                <tr>
                  <th
                    colSpan={periode.tage.length + 3}
                    style={{
                      ...td,
                      border: LINIE,
                      background: TB_FARBEN.titel,
                      textAlign: "center",
                      fontSize: 20,
                      fontWeight: 700,
                      letterSpacing: "0.35em",
                      padding: "10px 0 8px",
                    }}
                  >
                    TÄTIGKEITSBERICHT
                  </th>
                </tr>
                {/* Name + Monat — groß und klar, Name auf gelbem Eingabefeld */}
                <tr>
                  <th colSpan={2} style={{ ...td, border: "none", textAlign: "left", fontWeight: 700, fontSize: 15, paddingTop: 8, paddingBottom: 8 }}>
                    NAME:{" "}
                    <span
                      style={{
                        fontWeight: 700,
                        background: TB_FARBEN.eingabe,
                        padding: "2px 10px",
                        border: "1px solid #999",
                      }}
                    >
                      {maName}
                    </span>
                  </th>
                  <th
                    colSpan={periode.tage.length + 1}
                    style={{ ...td, border: "none", textAlign: "left", fontWeight: 700, fontSize: 15, paddingLeft: 24 }}
                  >
                    Monat/Jahr:{" "}
                    <span
                      style={{
                        fontWeight: 700,
                        background: TB_FARBEN.eingabe,
                        padding: "2px 10px",
                        border: "1px solid #999",
                      }}
                    >
                      {periodeTitel(periode)}
                    </span>
                  </th>
                </tr>
                {/* Wochentage — Sa/So/Feiertag tragen schon hier ihre Farbe */}
                <tr>
                  <th style={{ ...td, border: "none" }} />
                  <th style={{ ...td, border: "none" }} />
                  {periode.tage.map((iso) => (
                    <th
                      key={iso}
                      style={{
                        ...tdZahl,
                        border: "none",
                        fontWeight: 400,
                        textAlign: "center",
                        background: spalte(iso),
                      }}
                    >
                      {WOCHENTAG_KURZ[wochentagIndex(iso)]}
                    </th>
                  ))}
                  <th style={{ ...td, border: "none" }} />
                </tr>
                {/* Kst | Baustelle | Tage | Gesamt */}
                <tr>
                  <th style={{ ...td, fontStyle: "italic", textDecoration: "underline", textAlign: "left", width: 50, borderBottom: "2px solid #000" }}>
                    Kst
                  </th>
                  <th style={{ ...td, fontStyle: "italic", textDecoration: "underline", textAlign: "left", minWidth: 190, borderBottom: "2px solid #000" }}>
                    Baustelle
                  </th>
                  {periode.tage.map((iso) => {
                    const info = tagesBeschriftung(iso);
                    return (
                      <th
                        key={iso}
                        style={{
                          ...tdZahl,
                          textAlign: "center",
                          fontWeight: 700,
                          background: spalte(iso),
                          borderBottom: "2px solid #000",
                          position: "relative",
                        }}
                        title={info?.name}
                      >
                        {iso.slice(8)}.
                        {/* Feiertagsname läuft von hier aus senkrecht durch die
                            dunkle Spalte nach unten — wie im PDF und in der
                            Excel, statt in einer eigenen Leerzeile darüber.
                            pointer-events aus, damit die Zellen darunter
                            bedienbar bleiben. */}
                        {info && (
                          <span
                            style={{
                              position: "absolute",
                              top: "calc(100% + 4px)",
                              left: "50%",
                              transform: "translateX(-50%) rotate(180deg)",
                              writingMode: "vertical-rl",
                              fontFamily: SERIF,
                              fontSize: 10,
                              fontWeight: 700,
                              letterSpacing: "0.04em",
                              textTransform: "uppercase",
                              color: "#000",
                              whiteSpace: "nowrap",
                              pointerEvents: "none",
                              zIndex: 1,
                            }}
                          >
                            {info.name}
                          </span>
                        )}
                      </th>
                    );
                  })}
                  <th style={{ ...td, fontStyle: "italic", textDecoration: "underline", textAlign: "right", width: 52, borderBottom: "2px solid #000" }}>
                    Gesamt
                  </th>
                </tr>
              </thead>

              <tbody>
                {/* Kostenstellen-Zeilen */}
                {zeilen.map((zz) => {
                  const werte = zellen[zz.key] ?? {};
                  const gesamt = summeVon(werte);
                  return (
                    <tr key={zz.key}>
                      <td style={{ ...td, fontWeight: 700 }}>{zz.kst}</td>
                      <td style={{ ...td, textAlign: "left" }}>
                        <span className="inline-flex items-center gap-1">
                          {zz.bezeichnung}
                          {gesamt === 0 && kannBearbeiten && (
                            <button
                              type="button"
                              onClick={() => setSichtbar((c) => c.filter((k) => k !== zz.key))}
                              title="Zeile entfernen"
                              className="opacity-40 hover:opacity-100"
                            >
                              <Trash2 className="h-3 w-3" />
                            </button>
                          )}
                        </span>
                      </td>
                      {periode.tage.map((iso) => (
                        <td
                          key={iso}
                          style={{
                            ...tdZahl,
                            background: spalte(iso),
                            padding: 0,
                          }}
                        >
                          {kannBearbeiten ? (
                            <ZellEingabe
                              wert={werte[iso] ?? 0}
                              busy={busy === `${zz.key}|${iso}`}
                              onCommit={(v) => speichereZelle(zz, iso, v)}
                            />
                          ) : (
                            <span style={{ padding: "1px 3px", display: "block", textAlign: "right" }}>{z(werte[iso])}</span>
                          )}
                        </td>
                      ))}
                      <td style={{ ...tdZahl, fontWeight: 700 }}>{z(gesamt)}</td>
                    </tr>
                  );
                })}

                {/* Zeile hinzufügen */}
                {kannBearbeiten && (
                <tr>
                  <td colSpan={2} style={{ ...td, textAlign: "left" }}>
                    <Popover open={pickerOffen} onOpenChange={setPickerOffen}>
                      <PopoverTrigger asChild>
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                        >
                          <Plus className="h-3 w-3" /> Kostenstelle hinzufügen
                        </button>
                      </PopoverTrigger>
                      <PopoverContent align="start" className="w-96 p-0">
                        <Command>
                          <CommandInput placeholder="Kostenstelle oder Baustelle suchen…" />
                          <CommandList className="max-h-80">
                            <CommandEmpty>Nichts gefunden.</CommandEmpty>
                            <CommandGroup>
                              {zeilenStamm
                                .filter((s) => !sichtbar.includes(s.key))
                                .map((s) => (
                                  <CommandItem
                                    key={s.key}
                                    value={`${s.kst} ${s.bezeichnung}`}
                                    onSelect={() => {
                                      setSichtbar((c) => [...c, s.key]);
                                      setPickerOffen(false);
                                    }}
                                  >
                                    <span className="font-mono text-xs w-14 shrink-0">{s.kst}</span>
                                    <span className="truncate">{s.bezeichnung}</span>
                                  </CommandItem>
                                ))}
                            </CommandGroup>
                          </CommandList>
                        </Command>
                      </PopoverContent>
                    </Popover>
                  </td>
                  {periode.tage.map((iso) => (
                    <td key={iso} style={{ ...tdZahl, background: spalte(iso) }} />
                  ))}
                  <td style={td} />
                </tr>
                )}

                {/* ── Summenzeilen — Farben wie in der Vorlage ── */}
                <SummenZeile label="Zwischensumme" tage={periode.tage} werte={summen.zwischensumme} gesamt={summen.zwischensummeGesamt} fett farbe={TB_FARBEN.zwischensumme} spalte={spalte} dickOben />

                {/* Urlaub ist BEARBEITBAR — „doch nicht konsumiert" */}
                <tr>
                  <td colSpan={2} style={tdLabel}>
                    Urlaub
                    <span style={{ fontWeight: 400, fontSize: 10, marginLeft: 6, color: "#666" }}>
                      (änderbar)
                    </span>
                  </td>
                  {periode.tage.map((iso) => (
                    <td key={iso} style={{ ...tdZahl, background: spalte(iso), padding: 0 }}>
                      {kannBearbeiten ? (
                        <ZellEingabe
                          wert={sonder.urlaub[iso] ?? 0}
                          busy={busy === `urlaub|${iso}`}
                          onCommit={(v) => speichereUrlaub(iso, v)}
                        />
                      ) : (
                        <span style={{ padding: "1px 3px", display: "block", textAlign: "right" }}>{z(sonder.urlaub[iso])}</span>
                      )}
                    </td>
                  ))}
                  <td style={{ ...tdZahl, fontWeight: 700 }}>{z(summeVon(sonder.urlaub))}</td>
                </tr>

                <SummenZeile label="Sonderurlaub" tage={periode.tage} werte={sonder.sonderurlaub} gesamt={summeVon(sonder.sonderurlaub)} spalte={spalte} />
                <SummenZeile label="Krankheit" tage={periode.tage} werte={sonder.krankheit} gesamt={summeVon(sonder.krankheit)} spalte={spalte} />
                <SummenZeile label="Feiertag" tage={periode.tage} werte={sonder.feiertag} gesamt={summeVon(sonder.feiertag)} spalte={spalte} />
                <SummenZeile label="Stundensumme/Tag" tage={periode.tage} werte={summen.stundensumme} gesamt={summen.stundensummeGesamt} fett farbe={TB_FARBEN.stundensumme} spalte={spalte} dickOben />
                <SummenZeile label="Sollstunden/Tag" tage={periode.tage} werte={summen.soll} gesamt={summen.sollGesamt} spalte={spalte} />
                <SummenZeile label="DELTA" tage={periode.tage} werte={summen.delta} gesamt={summen.deltaGesamt} fett spalte={spalte} negRot />

                {/* Warnhinweis wie die Excel-Formel IF(DELTA>15; …) */}
                {summen.deltaGesamt > UEBERSTUNDEN_GRENZE && (
                  <tr>
                    <td colSpan={periode.tage.length + 3} style={{ ...td, textAlign: "left", fontStyle: "italic" }}>
                      {UEBERSTUNDEN_WARNUNG}
                    </td>
                  </tr>
                )}

                {/* Taggeld ist BEARBEITBAR — eine 1 je Tag, rechts die Anzahl */}
                {([
                  ["Taggeld > 6 Std.", "kurz", fahrtWerte.tg6, true],
                  ["Taggeld > 11 Std.", "lang", fahrtWerte.tg11, false],
                ] as const).map(([label, feld, werte, dick]) => (
                  <tr key={feld}>
                    <td colSpan={2} style={{ ...tdLabel, ...(dick ? { borderTop: "2px solid #000" } : {}) }}>
                      {label}
                      <span style={{ fontWeight: 400, fontSize: 10, marginLeft: 6, color: "#666" }}>
                        (1 eintragen)
                      </span>
                    </td>
                    {periode.tage.map((iso) => (
                      <td key={iso} style={{ ...tdZahl, ...(dick ? { borderTop: "2px solid #000" } : {}), background: spalte(iso), padding: 0 }}>
                        {kannBearbeiten ? (
                          <ZellEingabe
                            wert={werte[iso] ?? 0}
                            busy={busy === `tg-${feld}|${iso}`}
                            fmt={zGanz}
                            onCommit={(v) => speichereTaggeld(iso, feld, v)}
                          />
                        ) : (
                          <span style={{ padding: "1px 3px", display: "block", textAlign: "right" }}>{zGanz(werte[iso])}</span>
                        )}
                      </td>
                    ))}
                    <td style={{ ...tdZahl, ...(dick ? { borderTop: "2px solid #000" } : {}), fontWeight: 700 }}>{zGanz(summeVon(werte))}</td>
                  </tr>
                ))}
                <SummenZeile label="gefahrene km" tage={periode.tage} werte={fahrtWerte.km} gesamt={summeVon(fahrtWerte.km)} spalte={spalte} />
                {/* Kilometergeld bildet sich von selbst: km × 0,50 € je Tag */}
                <tr>
                  <td colSpan={2} style={tdLabel}>{String(KM_SATZ).replace(".", ",")} € / km</td>
                  {periode.tage.map((iso) => (
                    <td key={iso} style={{ ...tdZahl, background: spalte(iso) }}>
                      {z(r2((fahrtWerte.km[iso] ?? 0) * KM_SATZ))}
                    </td>
                  ))}
                  <td style={{ ...tdZahl, fontWeight: 700 }}>
                    {z(r2(summeVon(fahrtWerte.km) * KM_SATZ))}
                  </td>
                </tr>

                {/* Datum + Unterschrift — jetzt DIGITAL (Maus/Stift) */}
                <tr>
                  <td colSpan={periode.tage.length + 3} style={{ ...td, border: "none", paddingTop: 18 }}>
                    <div className="flex items-end gap-6 flex-wrap" style={{ fontFamily: SERIF, fontSize: 14 }}>
                      <span>
                        Datum:{" "}
                        {unterschrift
                          ? new Date(unterschrift.am).toLocaleDateString("de-AT")
                          : new Date().toLocaleDateString("de-AT")}
                      </span>
                      <span className="inline-flex items-end gap-2">
                        Unterschrift:
                        {unterschrift ? (
                          <img
                            src={unterschrift.data}
                            alt="Unterschrift"
                            style={{ height: 46, borderBottom: "1px solid #000" }}
                          />
                        ) : (
                          <span style={{ display: "inline-block", width: 220, borderBottom: "1px dotted #000" }}>&nbsp;</span>
                        )}
                      </span>
                      {kannBearbeiten && (
                        <Button size="sm" variant="outline" className="h-8" onClick={() => setSignOffen(true)}>
                          <Pen className="h-3.5 w-3.5 mr-1.5" />
                          {unterschrift ? "Neu unterschreiben" : "Unterschreiben"}
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          )}
        </CardContent>
      </Card>

      {tab === "bericht" && (
        <p className="text-xs text-muted-foreground mt-3">
          Krankheit und Feiertag füllen sich selbst — Krankheit aus der
          Krankmeldung, Feiertage aus dem österreichischen Kalender. Urlaub
          lässt sich direkt in der Zeile ändern, falls er doch nicht konsumiert
          wurde. Die gefahrenen Kilometer kommen aus dem Fahrtenbuch.
        </p>
      )}

      <UnterschriftDialog
        open={signOffen}
        onOpenChange={setSignOffen}
        onSave={speichereUnterschrift}
        titel="Tätigkeitsbericht unterschreiben"
      />
    </div>
  );
}

/** Kilometergeld-Satz wie in der Excel (Zelle A40). */
const KM_SATZ = 0.5;

/** Eine der Summen-/Abwesenheitszeilen unter der Matrix. */
function SummenZeile({
  label,
  tage,
  werte,
  gesamt,
  fett,
  farbe,
  spalte,
  dickOben,
  negRot,
}: {
  label: string;
  tage: string[];
  werte: Record<string, number>;
  gesamt: number;
  fett?: boolean;
  /** Negative Werte rot — für die DELTA-Zeile. */
  negRot?: boolean;
  /** Zeilenfarbe aus der Vorlage (Zwischensumme blau, Stundensumme grün). */
  farbe?: string;
  /** Spaltenfarbe je Tag — Wochenende/Feiertag übersteuert die Zeilenfarbe. */
  spalte: (iso: string) => string | undefined;
  /** Stärkere Linie oberhalb — Blocktrennung wie in der Vorlage. */
  dickOben?: boolean;
}) {
  const basis: React.CSSProperties = dickOben ? { borderTop: "2px solid #000" } : {};
  return (
    <tr>
      <td colSpan={2} style={{ ...tdLabel, ...basis, background: farbe }}>
        {label}
      </td>
      {tage.map((iso) => (
        <td
          key={iso}
          style={{
            ...tdZahl,
            ...basis,
            fontWeight: fett ? 700 : 400,
            background: spalte(iso) ?? farbe,
            color: negRot && (werte[iso] ?? 0) < 0 ? "#c00000" : undefined,
          }}
        >
          {z(werte[iso] ?? 0)}
        </td>
      ))}
      <td style={{ ...tdZahl, ...basis, fontWeight: 700, background: farbe, color: negRot && gesamt < 0 ? "#c00000" : undefined }}>{z(gesamt)}</td>
    </tr>
  );
}

/**
 * Eine Zelle der Matrix. Übernimmt beim Verlassen bzw. mit Enter, damit nicht
 * bei jedem Tastendruck gespeichert wird.
 */
function ZellEingabe({
  wert,
  busy,
  onCommit,
  fmt = z,
}: {
  wert: number;
  busy: boolean;
  onCommit: (v: number) => void;
  /** Anzeigeformat — Stunden „8,0", Taggeld-Zähler „1". */
  fmt?: (n: number) => string;
}) {
  const [text, setText] = useState(fmt(wert));
  const letzterWert = useRef(wert);

  // Von außen geändert (Realtime, Perioden-Wechsel) → übernehmen, solange
  // hier nicht gerade getippt wird.
  useEffect(() => {
    if (letzterWert.current !== wert) {
      letzterWert.current = wert;
      setText(fmt(wert));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wert]);

  const commit = () => {
    const v = Number(text.replace(",", ".").trim() || "0");
    const gerundet = Number.isFinite(v) && v >= 0 ? aufStundenRaster(v) : 0;
    if (gerundet === wert) {
      setText(fmt(wert));
      return;
    }
    letzterWert.current = gerundet;
    setText(fmt(gerundet));
    onCommit(gerundet);
  };

  if (busy) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-3 w-3 animate-spin" />
      </div>
    );
  }
  return (
    <input
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") setText(fmt(wert));
      }}
      inputMode="decimal"
      style={{
        width: "100%",
        border: "none",
        outline: "none",
        background: "transparent",
        textAlign: "right",
        fontFamily: SERIF,
        fontSize: 15,
        fontWeight: 600,
        padding: "1px 3px",
      }}
    />
  );
}
