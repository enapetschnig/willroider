/**
 * Read-only Vorschau der Tagesplanung im Word-Layout — für Mitarbeiter.
 *
 * Zeigt exakt dieselbe Optik wie das vom Admin generierte PDF/Word-Dokument,
 * aber als reine Webseite (keine PDF-Blobs) — funktioniert damit sofort und
 * zuverlässig auf jedem Gerät/Betriebssystem. Daten kommen live aus
 * useTagesplanung, sind also immer synchron mit dem aktuellen Stand.
 *
 * Am Handy (schmaler als 640 px) wird dasselbe Blatt wie am Tablet gezeigt,
 * auf Bildschirmbreite verkleinert und zoombar — mit zwei Fingern, doppelt
 * tippen oder über +/− (Wunsch J. Maurer 28.10.2026: „soll so aussehen wie in der
 * Ansicht am Tablet aber zum Zoomen“; die Karten-Ansicht vom 27.10. passte
 * nicht). Am PC/Tablet bleibt alles wie gehabt.
 */

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Loader2, Maximize2, Minus, Plus } from "lucide-react";
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

/** Breite, in der das Blatt am Handy gesetzt wird — wie am Tablet. */
const BLATT_BREITE = 760;
/** Höchste Vergrößerung, gemessen an der Originalgröße des Blatts. */
const MAX_ZOOM = 3;

/**
 * Am Handy: Inhalt in Tablet-Breite setzen, auf die verfügbare Breite
 * einpassen und zoombar machen — zwei Finger, doppelt tippen oder +/−.
 * Ab 640 px Breite reicht der Platz, dann wird nichts verändert.
 *
 * Gemessen wird am Rahmen, der seine Breite NICHT aus dem Inhalt bezieht
 * (min-width 0, contain: inline-size). Im Dialog (CSS-Grid) zog das breite
 * Blatt den Rahmen sonst mit auf, es wurde auf diese falsche Breite
 * eingepasst — bis 30.10. war das Blatt deshalb rechts abgeschnitten und die
 * Zoom-Knöpfe lagen außerhalb des Bildschirms.
 */
