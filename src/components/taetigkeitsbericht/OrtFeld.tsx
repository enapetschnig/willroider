/**
 * Ortsfeld fürs Fahrtenbuch (Abfahrt/Ankunft) mit Vorschlagsliste.
 *
 * Änderungswunsch J. Mainhard 24.09.: „Abfahrt - Ankunft über google maps“.
 * Umgesetzt mit OpenStreetMap statt Google (kein Konto, keine Kosten).
 * Die Vorschläge kommen in dieser Reihenfolge: Firma, eigene Baustellen mit
 * Adresse, die eigenen früheren Orte, zuletzt die Adresssuche auf der Karte
 * über Photon (photon.komoot.io). Nominatim (siehe lib/wetter.ts) darf laut
 * seinen Nutzungsregeln NICHT für Vorschläge beim Tippen verwendet werden —
 * Photon ist genau dafür gebaut.
 *
 * Freie Eingabe geht immer: ist die Kartensuche nicht erreichbar, bleibt es
 * ein normales Textfeld. Gespeichert wird wie bei den anderen Feldern erst
 * beim Verlassen — oder sofort beim Wählen eines Vorschlags.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Building2, HardHat, History, Loader2, MapPin } from "lucide-react";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";

export interface OrtVorschlag {
  /** Das, was ins Feld geschrieben wird. */
  text: string;
  art: "firma" | "baustelle" | "frueher" | "karte";
  /** Fette Kopfzeile im Vorschlag (Bauvorhaben), darunter `adresse`. */
  titel?: string;
  adresse?: string;
  /** Nur Baustellen: Kostenstelle wie in der Kostenstellen-Liste (4-stellig). */
  kostenstelle?: string;
}

const SERIF = '"Times New Roman", Times, Georgia, serif';

/** Klein, ohne Akzente, ß = ss — „strasse“ findet „Straße“. */
const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/ß/g, "ss")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

// ─── Kartensuche (Photon / OpenStreetMap) ───────────────────────────────

/** Zwischenspeicher je Suchtext — dieselbe Eingabe fragt nicht zweimal an. */
const kartenCache = new Map<string, OrtVorschlag[]>();

/** Die Felder einer Photon-Antwort, die hier gebraucht werden. */
interface PhotonFeature {
  properties?: {
    name?: string;
    street?: string;
    housenumber?: string;
    postcode?: string;
    city?: string;
    town?: string;
    village?: string;
    locality?: string;
    district?: string;
    country?: string;
    countrycode?: string;
  };
}

function photonText(f: PhotonFeature): string {
  const p = f?.properties ?? {};
  const strasse = [p.street, p.housenumber].filter(Boolean).join(" ");
  const ort = [p.postcode, p.city ?? p.town ?? p.village ?? p.locality ?? p.district].filter(Boolean).join(" ");
  // Name nur, wenn er mehr sagt als Straße/Ort (Firmen, Schulen, Gasthäuser).
  const name = p.name && p.name !== p.street && p.name !== ort && p.name !== p.city ? p.name : "";
  const land = p.countrycode && p.countrycode !== "AT" ? p.country : "";
  return [name, strasse, ort, land].filter(Boolean).join(", ");
}

async function sucheKarte(q: string, signal: AbortSignal): Promise<OrtVorschlag[]> {
  const schluessel = norm(q);
  const gemerkt = kartenCache.get(schluessel);
  if (gemerkt) return gemerkt;
  // lat/lon = Villach: Treffer in der Nähe zuerst, der Rest der Welt bleibt
  // erreichbar (Fahrten nach Italien/Slowenien).
  const res = await fetch(
    `https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&lang=de&limit=6&lat=46.61&lon=13.85`,
    { signal },
  );
  if (!res.ok) return [];
  const json = await res.json();
  const gesehen = new Set<string>();
  const liste: OrtVorschlag[] = [];
  for (const f of (json?.features ?? []) as PhotonFeature[]) {
    const text = photonText(f);
    if (!text || gesehen.has(norm(text))) continue;
    gesehen.add(norm(text));
    liste.push({ text, art: "karte" });
  }
  kartenCache.set(schluessel, liste);
  return liste;
}

