import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import {
  Users,
  Sun,
  Hourglass,
  CalendarCheck,
  ArrowRight,
} from "lucide-react";
import { localIso } from "@/lib/dateFmt";

export function AdminUebersicht({
  onNavigate,
}: {
  onNavigate: (k: any) => void;
}) {
  const [aktiveMa, setAktiveMa] = useState(0);
  const [offeneMonate, setOffeneMonate] = useState(0);
  const [urlaubSummeTage, setUrlaubSummeTage] = useState(0);
  const [zaSummeStunden, setZaSummeStunden] = useState(0);
  const [letzterMonat, setLetzterMonat] = useState<string>("");

  useEffect(() => {
    (async () => {
      const today = new Date(localIso());
      const lm = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      const lmStr = `${lm.getFullYear()}-${String(lm.getMonth() + 1).padStart(2, "0")}`;
      setLetzterMonat(lmStr);

      const [profs, urlaubSum, zaSum, ma] = await Promise.all([
        supabase
          .from("profiles")
          .select("id", { count: "exact", head: true })
          .eq("is_active", true),
        supabase.from("v_urlaubs_saldo" as any).select("saldo_tage"),
        supabase.from("v_za_saldo" as any).select("saldo_stunden"),
        supabase
          .from("monatsabschluss")
          .select("mitarbeiter_id")
          .eq("monat", lmStr),
      ]);

      setAktiveMa(profs.count ?? 0);
      const uTage = ((urlaubSum.data as any[]) ?? []).reduce(
        (s, r) => s + Number(r.saldo_tage ?? 0),
        0
      );
      const zStunden = ((zaSum.data as any[]) ?? []).reduce(
        (s, r) => s + Number(r.saldo_stunden ?? 0),
        0
      );
      setUrlaubSummeTage(uTage);
      setZaSummeStunden(zStunden);
      setOffeneMonate(
        (profs.count ?? 0) - ((ma.data as any[]) ?? []).length
      );
    })();
  }, []);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard
          icon={Users}
          label="Aktive Mitarbeiter"
          value={String(aktiveMa)}
          tone="primary"
        />
        <StatCard
          icon={CalendarCheck}
          label={`Offen für ${letzterMonat}`}
          value={`${offeneMonate} MA`}
          tone={offeneMonate > 0 ? "amber" : "muted"}
          cta="Monatsabschluss"
          onClick={() => onNavigate("lohnbuchhaltung")}
        />
        <StatCard
          icon={Sun}
          label="Urlaubs-Saldo total"
          value={`${urlaubSummeTage.toFixed(1).replace(".", ",")} Tg`}
          tone="emerald"
          cta="Urlaubs-Konten"
          onClick={() => onNavigate("urlaub")}
        />
        <StatCard
          icon={Hourglass}
          label="ZA-Saldo total"
          value={`${zaSummeStunden > 0 ? "+" : ""}${zaSummeStunden
            .toFixed(1)
            .replace(".", ",")} h`}
          tone={zaSummeStunden > 0 ? "sky" : "muted"}
          cta="ZA-Konten"
          onClick={() => onNavigate("za")}
        />
      </div>

      <Card>
        <CardContent className="p-4 space-y-2">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Schnellzugriff
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <QuickLink
              icon={Users}
              label="Mitarbeiter & Partien"
              desc="Stammdaten, Rollen, Personalanlageblatt"
              onClick={() => onNavigate("mitarbeiter")}
            />
            <QuickLink
              icon={Sun}
              label="Urlaubs-Konten"
              desc="Saldo, Verlauf, Gutschriften"
              onClick={() => onNavigate("urlaub")}
            />
            <QuickLink
              icon={Hourglass}
              label="ZA-Konten"
              desc="Zeitausgleich, Auszahlung"
              onClick={() => onNavigate("za")}
            />
            <QuickLink
              icon={CalendarCheck}
              label="Monatsabschluss"
              desc="Soll-/Ist-Vergleich, sperren"
              onClick={() => onNavigate("lohnbuchhaltung")}
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  tone,
  cta,
  onClick,
}: {
  icon: typeof Users;
  label: string;
  value: string;
  tone: "primary" | "emerald" | "sky" | "amber" | "muted";
  cta?: string;
  onClick?: () => void;
}) {
  const toneClasses: Record<typeof tone, string> = {
    primary: "border-primary/30 bg-primary/5",
    emerald: "border-emerald-200 bg-emerald-50",
    sky: "border-sky-200 bg-sky-50",
    amber: "border-amber-300 bg-amber-50",
    muted: "border-border bg-muted/30",
  };
  return (
    <Card className={`border ${toneClasses[tone]}`}>
      <CardContent className="p-3 space-y-1">
        <div className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-muted-foreground font-semibold">
          <Icon className="h-3.5 w-3.5" />
          {label}
        </div>
        <div className="text-2xl font-bold tabular-nums">{value}</div>
        {cta && onClick && (
          <button
            onClick={onClick}
            className="text-xs font-semibold text-primary hover:underline flex items-center gap-1"
          >
            {cta}
            <ArrowRight className="h-3 w-3" />
          </button>
        )}
      </CardContent>
    </Card>
  );
}

function QuickLink({
  icon: Icon,
  label,
  desc,
  onClick,
}: {
  icon: typeof Users;
  label: string;
  desc: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="text-left rounded-md border p-3 hover:shadow-sm transition flex items-center gap-3"
    >
      <Icon className="h-5 w-5 text-primary shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold">{label}</div>
        <div className="text-[11px] text-muted-foreground">{desc}</div>
      </div>
      <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0" />
    </button>
  );
}
