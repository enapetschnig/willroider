import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/PageHeader";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { feiertagAt } from "@/lib/feiertage";
import { localIso, werktageSeit } from "@/lib/dateFmt";
import {
  Building2,
  CalendarDays,
  Clock,
  ClipboardList,
  Users,
  ArrowRight,
  UserPlus,
  Truck,
  Briefcase,
  AlertCircle,
  ShieldAlert,
  FileText,
  Wrench,
  MessageSquarePlus,
} from "lucide-react";
import type { Database } from "@/integrations/supabase/types";
import { BerichteHintCard } from "@/components/dashboard/BerichteHintCard";
import { NeuerLohnzettelHintCard } from "@/components/dashboard/NeuerLohnzettelHintCard";
import { StundenBerichtHintCard } from "@/components/dashboard/StundenBerichtHintCard";
import { UnterschriftenCard } from "@/components/dashboard/UnterschriftenCard";
import { SIGNATURE_KARENZ_WERKTAGE } from "@/components/EvaluierungSignatureGate";
import { TagesplanPreview } from "@/components/TagesplanPreview";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

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

/** stunden_tage.tag_status → Anzeige-Label für die „Heute"-Karte. Nur
 *  Fehlzeit-Status; baustelle/firma sind keine Fehlzeit (→ undefined). */
const FEHLZEIT_LABEL: Record<string, string> = {
  urlaub: "Urlaub",
  krank: "Krank",
  schlechtwetter: "Schlechtwetter",
  feiertag: "Feiertag",
};

type HeuteEintrag = {
  einteilungId: string;
  baustelleId: string;
  bvhName: string;
  kostenstelle: string | null;
  ort: string | null;
  partieFarbe: string | null;
  taetigkeit: string | null;
  fahrzeuge: string[]; // kennzeichen + bezeichnung formatiert
  kollegen: string[]; // weitere Mitarbeiter auf der gleichen Einteilung
  bereitsGebucht: number;
};

