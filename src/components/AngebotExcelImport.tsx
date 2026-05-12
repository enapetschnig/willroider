import { useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Upload, FileSpreadsheet, ArrowRight } from "lucide-react";
import type { AngebotStatus } from "@/integrations/supabase/types";

type FieldKey =
  | "bvh_name"
  | "angebots_nr"
  | "bauherr"
  | "bauherr_adresse"
  | "baustellen_adresse"
  | "plz"
  | "ort"
  | "kontakt_telefon"
  | "kontakt_email"
  | "datum_angebot"
  | "wert_euro"
  | "status"
  | "naechste_nachfrage"
  | "notizen";

const FIELDS: { key: FieldKey; label: string; required?: boolean }[] = [
  { key: "bvh_name", label: "BV-Name", required: true },
  { key: "angebots_nr", label: "Angebots-Nr." },
  { key: "bauherr", label: "Bauherr" },
  { key: "bauherr_adresse", label: "Bauherr-Adresse" },
  { key: "baustellen_adresse", label: "Baustellen-Adresse" },
  { key: "plz", label: "PLZ" },
  { key: "ort", label: "Ort" },
  { key: "kontakt_telefon", label: "Telefon" },
  { key: "kontakt_email", label: "E-Mail" },
  { key: "datum_angebot", label: "Datum Angebot" },
  { key: "wert_euro", label: "Wert €" },
  { key: "status", label: "Status" },
  { key: "naechste_nachfrage", label: "Nächste Nachfrage" },
  { key: "notizen", label: "Notizen" },
];

const MAPPING_STORAGE_KEY = "willroider:angebot_excel_mapping";

