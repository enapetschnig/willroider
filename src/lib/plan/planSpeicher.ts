/**
 * Lokaler Speicher des Plan-Viewers (IndexedDB, bleibt auch ohne Netz):
 *  - dateien:     Inhalt eines Plans (für „offline speichern“ und als Zwischenspeicher)
 *  - anmerkungen: eigene Anmerkungsebene je Plan, mit Kennzeichen „ausstehend“
 *  - kopien:      „Als Kopie speichern“, das noch nicht hochgeladen ist
 *
 * Bewusst ohne Zusatzbibliothek — nur drei einfache Ablagen.
 */

const DB_NAME = "willroider-plaene";
const DB_VERSION = 1;
const ABLAGEN = ["dateien", "anmerkungen", "kopien"] as const;
type Ablage = (typeof ABLAGEN)[number];

let dbVersprechen: Promise<IDBDatabase> | null = null;

function oeffnen(): Promise<IDBDatabase> {
  if (dbVersprechen) return dbVersprechen;
  dbVersprechen = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const a of ABLAGEN) if (!db.objectStoreNames.contains(a)) db.createObjectStore(a);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      dbVersprechen = null;
      reject(req.error);
    };
  });
  return dbVersprechen;
}

function anfrage<T>(ablage: Ablage, modus: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  return oeffnen().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(ablage, modus);
        const r = fn(tx.objectStore(ablage));
        r.onsuccess = () => resolve(r.result as T);
        r.onerror = () => reject(r.error);
      }),
  );
}

export const speicher = {
  lesen: <T>(ablage: Ablage, key: string) =>
    anfrage<T | undefined>(ablage, "readonly", (s) => s.get(key)).catch(() => undefined),
  schreiben: (ablage: Ablage, key: string, wert: unknown) =>
    anfrage<IDBValidKey>(ablage, "readwrite", (s) => s.put(wert, key)).then(() => undefined),
  entfernen: (ablage: Ablage, key: string) =>
    anfrage<undefined>(ablage, "readwrite", (s) => s.delete(key)).catch(() => undefined),
  alle: async <T>(ablage: Ablage): Promise<{ key: string; wert: T }[]> => {
    try {
      const db = await oeffnen();
      return await new Promise((resolve, reject) => {
        const out: { key: string; wert: T }[] = [];
        const req = db.transaction(ablage, "readonly").objectStore(ablage).openCursor();
        req.onsuccess = () => {
          const c = req.result;
          if (!c) return resolve(out);
          out.push({ key: String(c.key), wert: c.value as T });
          c.continue();
        };
        req.onerror = () => reject(req.error);
      });
    } catch {
      return [];
    }
  },
};

/** Ein Plan, wie er im lokalen Speicher liegt. */
export type GespeicherterPlan = {
  blob: Blob;
  dateiname: string;
  mimetype: string | null;
  baustelleId: string;
  baustelleName?: string | null;
  /** true = ausdrücklich „offline speichern“; false = nur Zwischenspeicher. */
  offline: boolean;
  gespeichertAm: string;
  /** Ordner des Originals (für „Als Kopie speichern“ auch ohne Netz). */
  ordnerKey?: string | null;
  subpath?: string | null;
  webUrl?: string | null;
};