export default function Dashboard() {
  const { user, profile, isAdmin } = useAuth();
  const [aktiveBaustellen, setAktiveBaustellen] = useState<Baustelle[]>([]);
  const [pendingProfiles, setPendingProfiles] = useState<PendingProfile[]>([]);
  const [pendingCount, setPendingCount] = useState<number>(0);
  const [feedbackNeu, setFeedbackNeu] = useState<number>(0);
  const [angeboteFaellig, setAngeboteFaellig] = useState<number>(0);
  const [offeneUnterschriften, setOffeneUnterschriften] = useState<
    {
      evaluierung_id: string;
      bvh_name: string;
      mitarbeiter_id: string;
      evaluierung_titel: string | null;
      evaluierung_datum: string | null;
    }[]
  >([]);
  const [heuteEinteilungen, setHeuteEinteilungen] = useState<HeuteEintrag[]>([]);
  const [heuteFehlzeit, setHeuteFehlzeit] = useState<string | null>(null);
  const [planOpen, setPlanOpen] = useState(false);

  useEffect(() => {
    supabase
      .from("baustellen")
      .select("*")
      .eq("status", "aktiv")
      .order("start_datum", { ascending: true })
      .limit(8)
      .then(({ data }) => setAktiveBaustellen((data as Baustelle[]) ?? []));
  }, []);

  // Heutige Einteilung des aktuellen Users + Realtime-Sync
  useEffect(() => {
    if (!user) return;
    const today = localIso();

    const loadHeute = async () => {
      // 1) Tagesgenaue Einteilung über einteilung_mitarbeiter
      const { data: emRows } = await supabase
        .from("einteilung_mitarbeiter")
        .select(
          "id, einteilungen!inner(id, datum, baustelle_id, taetigkeit, baustellen(id, bvh_name, kostenstelle, ort, partie_id, partien(farbcode)))"
        )
        .eq("mitarbeiter_id", user.id)
        .eq("einteilungen.datum", today);

      const eintraege: HeuteEintrag[] = (emRows ?? [])
        .filter((r: any) => r.einteilungen?.baustellen)
        .map((r: any) => ({
          einteilungId: r.einteilungen.id,
          baustelleId: r.einteilungen.baustelle_id,
          bvhName: r.einteilungen.baustellen.bvh_name ?? "Baustelle",
          kostenstelle: r.einteilungen.baustellen.kostenstelle ?? null,
          ort: r.einteilungen.baustellen.ort ?? null,
          partieFarbe: r.einteilungen.baustellen.partien?.farbcode ?? null,
          taetigkeit: (r.einteilungen.taetigkeit as string | null) ?? null,
          fahrzeuge: [],
          kollegen: [],
          bereitsGebucht: 0,
        }));

      const einteilungIds = eintraege.map((e) => e.einteilungId);

      // 2) Fahrzeuge pro Einteilung
      if (einteilungIds.length > 0) {
        const { data: efRows } = await supabase
          .from("einteilung_fahrzeuge")
          .select("einteilung_id, fahrzeuge(kennzeichen, bezeichnung)")
          .in("einteilung_id", einteilungIds);
        for (const e of eintraege) {
          e.fahrzeuge = (efRows ?? [])
            .filter((r: any) => r.einteilung_id === e.einteilungId)
            .map((r: any) => {
              const kz = r.fahrzeuge?.kennzeichen ?? "";
              const bez = r.fahrzeuge?.bezeichnung;
              return bez ? `${kz} (${bez})` : kz;
            })
            .filter(Boolean);
        }

        // 3) Kollegen auf der gleichen Einteilung
        const { data: emCo } = await supabase
          .from("einteilung_mitarbeiter")
          .select("einteilung_id, mitarbeiter_id, profiles(vorname, nachname)")
          .in("einteilung_id", einteilungIds)
          .neq("mitarbeiter_id", user.id);
        for (const e of eintraege) {
          e.kollegen = (emCo ?? [])
            .filter((r: any) => r.einteilung_id === e.einteilungId)
            .map((r: any) =>
              r.profiles ? `${r.profiles.vorname} ${r.profiles.nachname}` : "?"
            );
        }
      }

      // 2) Schon gebuchte Stunden heute pro Baustelle aus der Zeiterfassung
      //    (stunden_taetigkeiten → stunden_tage) dazuholen.
      if (eintraege.length > 0) {
        const { data: stunden } = await supabase
          .from("stunden_taetigkeiten")
          .select(
            "baustelle_id, stunden, stunden_tag:stunden_tage!inner(mitarbeiter_id, datum)"
          )
          .eq("stunden_tag.mitarbeiter_id", user.id)
          .eq("stunden_tag.datum", today);
        if (stunden) {
          for (const e of eintraege) {
            e.bereitsGebucht = stunden
              .filter((r: any) => r.baustelle_id === e.baustelleId)
              .reduce((s: number, r: any) => s + Number(r.stunden ?? 0), 0);
          }
        }
      }

      // 3) Falls heute eine Fehlzeit erfasst ist (Urlaub/Krank/SW/Feiertag)
      const { data: tag } = await supabase
        .from("stunden_tage")
        .select("tag_status")
        .eq("mitarbeiter_id", user.id)
        .eq("datum", today)
        .maybeSingle();
      const status = (tag?.tag_status as string | undefined) ?? null;

      setHeuteEinteilungen(eintraege);
      setHeuteFehlzeit(status ? (FEHLZEIT_LABEL[status] ?? null) : null);
    };
    loadHeute();

    const ch = supabase
      .channel("dashboard-heute")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "einteilung_mitarbeiter" },
        loadHeute
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "einteilungen" },
        loadHeute
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "einteilung_fahrzeuge" },
        loadHeute
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "stunden_tage", filter: `mitarbeiter_id=eq.${user.id}` },
        loadHeute
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "stunden_taetigkeiten" },
        loadHeute
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [user]);

  useEffect(() => {
    if (!isAdmin) return;
    const loadPending = async () => {
      // Nur echte, noch nie freigeschaltete Selbst-Registrierungen —
      // ein deaktivierter Bestands-MA (je_freigeschaltet=true) zählt NICHT.
      const { data, count } = await supabase
        .from("profiles")
        .select("id, vorname, nachname, email, created_at", { count: "exact" })
        .eq("is_active", false)
        .eq("je_freigeschaltet", false)
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

  useEffect(() => {
    if (!isAdmin) return;
    const loadFeedback = async () => {
      const { count } = await supabase
        .from("feedback" as any)
        .select("id", { count: "exact", head: true })
        .eq("status", "neu");
      setFeedbackNeu(count ?? 0);
    };
    loadFeedback();
    const ch = supabase
      .channel("dashboard-feedback")
      .on("postgres_changes", { event: "*", schema: "public", table: "feedback" }, loadFeedback)
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [isAdmin]);

  useEffect(() => {
    if (!isAdmin) return;
    const loadAngebote = async () => {
      const today = localIso();
      const { count } = await supabase
        .from("angebote")
        .select("id", { count: "exact", head: true })
        .in("status", ["offen", "in_verhandlung"])
        .lte("naechste_nachfrage", today);
      setAngeboteFaellig(count ?? 0);
    };
    loadAngebote();
    const ch = supabase
      .channel("dashboard-angebote")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "angebote" },
        loadAngebote
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [isAdmin]);

  // Offene Unterschriften (Polier/Bauleiter sind verantwortlich)
  useEffect(() => {
    if (!user) return;
    const loadUnterschriften = async () => {
      const { data } = await supabase
        .from("v_offene_unterschriften" as any)
        .select(
          "evaluierung_id, bvh_name, mitarbeiter_id, evaluierung_titel, evaluierung_datum",
        )
        .eq("verantwortlich_id", user.id);
      // Pro evaluierung + ma deduplizieren (User kann gleichzeitig Polier+Bauleiter sein)
      const seen = new Set<string>();
      const unique = ((data as any[]) ?? []).filter((r) => {
        const k = `${r.evaluierung_id}_${r.mitarbeiter_id}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
      setOffeneUnterschriften(unique);
    };
    loadUnterschriften();
    const ch = supabase
      .channel("dashboard-unterschriften")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "evaluierung_unterschriften" },
        loadUnterschriften
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [user]);

  const fullName = profile ? `${profile.vorname} ${profile.nachname}`.trim() : "";

  // Alle Cards einheitlich im Willroider-Rot aus dem Design-Token (--primary)
  const WILLROIDER_RED = "hsl(var(--primary))";
  const cards: {
    to: string;
    label: string;
    desc: string;
    cta: string;
    icon: typeof Clock;
    show: boolean;
    color: string;
  }[] = [
    {
      to: "/stunden",
      label: "Stunden erfassen",
      desc: "Tägliche Stundenbuchung",
      cta: "Stunden erfassen",
      icon: Clock,
      show: true,
      color: WILLROIDER_RED,
    },
    {
      to: "/halle",
      label: "Halle / Werkstatt",
      desc: "Stunden auf Maschinen erfassen",
      cta: "Halle öffnen",
      icon: Wrench,
      show: true,
      color: WILLROIDER_RED,
    },
    {
      to: "/mein-tag",
      label: "Mein Tag",
      desc: "Heutige Einteilung & Baustelle",
      cta: "Heute öffnen",
      icon: ClipboardList,
      show: true,
      color: WILLROIDER_RED,
    },
    {
      to: "/baustellen",
      label: "Baustellen",
      desc: "Übersicht aller Baustellen",
      cta: "Baustellen öffnen",
      icon: Building2,
      show: true,
      color: WILLROIDER_RED,
    },
    {
      to: "/berichte",
      label: "Berichte",
      desc: "Bautagesberichte & Regieberichte",
      cta: "Berichte öffnen",
      icon: FileText,
      show: true,
      color: WILLROIDER_RED,
    },
    {
      to: "/arbeitsplanung",
      label: "Arbeitsplanung",
      desc: "Gantt-Chart & Einteilung",
      cta: "Planung öffnen",
      icon: CalendarDays,
      show: isAdmin,
      color: WILLROIDER_RED,
    },
    {
      to: "/mitarbeiter",
      label: "Mitarbeiter",
      desc: "Partien & Mitarbeiter verwalten",
      cta: "Verwalten",
      icon: Users,
      show: isAdmin,
      color: WILLROIDER_RED,
    },
  ];

  return (
    <div className="space-y-6">
      {/* Neuer Lohnzettel (MA) */}
      <NeuerLohnzettelHintCard />

      {/* Berichte-Hint (Polier: heutige Berichte, Bauleiter: zu prüfen) */}
      <BerichteHintCard />

      {/* Baustellenstundenbericht (MA: Durchsicht, Büro: Kontrolle) */}
      <StundenBerichtHintCard />

      {/* Offene Unterweisungs-Unterschriften des angemeldeten MA */}
      <UnterschriftenCard />

      {/* Neue-Anmeldungen-Banner (Admin) — bewusst ganz oben, vor dem Greeting */}
      {isAdmin && pendingCount > 0 && (
        <Card className="border-2 border-amber-500 bg-gradient-to-r from-amber-50 to-amber-100 shadow-md ring-2 ring-amber-500/20">
          <CardContent className="p-4 sm:p-5">
            <div className="flex items-start gap-3 sm:gap-4">
              <div className="relative shrink-0">
                <div className="h-11 w-11 sm:h-12 sm:w-12 rounded-full bg-amber-500 flex items-center justify-center text-white shadow-md">
                  <UserPlus className="h-5 w-5 sm:h-6 sm:w-6" />
                </div>
                <span className="absolute -top-0.5 -right-0.5 h-5 min-w-[20px] px-1 rounded-full bg-red-600 text-white text-[10px] font-bold flex items-center justify-center ring-2 ring-amber-50 animate-pulse">
                  {pendingCount}
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-bold text-base sm:text-lg text-amber-950 leading-tight">
                  {pendingCount === 1
                    ? "Neue Anmeldung wartet auf dich"
                    : `${pendingCount} neue Anmeldungen warten auf dich`}
                </div>
                <div className="text-xs sm:text-sm text-amber-800 mt-1">
                  Bevor sich {pendingCount === 1 ? "diese Person" : "diese Personen"} einloggen
                  {pendingCount === 1 ? " kann" : " können"}, musst du sie freischalten.
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {pendingProfiles.slice(0, 5).map((p) => (
                    <span
                      key={p.id}
                      className="inline-flex items-center gap-1.5 bg-white rounded-full px-2.5 py-1 text-xs shadow-sm border border-amber-200"
                    >
                      <span className="h-1.5 w-1.5 rounded-full bg-red-500 animate-pulse" />
                      <strong>
                        {p.vorname} {p.nachname}
                      </strong>
                      <span className="text-muted-foreground">· {relTime(p.created_at)}</span>
                    </span>
                  ))}
                  {pendingCount > 5 && (
                    <span className="text-xs text-amber-800 italic self-center">
                      +{pendingCount - 5} weitere
                    </span>
                  )}
                </div>
              </div>
              <Link to="/mitarbeiter" className="shrink-0 hidden sm:block">
                <Button className="bg-amber-600 hover:bg-amber-700 text-white shadow-md">
                  Jetzt freischalten
                  <ArrowRight className="h-4 w-4 ml-1.5" />
                </Button>
              </Link>
            </div>
            {/* Mobile-CTA breit unten */}
            <Link to="/mitarbeiter" className="sm:hidden block mt-3">
              <Button className="w-full h-11 bg-amber-600 hover:bg-amber-700 text-white shadow-md">
                Jetzt freischalten
                <ArrowRight className="h-4 w-4 ml-1.5" />
              </Button>
            </Link>
          </CardContent>
        </Card>
      )}

      {/* Feedback-Zähler (Admin) — dezent, nur wenn Neues da ist */}
      {isAdmin && feedbackNeu > 0 && (
        <Link to="/admin?tab=feedback" className="block">
          <Card className="border-primary/30 bg-primary/5 hover:bg-primary/10 transition">
            <CardContent className="p-3 flex items-center gap-3">
              <div className="h-9 w-9 rounded-full bg-primary/15 text-primary flex items-center justify-center shrink-0">
                <MessageSquarePlus className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">
                  {feedbackNeu === 1
                    ? "1 neue Rückmeldung"
                    : `${feedbackNeu} neue Rückmeldungen`}{" "}
                  von Mitarbeitern
                </div>
                <div className="text-xs text-muted-foreground">
                  Verbesserungswünsche & Meldungen ansehen
                </div>
              </div>
              <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0" />
            </CardContent>
          </Card>
        </Link>
      )}

      {/* Angebote-Nachfrage-Banner (Admin) */}
      {isAdmin && angeboteFaellig > 0 && (
        <Card className="border-2 border-red-400 bg-gradient-to-r from-red-50 to-rose-100 shadow-md">
          <CardContent className="p-4 sm:p-5">
            <div className="flex items-start gap-3 sm:gap-4">
              <div className="relative shrink-0">
                <div className="h-11 w-11 sm:h-12 sm:w-12 rounded-full bg-red-500 flex items-center justify-center text-white shadow-md">
                  <Briefcase className="h-5 w-5 sm:h-6 sm:w-6" />
                </div>
                <span className="absolute -top-0.5 -right-0.5 h-5 min-w-[20px] px-1 rounded-full bg-amber-500 text-white text-[10px] font-bold flex items-center justify-center ring-2 ring-red-50 animate-pulse">
                  {angeboteFaellig}
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-bold text-base sm:text-lg text-red-950 leading-tight">
                  {angeboteFaellig === 1
                    ? "1 Angebot zur Nachfrage fällig"
                    : `${angeboteFaellig} Angebote zur Nachfrage fällig`}
                </div>
                <div className="text-xs sm:text-sm text-red-900 mt-1 flex items-center gap-1.5">
                  <AlertCircle className="h-3.5 w-3.5" />
                  Beim Kunden nachfragen, bevor das Angebot „kalt" wird.
                </div>
              </div>
              <Link to="/angebote" className="shrink-0 hidden sm:block">
                <Button className="bg-red-600 hover:bg-red-700 text-white shadow-md">
                  Angebote öffnen
                  <ArrowRight className="h-4 w-4 ml-1.5" />
                </Button>
              </Link>
            </div>
            <Link to="/angebote" className="sm:hidden block mt-3">
              <Button className="w-full h-11 bg-red-600 hover:bg-red-700 text-white shadow-md">
                Angebote öffnen
                <ArrowRight className="h-4 w-4 ml-1.5" />
              </Button>
            </Link>
          </CardContent>
        </Card>
      )}

      {/* Offene Unterschriften — Polier/Bauleiter */}
      {offeneUnterschriften.length > 0 && (() => {
        const aelteste = offeneUnterschriften.reduce((max, u) => {
          if (!u.evaluierung_datum) return max;
          const wt = werktageSeit(u.evaluierung_datum);
          return wt > max ? wt : max;
        }, 0);
        const eskaliert = aelteste >= SIGNATURE_KARENZ_WERKTAGE;
        return (
        <Card
          className={
            eskaliert
              ? "border-2 border-red-500 bg-gradient-to-r from-red-50 to-rose-100 shadow-md"
              : "border-2 border-amber-400 bg-gradient-to-r from-amber-50 to-amber-100 shadow-md"
          }
        >
          <CardContent className="p-4 sm:p-5">
            <div className="flex items-start gap-3 sm:gap-4">
              <div className="relative shrink-0">
                <div
                  className={`h-11 w-11 sm:h-12 sm:w-12 rounded-full flex items-center justify-center text-white shadow-md ${
                    eskaliert ? "bg-red-600 animate-pulse" : "bg-amber-500"
                  }`}
                >
                  <ShieldAlert className="h-5 w-5 sm:h-6 sm:w-6" />
                </div>
                <span
                  className={`absolute -top-0.5 -right-0.5 h-5 min-w-[20px] px-1 rounded-full text-white text-[10px] font-bold flex items-center justify-center ring-2 animate-pulse ${
                    eskaliert
                      ? "bg-amber-500 ring-red-50"
                      : "bg-red-600 ring-amber-50"
                  }`}
                >
                  {offeneUnterschriften.length}
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <div
                  className={`font-bold text-base sm:text-lg leading-tight ${
                    eskaliert ? "text-red-950" : "text-amber-950"
                  }`}
                >
                  {offeneUnterschriften.length === 1
                    ? "1 offene Unterweisung-Unterschrift"
                    : `${offeneUnterschriften.length} offene Unterweisung-Unterschriften`}
                </div>
                <div
                  className={`text-xs sm:text-sm mt-1 ${
                    eskaliert ? "text-red-900" : "text-amber-900"
                  }`}
                >
                  {eskaliert
                    ? `Eskalation: ältester Fall seit ${aelteste} Werktagen offen.`
                    : "Mitarbeiter auf deinen Baustellen haben die Pflicht-Unterweisung noch nicht bestätigt."}
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {Array.from(
                    new Set(offeneUnterschriften.map((u) => u.bvh_name))
                  )
                    .slice(0, 5)
                    .map((bvh) => {
                      const count = offeneUnterschriften.filter(
                        (u) => u.bvh_name === bvh
                      ).length;
                      return (
                        <span
                          key={bvh}
                          className={`inline-flex items-center gap-1.5 bg-white rounded-full px-2.5 py-1 text-xs shadow-sm border ${
                            eskaliert ? "border-red-200" : "border-amber-200"
                          }`}
                        >
                          <strong>{bvh}</strong>
                          <span className="text-muted-foreground">· {count}</span>
                        </span>
                      );
                    })}
                </div>
              </div>
              <Link to="/evaluierung" className="shrink-0 hidden sm:block">
                <Button
                  className={`${
                    eskaliert
                      ? "bg-red-600 hover:bg-red-700"
                      : "bg-amber-600 hover:bg-amber-700"
                  } text-white shadow-md`}
                >
                  Anzeigen
                  <ArrowRight className="h-4 w-4 ml-1.5" />
                </Button>
              </Link>
            </div>
            <Link to="/evaluierung" className="sm:hidden block mt-3">
              <Button
                className={`w-full h-11 ${
                  eskaliert
                    ? "bg-red-600 hover:bg-red-700"
                    : "bg-amber-600 hover:bg-amber-700"
                } text-white shadow-md`}
              >
                Anzeigen
                <ArrowRight className="h-4 w-4 ml-1.5" />
              </Button>
            </Link>
          </CardContent>
        </Card>
        );
      })()}

      <PageHeader title={`Hallo ${fullName.split(" ")[0] || "willkommen"}!`} />

      {/* Feiertag-Hinweis: automatisch aus Kalender (AT + Kärnten) */}
      {(() => {
        const todayIso = localIso();
        const fei = feiertagAt(todayIso);
        if (!fei) return null;
        return (
          <Card className="border-2 border-violet-300 bg-violet-50">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="h-12 w-12 rounded-full bg-violet-500 text-white flex items-center justify-center shrink-0 font-bold text-lg">
                F
              </div>
              <div className="flex-1">
                <div className="font-bold text-violet-900">Heute ist Feiertag</div>
                <div className="text-sm text-violet-800">
                  {fei.name}
                  {fei.scope === "kaernten" && " (Kärntner Landesfeiertag)"}
                </div>
              </div>
            </CardContent>
          </Card>
        );
      })()}

      {/* Heute-Card: heutige Einteilung mit Quick-Stundenbuchung */}
      {(heuteEinteilungen.length > 0 || heuteFehlzeit) && (
        <Card className="border-2 border-primary/40 bg-primary/5 shadow-sm">
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-primary font-semibold">
              <ClipboardList className="h-4 w-4" />
              Heute
              <span className="text-muted-foreground font-normal normal-case ml-auto">
                {new Date().toLocaleDateString("de-AT", {
                  weekday: "long",
                  day: "2-digit",
                  month: "long",
                })}
              </span>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={() => setPlanOpen(true)}
            >
              <FileText className="h-4 w-4 mr-1.5" /> Tagesplan ansehen
            </Button>

            {heuteFehlzeit ? (
              <div className="text-sm">
                Heute eingetragen als <strong>{heuteFehlzeit}</strong> — keine Buchung nötig.
              </div>
            ) : (
              <div className="space-y-2">
                {heuteEinteilungen.map((e) => (
                  <div
                    key={e.einteilungId}
                    className="rounded-md border bg-card p-3 space-y-2"
                  >
                    <div className="flex items-start gap-3">
                      <div
                        className="h-10 w-10 rounded-md flex items-center justify-center shrink-0"
                        style={{
                          background: e.partieFarbe ? `${e.partieFarbe}25` : "hsl(var(--primary)/0.1)",
                          color: e.partieFarbe ?? "hsl(var(--primary))",
                        }}
                      >
                        <Building2 className="h-5 w-5" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold text-sm sm:text-base leading-tight">
                          {e.bvhName}
                        </div>
                        <div className="text-[11px] text-muted-foreground truncate">
                          {[e.kostenstelle, e.ort].filter(Boolean).join(" · ")}
                        </div>
                        {e.taetigkeit && (
                          <div className="text-xs italic text-foreground mt-0.5">
                            → {e.taetigkeit}
                          </div>
                        )}
                        {e.bereitsGebucht > 0 && (
                          <div className="text-[11px] text-emerald-700 font-medium mt-0.5">
                            ✓ {e.bereitsGebucht.toFixed(2).replace(".", ",")}h schon gebucht
                          </div>
                        )}
                      </div>
                      <Link
                        to={`/stunden?baustelle=${e.baustelleId}`}
                        className="shrink-0"
                      >
                        <Button size="sm" className="h-10">
                          <Clock className="h-4 w-4 mr-1.5" />
                          <span className="hidden sm:inline">
                            {e.bereitsGebucht > 0 ? "Nachbuchen" : "Stunden buchen"}
                          </span>
                          <span className="sm:hidden">
                            {e.bereitsGebucht > 0 ? "Nach" : "Buchen"}
                          </span>
                        </Button>
                      </Link>
                    </div>
                    {(e.fahrzeuge.length > 0 || e.kollegen.length > 0) && (
                      <div className="grid sm:grid-cols-2 gap-2 pt-2 border-t text-xs">
                        {e.fahrzeuge.length > 0 && (
                          <div className="flex items-start gap-1.5">
                            <Truck className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />
                            <div className="flex-1 min-w-0">
                              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                                Fahrzeug
                              </div>
                              <div className="font-medium tabular-nums">
                                {e.fahrzeuge.join(" · ")}
                              </div>
                            </div>
                          </div>
                        )}
                        {e.kollegen.length > 0 && (
                          <div className="flex items-start gap-1.5">
                            <Users className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />
                            <div className="flex-1 min-w-0">
                              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                                Mit dir dabei
                              </div>
                              <div className="font-medium">
                                {e.kollegen.join(", ")}
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Tagesplan-Vorschau im Dialog */}
      <Dialog open={planOpen} onOpenChange={setPlanOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Tagesplan</DialogTitle>
          </DialogHeader>
          <TagesplanPreview datum={localIso()} />
        </DialogContent>
      </Dialog>

      {/* Schnellzugriff */}
      <div>
        <h2 className="text-lg font-semibold mb-3">Schnellzugriff</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
          {cards
            .filter((c) => c.show)
            .map((c) => (
              <Link key={c.to} to={c.to} className="group block">
                <Card className="cursor-pointer hover:shadow-lg transition-all h-full flex flex-col overflow-hidden border-2 border-primary/20 hover:-translate-y-0.5">
                  <div className="h-1.5 w-full bg-primary" />
                  <CardHeader className="space-y-2 pb-3">
                    <div className="h-14 w-14 rounded-xl flex items-center justify-center shadow-sm bg-primary/10 text-primary">
                      <c.icon className="h-7 w-7" />
                    </div>
                    <CardTitle className="text-lg sm:text-xl">{c.label}</CardTitle>
                    <CardDescription className="text-sm">{c.desc}</CardDescription>
                  </CardHeader>
                  <CardContent className="mt-auto pt-0">
                    <Button
                      className="w-full bg-primary hover:bg-primary/90 text-primary-foreground shadow-sm"
                      size="sm"
                    >
                      {c.cta}
                      <ArrowRight className="h-4 w-4 ml-1" />
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

