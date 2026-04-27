import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/PageHeader";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import {
  Building2,
  CalendarDays,
  Clock,
  ClipboardList,
  Users,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Activity,
} from "lucide-react";
import type { Database } from "@/integrations/supabase/types";

type Baustelle = Database["public"]["Tables"]["baustellen"]["Row"];

type Stats = {
  baustellenAktiv: number;
  baustellenGeplant: number;
  mitarbeiterAktiv: number;
  stundenOffen: number;
  partienCount: number;
};

const STATUS_LABEL: Record<Baustelle["status"], string> = {
  geplant: "Geplant",
  aktiv: "Aktiv",
  pausiert: "Pausiert",
  abgeschlossen: "Abgeschlossen",
};
const STATUS_VARIANT: Record<Baustelle["status"], "default" | "secondary" | "outline" | "destructive"> = {
  aktiv: "default",
  geplant: "outline",
  pausiert: "secondary",
  abgeschlossen: "secondary",
};

export default function Dashboard() {
  const { profile, role, isAdmin, canReview } = useAuth();
  const [stats, setStats] = useState<Stats>({
    baustellenAktiv: 0,
    baustellenGeplant: 0,
    mitarbeiterAktiv: 0,
    stundenOffen: 0,
    partienCount: 0,
  });
  const [aktiveBaustellen, setAktiveBaustellen] = useState<Baustelle[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      const [bs, bsAktiv, ma, stundenOffen, partien] = await Promise.all([
        supabase.from("baustellen").select("id", { count: "exact", head: true }).eq("status", "geplant"),
        supabase
          .from("baustellen")
          .select("*")
          .eq("status", "aktiv")
          .order("start_datum", { ascending: true })
          .limit(8),
        supabase.from("profiles").select("id", { count: "exact", head: true }).eq("is_active", true),
        supabase.from("stundenbuchungen").select("id", { count: "exact", head: true }).in("status", ["offen", "zm_freigabe"]),
        supabase.from("partien").select("id", { count: "exact", head: true }),
      ]);

      setStats({
        baustellenAktiv: bsAktiv.data?.length ?? 0,
        baustellenGeplant: bs.count ?? 0,
        mitarbeiterAktiv: ma.count ?? 0,
        stundenOffen: stundenOffen.count ?? 0,
        partienCount: partien.count ?? 0,
      });
      setAktiveBaustellen((bsAktiv.data as Baustelle[]) ?? []);
      setLoading(false);
    };
    load();
  }, []);

  const fullName = profile ? `${profile.vorname} ${profile.nachname}`.trim() : "";

  const cards: { to: string; label: string; desc: string; icon: typeof Clock; show: boolean }[] = [
    {
      to: "/mein-tag",
      label: "Mein Tag",
      desc: "Heutige Einteilung & Baustelle",
      icon: ClipboardList,
      show: true,
    },
    {
      to: "/stunden",
      label: "Stunden erfassen",
      desc: "Tägliche Stundenbuchung",
      icon: Clock,
      show: true,
    },
    {
      to: "/baustellen",
      label: "Baustellen",
      desc: "Übersicht aller Baustellen",
      icon: Building2,
      show: true,
    },
    {
      to: "/arbeitsplanung",
      label: "Arbeitsplanung",
      desc: "Gantt-Chart & Einteilung",
      icon: CalendarDays,
      show: isAdmin,
    },
    {
      to: "/mitarbeiter",
      label: "Mitarbeiter",
      desc: "Partien & Mitarbeiter verwalten",
      icon: Users,
      show: isAdmin,
    },
    {
      to: "/stunden/freigabe",
      label: "Freigaben",
      desc: "Stunden prüfen & freigeben",
      icon: CheckCircle2,
      show: canReview,
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Hallo ${fullName.split(" ")[0] || "willkommen"}!`}
        description="Übersicht über laufende Baustellen, Einteilungen und offene Aufgaben."
      />

      {/* Stat tiles */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
        <StatTile
          icon={Activity}
          label="Aktive Baustellen"
          value={stats.baustellenAktiv}
          loading={loading}
          tone="primary"
        />
        <StatTile
          icon={CalendarDays}
          label="Geplante Baustellen"
          value={stats.baustellenGeplant}
          loading={loading}
          tone="muted"
        />
        <StatTile
          icon={Users}
          label="Mitarbeiter aktiv"
          value={stats.mitarbeiterAktiv}
          loading={loading}
          tone="muted"
        />
        <StatTile
          icon={ClipboardList}
          label="Partien"
          value={stats.partienCount}
          loading={loading}
          tone="primary"
        />
        <StatTile
          icon={AlertTriangle}
          label="Offene Stunden"
          value={stats.stundenOffen}
          loading={loading}
          tone="warn"
        />
      </div>

      {/* Schnellzugriff */}
      <div>
        <h2 className="text-lg font-semibold mb-3">Schnellzugriff</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {cards
            .filter((c) => c.show)
            .map((c) => (
              <Link key={c.to} to={c.to}>
                <Card className="hover:shadow-md hover:border-primary/40 transition-all h-full">
                  <CardHeader className="pb-3">
                    <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center mb-2">
                      <c.icon className="h-5 w-5 text-primary" />
                    </div>
                    <CardTitle className="text-base">{c.label}</CardTitle>
                    <CardDescription className="text-xs">{c.desc}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Button variant="ghost" size="sm" className="px-0 text-primary">
                      Öffnen <ArrowRight className="h-4 w-4 ml-1" />
                    </Button>
                  </CardContent>
                </Card>
              </Link>
            ))}
        </div>
      </div>

      {/* Aktive Baustellen */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold">Aktive Baustellen</h2>
          <Link to="/baustellen">
            <Button variant="ghost" size="sm">
              Alle anzeigen <ArrowRight className="h-4 w-4 ml-1" />
            </Button>
          </Link>
        </div>
        {aktiveBaustellen.length === 0 ? (
          <Card>
            <CardContent className="p-8 text-center text-sm text-muted-foreground">
              Aktuell keine aktiven Baustellen.
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-2">
            {aktiveBaustellen.map((b) => (
              <Link key={b.id} to={`/baustellen/${b.id}`}>
                <Card className="hover:shadow-md transition-shadow">
                  <CardContent className="p-3 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <Building2 className="h-4 w-4 text-primary shrink-0" />
                        <span className="font-semibold truncate">{b.bvh_name}</span>
                        <Badge variant={STATUS_VARIANT[b.status]} className="text-[10px]">
                          {STATUS_LABEL[b.status]}
                        </Badge>
                      </div>
                      <div className="text-xs text-muted-foreground truncate">
                        {[b.kostenstelle, b.ort, b.bauherr].filter(Boolean).join(" · ")}
                      </div>
                    </div>
                    <div className="text-right text-xs text-muted-foreground shrink-0">
                      {b.start_datum && new Date(b.start_datum).toLocaleDateString("de-AT")} →{" "}
                      {b.end_datum ? new Date(b.end_datum).toLocaleDateString("de-AT") : "offen"}
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function StatTile({
  icon: Icon,
  label,
  value,
  loading,
  tone,
}: {
  icon: typeof Clock;
  label: string;
  value: number;
  loading: boolean;
  tone: "primary" | "muted" | "warn";
}) {
  const toneClass =
    tone === "primary"
      ? "bg-primary/10 text-primary"
      : tone === "warn"
      ? "bg-yellow-100 text-yellow-800"
      : "bg-muted text-foreground";
  return (
    <Card>
      <CardContent className="p-3 flex items-center gap-3">
        <div className={`h-10 w-10 rounded-md flex items-center justify-center ${toneClass}`}>
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <div className="text-xl font-bold leading-none">{loading ? "…" : value}</div>
          <div className="text-[11px] text-muted-foreground">{label}</div>
        </div>
      </CardContent>
    </Card>
  );
}
