/**
 * Read-only Vorschau der Tagesplanung im Word-Layout — für Mitarbeiter.
 *
 * Zeigt exakt dieselbe Optik wie das vom Admin generierte PDF/Word-Dokument,
 * aber als reine Webseite (keine PDF-Blobs) — funktioniert damit sofort und
 * zuverlässig auf jedem Gerät/Betriebssystem. Daten kommen live aus
 * useTagesplanung, sind also immer synchron mit dem aktuellen Stand.
 */

import { Loader2 } from "lucide-react";
import { useTagesplanung } from "@/hooks/useTagesplanung";
import type { Database } from "@/integrations/supabase/types";

type Profile = Database["public"]["Tables"]["profiles"]["Row"];

const WOCHENTAG = [
  "Sonntag",
  "Montag",
  "Dienstag",
  "Mittwoch",
  "Donnerstag",
  "Freitag",
  "Samstag",
];

function fmtHeaderDatum(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  return `${WOCHENTAG[d.getDay()]} ${String(d.getDate()).padStart(2, "0")}.${String(
    d.getMonth() + 1,
  ).padStart(2, "0")}.${d.getFullYear()}`;
}

function shortDate(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  return `${d.getDate()}.${d.getMonth() + 1}.`;
}

const cellBorder = "1px solid black";

