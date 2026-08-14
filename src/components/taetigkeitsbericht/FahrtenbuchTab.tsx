/**
 * Fahrtenbuch — Nachbau des Excel-Blatts, aber je Berichtsperiode (21.–20.).
 *
 * Spalten wie in der Vorlage: Tätigkeitsbericht (= Periodenlabel, fürs
 * Lohnbüro immer gefüllt) · Datum · Abfahrt · Ankunft · Reiseweg ·
 * km-Stände · gefahrene km · Kostenstelle. Farben aus TB_FARBEN,
 * dieselben wie im Tätigkeitsbericht und im PDF. Der km-Stand bei
 * Ankunft rechnet sich selbst: Stand Abfahrt + gefahrene km.
 *
 * Die km je Tag fließen direkt in die Zeile „gefahrene km" des
 * Tätigkeitsberichts — eine Quelle, keine Doppelerfassung.
 */

import { useEffect, useRef, useState } from "react";
import { Loader2, Plus, Trash2, Upload } from "lucide-react";
import { parseFahrtenDatei } from "./fahrtenbuchImport";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import {
  TB_FARBEN,
  periodeKurz,
  periodeTitel,
  r2,
  type Periode,
} from "@/lib/taetigkeitsbericht";

export interface FahrtRow {
  id: string;
  mitarbeiter_id: string;
  datum: string;
  abfahrt: string | null;
  ankunft: string | null;
  reiseweg: string | null;
  km_start: number | null;
  km_ende: number | null;
  km: number;
  kostenstelle: string | null;
}

const SERIF = '"Times New Roman", Times, Georgia, serif';
const zelle: React.CSSProperties = {
  border: "1px solid #000",
  padding: "2px 4px",
  fontFamily: SERIF,
  // Auf Wunsch größer — die Werte waren am Bildschirm schwer lesbar.
  fontSize: 15,
  background: "#fff",
};


const zahl = (n: number | null | undefined): string =>
  n == null || n === 0 ? "" : String(r2(Number(n))).replace(".", ",");

/** Textfeld, das erst beim Verlassen speichert. */
function FbText({
  wert,
  onCommit,
  breit,
  rechts,
  liste,
}: {
  wert: string;
  onCommit: (v: string) => void;
  breit?: boolean;
  rechts?: boolean;
  liste?: string;
}) {
  const [text, setText] = useState(wert);
  const alt = useRef(wert);
  useEffect(() => {
    if (alt.current !== wert) {
      alt.current = wert;
      setText(wert);
    }
  }, [wert]);
  return (
    <input
      value={text}
      list={liste}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        if (text !== wert) onCommit(text);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") setText(wert);
      }}
      style={{
        width: breit ? "100%" : 72,
        border: "none",
        outline: "none",
        background: "transparent",
        fontFamily: SERIF,
        fontSize: 15,
        fontWeight: 600,
        textAlign: rechts ? "right" : "left",
      }}
    />
  );
}

