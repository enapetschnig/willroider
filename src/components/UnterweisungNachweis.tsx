/**
 * Nachweisliste einer Unterweisung: wer hat wann worüber bestätigt.
 * Für das Büro und den Bauleiter — Name · Status · fällig · bestätigt am ·
 * Gerät · erfasst von. Zeitstempel kommen vom Server (unterweisung_bestaetigen).
 */
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { CheckCircle2, Clock, AlertCircle } from "lucide-react";

type Zeile = {
  id: string;
  vorname: string;
  nachname: string;
  status: string;
  faellig_am: string | null;
  unterschrieben_am: string | null;
  bestaetigt_ueber: string | null;
  erfasser: string | null;
};

const fmt = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString("de-AT", {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";

export function UnterweisungNachweis({
  evaluierungId,
  refreshKey,
}: {
  evaluierungId: string;
  /** Ändert sich der Wert, wird neu geladen (z. B. nach dem Tablet-Modus). */
  refreshKey?: number;
}) {
  const [zeilen, setZeilen] = useState<Zeile[]>([]);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("evaluierung_unterschriften")
      .select(
        "id, status, faellig_am, unterschrieben_am, bestaetigt_ueber, profiles!evaluierung_unterschriften_mitarbeiter_id_fkey(vorname, nachname), erfasser:profiles!evaluierung_unterschriften_erfasst_von_fkey(vorname, nachname)",
      )
      .eq("evaluierung_id", evaluierungId);
    const list: Zeile[] = ((data as any[]) ?? []).map((u) => ({
      id: u.id,
      vorname: u.profiles?.vorname ?? "?",
      nachname: u.profiles?.nachname ?? "",
      status: u.status,
      faellig_am: u.faellig_am,
      unterschrieben_am: u.unterschrieben_am,
      bestaetigt_ueber: u.bestaetigt_ueber,
      erfasser: u.erfasser ? `${u.erfasser.vorname} ${u.erfasser.nachname}` : null,
    }));
    list.sort((a, b) => {
      const ao = a.status === "offen" ? 0 : 1;
      const bo = b.status === "offen" ? 0 : 1;
      if (ao !== bo) return ao - bo;
      return `${a.nachname} ${a.vorname}`.localeCompare(`${b.nachname} ${b.vorname}`, "de");
    });
    setZeilen(list);
  }, [evaluierungId]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  if (zeilen.length === 0) {
    return (
      <div className="text-xs text-muted-foreground">
        Noch niemand zugeteilt — das passiert automatisch mit dem Tagesplan.
      </div>
    );
  }

  const offen = zeilen.filter((z) => z.status === "offen").length;

  return (
    <div className="space-y-1.5">
      <div className="text-xs font-semibold">
        {zeilen.length - offen} von {zeilen.length} bestätigt
        {offen > 0 && <span className="text-amber-700"> · {offen} offen</span>}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-[10px] uppercase tracking-wide text-muted-foreground">
              <th className="text-left font-semibold py-1 pr-2">Name</th>
              <th className="text-left font-semibold py-1 pr-2">Fällig</th>
              <th className="text-left font-semibold py-1 pr-2">Bestätigt</th>
              <th className="text-left font-semibold py-1">Wie</th>
            </tr>
          </thead>
          <tbody>
            {zeilen.map((z) => {
              const ueberfaellig =
                z.status === "offen" && !!z.faellig_am && new Date(z.faellig_am).getTime() <= Date.now();
              return (
                <tr key={z.id} className="border-t">
                  <td className="py-1.5 pr-2 whitespace-nowrap">
                    <span className="inline-flex items-center gap-1.5">
                      {z.status === "offen" ? (
                        ueberfaellig ? (
                          <AlertCircle className="h-3.5 w-3.5 text-destructive" />
                        ) : (
                          <Clock className="h-3.5 w-3.5 text-amber-600" />
                        )
                      ) : (
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                      )}
                      {z.vorname} {z.nachname}
                    </span>
                  </td>
                  <td className="py-1.5 pr-2 tabular-nums whitespace-nowrap text-muted-foreground">
                    {z.status === "offen" ? fmt(z.faellig_am) : ""}
                  </td>
                  <td className="py-1.5 pr-2 tabular-nums whitespace-nowrap">
                    {z.status === "offen" ? (
                      <span className={ueberfaellig ? "text-destructive font-semibold" : "text-amber-700"}>
                        {ueberfaellig ? "überfällig" : "offen"}
                      </span>
                    ) : (
                      fmt(z.unterschrieben_am)
                    )}
                  </td>
                  <td className="py-1.5 text-muted-foreground whitespace-nowrap">
                    {z.status === "offen"
                      ? ""
                      : z.bestaetigt_ueber === "tablet"
                        ? `Tablet${z.erfasser ? ` (${z.erfasser})` : ""}`
                        : z.bestaetigt_ueber === "eigenes_geraet"
                          ? "eigenes Handy"
                          : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
