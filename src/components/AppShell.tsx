import { ReactNode, useEffect, useState } from "react";
import { Link, NavLink, useNavigate } from "react-router-dom";
import {
  LayoutDashboard,
  CalendarDays,
  ClipboardCheck,
  ClipboardList,
  Building2,
  Users,
  Truck,
  Clock,
  Wrench,
  CalendarRange,
  ShieldCheck,
  BarChart3,
  FileSpreadsheet,
  Briefcase,
  Settings,
  LogOut,
  Smartphone,
  User as UserIcon,
  FileText,
  Calculator,
  Mail,
  MessageSquarePlus,
  X,
} from "lucide-react";
import { InstallPromptDialog } from "./InstallPromptDialog";
import { FeedbackDialog } from "./FeedbackDialog";
import {
  getCachedInstallPrompt,
  subscribeInstallPrompt,
  clearCachedInstallPrompt,
  type BeforeInstallPromptEvent,
} from "@/lib/pwaInstall";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import ChangePasswordDialog from "@/components/ChangePasswordDialog";
import { cn } from "@/lib/utils";

type NavItem = {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
  /** Legacy-Group für Sichtbarkeit. Neue Items nutzen besser `perm`. */
  roles?: ("admin" | "review" | "gf" | "all")[];
  /** Permission-Key — wenn gesetzt, MUSS der User diese Permission haben.
   *  Überschreibt `roles`. */
  perm?: import("@/lib/permissionKeys").PermissionKey;
  /** end=true → highlight nur wenn Pfad EXAKT übereinstimmt. Default true. */
  end?: boolean;
};

const NAV: NavItem[] = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, perm: "dashboard.view", end: true },
  { to: "/mein-tag", label: "Mein Tag", icon: ClipboardList, perm: "meintag.view", end: true },
  { to: "/arbeitsplanung", label: "Jahresplanung", icon: CalendarDays, perm: "arbeitsplanung.view", end: true },
  { to: "/tagesplanung", label: "Tagesplanung", icon: ClipboardCheck, perm: "tagesplanung.edit", end: true },
  { to: "/angebote", label: "Angebote", icon: Briefcase, perm: "angebote.view", end: false },
  { to: "/baustellen", label: "Baustellen", icon: Building2, perm: "baustellen.view", end: false },
  { to: "/stunden", label: "Zeiterfassung", icon: Clock, perm: "stunden.view_eigene", end: true },
  { to: "/halle", label: "Halle", icon: Wrench, perm: "stunden.view_eigene", end: true },
  { to: "/stunden/auswertung", label: "Auswertung", icon: BarChart3, perm: "stunden.view_alle", end: true },
  { to: "/stundenberichte", label: "Stundenberichte", icon: FileSpreadsheet, perm: "stunden.bsb.bestaetigen", end: false },
  { to: "/berichte", label: "Berichte", icon: FileText, perm: "berichte.view", end: false },
  { to: "/kalkulator", label: "Kalkulator", icon: Calculator, perm: "kalkulator.view", end: true },
  { to: "/kalkulator/anfragen", label: "Anfragen", icon: Mail, perm: "kalkulator.anfragen_verwalten", end: true },
  { to: "/admin", label: "Verwaltung", icon: Settings, perm: "admin.view", end: false },
];