export function TagesplanPreview({ datum }: { datum: string }) {
  const { data: plan, isLoading } = useTagesplanung(datum);

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 p-8 text-sm text-muted-foreground justify-center">
        <Loader2 className="h-4 w-4 animate-spin" /> Lade Tagesplan…
      </div>
    );
  }

  const einteilungen = plan?.einteilungen ?? [];
  const abwesende = plan?.abwesende ?? [];
  const urlaub = abwesende.filter((a) => a.status === "urlaub");
  const krank = abwesende.filter((a) => a.status === "krank");
  const sw = abwesende.filter((a) => a.status === "schlechtwetter");
  const notiz = plan?.freigabe?.notiz ?? "";

  const renderAbw = (list: typeof abwesende) => {
    if (list.length === 0) return <span style={{ fontStyle: "italic" }}>—</span>;
    return list
      .map((a) => {
        const name = `${a.ma.nachname} ${a.ma.vorname}`;
        const suffix =
          a.seit && a.bis
            ? ` (${shortDate(a.seit)} – ${shortDate(a.bis)})`
            : a.seit
            ? ` (seit ${shortDate(a.seit)})`
            : "";
        return `${name}${suffix}`;
      })
      .join(" · ");
  };

  return (
    <div
      className="bg-white p-4 sm:p-6 border mx-auto"
      style={{ fontFamily: '"Times New Roman", Times, serif', maxWidth: "210mm" }}
    >
      {/* Titel-Box */}
      <div className="border-2 border-black py-2 px-4 text-center mb-4">
        <div
          className="text-xl font-bold"
          style={{ fontStyle: "italic", textDecoration: "underline" }}
        >
          Arbeitseinteilung Zimmerei
        </div>
      </div>

      {/* Datum */}
      <div className="text-center mb-3">
        <span className="text-lg font-bold" style={{ textDecoration: "underline" }}>
          {fmtHeaderDatum(datum)}
        </span>
      </div>

      {/* Tabelle */}
      <table style={{ width: "100%", borderCollapse: "collapse", border: cellBorder }}>
        <thead>
          <tr>
            <th style={thStyle()}>
              <span style={{ fontStyle: "italic", textDecoration: "underline" }}>
                BVH:
              </span>
            </th>
            <th style={{ ...thStyle(), width: "20%" }}>
              <span style={{ fontStyle: "italic", textDecoration: "underline" }}>
                Fahrz.
              </span>
            </th>
            <th style={{ ...thStyle(), width: "20%" }}>
              <span style={{ fontStyle: "italic", textDecoration: "underline" }}>
                Tätigkeit
              </span>
            </th>
            <th style={{ ...thStyle(), width: "35%" }}>
              <span style={{ fontStyle: "italic", textDecoration: "underline" }}>
                Mitarbeiter
              </span>
            </th>
          </tr>
        </thead>
        <tbody>
          {einteilungen.map((e) => (
            <tr key={e.einteilung.id}>
              {/* BVH */}
              <td style={tdStyle()}>
                {e.baustelle ? (
                  <>
                    <div
                      style={{
                        fontWeight: "bold",
                        textDecoration: "underline",
                        fontSize: "0.95em",
                      }}
                    >
                      {e.baustelle.bvh_name}
                    </div>
                    {e.baustelle.kostenstelle && (
                      <div
                        style={{ fontSize: "0.78em", fontStyle: "italic", marginTop: 2 }}
                      >
                        {e.baustelle.kostenstelle}
                      </div>
                    )}
                  </>
                ) : (
                  <span style={{ fontStyle: "italic", color: "#777" }}>(intern)</span>
                )}
              </td>
              {/* Fahrz. */}
              <td style={{ ...tdStyle(), fontWeight: "bold", fontSize: "0.95em" }}>
                {e.fahrzeuge.length > 0
                  ? e.fahrzeuge.map((f) => <div key={f.id}>{f.kennzeichen}</div>)
                  : "—"}
              </td>
              {/* Tätigkeit */}
              <td
                style={{
                  ...tdStyle(),
                  fontStyle: "italic",
                  fontSize: "0.92em",
                  whiteSpace: "pre-line",
                }}
              >
                {e.einteilung.taetigkeit || "—"}
              </td>
              {/* Mitarbeiter */}
              <td style={tdStyle()}>
                {e.mitarbeiter.filter((m) => m.profil).length > 0 ? (
                  e.mitarbeiter
                    .filter((m) => m.profil)
                    .map((m) => (
                      <div key={m.ma.id} style={{ fontSize: "0.92em" }}>
                        {(m.profil as Profile).nachname} {(m.profil as Profile).vorname}
                      </div>
                    ))
                ) : (
                  <span style={{ fontStyle: "italic", color: "#777" }}>—</span>
                )}
              </td>
            </tr>
          ))}
          {einteilungen.length === 0 && (
            <tr>
              <td
                colSpan={4}
                style={{ ...tdStyle(), textAlign: "center", color: "#777" }}
              >
                Noch keine Einteilungen für diesen Tag.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {/* Sonderfälle */}
      <div
        style={{
          border: cellBorder,
          padding: "10px 12px",
          fontSize: "0.92em",
          marginTop: 16,
        }}
      >
        <div
          style={{
            fontWeight: "bold",
            textDecoration: "underline",
            fontStyle: "italic",
            marginBottom: 8,
          }}
        >
          Sonderfälle:
        </div>
        <div className="space-y-1.5">
          <div className="flex gap-2">
            <span style={{ fontWeight: "bold", minWidth: 110 }}>Urlaub / ZA:</span>
            <span>{renderAbw(urlaub)}</span>
          </div>
          <div className="flex gap-2">
            <span style={{ fontWeight: "bold", minWidth: 110 }}>Krank:</span>
            <span>{renderAbw(krank)}</span>
          </div>
          <div className="flex gap-2">
            <span style={{ fontWeight: "bold", minWidth: 110 }}>Schlechtwetter:</span>
            <span>{renderAbw(sw)}</span>
          </div>
          {notiz.trim() && (
            <div className="pt-2 border-t border-black/20 mt-2">
              <div style={{ fontWeight: "bold", marginBottom: 4 }}>
                Sonstige Hinweise:
              </div>
              <div style={{ whiteSpace: "pre-line" }}>{notiz}</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function thStyle(): React.CSSProperties {
  return {
    border: cellBorder,
    padding: "6px 8px",
    fontWeight: "bold",
    textAlign: "left",
    background: "white",
  };
}
function tdStyle(): React.CSSProperties {
  return { border: cellBorder, padding: "8px 10px", verticalAlign: "top" };
}
