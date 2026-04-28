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
  ArrowRight,
  CheckCircle2,
  UserPlus,
} from "lucide-react";
import type { Database } from "@/integrations/supabase/types";

type Baustelle = Database["public"]["Tables"]["baustellen"]["Row"];

type PendingProfile = {
  id: string;
  vorname: string;
  nachname: string;
  email: string | null;
  created_at: string;
};

function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return "gerade eben";
  if (min < 60) return `vor ${min} Min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `vor ${h} Std`;
  const d = Math.floor(h / 24);
  if (d < 7) return `vor ${d} Tag${d === 1 ? "" : "en"}`;
  return new Date(iso).toLocaleDateString("de-AT");
}

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
  const { profile, isAdmin, canReview } = useAuth();
  const [aktiveBaustellen, setAktiveBaustellen] = useState<Baustelle[]>([]);
  const [pendingProfiles, setPendingProfiles] = useState<PendingProfile[]>([]);
  const [pendingCount, setPendingCount] = useState<number>(0);

  useEffect(() => {
    supabase
      .from("baustellen")
      .select("*")
      .eq("status", "aktiv")
      .order("start_datum", { ascending: true })
      .limit(8)
      .then(({ data }) => setAktiveBaustellen((data as Baustelle[]) ?? []));
  }, []);

  useEffect(() => {
    if (!isAdmin) return;
    const loadPending = async () => {
      const { data, count } = await supabase
        .from("profiles")
        .select("id, vorname, nachname, email, created_at", { count: "exact" })
        .eq("is_active", false)
        .order("created_at", { ascending: false })
        .limit(5);
      setPendingProfiles((data as PendingProfile[]) ?? []);
      setPendingCount(count ?? 0);
    };
    loadPending();
    const ch = supabase
      .channel("dashboard-pending")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "profiles" },
        loadPending
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [isAdmin]);

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
      <PageHeader title={`Hallo ${fullName.split(" ")[0] || "willkommen"}!`} />

      {/* Pending-Users-Banner (Admin) */}
      {isAdmin && pendingCount > 0 && (
        <Card className="border-amber-400 bg-amber-50">
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              <div className="h-10 w-10 rounded-md bg-amber-200 flex items-center justify-center text-amber-900 shrink-0">
                <UserPlus className="h-5 w-5" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-sm sm:text-base text-amber-950">
                  {pendingCount === 1
                    ? "1 Mitarbeiter wartet auf Freischaltung"
                    : `${pendingCount} Mitarbeiter warten auf Freischaltung`}
                </div>
                <div className="text-xs text-amber-800 mt-0.5">
                  Neue Anmeldungen müssen vor dem ersten Login von dir aktiviert werden.
                </div>
                <div className="mt-2 flex flex-wrap gap-1">
                  {pendingProfiles.slice(0, 5).map((p) => (
                    <span
                      key={p.id}
                      className="inline-flex items-center gap-1.5 bg-white/70 rounded-full px-2 py-0.5 text-[11px]"
                    >
                      <strong>
                        {p.vorname} {p.nachname}
                      </strong>
                      <span className="text-muted-foreground">· {relTime(p.created_at)}</span>
                    </span>
                  ))}
                  {pendingCount > 5 && (
                    <span className="text-[11px] text-amber-800 italic self-center">
                      +{pendingCount - 5} weitere
                    </span>
                  )}
                </div>
              </div>
              <Link to="/mitarbeiter" className="shrink-0">
                <Button size="sm" className="bg-amber-600 hover:bg-amber-700 text-white">
                  Verwalten
                  <ArrowRight className="h-3.5 w-3.5 ml-1" />
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      )}

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

