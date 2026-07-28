/**
 * Tätigkeitsbericht — Zeiterfassung der Angestellten.
 *
 * Nachbau der alten Excel: Matrix Kostenstelle × Tag, Periode 21.–20.,
 * darunter die Summenzeilen Zwischensumme / Urlaub / Sonderurlaub /
 * Krankheit / Feiertag / Stundensumme / Sollstunden / DELTA, dann Taggeld,
 * Kilometer und das Unterschriftenfeld.
 *
 * Gespeichert wird in `stunden_tage` + `stunden_taetigkeiten` — dieselben
 * Tabellen wie die herkömmliche Erfassung. Fremde Einträge desselben Tages
 * (Halle/Maschine, echte Baustellen aus /stunden) bleiben beim Speichern
 * erhalten; das Muster stammt aus HalleErfassung.tsx.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { ChevronLeft, ChevronRight, Loader2, Plus, Printer, Trash2, Users } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useStundenTageList, useSaveStundenTag, type SaveEintrag } from "@/hooks/useStundenTag";
import { localIso } from "@/lib/dateFmt";
import {
  ANGESTELLTEN_SOLL,
  UEBERSTUNDEN_GRENZE,
  UEBERSTUNDEN_WARNUNG,
  WOCHENTAG_KURZ,
  berechneSummen,
  ladeBerichtZeilen,
  periodeTitel,
  periodeVerschieben,
  periodeVonDatum,
  r2,
  tagesBeschriftung,
  wochentagIndex,
  type BerichtZeile,
  type Periode,
} from "@/lib/taetigkeitsbericht";
import { makeTaetigkeitsberichtPdf } from "@/lib/taetigkeitsberichtPdf";
import { aufStundenRaster } from "@/components/stunden/zeiterfassungUi";
import type { Database } from "@/integrations/supabase/types";

type Profile = Database["public"]["Tables"]["profiles"]["Row"];

/** Zahl wie in der Excel: Komma, keine überflüssigen Nullen, 0 bleibt leer. */
const z = (n: number | null | undefined): string => {
  if (n == null || n === 0) return "";
  return String(r2(n)).replace(".", ",");
};

// ─── Excel-Optik ───────────────────────────────────────────────────────
// Serifenschrift, durchgehend dünne schwarze Linien, keine Rundungen.
const SERIF = '"Times New Roman", Times, Georgia, serif';
const LINIE = "1px solid #000";
const td: React.CSSProperties = {
  border: LINIE,
  padding: "1px 3px",
  fontFamily: SERIF,
  fontSize: 12,
  lineHeight: 1.25,
  whiteSpace: "nowrap",
};
const tdZahl: React.CSSProperties = { ...td, textAlign: "right", width: 34, minWidth: 34 };
const tdLabel: React.CSSProperties = { ...td, textAlign: "left", fontWeight: 700 };

