import { ReactNode, useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import {
  LayoutDashboard,
  CalendarDays,
  ClipboardList,
  Building2,
  Users,
  Truck,
  Clock,
  CalendarRange,
  ShieldCheck,
  CheckCircle2,
  LogOut,
  Menu,
  X,
  User as UserIcon,
} from "lucide-react";
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
};

const NAV: NavItem[] = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, roles: ["all"] },
  { to: "/mein-tag", label: "Mein Tag", icon: ClipboardList, roles: ["all"] },
  { to: "/arbeitsplanung", label: "Arbeitsplanung", icon: CalendarDays, roles: ["admin"] },
  { to: "/einteilung", label: "Einteilung", icon: ClipboardList, roles: ["admin"] },
  { to: "/baustellen", label: "Baustellen", icon: Building2, roles: ["all"] },
  { to: "/mitarbeiter", label: "Mitarbeiter", icon: Users, roles: ["admin"] },
  { to: "/fahrzeuge", label: "Fahrzeuge", icon: Truck, roles: ["admin"] },
  { to: "/stunden", label: "Stunden", icon: Clock, roles: ["all"] },
  { to: "/stunden/freigabe", label: "Freigaben", icon: CheckCircle2, roles: ["review"] },
  { to: "/evaluierung", label: "Evaluierung", icon: ShieldCheck, roles: ["admin"] },
  { to: "/kalender", label: "Arbeitszeitkalender", icon: CalendarRange, roles: ["admin"] },
];

export function AppShell({ children }: { children: ReactNode }) {
  const { profile, role, isAdmin, canReview, signOut } = useAuth();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);

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
    bauleiter: "Bauleiter",
    zimmermeister: "Zimmermeister",
    buero: "Büro",
    mitarbeiter: "Mitarbeiter",
  };

  return (
    <div className="min-h-screen bg-muted/30 flex">
      {/* Sidebar (desktop) */}
      <aside className="hidden lg:flex w-64 shrink-0 flex-col bg-card border-r">
        <div className="bg-primary text-primary-foreground px-4 py-4 flex items-center gap-3">
          <div className="bg-white rounded-md p-1 shadow-sm shrink-0">
            <img src="/willroider-logo.jpg" alt="Holzbau Willroider" className="h-9 w-auto block" />
          </div>
          <div className="leading-tight min-w-0">
            <div className="font-bold text-sm truncate">Holzbau Willroider</div>
            <div className="text-[11px] opacity-90">Baustellenmanagement</div>
          </div>
        </div>
        <div className="h-1 bg-secondary" />
        <nav className="flex-1 overflow-y-auto px-2 py-3 space-y-0.5">
          {visibleNav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === "/"}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors",
                  isActive
                    ? "bg-primary text-primary-foreground font-medium"
                    : "text-foreground hover:bg-muted"
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
              <Button
                variant="ghost"
                size="icon"
                className="lg:hidden"
                onClick={() => setMobileOpen((v) => !v)}
                aria-label="Menü"
              >
                {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
              </Button>
              <div className="lg:hidden flex items-center gap-2 min-w-0">
                <div className="bg-primary rounded-md p-0.5 shadow-sm shrink-0">
                  <img src="/willroider-logo.jpg" alt="Logo" className="h-7 w-auto block bg-white rounded-sm" />
                </div>
                <div className="text-sm font-bold truncate">Holzbau Willroider</div>
              </div>
              <div className="hidden lg:block text-xs text-muted-foreground">
                Angemeldet als <span className="font-medium text-foreground">{fullName}</span>
                {role ? <span> · {roleLabel[role] ?? role}</span> : null}
              </div>
            </div>

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

          {/* Mobile drawer */}
          {mobileOpen && (
            <nav className="lg:hidden border-t bg-card px-2 py-2 space-y-0.5">
              {visibleNav.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.to === "/"}
                  onClick={() => setMobileOpen(false)}
                  className={({ isActive }) =>
                    cn(
                      "flex items-center gap-3 px-3 py-2 rounded-md text-sm",
                      isActive
                        ? "bg-primary text-primary-foreground font-medium"
                        : "hover:bg-muted"
                    )
                  }
                >
                  <item.icon className="h-4 w-4" />
                  <span>{item.label}</span>
                </NavLink>
              ))}
            </nav>
          )}
        </header>

        <main className="flex-1 px-3 sm:px-4 lg:px-6 py-4 sm:py-6 max-w-full">
          {children}
        </main>
      </div>
    </div>
  );
}