// Excel-Serial-Date → ISO-String
function excelDateToIso(v: any): string | null {
  if (v == null || v === "") return null;
  if (typeof v === "number") {
    // Excel epoch starts 1900-01-01, with a leap-year bug → use SheetJS helper
    const date = XLSX.SSF.parse_date_code(v);
    if (!date) return null;
    const y = date.y.toString().padStart(4, "0");
    const m = String(date.m).padStart(2, "0");
    const d = String(date.d).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  const s = String(v).trim();
  // ISO-Format ohnehin
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  // DD.MM.YYYY
  const m = s.match(/^(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{2,4})/);
  if (m) {
    const dd = m[1].padStart(2, "0");
    const mm = m[2].padStart(2, "0");
    let yyyy = m[3];
    if (yyyy.length === 2) yyyy = (Number(yyyy) > 50 ? "19" : "20") + yyyy;
    return `${yyyy}-${mm}-${dd}`;
  }
  return null;
}

function parseStatus(v: any): AngebotStatus {
  const s = String(v ?? "")
    .toLowerCase()
    .trim();
  if (!s) return "offen";
  if (s.includes("verhandl")) return "in_verhandlung";
  if (s.includes("angen") || s.includes("auftrag") || s.includes("ja"))
    return "angenommen";
  if (s.includes("abgelehnt") || s.includes("nein") || s.includes("verlor"))
    return "abgelehnt";
  if (s.includes("zurueck") || s.includes("zurück")) return "zurueckgezogen";
  return "offen";
}

function parseNumber(v: any): number | null {
  if (v == null || v === "") return null;
  if (typeof v === "number") return v;
  const s = String(v).replace(/\./g, "").replace(",", ".").replace(/[^\d.-]/g, "");
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function AngebotExcelImport({
  open,
  onOpenChange,
  onImported,
}: {
  open: boolean;
  onOpenChange: (b: boolean) => void;
  onImported: () => void;
}) {
  const { toast } = useToast();
  const { user } = useAuth();
  const fileRef = useRef<HTMLInputElement>(null);
  const [sheetNames, setSheetNames] = useState<string[]>([]);
  const [activeSheet, setActiveSheet] = useState<string>("");
  const [headerRow, setHeaderRow] = useState<number>(1);
  const [rawSheets, setRawSheets] = useState<Record<string, any[][]>>({});
  const [mapping, setMapping] = useState<Partial<Record<FieldKey, string>>>({});
  const [importing, setImporting] = useState(false);

  // Reset
  useEffect(() => {
    if (!open) {
      setSheetNames([]);
      setActiveSheet("");
      setHeaderRow(1);
      setRawSheets({});
      setMapping({});
      setImporting(false);
    }
  }, [open]);

  // Vorher gespeichertes Mapping wiederherstellen
  useEffect(() => {
    if (!open) return;
    try {
      const saved = localStorage.getItem(MAPPING_STORAGE_KEY);
      if (saved) setMapping(JSON.parse(saved));
    } catch {
      /* ignore */
    }
  }, [open]);

  const onFile = async (file: File) => {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array" });
    const sheets: Record<string, any[][]> = {};
    wb.SheetNames.forEach((n) => {
      const ws = wb.Sheets[n];
      sheets[n] = XLSX.utils.sheet_to_json(ws, {
        header: 1,
        raw: true,
        defval: null,
      }) as any[][];
    });
    setRawSheets(sheets);
    setSheetNames(wb.SheetNames);
    setActiveSheet(wb.SheetNames[0] ?? "");
  };

  const headers: string[] = useMemo(() => {
    const rows = rawSheets[activeSheet];
    if (!rows) return [];
    const row = rows[headerRow - 1] ?? [];
    return row.map((c: any, i: number) =>
      c == null || String(c).trim() === "" ? `Spalte ${i + 1}` : String(c).trim()
    );
  }, [rawSheets, activeSheet, headerRow]);

  const dataRows: any[][] = useMemo(() => {
    const rows = rawSheets[activeSheet];
    if (!rows) return [];
    return rows.slice(headerRow).filter((r) => r.some((c) => c != null && c !== ""));
  }, [rawSheets, activeSheet, headerRow]);

  // Auto-Mapping per Heuristik
  useEffect(() => {
    if (headers.length === 0) return;
    setMapping((prev) => {
      const next: Partial<Record<FieldKey, string>> = { ...prev };
      const usedExcelCols = new Set(Object.values(prev).filter(Boolean) as string[]);
      const lc = (s: string) => s.toLowerCase();
      const findHeader = (...patterns: RegExp[]): string | undefined =>
        headers.find(
          (h) => !usedExcelCols.has(h) && patterns.some((p) => p.test(lc(h)))
        );
      const set = (k: FieldKey, h?: string) => {
        if (!next[k] && h) {
          next[k] = h;
          usedExcelCols.add(h);
        }
      };
      set("bvh_name", findHeader(/bv|bauvorhaben|projekt|name/));
      set("angebots_nr", findHeader(/nr|nummer/));
      set("bauherr", findHeader(/bauherr|kunde|auftraggeber/));
      set(
        "bauherr_adresse",
        findHeader(/bauherr.*adress|kunde.*adress|rechnungsadresse/)
      );
      set("baustellen_adresse", findHeader(/baustelle.*adress|adresse|str/));
      set("plz", findHeader(/plz|postleit/));
      set("ort", findHeader(/ort|stadt/));
      set("kontakt_telefon", findHeader(/tel|phone|handy/));
      set("kontakt_email", findHeader(/email|mail|e-mail/));
      set("datum_angebot", findHeader(/datum|date/));
      set("wert_euro", findHeader(/wert|summe|betrag|euro|preis/));
      set("status", findHeader(/status|zustand/));
      set("naechste_nachfrage", findHeader(/nachfrag|wiedervorlage|erinner/));
      set("notizen", findHeader(/notiz|bemerk|info|kommentar/));
      return next;
    });
  }, [headers.join("|")]);

  const preview: any[] = useMemo(() => {
    return dataRows.slice(0, 10).map((r) => {
      const obj: Record<string, any> = {};
      FIELDS.forEach((f) => {
        const excelCol = mapping[f.key];
        if (!excelCol) return;
        const idx = headers.indexOf(excelCol);
        obj[f.key] = idx >= 0 ? r[idx] : null;
      });
      return obj;
    });
  }, [dataRows, headers, mapping]);

  const doImport = async () => {
    if (!mapping.bvh_name) {
      toast({
        variant: "destructive",
        title: "BV-Name fehlt",
        description: "BV-Name ist Pflicht und muss einer Excel-Spalte zugeordnet sein.",
      });
      return;
    }
    setImporting(true);
    // Mapping persistieren
    try {
      localStorage.setItem(MAPPING_STORAGE_KEY, JSON.stringify(mapping));
    } catch {
      /* ignore */
    }
    const inserts = dataRows
      .map((r) => {
        const get = (k: FieldKey) => {
          const col = mapping[k];
          if (!col) return null;
          const idx = headers.indexOf(col);
          return idx >= 0 ? r[idx] : null;
        };
        const bvh = String(get("bvh_name") ?? "").trim();
        if (!bvh) return null;
        return {
          bvh_name: bvh,
          angebots_nr: get("angebots_nr") ? String(get("angebots_nr")).trim() : null,
          bauherr: get("bauherr") ? String(get("bauherr")).trim() : null,
          bauherr_adresse: get("bauherr_adresse")
            ? String(get("bauherr_adresse")).trim()
            : null,
          baustellen_adresse: get("baustellen_adresse")
            ? String(get("baustellen_adresse")).trim()
            : null,
          plz: get("plz") ? String(get("plz")).trim() : null,
          ort: get("ort") ? String(get("ort")).trim() : null,
          kontakt_telefon: get("kontakt_telefon")
            ? String(get("kontakt_telefon")).trim()
            : null,
          kontakt_email: get("kontakt_email")
            ? String(get("kontakt_email")).trim()
            : null,
          datum_angebot: excelDateToIso(get("datum_angebot")),
          wert_euro: parseNumber(get("wert_euro")),
          status: parseStatus(get("status")),
          naechste_nachfrage: excelDateToIso(get("naechste_nachfrage")),
          notizen: get("notizen") ? String(get("notizen")) : null,
          created_by: user?.id ?? null,
        };
      })
      .filter(Boolean) as any[];

    if (inserts.length === 0) {
      setImporting(false);
      toast({ variant: "destructive", title: "Keine gültigen Zeilen" });
      return;
    }

    // In Batches à 50
    let success = 0;
    for (let i = 0; i < inserts.length; i += 50) {
      const batch = inserts.slice(i, i + 50);
      const { error } = await supabase.from("angebote").insert(batch);
      if (error) {
        toast({
          variant: "destructive",
          title: `Fehler bei Batch ${i / 50 + 1}`,
          description: error.message,
        });
        continue;
      }
      success += batch.length;
    }
    setImporting(false);
    toast({
      title: `${success} Angebote importiert`,
      description: inserts.length - success > 0
        ? `${inserts.length - success} fehlgeschlagen.`
        : undefined,
    });
    onImported();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Angebote aus Excel importieren</DialogTitle>
        </DialogHeader>

        {sheetNames.length === 0 ? (
          <div className="space-y-4">
            <div className="rounded-md border-2 border-dashed border-muted-foreground/30 p-8 text-center">
              <FileSpreadsheet className="h-10 w-10 mx-auto mb-2 text-muted-foreground" />
              <div className="text-sm text-muted-foreground mb-3">
                Wähle eine Excel-Datei (.xlsx, .xls) oder CSV-Datei.
              </div>
              <input
                ref={fileRef}
                type="file"
                accept=".xlsx,.xls,.csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) onFile(f);
                  if (fileRef.current) fileRef.current.value = "";
                }}
              />
              <Button onClick={() => fileRef.current?.click()}>
                <Upload className="h-4 w-4 mr-2" />
                Datei wählen
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Sheet + Header-Row */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Tabellenblatt</Label>
                <select
                  value={activeSheet}
                  onChange={(e) => setActiveSheet(e.target.value)}
                  className="w-full h-9 rounded-md border bg-background px-2 text-sm"
                >
                  {sheetNames.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <Label className="text-xs">Header-Zeile</Label>
                <Input
                  type="number"
                  min={1}
                  value={headerRow}
                  onChange={(e) =>
                    setHeaderRow(Math.max(1, Number(e.target.value) || 1))
                  }
                />
              </div>
            </div>

            {/* Mapping */}
            <div>
              <Label className="text-xs">Spalten-Zuordnung</Label>
              <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
                {FIELDS.map((f) => (
                  <div
                    key={f.key}
                    className="flex items-center gap-2 text-sm"
                  >
                    <div className="min-w-[140px] text-xs">
                      {f.label}
                      {f.required && <span className="text-red-500 ml-0.5">*</span>}
                    </div>
                    <ArrowRight className="h-3 w-3 text-muted-foreground shrink-0" />
                    <select
                      value={mapping[f.key] ?? ""}
                      onChange={(e) =>
                        setMapping((p) => ({ ...p, [f.key]: e.target.value || undefined }))
                      }
                      className="flex-1 h-8 rounded-md border bg-background px-2 text-xs"
                    >
                      <option value="">— ignorieren —</option>
                      {headers.map((h) => (
                        <option key={h} value={h}>
                          {h}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            </div>

            {/* Vorschau */}
            <div>
              <Label className="text-xs">
                Vorschau ({dataRows.length} Zeile{dataRows.length !== 1 ? "n" : ""} total
                · zeige die ersten {Math.min(10, dataRows.length)})
              </Label>
              <div className="mt-2 border rounded overflow-x-auto">
                <table className="text-xs w-full">
                  <thead className="bg-muted">
                    <tr>
                      {FIELDS.filter((f) => mapping[f.key]).map((f) => (
                        <th
                          key={f.key}
                          className="px-2 py-1 text-left font-semibold whitespace-nowrap"
                        >
                          {f.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.map((row, i) => (
                      <tr key={i} className="border-t">
                        {FIELDS.filter((f) => mapping[f.key]).map((f) => (
                          <td
                            key={f.key}
                            className="px-2 py-1 whitespace-nowrap max-w-[200px] truncate"
                            title={String(row[f.key] ?? "")}
                          >
                            {row[f.key] == null ? "—" : String(row[f.key])}
                          </td>
                        ))}
                      </tr>
                    ))}
                    {preview.length === 0 && (
                      <tr>
                        <td className="px-2 py-3 text-center text-muted-foreground">
                          Keine Datenzeilen gefunden.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        <DialogFooter className="flex-row gap-2">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="flex-1"
          >
            Abbrechen
          </Button>
          {sheetNames.length > 0 && (
            <Button
              onClick={doImport}
              disabled={importing || dataRows.length === 0 || !mapping.bvh_name}
              className="flex-1"
            >
              {importing
                ? "Importiere…"
                : `${dataRows.length} Zeile${
                    dataRows.length !== 1 ? "n" : ""
                  } importieren`}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
