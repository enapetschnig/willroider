import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Loader2, History, ArrowRight } from "lucide-react";

type Eintrag = {
  id: string;
  tabelle: string;
  datensatz_id: string;
  feld: string;
  alt: string | null;
  neu: string | null;
  geaendert_von: string | null;
  geaendert_am: string;
};

const FELD_LABEL: Record<string, string> = {
  partie_id: "Partie",
  is_active: "Aktiv",
  is_partieleiter: "Partieleiter-Flag",
  in_tagesplanung: "In Tagesplanung",
  rolle_id: "Rolle",
  partieleiter_id: "Partieleiter",
};

const fmtZeit = (s: string) =>
  new Date(s).toLocaleDateString("de-AT", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

/**
 * Änderungsprotokoll — wer hat wann Partie/Rolle/Status geändert.
 * Hilft, versehentliche Umstellungen (z.B. Partie-Wechsel per Fehlklick)
 * schnell aufzuklären.
 */
export function AdminProtokoll() {
  const [eintraege, setEintraege] = useState<Eintrag[]>([]);
  const [namen, setNamen] = useState<Map<string, string>>(new Map());
  const [partienMap, setPartienMap] = useState<Map<string, string>>(new Map());
  const [rollenMap, setRollenMap] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const [{ data: logs }, { data: profs }, { data: parts }, { data: rollen }] =
        await Promise.all([
          supabase
            .from("aenderungsprotokoll" as any)
            .select("*")
            .order("geaendert_am", { ascending: false })
            .limit(200),
          supabase.from("profiles").select("id, vorname, nachname"),
          supabase.from("partien").select("id, name"),
          supabase.from("rollen" as any).select("id, bezeichnung"),
        ]);
      setEintraege((logs as unknown as Eintrag[]) ?? []);
      setNamen(
        new Map(
          ((profs as any[]) ?? []).map((p) => [
            p.id,
            `${p.vorname ?? ""} ${p.nachname ?? ""}`.trim(),
          ]),
        ),
      );
      setPartienMap(new Map(((parts as any[]) ?? []).map((p) => [p.id, p.name])));
      setRollenMap(new Map(((rollen as any[]) ?? []).map((r) => [r.id, r.bezeichnung])));
      setLoading(false);
    })();
  }, []);

  /** Rohwert je nach Feld in Klartext übersetzen. */
  const wert = (feld: string, v: string | null): string => {
    if (v == null) return "—";
    if (feld === "partie_id") return partienMap.get(v) ?? v.slice(0, 8);
    if (feld === "rolle_id") return rollenMap.get(v) ?? v.slice(0, 8);
    if (feld === "partieleiter_id") return namen.get(v) ?? v.slice(0, 8);
    if (v === "true") return "Ja";
    if (v === "false") return "Nein";
    return v;
  };

  /** Wen betrifft der Eintrag? */
  const betrifft = (e: Eintrag): string => {
    if (e.tabelle === "partien")
      return `Partie „${partienMap.get(e.datensatz_id) ?? "?"}"`;
    return namen.get(e.datensatz_id) ?? "Unbekannt";
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 justify-center py-12 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Lädt …
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="text-sm text-muted-foreground flex items-center gap-2">
        <History className="h-4 w-4" />
        Änderungen an Partie, Rolle, Aktiv-Status und Partieleitern — neueste zuerst.
      </div>
      {eintraege.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Noch keine protokollierten Änderungen.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0 divide-y">
            {eintraege.map((e) => (
              <div key={e.id} className="px-4 py-2.5 text-sm flex flex-wrap items-center gap-x-2 gap-y-0.5">
                <span className="text-xs text-muted-foreground tabular-nums shrink-0 w-28">
                  {fmtZeit(e.geaendert_am)}
                </span>
                <span className="font-medium">{betrifft(e)}</span>
                <span className="text-muted-foreground">· {FELD_LABEL[e.feld] ?? e.feld}:</span>
                <span>{wert(e.feld, e.alt)}</span>
                <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="font-medium">{wert(e.feld, e.neu)}</span>
                <span className="text-xs text-muted-foreground ml-auto">
                  {e.geaendert_von ? `durch ${namen.get(e.geaendert_von) ?? "?"}` : "durch System"}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