export function FahrtenbuchTab({
  mitarbeiterId,
  periode,
  fahrten,
  onReload,
  kennzeichen,
  fahrerName,
  kannBearbeiten,
  kostenstellen,
}: {
  mitarbeiterId: string;
  periode: Periode;
  fahrten: FahrtRow[];
  onReload: () => void;
  kennzeichen: string;
  fahrerName: string;
  kannBearbeiten: boolean;
  kostenstellen: string[];
}) {
  const { toast } = useToast();
  const [busy, setBusy] = useState<string | null>(null);

  const fehler = (e: unknown) =>
    toast({
      variant: "destructive",
      title: "Nicht gespeichert",
      description: (e as Error).message,
    });

  async function aendern(id: string, patch: Partial<FahrtRow>) {
    setBusy(id);
    try {
      const { error } = await supabase
        .from("fahrtenbuch_eintraege" as any)
        .update(patch)
        .eq("id", id);
      if (error) throw error;
      onReload();
    } catch (e) {
      fehler(e);
    } finally {
      setBusy(null);
    }
  }

  /** Automatik zwischen den drei km-Feldern. Grundregel: was der Nutzer
   *  getippt hat, wird NIE überschrieben — nur der fehlende dritte Wert
   *  ergibt sich von selbst. Die alte Fassung setzte beim Eintippen des
   *  Abfahrts-Stands den Ankunfts-Stand auf „Abfahrt + 0 km" und
   *  radierte damit einen bereits eingetragenen Ankunfts-Stand aus. */
  function patchMitKm(f: FahrtRow, patch: Partial<FahrtRow>): Partial<FahrtRow> {
    const start = patch.km_start !== undefined ? patch.km_start : f.km_start;
    const ende = patch.km_ende !== undefined ? patch.km_ende : f.km_ende;
    const km = patch.km !== undefined ? patch.km : Number(f.km) || null;

    if (patch.km !== undefined) {
      // Strecke getippt → der Ankunfts-Stand ergibt sich aus dem
      // Abfahrts-Stand (bzw. umgekehrt, wenn nur die Ankunft bekannt ist).
      if (km != null && start != null) return { ...patch, km_ende: r2(Number(start) + km) };
      if (km != null && start == null && ende != null) return { ...patch, km_start: r2(Number(ende) - km) };
      return patch;
    }
    // Stand getippt → sind beide Stände da, ergibt sich die Strecke.
    if (start != null && ende != null) {
      return Number(ende) >= Number(start)
        ? { ...patch, km: r2(Number(ende) - Number(start)) }
        : patch;
    }
    // Nur ein Stand da: den fehlenden aus der Strecke ergänzen.
    if (patch.km_start !== undefined && start != null && km) {
      return { ...patch, km_ende: r2(Number(start) + km) };
    }
    if (patch.km_ende !== undefined && ende != null && km) {
      return { ...patch, km_start: r2(Number(ende) - km) };
    }
    return patch;
  }

  async function neu() {
    setBusy("neu");
    try {
      // Vorbelegung: heute, wenn es in der Periode liegt — sonst Periodenstart.
      const heute = new Date().toISOString().slice(0, 10);
      const datum = heute >= periode.von && heute <= periode.bis ? heute : periode.von;
      // Abfahrts-Stand mit dem letzten bekannten Ankunfts-Stand vorbelegen.
      const letzterStand = [...fahrten].reverse().find((f) => f.km_ende != null)?.km_ende ?? null;
      const { error } = await supabase.from("fahrtenbuch_eintraege" as any).insert({
        mitarbeiter_id: mitarbeiterId,
        datum,
        km: 0,
        km_start: letzterStand,
      });
      if (error) throw error;
      onReload();
    } catch (e) {
      fehler(e);
    } finally {
      setBusy(null);
    }
  }

  async function loeschen(id: string) {
    setBusy(id);
    try {
      const { error } = await supabase
        .from("fahrtenbuch_eintraege" as any)
        .delete()
        .eq("id", id);
      if (error) throw error;
      onReload();
    } catch (e) {
      fehler(e);
    } finally {
      setBusy(null);
    }
  }

  // ── Import aus Fahrtenbuch-Apps (Driversnote & Co.) ──────────────────
  const dateiRef = useRef<HTMLInputElement>(null);

  async function importiereDatei(file: File) {
    setBusy("import");
    try {
      const { fahrten: neu, fehler: parseFehler } = await parseFahrtenDatei(file);
      if (parseFehler) {
        toast({ variant: "destructive", title: "Import nicht möglich", description: parseFehler });
        return;
      }
      if (neu.length === 0) {
        toast({ variant: "destructive", title: "Keine Fahrten in der Datei gefunden" });
        return;
      }

      // Doppelte überspringen — sowohl innerhalb der Datei (nochmal
      // importiert) als auch gegen den Bestand des Zeitraums.
      const von = neu.reduce((m, f) => (f.datum < m ? f.datum : m), neu[0].datum);
      const bis = neu.reduce((m, f) => (f.datum > m ? f.datum : m), neu[0].datum);
      const { data: bestand } = await supabase
        .from("fahrtenbuch_eintraege" as any)
        .select("datum, km_start, km_ende, km")
        .eq("mitarbeiter_id", mitarbeiterId)
        .gte("datum", von)
        .lte("datum", bis);
      // Auf EINE Nachkommastelle vergröbert: Excel- und PDF-Export runden
      // die km-Stände unterschiedlich (247245,84 vs. 247245,8) — dieselbe
      // Fahrt aus beiden Formaten darf nicht doppelt landen.
      const r1 = (n: number | null) => (n == null ? "" : (Math.round(n * 10) / 10).toFixed(1));
      const kennung = (f: { datum: string; km_start: number | null; km_ende: number | null; km: number }) =>
        `${f.datum}|${r1(f.km_start === null ? null : Number(f.km_start))}|${r1(f.km_ende === null ? null : Number(f.km_ende))}|${r1(Number(f.km))}`;
      const schonDa = new Set(((bestand as any[]) ?? []).map(kennung));
      const einfuegen: typeof neu = [];
      let doppelt = 0;
      for (const f of neu) {
        const k = kennung(f);
        if (schonDa.has(k)) {
          doppelt++;
          continue;
        }
        schonDa.add(k);
        einfuegen.push(f);
      }

      if (einfuegen.length > 0) {
        const { error } = await supabase.from("fahrtenbuch_eintraege" as any).insert(
          einfuegen.map((f) => ({ ...f, mitarbeiter_id: mitarbeiterId })),
        );
        if (error) throw error;
      }

      const anderePeriode = einfuegen.filter(
        (f) => f.datum < periode.von || f.datum > periode.bis,
      ).length;
      toast({
        title: `${einfuegen.length} Fahrt${einfuegen.length === 1 ? "" : "en"} importiert`,
        description:
          [
            doppelt > 0 ? `${doppelt} übersprungen (schon vorhanden)` : "",
            anderePeriode > 0 ? `${anderePeriode} liegen in anderen Perioden und erscheinen dort` : "",
          ]
            .filter(Boolean)
            .join(" · ") || undefined,
      });
      onReload();
    } catch (e) {
      fehler(e);
    } finally {
      setBusy(null);
      if (dateiRef.current) dateiRef.current.value = "";
    }
  }

  async function speichereKennzeichen(v: string) {
    const { error } = await supabase
      .from("profiles")
      .update({ fahrtenbuch_kennzeichen: v.trim() || null } as any)
      .eq("id", mitarbeiterId);
    if (error) fehler(error);
  }

  const label = periodeKurz(periode);
  const kopfWeiss: React.CSSProperties = {
    ...zelle,
    background: TB_FARBEN.fahrtenbuchKopf,
    color: "#fff",
    fontWeight: 700,
    textAlign: "center",
  };

  return (
    <div className="overflow-auto max-h-[calc(100vh-15rem)]">
      <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 900 }}>
        <thead>
          {/* Titelband wie die Excel: Dunkelblau, weiß, über alle Spalten */}
          <tr>
            <th
              colSpan={10}
              style={{
                ...zelle,
                background: TB_FARBEN.fahrtenbuchTitel,
                color: "#fff",
                fontSize: 18,
                fontWeight: 700,
                letterSpacing: "0.12em",
                textAlign: "center",
                padding: "8px 0",
              }}
            >
              FAHRTENBUCH {periodeTitel(periode)}
            </th>
          </tr>
          <tr>
            <th colSpan={2} style={{ ...zelle, textAlign: "left", fontWeight: 700 }}>
              Fahrer:
            </th>
            <th colSpan={3} style={{ ...zelle, background: TB_FARBEN.eingabe, textAlign: "left", fontWeight: 400 }}>
              {fahrerName}
            </th>
            <th colSpan={2} style={{ ...zelle, textAlign: "left", fontWeight: 700 }}>
              Kennzeichen:
            </th>
            <th colSpan={3} style={{ ...zelle, background: TB_FARBEN.eingabe, textAlign: "left", fontWeight: 400 }}>
              {kannBearbeiten ? (
                <FbText wert={kennzeichen} onCommit={speichereKennzeichen} breit />
              ) : (
                kennzeichen
              )}
            </th>
          </tr>
          <tr>
            <th style={{ ...kopfWeiss, minWidth: 96 }}>Tätigkeitsbericht</th>
            <th style={{ ...kopfWeiss, minWidth: 108 }}>Datum</th>
            <th style={{ ...kopfWeiss, minWidth: 76 }}>Abfahrt</th>
            <th style={{ ...kopfWeiss, minWidth: 76 }}>Ankunft</th>
            <th style={{ ...kopfWeiss, minWidth: 220 }}>Reiseweg / Bemerkungen</th>
            <th style={{ ...kopfWeiss, minWidth: 84 }}>
              km-Stand
              <br />
              Abfahrt
            </th>
            <th style={{ ...kopfWeiss, minWidth: 84 }}>
              km-Stand
              <br />
              Ankunft
            </th>
            <th style={{ ...kopfWeiss, minWidth: 76 }}>gefahrene km</th>
            <th style={{ ...kopfWeiss, minWidth: 100 }}>Kostenstelle</th>
            <th style={{ ...kopfWeiss, width: 34 }} />
          </tr>
        </thead>
        <tbody>
          {fahrten.map((f) => (
            <tr key={f.id}>
              {/* Fürs Lohnbüro: das Periodenlabel steht in JEDER Zeile. */}
              <td style={{ ...zelle, fontWeight: 700 }}>{label}</td>
              <td style={zelle}>
                {kannBearbeiten ? (
                  <input
                    type="date"
                    value={f.datum}
                    min={periode.von}
                    max={periode.bis}
                    onChange={(e) => e.target.value && aendern(f.id, { datum: e.target.value })}
                    style={{ border: "none", background: "transparent", fontFamily: SERIF, fontSize: 15, fontWeight: 600, width: "100%" }}
                  />
                ) : (
                  new Date(f.datum + "T00:00:00").toLocaleDateString("de-AT")
                )}
              </td>
              {(["abfahrt", "ankunft"] as const).map((feld) => (
                <td key={feld} style={zelle}>
                  {kannBearbeiten ? (
                    <input
                      type="time"
                      value={f[feld]?.slice(0, 5) ?? ""}
                      onChange={(e) => aendern(f.id, { [feld]: e.target.value || null })}
                      style={{ border: "none", background: "transparent", fontFamily: SERIF, fontSize: 15, fontWeight: 600, width: "100%" }}
                    />
                  ) : (
                    f[feld]?.slice(0, 5) ?? ""
                  )}
                </td>
              ))}
              <td style={zelle}>
                {kannBearbeiten ? (
                  <FbText
                    wert={f.reiseweg ?? ""}
                    onCommit={(v) => aendern(f.id, { reiseweg: v.trim() || null })}
                    breit
                  />
                ) : (
                  f.reiseweg
                )}
              </td>
              {(["km_start", "km_ende"] as const).map((feld) => (
                <td key={feld} style={{ ...zelle, textAlign: "right" }}>
                  {kannBearbeiten ? (
                    <FbText
                      wert={zahl(f[feld])}
                      rechts
                      onCommit={(v) => {
                        const n = v.trim() === "" ? null : Number(v.replace(/\s/g, "").replace(",", "."));
                        if (n !== null && !Number.isFinite(n)) {
                          // Vorher wurde still verworfen — es sah aus, als
                          // würde das Feld „nicht funktionieren".
                          fehler(new Error(`„${v}" ist keine Zahl — bitte nur Ziffern, z. B. 247245`));
                          return;
                        }
                        aendern(f.id, patchMitKm(f, { [feld]: n }));
                      }}
                    />
                  ) : (
                    zahl(f[feld])
                  )}
                </td>
              ))}
              <td style={{ ...zelle, textAlign: "right", fontWeight: 700 }}>
                {kannBearbeiten ? (
                  <FbText
                    wert={zahl(f.km)}
                    rechts
                    onCommit={(v) => {
                      const n = Number(v.replace(/\s/g, "").replace(",", ".") || "0");
                      if (!Number.isFinite(n) || n < 0) {
                        fehler(new Error(`„${v}" ist keine Zahl — bitte nur Ziffern, z. B. 62,5`));
                        return;
                      }
                      aendern(f.id, patchMitKm(f, { km: r2(n) }));
                    }}
                  />
                ) : (
                  zahl(f.km)
                )}
              </td>
              <td style={zelle}>
                {kannBearbeiten ? (
                  <FbText
                    wert={f.kostenstelle ?? ""}
                    liste="fb-kostenstellen"
                    onCommit={(v) => aendern(f.id, { kostenstelle: v.trim() || null })}
                    breit
                  />
                ) : (
                  f.kostenstelle
                )}
              </td>
              <td style={{ ...zelle, textAlign: "center", padding: 0 }}>
                {kannBearbeiten &&
                  (busy === f.id ? (
                    <Loader2 className="h-3 w-3 animate-spin inline" />
                  ) : (
                    <button
                      type="button"
                      onClick={() => loeschen(f.id)}
                      className="opacity-40 hover:opacity-100 p-1"
                      title="Fahrt löschen"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  ))}
              </td>
            </tr>
          ))}

          {fahrten.length === 0 && (
            <tr>
              <td colSpan={10} style={{ ...zelle, textAlign: "center", fontStyle: "italic", padding: "14px 0" }}>
                Noch keine Fahrten in dieser Periode.
              </td>
            </tr>
          )}

          {kannBearbeiten && (
            <tr>
              <td colSpan={10} style={{ ...zelle, textAlign: "left" }}>
                <div className="flex items-center gap-4 flex-wrap">
                  <button
                    type="button"
                    onClick={neu}
                    disabled={busy === "neu"}
                    className="inline-flex items-center gap-1 text-xs text-primary hover:underline disabled:opacity-50"
                  >
                    {busy === "neu" ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Plus className="h-3 w-3" />
                    )}{" "}
                    Fahrt hinzufügen
                  </button>
                  <button
                    type="button"
                    onClick={() => dateiRef.current?.click()}
                    disabled={busy === "import"}
                    className="inline-flex items-center gap-1 text-xs text-primary hover:underline disabled:opacity-50"
                    title="Export aus einer Fahrtenbuch-App (z. B. Driversnote) einlesen — Excel, CSV oder der PDF-Fahrtenbericht"
                  >
                    {busy === "import" ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Upload className="h-3 w-3" />
                    )}{" "}
                    Aus App importieren (Excel/CSV/PDF)
                  </button>
                  <input
                    ref={dateiRef}
                    type="file"
                    accept=".xlsx,.xls,.csv,.pdf"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void importiereDatei(f);
                    }}
                  />
                </div>
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <datalist id="fb-kostenstellen">
        {kostenstellen.map((k) => (
          <option key={k} value={k} />
        ))}
      </datalist>
    </div>
  );
}
