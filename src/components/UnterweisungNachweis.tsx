/**
 * Nachweisliste einer Unterweisung: wer hat wann worüber bestätigt.
 * Für das Büro und den Bauleiter — Name · Status · fällig · bestätigt am ·
 * Gerät · erfasst von. Zeitstempel kommen vom Server (unterweisung_bestaetigen).
 *
 * Mit `darfAendern` lassen sich Mitarbeiter von Hand dazunehmen oder (solange
 * sie noch nicht unterschrieben haben) wieder herausnehmen — Wunsch
 * N. Gwenger 29.09. Von Hand Dazugenommene haben keine Fälligkeit: Sie sehen
 * die Unterweisung und können unterschreiben, die App sperrt aber erst, wenn
 * sie über den Tagesplan hier eingeteilt werden.
 */
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { CheckCircle2, Clock, AlertCircle, Plus, X } from "lucide-react";

type Zeile = {
  id: string;
  mitarbeiter_id: string;
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
  darfAendern = false,
}: {
  evaluierungId: string;
  /** Ändert sich der Wert, wird neu geladen (z. B. nach dem Tablet-Modus). */
  refreshKey?: number;
  /** Mitarbeiter hinzufügen / offene herausnehmen. */
  darfAendern?: boolean;
}) {
  const { toast } = useToast();
  const [zeilen, setZeilen] = useState<Zeile[]>([]);
  const [alle, setAlle] = useState<{ id: string; vorname: string; nachname: string }[]>([]);
  const [auswahl, setAuswahl] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!darfAendern) return;
    supabase
      .from("profiles")
      .select("id, vorname, nachname")
      .eq("is_active", true)
      .order("nachname")
      .then(({ data }) => setAlle((data as any[]) ?? []));
  }, [darfAendern]);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("evaluierung_unterschriften")
      .select(
        "id, mitarbeiter_id, status, faellig_am, unterschrieben_am, bestaetigt_ueber, profiles!evaluierung_unterschriften_mitarbeiter_id_fkey(vorname, nachname), erfasser:profiles!evaluierung_unterschriften_erfasst_von_fkey(vorname, nachname)",
      )
      .eq("evaluierung_id", evaluierungId);
    const list: Zeile[] = ((data as any[]) ?? []).map((u) => ({
      id: u.id,
      mitarbeiter_id: u.mitarbeiter_id,
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

  async function hinzufuegen() {
    if (!auswahl) return;
    setBusy(true);
    const { data, error } = await supabase
      .from("evaluierung_unterschriften")
      .insert({ evaluierung_id: evaluierungId, mitarbeiter_id: auswahl, status: "offen" } as any)
      .select("id");
    setBusy(false);
    if (error || !data?.length) {
      toast({
        variant: "destructive",
        title: "Nicht hinzugefügt",
        description: error?.message ?? "Keine Berechtigung.",
      });
      return;
    }
    setAuswahl("");
    toast({ title: "Mitarbeiter hinzugefügt", description: "Die Unterweisung erscheint jetzt in der App und kann unterschrieben werden." });
    void load();
  }

  async function entfernen(z: Zeile) {
    if (!window.confirm(`${z.vorname} ${z.nachname} aus dieser Unterweisung herausnehmen?`)) return;
    setBusy(true);
    // Nur offene — eine geleistete Unterschrift ist ein Nachweis und bleibt.
    const { data, error } = await supabase
      .from("evaluierung_unterschriften")
      .delete()
      .eq("id", z.id)
      .eq("status", "offen")
      .select("id");
    setBusy(false);
    if (error || !data?.length) {
      toast({
        variant: "destructive",
        title: "Nicht entfernt",
        description: error?.message ?? "Keine Berechtigung oder bereits unterschrieben.",
      });
      return;
    }
    void load();
  }

  const schonDabei = new Set(zeilen.map((z) => z.mitarbeiter_id));
  const hinzufuegenZeile = darfAendern && (
    <div className="flex items-center gap-2 pt-1">
      <select
        value={auswahl}
        onChange={(e) => setAuswahl(e.target.value)}
        className="h-9 flex-1 min-w-0 rounded-md border bg-background px-2 text-sm"
      >
        <option value="">Mitarbeiter hinzufügen …</option>
        {alle
          .filter((p) => !schonDabei.has(p.id))
          .map((p) => (
            <option key={p.id} value={p.id}>
              {p.nachname} {p.vorname}
            </option>
          ))}
      </select>
      <button
        type="button"
        onClick={hinzufuegen}
        disabled={!auswahl || busy}
        className="h-9 px-3 rounded-md border text-sm inline-flex items-center gap-1 hover:bg-muted disabled:opacity-50"
      >
        <Plus className="h-3.5 w-3.5" /> Hinzufügen
      </button>
    </div>
  );

  if (zeilen.length === 0) {
    return (
      <div className="space-y-1.5">
        <div className="text-xs text-muted-foreground">
          Noch niemand zugeteilt — das passiert automatisch mit dem Tagesplan.
        </div>
        {hinzufuegenZeile}
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
              {darfAendern && <th />}
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
                  {darfAendern && (
                    <td className="py-1.5 pl-1 text-right">
                      {z.status === "offen" && (
                        <button
                          type="button"
                          onClick={() => entfernen(z)}
                          disabled={busy}
                          className="p-1 rounded text-muted-foreground hover:text-destructive hover:bg-muted"
                          title="Aus dieser Unterweisung herausnehmen"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {hinzufuegenZeile}
    </div>
  );
}
