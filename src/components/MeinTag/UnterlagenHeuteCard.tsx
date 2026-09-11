/**
 * „Unterlagen deiner Baustelle" in Mein Tag — die vier Ordner, die ein
 * Mitarbeiter braucht: Pläne, Leistungsverzeichnis, Berichte, Unterweisung.
 * Ein Tipp führt direkt in den Ordner der heutigen Baustelle. Was er sehen
 * darf, entscheidet die Datenbank (darf_ordner_sehen) — die Zahlen hier
 * zählen nur, was ohnehin zurückkommt.
 */
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { getBaustellenForMaToday } from "@/lib/tagesplanung";
import { localIso } from "@/lib/dateFmt";
import { FolderOpen, FileText, ClipboardList, ShieldCheck, Ruler } from "lucide-react";

type Ordner = { key: string; label: string; icon: typeof FileText; anzahl: number };

export function UnterlagenHeuteCard({ userId }: { userId: string }) {
  const [baustelle, setBaustelle] = useState<{ id: string; name: string } | null>(null);
  const [ordner, setOrdner] = useState<Ordner[]>([]);

  useEffect(() => {
    let aktiv = true;
    (async () => {
      const heute = await getBaustellenForMaToday(userId, localIso());
      const bid = heute[0]?.baustelle_id;
      if (!bid) {
        if (aktiv) setBaustelle(null);
        return;
      }
      const [{ data: b }, { data: docs }] = await Promise.all([
        supabase.from("baustellen").select("id, bvh_name").eq("id", bid).maybeSingle(),
        supabase.from("dokumente").select("ordner, subpath").eq("baustelle_id", bid),
      ]);
      if (!aktiv) return;
      setBaustelle(b ? { id: b.id, name: b.bvh_name } : null);
      const rows = (docs as { ordner: string | null; subpath: string | null }[]) ?? [];
      const zaehl = (pred: (d: { ordner: string | null; subpath: string | null }) => boolean) =>
        rows.filter(pred).length;
      setOrdner([
        { key: "91-plaene", label: "Pläne", icon: Ruler, anzahl: zaehl((d) => d.ordner === "91-plaene") },
        {
          key: "95-leistungsverzeichnis",
          label: "Leistungsverzeichnis",
          icon: ClipboardList,
          anzahl: zaehl((d) => d.ordner === "95-leistungsverzeichnis"),
        },
        {
          key: "2-schriftverkehr",
          label: "Berichte",
          icon: FileText,
          anzahl: zaehl(
            (d) =>
              d.ordner === "2-schriftverkehr" &&
              /^(tagesberichte|regieberichte)(\/|$)/.test(d.subpath ?? ""),
          ),
        },
        { key: "evaluierung", label: "Unterweisung", icon: ShieldCheck, anzahl: zaehl((d) => d.ordner === "evaluierung") },
      ]);
    })();
    return () => {
      aktiv = false;
    };
  }, [userId]);

  if (!baustelle) return null;

  return (
    <Card>
      <CardContent className="p-4 space-y-2">
        <div className="flex items-center gap-2">
          <FolderOpen className="h-5 w-5 text-primary shrink-0" />
          <div className="min-w-0">
            <div className="text-sm font-semibold">Unterlagen</div>
            <div className="text-xs text-muted-foreground truncate">{baustelle.name}</div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {ordner.map((o) => (
            <Link
              key={o.key}
              to={`/baustellen/${baustelle.id}?tab=dokumente&ordner=${encodeURIComponent(o.key)}`}
              className="rounded-md border bg-card px-3 py-2.5 flex items-center gap-2 active:bg-muted"
            >
              <o.icon className="h-4 w-4 text-muted-foreground shrink-0" />
              <span className="flex-1 text-sm leading-tight">{o.label}</span>
              <span className="text-xs tabular-nums text-muted-foreground">{o.anzahl}</span>
            </Link>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