export default function Taetigkeitsbericht() {
  const { user, profile, hasPermission } = useAuth();
  const { toast } = useToast();
  const darfFremde = hasPermission("stunden.taetigkeitsbericht");

  const [periode, setPeriode] = useState<Periode>(() => periodeVonDatum(localIso()));
  const [maId, setMaId] = useState<string>("");
  const [angestellte, setAngestellte] = useState<Profile[]>([]);
  const [zeilenStamm, setZeilenStamm] = useState<BerichtZeile[]>([]);
  const [sichtbar, setSichtbar] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [pickerOffen, setPickerOffen] = useState(false);

  const zielMa = maId || user?.id || "";

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

  /** Abwesenheiten — nur Anzeige. Urlaub/Krank kommen aus Antrag bzw.
   *  Krankmeldung, Feiertag aus dem Kalender, Sonderurlaub aus dem Stamm. */
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
      if (st === "urlaub") out.urlaub[iso] = Number(t.tag.netto_stunden) || sollVon(iso);
      else if (st === "krank") out.krankheit[iso] = Number(t.tag.netto_stunden) || sollVon(iso);
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

  /** Taggeld und Kilometer je Tag aus stunden_fahrt. */
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
    return { tg6, tg11, km };
  }, [tageList]);

  const summeVon = (m: Record<string, number>) =>
    r2(periode.tage.reduce((a, t) => a + (m[t] ?? 0), 0));

  // ─── Speichern einer Zelle ───────────────────────────────────────────
  const saveMut = useSaveStundenTag();

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

  // ─── Realtime ────────────────────────────────────────────────────────
  useEffect(() => {
    const ch = supabase
      .channel("taetigkeitsbericht")
      .on("postgres_changes", { event: "*", schema: "public", table: "stunden_tage" }, () => refetch())
      .on("postgres_changes", { event: "*", schema: "public", table: "stunden_taetigkeiten" }, () => refetch())
      .on("postgres_changes", { event: "*", schema: "public", table: "urlaubsantraege" }, () => refetch())
      .on("postgres_changes", { event: "*", schema: "public", table: "krankmeldungen" }, () => refetch())
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

  function druck() {
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
    });
    doc.save(`Taetigkeitsbericht_${maName.replace(/\s+/g, "_")}_${periode.jahr}-${String(periode.monat).padStart(2, "0")}.pdf`);
  }

  // ─── Render ──────────────────────────────────────────────────────────
  const freierTag = (iso: string) => ANGESTELLTEN_SOLL[wochentagIndex(iso)] === 0;

  return (
    <div className="p-3 sm:p-6 pb-safe-nav">
      <PageHeader
        title="Tätigkeitsbericht"
        description={`Zeiterfassung für Angestellte · ${periodeTitel(periode)}`}
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => setPeriode((p) => periodeVerschieben(p, -1))}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="sm" onClick={() => setPeriode(periodeVonDatum(localIso()))}>
              Heute
            </Button>
            <Button variant="outline" size="sm" onClick={() => setPeriode((p) => periodeVerschieben(p, 1))}>
              <ChevronRight className="h-4 w-4" />
            </Button>
            <Button size="sm" onClick={druck} disabled={zeilen.length === 0}>
              <Printer className="h-4 w-4 mr-1.5" /> PDF
            </Button>
          </>
        }
      />

      {darfFremde && angestellte.length > 0 && (
        <div className="mb-3 flex items-center gap-2 text-sm">
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

      <Card className="overflow-hidden">
        <CardContent className="p-0">
          <div className="overflow-auto max-h-[calc(100vh-14rem)]">
            <table style={{ borderCollapse: "collapse", background: "#fff", color: "#000" }}>
              {/* Titel wie in der Excel: gesperrt gesetzt, über alles verbunden */}
              <thead>
                <tr>
                  <th
                    colSpan={periode.tage.length + 3}
                    style={{
                      ...td,
                      border: "none",
                      textAlign: "center",
                      fontSize: 16,
                      fontWeight: 700,
                      letterSpacing: "0.35em",
                      padding: "10px 0 6px",
                    }}
                  >
                    TÄTIGKEITSBERICHT
                  </th>
                </tr>
                <tr>
                  <th colSpan={2} style={{ ...td, border: "none", textAlign: "left", fontWeight: 700 }}>
                    NAME: <span style={{ fontWeight: 400 }}>{maName}</span>
                  </th>
                  <th
                    colSpan={periode.tage.length + 1}
                    style={{ ...td, border: "none", textAlign: "left", fontWeight: 700, paddingLeft: 24 }}
                  >
                    Monat/Jahr: <span style={{ fontWeight: 400 }}>{periodeTitel(periode)}</span>
                  </th>
                </tr>
                {/* Wochentage */}
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
                        color: freierTag(iso) ? "#888" : "#000",
                      }}
                    >
                      {WOCHENTAG_KURZ[wochentagIndex(iso)]}
                    </th>
                  ))}
                  <th style={{ ...td, border: "none" }} />
                </tr>
                {/* Kst | Baustelle | Tage | Gesamt */}
                <tr>
                  <th style={{ ...td, fontStyle: "italic", textDecoration: "underline", textAlign: "left", width: 46 }}>
                    Kst
                  </th>
                  <th style={{ ...td, fontStyle: "italic", textDecoration: "underline", textAlign: "left", minWidth: 190 }}>
                    Baustelle
                  </th>
                  {periode.tage.map((iso) => (
                    <th
                      key={iso}
                      style={{
                        ...tdZahl,
                        textAlign: "center",
                        background: freierTag(iso) ? "#eee" : undefined,
                      }}
                      title={tagesBeschriftung(iso)?.name}
                    >
                      {iso.slice(8)}.
                    </th>
                  ))}
                  <th style={{ ...td, fontStyle: "italic", textDecoration: "underline", textAlign: "right", width: 48 }}>
                    Gesamt
                  </th>
                </tr>
              </thead>

              <tbody>
                {/* Feiertags-Beschriftung senkrecht über den Kst-Block */}
                <tr>
                  <td colSpan={2} style={{ ...td, border: "none" }} />
                  {periode.tage.map((iso) => {
                    const info = tagesBeschriftung(iso);
                    return (
                      <td
                        key={iso}
                        style={{
                          ...tdZahl,
                          border: "none",
                          height: 92,
                          verticalAlign: "bottom",
                          padding: 0,
                        }}
                      >
                        {info && (
                          <div
                            style={{
                              writingMode: "vertical-rl",
                              transform: "rotate(180deg)",
                              fontFamily: SERIF,
                              fontSize: 10,
                              fontWeight: 700,
                              letterSpacing: "0.04em",
                              textTransform: "uppercase",
                              color: info.scope === "betrieblich" ? "#666" : "#000",
                              whiteSpace: "nowrap",
                              margin: "0 auto",
                            }}
                            title={info.name}
                          >
                            {info.name}
                          </div>
                        )}
                      </td>
                    );
                  })}
                  <td style={{ ...td, border: "none" }} />
                </tr>

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
                          {gesamt === 0 && (
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
                            background: freierTag(iso) ? "#f4f4f4" : undefined,
                            padding: 0,
                          }}
                        >
                          <ZellEingabe
                            wert={werte[iso] ?? 0}
                            busy={busy === `${zz.key}|${iso}`}
                            onCommit={(v) => speichereZelle(zz, iso, v)}
                          />
                        </td>
                      ))}
                      <td style={{ ...tdZahl, fontWeight: 700 }}>{z(gesamt)}</td>
                    </tr>
                  );
                })}

                {/* Zeile hinzufügen */}
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
                    <td key={iso} style={{ ...tdZahl, background: freierTag(iso) ? "#f4f4f4" : undefined }} />
                  ))}
                  <td style={td} />
                </tr>

                {/* ── Summenzeilen ── */}
                <SummenZeile label="Zwischensumme" tage={periode.tage} werte={summen.zwischensumme} gesamt={summen.zwischensummeGesamt} fett />
                <SummenZeile label="Urlaub" tage={periode.tage} werte={sonder.urlaub} gesamt={summeVon(sonder.urlaub)} grau />
                <SummenZeile label="Sonderurlaub" tage={periode.tage} werte={sonder.sonderurlaub} gesamt={summeVon(sonder.sonderurlaub)} grau />
                <SummenZeile label="Krankheit" tage={periode.tage} werte={sonder.krankheit} gesamt={summeVon(sonder.krankheit)} grau />
                <SummenZeile label="Feiertag" tage={periode.tage} werte={sonder.feiertag} gesamt={summeVon(sonder.feiertag)} grau />
                <SummenZeile label="Stundensumme/Tag" tage={periode.tage} werte={summen.stundensumme} gesamt={summen.stundensummeGesamt} fett />
                <SummenZeile label="Sollstunden/Tag" tage={periode.tage} werte={summen.soll} gesamt={summen.sollGesamt} />
                <SummenZeile label="DELTA" tage={periode.tage} werte={summen.delta} gesamt={summen.deltaGesamt} fett />

                {/* Warnhinweis wie die Excel-Formel IF(DELTA>15; …) */}
                {summen.deltaGesamt > UEBERSTUNDEN_GRENZE && (
                  <tr>
                    <td colSpan={periode.tage.length + 3} style={{ ...td, textAlign: "left", fontStyle: "italic" }}>
                      {UEBERSTUNDEN_WARNUNG}
                    </td>
                  </tr>
                )}

                <SummenZeile label="Taggeld > 6 Std." tage={periode.tage} werte={fahrtWerte.tg6} gesamt={summeVon(fahrtWerte.tg6)} />
                <SummenZeile label="Taggeld > 11 Std." tage={periode.tage} werte={fahrtWerte.tg11} gesamt={summeVon(fahrtWerte.tg11)} />
                <SummenZeile label="gefahrene km" tage={periode.tage} werte={fahrtWerte.km} gesamt={summeVon(fahrtWerte.km)} />
                <tr>
                  <td colSpan={2} style={tdLabel}>{String(KM_SATZ).replace(".", ",")}</td>
                  {periode.tage.map((iso) => (
                    <td key={iso} style={tdZahl} />
                  ))}
                  <td style={{ ...tdZahl, fontWeight: 700 }}>
                    {z(r2(summeVon(fahrtWerte.km) * KM_SATZ))}
                  </td>
                </tr>

                {/* Datum + Unterschrift */}
                <tr>
                  <td colSpan={periode.tage.length + 3} style={{ ...td, border: "none", paddingTop: 18 }}>
                    <span style={{ fontFamily: SERIF, fontSize: 12 }}>
                      Datum: {new Date().toLocaleDateString("de-AT")}
                      <span style={{ display: "inline-block", width: 60 }} />
                      Unterschrift: ..................................................
                    </span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground mt-3">
        Urlaub, Krankheit und Feiertag füllen sich selbst — Urlaub aus dem
        genehmigten Antrag, Krankheit aus der Krankmeldung, Feiertage aus dem
        österreichischen Kalender. Der 24. und 31. Dezember stehen als
        Sonderurlaub, weil sie keine gesetzlichen Feiertage sind.
      </p>
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
  grau,
}: {
  label: string;
  tage: string[];
  werte: Record<string, number>;
  gesamt: number;
  fett?: boolean;
  grau?: boolean;
}) {
  const zahl: React.CSSProperties = {
    ...tdZahl,
    fontWeight: fett ? 700 : 400,
    background: grau ? "#f4f4f4" : undefined,
  };
  return (
    <tr>
      <td colSpan={2} style={{ ...tdLabel, background: grau ? "#f4f4f4" : undefined }}>
        {label}
      </td>
      {tage.map((iso) => (
        <td key={iso} style={zahl}>
          {z(werte[iso] ?? 0)}
        </td>
      ))}
      <td style={{ ...zahl, fontWeight: 700 }}>{z(gesamt)}</td>
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
}: {
  wert: number;
  busy: boolean;
  onCommit: (v: number) => void;
}) {
  const [text, setText] = useState(wert ? String(wert).replace(".", ",") : "");
  const letzterWert = useRef(wert);

  // Von außen geändert (Realtime, Perioden-Wechsel) → übernehmen, solange
  // hier nicht gerade getippt wird.
  useEffect(() => {
    if (letzterWert.current !== wert) {
      letzterWert.current = wert;
      setText(wert ? String(wert).replace(".", ",") : "");
    }
  }, [wert]);

  const commit = () => {
    const v = Number(text.replace(",", ".").trim() || "0");
    const gerundet = Number.isFinite(v) && v >= 0 ? aufStundenRaster(v) : 0;
    if (gerundet === wert) {
      setText(wert ? String(wert).replace(".", ",") : "");
      return;
    }
    letzterWert.current = gerundet;
    setText(gerundet ? String(gerundet).replace(".", ",") : "");
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
        if (e.key === "Escape") setText(wert ? String(wert).replace(".", ",") : "");
      }}
      inputMode="decimal"
      style={{
        width: "100%",
        border: "none",
        outline: "none",
        background: "transparent",
        textAlign: "right",
        fontFamily: SERIF,
        fontSize: 12,
        padding: "1px 3px",
      }}
    />
  );
}