function HandyZoom({ children }: { children: ReactNode }) {
  const rahmenRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const blattRef = useRef<HTMLDivElement>(null);
  const [breite, setBreite] = useState(0);
  const [faktor, setFaktor] = useState(1); // 1 = eingepasst
  // Aktueller Stand für die Gesten — während des Ziehens wird direkt am
  // Blatt gezoomt (flüssig, ohne React-Durchlauf), am Ende übernommen.
  const live = useRef({ faktor: 1, einpassen: 1 });

  // Vor dem ersten Zeichnen messen, damit das Blatt nicht kurz gequetscht
  // erscheint; danach bei jeder Größenänderung (Handy drehen).
  useLayoutEffect(() => {
    const el = rahmenRef.current;
    if (!el) return;
    const messen = () => setBreite(el.clientWidth);
    const ro = new ResizeObserver(messen);
    ro.observe(el);
    messen();
    return () => ro.disconnect();
  }, []);

  const handy = breite > 0 && breite < 640;
  // − 2: der 1-px-Rand des Sichtfensters links und rechts
  const einpassen = handy ? (breite - 2) / BLATT_BREITE : 1;
  const maxFaktor = Math.max(1, MAX_ZOOM / einpassen);
  live.current.einpassen = einpassen;

  /** Punkt im Sichtfenster → Punkt auf dem Blatt (Originalgröße). */
  const blattPunkt = (sx: number, sy: number) => {
    const el = scrollRef.current;
    const z = live.current.einpassen * live.current.faktor;
    return el ? { bx: (el.scrollLeft + sx) / z, by: (el.scrollTop + sy) / z } : { bx: 0, by: 0 };
  };

  /** Zoom setzen; der Blatt-Punkt (bx, by) landet im Sichtfenster bei (sx, sy). */
  const anwenden = (f: number, bx: number, by: number, sx: number, sy: number) => {
    const el = scrollRef.current;
    const blatt = blattRef.current;
    const e = live.current.einpassen;
    const neu = Math.min(Math.max(1, MAX_ZOOM / e), Math.max(1, f));
    live.current.faktor = neu;
    if (el && blatt) {
      const z = e * neu;
      blatt.style.zoom = String(z);
      el.scrollLeft = bx * z - sx;
      el.scrollTop = by * z - sy;
    }
    return neu;
  };

  /** Knöpfe und Doppeltippen: um einen Punkt (sonst die Mitte) zoomen. */
  const zoomenUm = (f: number, sx?: number, sy?: number) => {
    const el = scrollRef.current;
    if (!el) return;
    const x = sx ?? el.clientWidth / 2;
    const y = sy ?? el.clientHeight / 2;
    const { bx, by } = blattPunkt(x, y);
    setFaktor(anwenden(f, bx, by, x, y));
  };

  // Gesten. Nicht-passive Listener, damit der Browser nicht zusätzlich die
  // ganze Seite zoomt; touch-action am Sichtfenster lässt ihm nur das
  // Verschieben mit einem Finger.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !handy) return;
    let pinch: { abstand: number; faktor: number; bx: number; by: number } | null = null;
    let tipp: { t: number; x: number; y: number; bewegt: boolean } | null = null;
    let letzterTipp: { t: number; x: number; y: number } | null = null;
    const punkt = (t: Touch) => {
      const r = el.getBoundingClientRect();
      return { x: t.clientX - r.left, y: t.clientY - r.top };
    };
    const mitte = (l: TouchList) => {
      const a = punkt(l[0]);
      const b = punkt(l[1]);
      return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, d: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)) };
    };
    const start = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        const m = mitte(e.touches);
        pinch = { abstand: m.d, faktor: live.current.faktor, ...blattPunkt(m.x, m.y) };
        tipp = null;
      } else if (e.touches.length === 1) {
        const p = punkt(e.touches[0]);
        tipp = { t: Date.now(), x: p.x, y: p.y, bewegt: false };
      }
    };
    const bewegen = (e: TouchEvent) => {
      if (e.touches.length === 2 && pinch) {
        e.preventDefault();
        const m = mitte(e.touches);
        anwenden((pinch.faktor * m.d) / pinch.abstand, pinch.bx, pinch.by, m.x, m.y);
      } else if (tipp && e.touches.length === 1) {
        const p = punkt(e.touches[0]);
        if (Math.hypot(p.x - tipp.x, p.y - tipp.y) > 10) tipp.bewegt = true;
      }
    };
    const ende = (e: TouchEvent) => {
      if (pinch) {
        if (e.touches.length < 2) {
          pinch = null;
          tipp = null;
          letzterTipp = null;
          setFaktor(live.current.faktor);
        }
        return;
      }
      if (!tipp || e.touches.length > 0) return;
      const t = tipp;
      tipp = null;
      if (t.bewegt || Date.now() - t.t > 300) {
        letzterTipp = null;
        return;
      }
      const jetzt = Date.now();
      if (letzterTipp && jetzt - letzterTipp.t < 350 && Math.hypot(t.x - letzterTipp.x, t.y - letzterTipp.y) < 40) {
        // Doppeltippen: auf Originalgröße hinein bzw. wieder einpassen.
        e.preventDefault();
        letzterTipp = null;
        const l = live.current;
        zoomenUm(l.faktor > 1.05 ? 1 : Math.max(2, 1 / l.einpassen), t.x, t.y);
      } else {
        letzterTipp = { t: jetzt, x: t.x, y: t.y };
      }
    };
    // Safari am iPhone meldet das Zwei-Finger-Zoomen zusätzlich als eigene
    // gesture*-Ereignisse — auch die abfangen, sonst zoomt die Seite mit.
    const geste = (e: Event) => e.preventDefault();
    el.addEventListener("touchstart", start, { passive: true });
    el.addEventListener("touchmove", bewegen, { passive: false });
    el.addEventListener("touchend", ende, { passive: false });
    el.addEventListener("touchcancel", ende);
    el.addEventListener("gesturestart", geste, { passive: false });
    el.addEventListener("gesturechange", geste, { passive: false });
    return () => {
      el.removeEventListener("touchstart", start);
      el.removeEventListener("touchmove", bewegen);
      el.removeEventListener("touchend", ende);
      el.removeEventListener("touchcancel", ende);
      el.removeEventListener("gesturestart", geste);
      el.removeEventListener("gesturechange", geste);
    };
    // Die Hilfsfunktionen lesen nur Refs — neu binden nur, wenn sich das Sichtfenster ändert.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handy]);

  const knopf =
    "h-10 w-10 shrink-0 flex items-center justify-center rounded-full border bg-background shadow-sm active:bg-muted disabled:opacity-40";
  return (
    <div ref={rahmenRef} style={{ minWidth: 0, width: "100%", contain: "inline-size" }}>
      {!handy ? (
        children
      ) : (
        <>
          <div
            ref={scrollRef}
            className="overflow-auto rounded-sm border"
            style={{ maxHeight: "70vh", touchAction: "pan-x pan-y" }}
          >
            <div ref={blattRef} style={{ width: BLATT_BREITE, zoom: einpassen * faktor } as CSSProperties}>
              {children}
            </div>
          </div>
          <div className="flex items-center justify-end gap-2 pt-2">
            <span className="mr-auto text-xs leading-tight text-muted-foreground">
              Zoomen: zwei Finger oder doppelt tippen
            </span>
            <button
              type="button"
              className={knopf}
              aria-label="Verkleinern"
              disabled={faktor <= 1}
              onClick={() => zoomenUm(faktor / 1.5)}
            >
              <Minus className="h-4 w-4" />
            </button>
            <button
              type="button"
              className={knopf}
              aria-label="Einpassen"
              disabled={faktor === 1}
              onClick={() => zoomenUm(1)}
            >
              <Maximize2 className="h-4 w-4" />
            </button>
            <button
              type="button"
              className={knopf}
              aria-label="Vergrößern"
              disabled={faktor >= maxFaktor}
              onClick={() => zoomenUm(faktor * 1.5)}
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export function TagesplanPreview({ datum }: { datum: string }) {
  const { data: plan, isLoading } = useTagesplanung(datum);

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 p-8 text-sm text-muted-foreground justify-center">
        <Loader2 className="h-4 w-4 animate-spin" /> Lade Tagesplan…
      </div>
    );
  }

  // Wie PDF und Bild: reine Büro-Zeilen (nur in_tagesplanung = false)
  // weglassen. Das ist die Ausgabe-Ansicht, nicht die Bearbeitung.
  const einteilungen = (plan?.einteilungen ?? []).filter((e) => !e.nurAusgeblendete);
  const abwesende = plan?.abwesende ?? [];
  const urlaub = abwesende.filter((a) => a.status === "urlaub");
  const krank = abwesende.filter((a) => a.status === "krank");
  const sw = abwesende.filter((a) => a.status === "schlechtwetter");
  const schule = abwesende.filter((a) => a.status === "berufsschule");
  const polierschule = abwesende.filter((a) => a.status === "polierschule");
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
    <HandyZoom>
    <div
      className="bg-white p-6 border mx-auto"
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
          marginTop: 12,
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
          <div className="flex gap-2">
            <span style={{ fontWeight: "bold", minWidth: 110 }}>Berufsschule:</span>
            <span>{renderAbw(schule)}</span>
          </div>
          {polierschule.length > 0 && (
            <div className="flex gap-2">
              <span style={{ fontWeight: "bold", minWidth: 110 }}>Polierschule:</span>
              <span>{renderAbw(polierschule)}</span>
            </div>
          )}
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
    </HandyZoom>
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
