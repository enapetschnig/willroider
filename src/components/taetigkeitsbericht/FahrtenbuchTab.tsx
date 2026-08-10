/**
 * Fahrtenbuch — Nachbau des Excel-Blatts, aber je Berichtsperiode (21.–20.).
 *
 * Spalten wie in der Vorlage: Tätigkeitsbericht (= Periodenlabel, fürs
 * Lohnbüro immer gefüllt) · Datum · Abfahrt · Ankunft · Reiseweg ·
 * km-Stände · gefahrene km · Kostenstelle · Dauer. Farben aus TB_FARBEN,
 * dieselben wie im Tätigkeitsbericht und im PDF.
 *
 * Die km je Tag fließen direkt in die Zeile „gefahrene km" des
 * Tätigkeitsberichts — eine Quelle, keine Doppelerfassung.
 */

import { useEffect, useRef, useState } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import {
  TB_FARBEN,
  fahrtDauerH,
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
  fontSize: 13,
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
        fontSize: 13,
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

  /** km-Stände: wenn beide da sind, gefahrene km automatisch mitrechnen. */
  function patchMitKm(f: FahrtRow, patch: Partial<FahrtRow>): Partial<FahrtRow> {
    const start = patch.km_start !== undefined ? patch.km_start : f.km_start;
    const ende = patch.km_ende !== undefined ? patch.km_ende : f.km_ende;
    if (
      (patch.km_start !== undefined || patch.km_ende !== undefined) &&
      start != null &&
      ende != null &&
      ende >= start
    ) {
      return { ...patch, km: r2(ende - start) };
    }
    return patch;
  }

  async function neu() {
    setBusy("neu");
    try {
      // Vorbelegung: heute, wenn es in der Periode liegt — sonst Periodenstart.
      const heute = new Date().toISOString().slice(0, 10);
      const datum = heute >= periode.von && heute <= periode.bis ? heute : periode.von;
      const { error } = await supabase.from("fahrtenbuch_eintraege" as any).insert({
        mitarbeiter_id: mitarbeiterId,
        datum,
        km: 0,
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

  async function speichereKennzeichen(v: string) {
    const { error } = await supabase
      .from("profiles")
      .update({ fahrtenbuch_kennzeichen: v.trim() || null } as any)
      .eq("id", mitarbeiterId);
    if (error) fehler(error);
  }

  const gesamtKm = r2(fahrten.reduce((a, f) => a + Number(f.km ?? 0), 0));
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
              colSpan={11}
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
            <th colSpan={4} style={{ ...zelle, background: TB_FARBEN.eingabe, textAlign: "left", fontWeight: 400 }}>
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
            <th style={{ ...kopfWeiss, minWidth: 60 }}>Dauer (h)</th>
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
                    style={{ border: "none", background: "transparent", fontFamily: SERIF, fontSize: 13, width: "100%" }}
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
                      style={{ border: "none", background: "transparent", fontFamily: SERIF, fontSize: 13, width: "100%" }}
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
                        const n = v.trim() === "" ? null : Number(v.replace(",", "."));
                        if (n !== null && !Number.isFinite(n)) return;
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
                      const n = Number(v.replace(",", ".").trim() || "0");
                      if (Number.isFinite(n) && n >= 0) aendern(f.id, { km: r2(n) });
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
              <td style={{ ...zelle, textAlign: "right" }}>{zahl(fahrtDauerH(f.abfahrt, f.ankunft))}</td>
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
              <td colSpan={11} style={{ ...zelle, textAlign: "center", fontStyle: "italic", padding: "14px 0" }}>
                Noch keine Fahrten in dieser Periode.
              </td>
            </tr>
          )}

          {kannBearbeiten && (
            <tr>
              <td colSpan={11} style={{ ...zelle, textAlign: "left" }}>
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
              </td>
            </tr>
          )}

          {/* GESAMT wie in der Excel: grün hinterlegt */}
          <tr>
            <td colSpan={7} style={{ ...zelle, textAlign: "right", fontWeight: 700, border: "2px solid #000" }}>
              GESAMT km:
            </td>
            <td
              style={{
                ...zelle,
                textAlign: "right",
                fontWeight: 700,
                background: TB_FARBEN.stundensumme,
                border: "2px solid #000",
              }}
            >
              {zahl(gesamtKm)}
            </td>
            <td colSpan={3} style={{ ...zelle, border: "2px solid #000" }} />
          </tr>
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