// ─── Feld ───────────────────────────────────────────────────────────────

const GRUPPEN: { art: OrtVorschlag["art"]; titel: string; max: number }[] = [
  { art: "firma", titel: "Firma", max: 4 },
  { art: "baustelle", titel: "Baustellen", max: 6 },
  { art: "frueher", titel: "Frühere Orte", max: 5 },
  { art: "karte", titel: "Karte (OpenStreetMap)", max: 6 },
];

const SYMBOL = {
  firma: Building2,
  baustelle: HardHat,
  frueher: History,
  karte: MapPin,
} as const;

export function OrtFeld({
  wert,
  onCommit,
  vorschlaege,
  platzhalter,
}: {
  wert: string;
  /** `vorschlag` ist gesetzt, wenn aus der Liste gewählt wurde. */
  onCommit: (text: string, vorschlag?: OrtVorschlag) => void;
  /** Firma, Baustellen und frühere Orte — die Kartentreffer holt das Feld selbst. */
  vorschlaege: OrtVorschlag[];
  platzhalter?: string;
}) {
  const [text, setText] = useState(wert);
  const alt = useRef(wert);
  // Zuletzt selbst gespeicherter Text — nach dem Wählen eines Vorschlags
  // löst das anschließende Verlassen des Felds nicht noch ein Speichern aus.
  const gespeichert = useRef<string | null>(null);
  useEffect(() => {
    if (alt.current !== wert) {
      alt.current = wert;
      gespeichert.current = null;
      setText(wert);
    }
  }, [wert]);

  const [offen, setOffen] = useState(false);
  const [aktiv, setAktiv] = useState(-1);
  const [karte, setKarte] = useState<OrtVorschlag[]>([]);
  const [sucht, setSucht] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const suchtext = text.trim();
  // Solange nur der gespeicherte Wert im Feld steht, gibt es nichts zu suchen.
  const tippt = suchtext !== "" && suchtext !== wert.trim();

  // Kartensuche: entprellt, ab 3 Zeichen, alte Anfragen werden abgebrochen.
  useEffect(() => {
    if (!offen || !tippt || suchtext.length < 3) {
      setKarte([]);
      setSucht(false);
      return;
    }
    const ctrl = new AbortController();
    setSucht(true);
    const t = window.setTimeout(() => {
      sucheKarte(suchtext, ctrl.signal)
        .then((r) => {
          if (!ctrl.signal.aborted) setKarte(r);
        })
        .catch(() => {
          if (!ctrl.signal.aborted) setKarte([]);
        })
        .finally(() => {
          if (!ctrl.signal.aborted) setSucht(false);
        });
    }, 350);
    return () => {
      window.clearTimeout(t);
      ctrl.abort();
    };
  }, [offen, tippt, suchtext]);

  /** Sichtbare Vorschläge, gruppiert — leeres Feld: Firma + häufigste Orte. */
  const gruppen = useMemo(() => {
    const woerter = tippt ? norm(suchtext).split(/\s+/).filter(Boolean) : [];
    const passt = (v: OrtVorschlag) => {
      const heu = norm(`${v.titel ?? ""} ${v.text}`);
      return woerter.every((w) => heu.includes(w));
    };
    const lokal = vorschlaege.filter((v) => (tippt ? passt(v) : v.art !== "baustelle"));
    const schonDa = new Set(lokal.map((v) => norm(v.text)));
    const alle = [...lokal, ...karte.filter((v) => !schonDa.has(norm(v.text)))];
    return GRUPPEN.map((g) => ({
      ...g,
      eintraege: alle.filter((v) => v.art === g.art).slice(0, g.max),
    })).filter((g) => g.eintraege.length > 0);
  }, [vorschlaege, karte, tippt, suchtext]);
  const flach = useMemo(() => gruppen.flatMap((g) => g.eintraege), [gruppen]);

  useEffect(() => {
    setAktiv((i) => Math.min(i, flach.length - 1));
  }, [flach.length]);

  function speichern(neu: string, vorschlag?: OrtVorschlag) {
    if (!vorschlag && (neu === wert || neu === gespeichert.current)) return;
    gespeichert.current = neu;
    onCommit(neu, vorschlag);
  }

  function waehle(v: OrtVorschlag) {
    setText(v.text);
    setOffen(false);
    setAktiv(-1);
    speichern(v.text, v);
  }

  const zeigen = offen && (flach.length > 0 || sucht);

  return (
    <Popover open={zeigen} onOpenChange={(o) => !o && setOffen(false)}>
      <PopoverAnchor asChild>
        <input
          ref={inputRef}
          value={text}
          placeholder={platzhalter}
          onFocus={() => setOffen(true)}
          onChange={(e) => {
            setText(e.target.value);
            setOffen(true);
            setAktiv(-1);
          }}
          onBlur={() => {
            setOffen(false);
            speichern(text.trim());
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown" && flach.length > 0) {
              e.preventDefault();
              setOffen(true);
              setAktiv((i) => Math.min(i + 1, flach.length - 1));
            } else if (e.key === "ArrowUp" && flach.length > 0) {
              e.preventDefault();
              setAktiv((i) => Math.max(i - 1, -1));
            } else if (e.key === "Enter") {
              if (zeigen && aktiv >= 0 && flach[aktiv]) waehle(flach[aktiv]);
              else (e.target as HTMLInputElement).blur();
            } else if (e.key === "Escape") {
              if (zeigen) setOffen(false);
              else setText(wert);
            }
          }}
          style={{
            width: "100%",
            border: "none",
            outline: "none",
            background: "transparent",
            fontFamily: SERIF,
            fontSize: 15,
            fontWeight: 600,
          }}
        />
      </PopoverAnchor>
      <PopoverContent
        align="start"
        className="w-[min(380px,90vw)] p-1"
        onOpenAutoFocus={(e) => e.preventDefault()}
        onCloseAutoFocus={(e) => e.preventDefault()}
        // Klick ins Feld selbst schließt die Liste nicht.
        onInteractOutside={(e) => {
          if (inputRef.current?.contains(e.target as Node)) e.preventDefault();
        }}
        // Das Feld behält den Fokus, wenn man in die Liste klickt.
        onMouseDown={(e) => e.preventDefault()}
      >
        <div className="max-h-72 overflow-auto">
          {gruppen.map((g) => (
            <div key={g.art} className="py-0.5">
              <div className="px-2 pt-1 pb-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                {g.titel}
              </div>
              {g.eintraege.map((v) => {
                const i = flach.indexOf(v);
                const Icon = SYMBOL[v.art];
                return (
                  <button
                    key={`${v.art}|${v.titel ?? ""}|${v.text}`}
                    type="button"
                    onClick={() => waehle(v)}
                    onMouseEnter={() => setAktiv(i)}
                    className={`w-full flex items-start gap-2 rounded px-2 py-1.5 text-left text-sm ${
                      i === aktiv ? "bg-accent text-accent-foreground" : "hover:bg-accent/60"
                    }`}
                  >
                    <Icon className="h-3.5 w-3.5 mt-0.5 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1">
                      {v.titel && <span className="block font-medium leading-tight">{v.titel}</span>}
                      <span className={v.titel ? "block text-xs text-muted-foreground" : "block leading-tight"}>
                        {v.titel ? v.adresse ?? v.text : v.text}
                      </span>
                    </span>
                    {v.kostenstelle && (
                      <span className="shrink-0 text-[10px] text-muted-foreground mt-0.5">Kst {v.kostenstelle}</span>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
          {sucht && (
            <div className="flex items-center gap-1.5 px-2 py-1.5 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" /> Suche auf der Karte …
            </div>
          )}
          {karte.length > 0 && (
            <div className="px-2 pt-1 text-[10px] text-muted-foreground">Adressen © OpenStreetMap-Mitwirkende</div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
