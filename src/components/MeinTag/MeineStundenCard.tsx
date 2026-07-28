/**
 * „Meine Stunden" in Mein Tag.
 *
 * Wunsch aus der Baustelle: „Wo sehe ich als Mitarbeiter und Polier die
 * geschriebenen Stunden? Das gehört unter Mein Tag in einen extra Button,
 * den die Arbeiter sehen können."
 *
 * Zeigt Ist und Soll des laufenden Monats und darunter die letzten Tage.
 * Der Polier kann zusätzlich auf seine Partie umschalten — dafür gibt es
 * das Recht `stunden.view_partie`, das bisher zwar vergeben, im Frontend
 * aber nirgends geprüft wurde.
 */

import { useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ChevronDown, ChevronUp, Clock, Loader2 } from "lucide-react";
import { Link } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useStundenTageList } from "@/hooks/useStundenTag";
import { MeineStundenListe } from "@/components/stunden/MeineStundenListe";
import {
  ladeKalenderMap,
  periodeSoll,
  fmtStunden,
  type ArbeitszeitModell,
  type TagessollKalender,
} from "@/lib/konten";
import { localIso } from "@/lib/dateFmt";

/** Erster und letzter Tag des laufenden Monats. */
function monatsGrenzen(): { von: string; bis: string; label: string } {
  const heute = new Date();
  const von = new Date(heute.getFullYear(), heute.getMonth(), 1);
  const bis = new Date(heute.getFullYear(), heute.getMonth() + 1, 0);
  return {
    von: localIso(von),
    bis: localIso(bis),
    label: heute.toLocaleDateString("de-AT", { month: "long", year: "numeric" }),
  };
}

export function MeineStundenCard() {
  const { user, profile, hasPermission } = useAuth();
  const darfPartie = hasPermission("stunden.view_partie");

  const [offen, setOffen] = useState(false);
  const [ansicht, setAnsicht] = useState<"meine" | "partie">("meine");
  const [partieIds, setPartieIds] = useState<string[]>([]);
  const [namen, setNamen] = useState<Map<string, string>>(new Map());
  const [soll, setSoll] = useState<number | null>(null);

  const { von, bis, label } = useMemo(monatsGrenzen, []);
  const partieId = (profile as any)?.partie_id ?? null;

  // Die Partie-Mitglieder. Die RLS auf stunden_tage erlaubt jedem Lesen —
  // die Eingrenzung muss also hier passieren, nicht in der Datenbank.
  useEffect(() => {
    if (!darfPartie || !partieId) return;
    supabase
      .from("profiles")
      .select("id, vorname, nachname")
      .eq("partie_id", partieId)
      .eq("is_active", true)
      .order("nachname")
      .then(({ data }) => {
        const rows = (data as any[]) ?? [];
        setPartieIds(rows.map((r) => r.id));
        setNamen(new Map(rows.map((r) => [r.id, `${r.nachname} ${r.vorname?.[0] ?? ""}.`])));
      });
  }, [darfPartie, partieId]);

  const zeigePartie = ansicht === "partie" && darfPartie && partieIds.length > 0;
  const ids = zeigePartie ? partieIds : user?.id ? [user.id] : [];

  const { data: tage = [], isLoading } = useStundenTageList({
    fromDate: von,
    toDate: bis,
    mitarbeiterIds: ids,
    enabled: ids.length > 0,
  });

  // Soll des Monats — nur für die eigene Person, sonst wäre die Zahl in der
  // Partie-Ansicht eine Summe über verschiedene Arbeitszeitmodelle.
  useEffect(() => {
    if (!user?.id) return;
    let abgebrochen = false;
    (async () => {
      const [{ data: settings }, kalender] = await Promise.all([
        supabase
          .from("profile_konten_settings")
          .select("arbeitszeitmodell, tagesnorm_stunden, beschaeftigungsgrad")
          .eq("profile_id", user.id)
          .maybeSingle(),
        ladeKalenderMap(new Date().getFullYear()) as Promise<Map<string, TagessollKalender>>,
      ]);
      if (abgebrochen) return;
      const s = settings as any;
      setSoll(
        periodeSoll(
          von,
          bis,
          kalender,
          (s?.arbeitszeitmodell ?? "zimmerei_sommer") as ArbeitszeitModell,
          Number(s?.tagesnorm_stunden ?? 8),
          Number(s?.beschaeftigungsgrad ?? 1),
        ),
      );
    })();
    return () => {
      abgebrochen = true;
    };
  }, [user?.id, von, bis]);

  const ist = useMemo(
    () => tage.reduce((a, t) => a + Number(t.tag.netto_stunden ?? 0), 0),
    [tage],
  );
  const eigeneIst = useMemo(
    () =>
      tage
        .filter((t) => t.tag.mitarbeiter_id === user?.id)
        .reduce((a, t) => a + Number(t.tag.netto_stunden ?? 0), 0),
    [tage, user],
  );

  const diff = soll != null ? eigeneIst - soll : null;

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <button
          type="button"
          onClick={() => setOffen((v) => !v)}
          className="w-full flex items-center justify-between gap-2"
        >
          <span className="flex items-center gap-2 text-sm font-semibold">
            <Clock className="h-4 w-4 text-primary" />
            Meine Stunden
            <span className="text-xs font-normal text-muted-foreground">{label}</span>
          </span>
          <span className="flex items-center gap-2">
            <span className="text-sm font-bold tabular-nums">
              {fmtStunden(eigeneIst)}
            </span>
            {soll != null && (
              <span className="text-xs text-muted-foreground tabular-nums">
                / Soll {fmtStunden(soll)}
              </span>
            )}
            {offen ? (
              <ChevronUp className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            )}
          </span>
        </button>

        {offen && (
          <>
            {diff != null && (
              <div className="flex items-center gap-2 text-xs">
                <Badge
                  variant="outline"
                  className={
                    diff >= 0
                      ? "border-emerald-300 text-emerald-800 bg-emerald-50"
                      : "border-amber-300 text-amber-800 bg-amber-50"
                  }
                >
                  {diff >= 0 ? "+" : ""}
                  {fmtStunden(diff)} gegenüber Soll
                </Badge>
              </div>
            )}

            {darfPartie && partieIds.length > 0 && (
              <div className="flex gap-1">
                {(["meine", "partie"] as const).map((a) => (
                  <Button
                    key={a}
                    size="sm"
                    variant={ansicht === a ? "default" : "outline"}
                    className="h-8 flex-1 text-xs"
                    onClick={() => setAnsicht(a)}
                  >
                    {a === "meine" ? "Meine" : "Partie"}
                  </Button>
                ))}
              </div>
            )}

            {isLoading ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
                <Loader2 className="h-3 w-3 animate-spin" /> Lade…
              </div>
            ) : (
              <MeineStundenListe
                tage={tage}
                maxAnzahl={zeigePartie ? 20 : 10}
                nameFuer={zeigePartie ? (id) => namen.get(id) ?? null : undefined}
              />
            )}

            {zeigePartie && (
              <div className="text-[11px] text-muted-foreground">
                Partie gesamt: {fmtStunden(ist)}
              </div>
            )}

            <Link to="/stunden">
              <Button variant="outline" size="sm" className="w-full h-9 text-xs">
                Stunden erfassen
              </Button>
            </Link>
          </>
        )}
      </CardContent>
    </Card>
  );
}
