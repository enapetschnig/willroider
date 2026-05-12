import { useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import {
  Users,
  Truck,
  ShieldCheck,
  CalendarRange,
  CalendarCheck,
  Sun,
  Hourglass,
  Settings,
  LayoutDashboard,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { AdminUebersicht } from "@/components/admin/AdminUebersicht";
import { AdminUrlaubsKonten } from "@/components/admin/AdminUrlaubsKonten";
import { AdminZaKonten } from "@/components/admin/AdminZaKonten";
import { AdminMonatsabschluss } from "@/components/admin/AdminMonatsabschluss";
import { AdminEinstellungen } from "@/components/admin/AdminEinstellungen";
import Mitarbeiter from "@/pages/Mitarbeiter";
import Kalender from "@/pages/Kalender";
import Fahrzeuge from "@/pages/Fahrzeuge";
import Evaluierung from "@/pages/Evaluierung";

type TabKey =
  | "uebersicht"
  | "mitarbeiter"
  | "urlaub"
  | "za"
  | "monatsabschluss"
  | "kalender"
  | "fahrzeuge"
  | "evaluierung"
  | "einstellungen";

const TABS: { key: TabKey; label: string; icon: typeof Users }[] = [
  { key: "uebersicht", label: "Übersicht", icon: LayoutDashboard },
  { key: "mitarbeiter", label: "Mitarbeiter & Partien", icon: Users },
  { key: "urlaub", label: "Urlaubs-Konten", icon: Sun },
  { key: "za", label: "ZA-Konten", icon: Hourglass },
  { key: "monatsabschluss", label: "Monatsabschluss", icon: CalendarCheck },
  { key: "kalender", label: "Arbeitszeitkalender", icon: CalendarRange },
  { key: "fahrzeuge", label: "Fahrzeuge", icon: Truck },
  { key: "evaluierung", label: "Evaluierung", icon: ShieldCheck },
  { key: "einstellungen", label: "Einstellungen", icon: Settings },
];

export default function Admin() {
  const { isAdmin } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tab = (params.get("tab") as TabKey) || "uebersicht";

  useEffect(() => {
    if (!isAdmin) navigate("/");
  }, [isAdmin, navigate]);

  if (!isAdmin) return null;

  const setTab = (k: TabKey) => {
    const p = new URLSearchParams(params);
    p.set("tab", k);
    setParams(p);
  };

  return (
    <div className="space-y-4">
      <PageHeader title="Verwaltung" />

      {/* Tab-Auswahl */}
      <Card>
        <CardContent className="p-2 flex flex-wrap gap-1.5">
          {TABS.map((t) => {
            const active = t.key === tab;
            const Icon = t.icon;
            return (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium transition ${
                  active
                    ? "bg-primary text-primary-foreground"
                    : "hover:bg-muted text-foreground"
                }`}
              >
                <Icon className="h-4 w-4" />
                {t.label}
              </button>
            );
          })}
        </CardContent>
      </Card>

      <div>
        {tab === "uebersicht" && <AdminUebersicht onNavigate={setTab} />}
        {tab === "mitarbeiter" && <Mitarbeiter />}
        {tab === "urlaub" && <AdminUrlaubsKonten />}
        {tab === "za" && <AdminZaKonten />}
        {tab === "monatsabschluss" && <AdminMonatsabschluss />}
        {tab === "kalender" && <Kalender />}
        {tab === "fahrzeuge" && <Fahrzeuge />}
        {tab === "evaluierung" && <Evaluierung />}
        {tab === "einstellungen" && <AdminEinstellungen />}
      </div>
    </div>
  );
}
