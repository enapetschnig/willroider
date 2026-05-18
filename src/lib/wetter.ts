/**
 * Wetter-Fetcher für Berichte. Open-Meteo (kostenlos, kein API-Key).
 * - Vergangene Tage: archive-api.open-meteo.com
 * - Heute / Zukunft: api.open-meteo.com (Forecast)
 * - WMO weather_code → deutsche Kurzbeschreibung
 *
 * Liefert null bei Fehler oder fehlenden Koordinaten. Aufrufer zeigt dann
 * eine manuelle Eingabe.
 */

export interface WetterTag {
  beschreibung: string;
  temp_min: number;
  temp_max: number;
  niederschlag_mm: number;
  quelle: "open-meteo";
}

const WMO_CODE: Record<number, string> = {
  0: "Heiter",
  1: "Überwiegend heiter",
  2: "Bewölkt",
  3: "Bedeckt",
  45: "Nebel",
  48: "Nebel mit Reif",
  51: "Leichter Sprühregen",
  53: "Sprühregen",
  55: "Starker Sprühregen",
  56: "Gefr. Sprühregen",
  57: "Starker gefr. Sprühregen",
  61: "Leichter Regen",
  63: "Regen",
  65: "Starker Regen",
  66: "Gefr. Regen",
  67: "Starker gefr. Regen",
  71: "Leichter Schneefall",
  73: "Schneefall",
  75: "Starker Schneefall",
  77: "Schneegriesel",
  80: "Leichter Schauer",
  81: "Schauer",
  82: "Heftiger Schauer",
  85: "Leichte Schneeschauer",
  86: "Schneeschauer",
  95: "Gewitter",
  96: "Gewitter mit leichtem Hagel",
  99: "Gewitter mit Hagel",
};

function beschreibungAusCode(code: number | null | undefined): string {
  if (code == null) return "Unbekannt";
  return WMO_CODE[code] ?? "Wetterlage unbekannt";
}

/** ISO-Datum heute in Wien-Zeitzone. */
function heuteIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Geocode AT-Adresse via Nominatim (OpenStreetMap, kostenlos, kein API-Key).
 * Liefert null wenn Adresse leer / Nominatim erfolglos.
 * Aufrufer sollte das Ergebnis in `baustellen.koordinaten_lat/lng` cachen,
 * damit nicht jedesmal neu angefragt wird (Nominatim erlaubt max. 1 req/sec).
 */
export async function geocodeAdresse(
  strasse: string | null | undefined,
  plz: string | null | undefined,
  ort: string | null | undefined,
): Promise<{ lat: number; lng: number } | null> {
  const parts = [strasse, plz, ort].map((s) => (s ?? "").trim()).filter(Boolean);
  if (parts.length === 0) return null;
  const q = parts.join(", ");
  const url =
    `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=at` +
    `&q=${encodeURIComponent(q)}`;
  try {
    const res = await fetch(url, { headers: { "Accept-Language": "de" } });
    if (!res.ok) return null;
    const arr = await res.json();
    if (!Array.isArray(arr) || arr.length === 0) return null;
    const lat = Number(arr[0].lat);
    const lng = Number(arr[0].lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { lat, lng };
  } catch {
    return null;
  }
}

export async function fetchWetterFuerTag(
  lat: number,
  lng: number,
  datum: string,
): Promise<WetterTag | null> {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(datum)) return null;

  const isPast = datum < heuteIso();
  const base = isPast
    ? "https://archive-api.open-meteo.com/v1/archive"
    : "https://api.open-meteo.com/v1/forecast";

  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lng),
    start_date: datum,
    end_date: datum,
    daily: "temperature_2m_max,temperature_2m_min,precipitation_sum,weather_code",
    timezone: "Europe/Vienna",
  });

  try {
    const res = await fetch(`${base}?${params.toString()}`);
    if (!res.ok) return null;
    const data = await res.json();
    const d = data?.daily;
    if (!d || !Array.isArray(d.time) || d.time.length === 0) return null;
    return {
      beschreibung: beschreibungAusCode(d.weather_code?.[0]),
      temp_min: Number(d.temperature_2m_min?.[0] ?? 0),
      temp_max: Number(d.temperature_2m_max?.[0] ?? 0),
      niederschlag_mm: Number(d.precipitation_sum?.[0] ?? 0),
      quelle: "open-meteo",
    };
  } catch {
    return null;
  }
}