export function AppShell({ children }: { children: ReactNode }) {
  const { profile, role, isAdmin, canReview, hasPermission, signOut } = useAuth();
  const navigate = useNavigate();
  const [installOpen, setInstallOpen] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  /** Einmaliger Hinweis auf den neuen Feedback-Kanal (pro Gerät einmal). */
  const [feedbackHint, setFeedbackHint] = useState(false);
  /** Nativer Installations-Prompt (Chrome/Edge Desktop + Android), sobald
   *  der Browser ihn anbietet. Null = nicht verfügbar (iOS, Firefox, …). */
  const [deferredPrompt, setDeferredPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (navigator as any).standalone === true;
    setIsStandalone(standalone);

    // Nativen Prompt übernehmen (evtl. schon vor Mount gecacht) + abonnieren.
    setDeferredPrompt(getCachedInstallPrompt());
    const unsub = subscribeInstallPrompt((e) => setDeferredPrompt(e));
    const onInstalled = () => setIsStandalone(true);
    window.addEventListener("appinstalled", onInstalled);

    // Feedback-Hinweis: einmal pro Gerät zeigen.
    try {
      setFeedbackHint(!localStorage.getItem("willroider:feedback-hint-v1"));
    } catch {
      /* ignore */
    }
    return () => {
      unsub();
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const dismissFeedbackHint = () => {
    setFeedbackHint(false);
    try {
      localStorage.setItem("willroider:feedback-hint-v1", "true");
    } catch {
      /* ignore */
    }
  };

  const openFeedback = () => {
    dismissFeedbackHint();
    setFeedbackOpen(true);
  };

  /** Ein Klick auf „App installieren": wenn der Browser den nativen Prompt
   *  anbietet (PC-Chrome/Edge, Android), diesen direkt auslösen — sonst die
   *  Schritt-für-Schritt-Anleitung öffnen (iPhone, Firefox …). */
  const handleInstallClick = async () => {
    if (deferredPrompt) {
      try {
        await deferredPrompt.prompt();
        const choice = await deferredPrompt.userChoice;
        clearCachedInstallPrompt();
        setDeferredPrompt(null);
        if (choice.outcome !== "accepted") {
          // Nutzer hat abgelehnt → Anleitung als Alternative anbieten
          setInstallOpen(true);
        }
      } catch {
        setInstallOpen(true);
      }
      return;
    }
    setInstallOpen(true);
  };

  const closeInstallDialog = () => {
    setInstallOpen(false);
    try {
      localStorage.setItem("willroider:install-dismissed", "true");
    } catch {
      /* ignore */
    }
  };

  const visibleNav = NAV.filter((n) => {
    // Wenn perm gesetzt: das ist die einzige Quelle der Wahrheit.
    if (n.perm) return hasPermission(n.perm);
    // Fallback: alte roles-Logik (für Items ohne perm).
    if (!n.roles || n.roles.includes("all")) return true;
    if (n.roles.includes("admin") && isAdmin) return true;
    if (n.roles.includes("review") && canReview) return true;
    if (n.roles.includes("gf") && role === "geschaeftsfuehrung") return true;
    return false;
  });

  const handleLogout = async () => {
    await signOut();
    navigate("/auth");
  };

  const fullName = profile ? `${profile.vorname} ${profile.nachname}`.trim() || profile.email : "";

  const roleLabel: Record<string, string> = {
    geschaeftsfuehrung: "Geschäftsführung",
    bauleiter: "Vorarbeiter",
    zimmermeister: "Zimmermeister",
    buero: "Büro",
    mitarbeiter: "Mitarbeiter",
  };

  return (
    <div className="min-h-screen bg-muted/30 flex">
      {/* Sidebar (desktop) */}
      <aside className="hidden lg:flex w-64 shrink-0 flex-col bg-card border-r">
        <Link
          to="/"
          className="px-4 py-4 border-b flex items-center gap-3 hover:bg-muted/40 transition-colors"
          aria-label="Zum Dashboard"
        >
          <img src="/willroider-logo.jpg" alt="Holzbau Willroider" className="h-9 w-auto shrink-0" />
          <div className="leading-tight min-w-0">
            <div className="font-semibold text-sm truncate">Holzbau Willroider</div>
            <div className="text-[11px] text-muted-foreground">Baustellenmanagement</div>
          </div>
        </Link>
        <nav className="flex-1 overflow-y-auto px-2 py-3 space-y-0.5">
          {visibleNav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end ?? true}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors",
                  isActive
                    ? "bg-primary/10 text-primary font-medium border-l-2 border-primary -ml-px"
                    : "text-foreground hover:bg-muted border-l-2 border-transparent -ml-px"
                )
              }
            >
              <item.icon className="h-4 w-4 shrink-0" />
              <span className="truncate">{item.label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="p-3 border-t text-[11px] text-muted-foreground">
          v1.0 · Holzbau Willroider GmbH
        </div>
      </aside>

      {/* Main column */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="bg-card border-b sticky top-0 z-30">
          <div className="flex items-center justify-between px-3 sm:px-4 lg:px-6 py-3 gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <Link
                to="/"
                className="lg:hidden flex items-center gap-2 min-w-0"
                aria-label="Zum Dashboard"
              >
                <img src="/willroider-logo.jpg" alt="Logo" className="h-7 w-auto shrink-0" />
                <div className="text-sm font-semibold truncate">Holzbau Willroider</div>
              </Link>
              <div className="hidden lg:block text-xs text-muted-foreground">
                Angemeldet als <span className="font-medium text-foreground">{fullName}</span>
                {role ? <span> · {roleLabel[role] ?? role}</span> : null}
              </div>
            </div>

            <div className="flex items-center gap-1.5">
              {!isStandalone && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleInstallClick}
                  title="App auf Startbildschirm installieren"
                  aria-label="App installieren"
                  className="px-2.5"
                >
                  <Smartphone className="h-4 w-4 sm:mr-1.5" />
                  <span className="hidden sm:inline">App installieren</span>
                </Button>
              )}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm">
                    <UserIcon className="h-4 w-4 mr-2" />
                    <span className="hidden sm:inline">{fullName || "Account"}</span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuLabel>{fullName}</DropdownMenuLabel>
                  {role ? (
                    <div className="px-2 pb-2 text-xs text-muted-foreground">
                      {roleLabel[role] ?? role}
                    </div>
                  ) : null}
                  {!isStandalone && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onSelect={(e) => {
                          e.preventDefault();
                          void handleInstallClick();
                        }}
                      >
                        <Smartphone className="mr-2 h-4 w-4" />
                        <span>App installieren</span>
                      </DropdownMenuItem>
                    </>
                  )}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onSelect={(e) => {
                      e.preventDefault();
                      openFeedback();
                    }}
                  >
                    <MessageSquarePlus className="mr-2 h-4 w-4" />
                    <span>Feedback geben</span>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <ChangePasswordDialog />
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={handleLogout}>
                    <LogOut className="mr-2 h-4 w-4" />
                    <span>Abmelden</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </header>

        {/* Einmaliger Hinweis auf den Feedback-Kanal — dezent, wegklickbar */}
        {feedbackHint && (
          <div className="bg-primary/5 border-b border-primary/20 px-3 sm:px-4 lg:px-6 py-2.5">
            <div className="flex items-center gap-3">
              <MessageSquarePlus className="h-5 w-5 text-primary shrink-0" />
              <div className="text-sm min-w-0 flex-1">
                <span className="font-medium">Neu: Sag uns deine Meinung!</span>{" "}
                <span className="text-muted-foreground">
                  Verbesserungswünsche, Fehler oder Lob – jederzeit über dein
                  Konto-Menü oder hier.
                </span>
              </div>
              <Button size="sm" onClick={openFeedback} className="shrink-0 hidden sm:inline-flex">
                <MessageSquarePlus className="h-4 w-4 mr-1.5" /> Feedback geben
              </Button>
              <Button size="sm" onClick={openFeedback} className="shrink-0 sm:hidden px-2">
                <MessageSquarePlus className="h-4 w-4" />
              </Button>
              <button
                onClick={dismissFeedbackHint}
                className="shrink-0 p-1.5 rounded hover:bg-muted text-muted-foreground"
                aria-label="Hinweis ausblenden"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}

        <main className="flex-1 px-3 sm:px-4 lg:px-6 py-3 sm:py-6 max-w-full pb-28 lg:pb-6">
          {children}
        </main>

        {/* Mobile bottom nav with safe-area */}
        <nav
          className="lg:hidden fixed bottom-0 inset-x-0 z-30 bg-card border-t flex"
          style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
        >
          {([
            { to: "/", label: "Start", icon: LayoutDashboard, end: true, perm: "dashboard.view" as const },
            hasPermission("arbeitsplanung.view")
              ? { to: "/arbeitsplanung", label: "Plan", icon: CalendarDays, end: false, perm: "arbeitsplanung.view" as const }
              : { to: "/mein-tag", label: "Heute", icon: ClipboardList, end: false, perm: "meintag.view" as const },
            { to: "/stunden", label: "Stunden", icon: Clock, end: false, perm: "stunden.view_eigene" as const },
            { to: "/berichte", label: "Berichte", icon: FileText, end: false, perm: "berichte.view" as const },
            { to: "/baustellen", label: "Baustellen", icon: Building2, end: false, perm: "baustellen.view" as const },
          ] as const)
            .filter((item) => hasPermission(item.perm))
            .map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                cn(
                  "flex-1 flex flex-col items-center gap-0.5 py-2 text-[10px]",
                  isActive ? "text-primary" : "text-muted-foreground"
                )
              }
            >
              <item.icon className="h-5 w-5" />
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>
      </div>

      <InstallPromptDialog open={installOpen} onClose={closeInstallDialog} />
      <FeedbackDialog open={feedbackOpen} onOpenChange={setFeedbackOpen} />
    </div>
  );
}
