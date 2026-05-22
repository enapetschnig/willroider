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
} from "lucide-react";
import { InstallPromptDialog } from "./InstallPromptDialog";
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
  roles?: ("admin" | "review" | "all")[];
  /** end=true → highlight nur wenn Pfad EXAKT übereinstimmt. Default true. */
  end?: boolean;
};

const NAV: NavItem[] = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, roles: ["all"], end: true },
  { to: "/mein-tag", label: "Mein Tag", icon: ClipboardList, roles: ["all"], end: true },
  { to: "/arbeitsplanung", label: "Jahresplanung", icon: CalendarDays, roles: ["admin"], end: true },
  { to: "/tagesplanung", label: "Tagesplanung", icon: ClipboardCheck, roles: ["admin"], end: true },
  { to: "/angebote", label: "Angebote", icon: Briefcase, roles: ["admin"], end: false },
  { to: "/baustellen", label: "Baustellen", icon: Building2, roles: ["all"], end: false },
  { to: "/stunden", label: "Zeiterfassung", icon: Clock, roles: ["all"], end: true },
  { to: "/stunden/auswertung", label: "Auswertung", icon: BarChart3, roles: ["review"], end: true },
  { to: "/stundenberichte", label: "Stundenberichte", icon: FileSpreadsheet, roles: ["review"], end: false },
  { to: "/berichte", label: "Berichte", icon: FileText, roles: ["all"], end: false },
  { to: "/admin", label: "Verwaltung", icon: Settings, roles: ["admin"], end: false },
];

export function AppShell({ children }: { children: ReactNode }) {
  const { profile, role, isAdmin, canReview, signOut } = useAuth();
  const navigate = useNavigate();
  const [installOpen, setInstallOpen] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);

  // Auto-show install prompt one time per device (skipped if already installed)
  useEffect(() => {
    if (typeof window === "undefined") return;
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (navigator as any).standalone === true;
    setIsStandalone(standalone);
    if (standalone) return;
    if (localStorage.getItem("willroider:install-dismissed") === "true") return;
    const t = window.setTimeout(() => setInstallOpen(true), 4000);
    return () => window.clearTimeout(t);
  }, []);

  const closeInstallDialog = () => {
    setInstallOpen(false);
    try {
      localStorage.setItem("willroider:install-dismissed", "true");
    } catch {
      /* ignore */
    }
  };

  const visibleNav = NAV.filter((n) => {
    if (!n.roles || n.roles.includes("all")) return true;
    if (n.roles.includes("admin") && isAdmin) return true;
    if (n.roles.includes("review") && canReview) return true;
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
                  onClick={() => setInstallOpen(true)}
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
                          setInstallOpen(true);
                        }}
                      >
                        <Smartphone className="mr-2 h-4 w-4" />
                        <span>App zum Startbildschirm</span>
                      </DropdownMenuItem>
                    </>
                  )}
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

        <main className="flex-1 px-3 sm:px-4 lg:px-6 py-3 sm:py-6 max-w-full pb-28 lg:pb-6">
          {children}
        </main>

        {/* Mobile bottom nav with safe-area */}
        <nav
          className="lg:hidden fixed bottom-0 inset-x-0 z-30 bg-card border-t flex"
          style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
        >
          {[
            { to: "/", label: "Start", icon: LayoutDashboard, end: true },
            isAdmin
              ? { to: "/arbeitsplanung", label: "Plan", icon: CalendarDays, end: false }
              : { to: "/mein-tag", label: "Heute", icon: ClipboardList, end: false },
            { to: "/stunden", label: "Stunden", icon: Clock, end: false },
            { to: "/berichte", label: "Berichte", icon: FileText, end: false },
            { to: "/baustellen", label: "Baustellen", icon: Building2, end: false },
          ].map((item) => (
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
    </div>
  );
}
