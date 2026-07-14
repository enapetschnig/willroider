import { useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import {
  Users,
  Truck,
  ShieldCheck,
  Sun,
  Hourglass,
  LayoutDashboard,
  Clock,
  HeartPulse,
  FileText,
  KeyRound,
  Send,
  MessageSquarePlus,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { AdminUebersicht } from "@/components/admin/AdminUebersicht";
import { AdminUrlaubsKonten } from "@/components/admin/AdminUrlaubsKonten";
import { AdminZaKonten } from "@/components/admin/AdminZaKonten";
import { AdminArbeitszeit } from "@/components/admin/AdminArbeitszeit";
import { AdminKrankmeldungen } from "@/components/admin/AdminKrankmeldungen";
import { AdminLohnzettel } from "@/components/admin/AdminLohnzettel";
import { AdminBerechtigungen } from "@/components/admin/AdminBerechtigungen";
import { AdminZugangVerschicken } from "@/components/admin/AdminZugangVerschicken";
import { AdminFeedback } from "@/components/admin/AdminFeedback";
import Mitarbeiter from "@/pages/Mitarbeiter";
import Fahrzeuge from "@/pages/Fahrzeuge";
import Evaluierung from "@/pages/Evaluierung";

type TabKey =
  | "uebersicht"
  | "mitarbeiter"
  | "zugang"
  | "urlaub"
  | "za"
  | "arbeitszeit"
  | "krankmeldungen"
  | "lohnzettel"
  | "fahrzeuge"
  | "evaluierung"
  | "feedback"
  | "berechtigungen";

const TABS: { key: TabKey; label: string; icon: typeof Users }[] = [
  { key: "uebersicht", label: "Übersicht", icon: LayoutDashboard },
  { key: "mitarbeiter", label: "Mitarbeiter & Partien", icon: Users },
  { key: "zugang", label: "Zugang senden", icon: Send },
  { key: "urlaub", label: "Urlaubs-Konten", icon: Sun },
  { key: "za", label: "ZA-Konten", icon: Hourglass },
  { key: "arbeitszeit", label: "Arbeitszeit", icon: Clock },
  { key: "krankmeldungen", label: "Krankmeldungen", icon: HeartPulse },
  { key: "lohnzettel", label: "Lohnzettel", icon: FileText },
  { key: "fahrzeuge", label: "Fahrzeuge", icon: Truck },
  { key: "evaluierung", label: "Evaluierung", icon: ShieldCheck },
  { key: "feedback", label: "Feedback", icon: MessageSquarePlus },
  { key: "berechtigungen", label: "Berechtigungen", icon: KeyRound },
];

/** Alt-Tab-Keys (vor der Zusammenführung) → neuer Arbeitszeit-Tab. */
const ALT_TAB: Record<string, TabKey> = {
  kalender: "arbeitszeit",
  stunden_stamm: "arbeitszeit",
  einstellungen: "arbeitszeit",
};

export default function Admin() {
  const { isAdmin, hasPermission } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const rawTab = params.get("tab") || "uebersicht";
  const tab: TabKey = ALT_TAB[rawTab] ?? (rawTab as TabKey);

  useEffect(() => {
    if (!isAdmin) navigate("/");
  }, [isAdmin, navigate]);

  if (!isAdmin) return null;

  // Tabs an Permissions binden:
  // - berechtigungen → system.manage_permissions
  // - zugang → mitarbeiter.einladung_resend
  const visibleTabs = TABS.filter((t) => {
    if (t.key === "berechtigungen") return hasPermission("system.manage_permissions");
    if (t.key === "zugang") return hasPermission("mitarbeiter.einladung_resend");
    return true;
  });

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
          {visibleTabs.map((t) => {
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
        {tab === "zugang" && <AdminZugangVerschicken />}
        {tab === "urlaub" && <AdminUrlaubsKonten />}
        {tab === "za" && <AdminZaKonten />}
        {tab === "arbeitszeit" && <AdminArbeitszeit />}
        {tab === "krankmeldungen" && <AdminKrankmeldungen />}
        {tab === "lohnzettel" && <AdminLohnzettel />}
        {tab === "fahrzeuge" && <Fahrzeuge />}
        {tab === "evaluierung" && <Evaluierung />}
        {tab === "feedback" && <AdminFeedback />}
        {tab === "berechtigungen" && <AdminBerechtigungen />}
      </div>
    </div>
  );
}
