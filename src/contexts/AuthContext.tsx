import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import type { AppRole } from "@/integrations/supabase/types";
import type { PermissionKey } from "@/lib/permissionKeys";

type Profile = {
  id: string;
  vorname: string;
  nachname: string;
  email: string | null;
  is_active: boolean | null;
  is_partieleiter: boolean | null;
  partie_id: string | null;
  pers_nr: string | null;
};

type AuthContextValue = {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  /** Legacy: ENUM-basierte Rolle. Wird automatisch synchron gehalten,
   *  bleibt aber NICHT die primäre Quelle. */
  role: AppRole | null;
  loading: boolean;
  /** Permissions aus my_permissions()-RPC. Wenn permissionsLoaded=true,
   *  kann sich der Aufrufer auf die abgeleiteten Flags verlassen. */
  permissions: Set<PermissionKey>;
  permissionsLoaded: boolean;
  hasPermission: (key: PermissionKey) => boolean;
  /** Legacy-Flags — werden ab sofort aus Permissions berechnet. */
  isAdmin: boolean;
  isPolier: boolean;
  canPlan: boolean;
  canReview: boolean;
  canCreateBaustelle: boolean;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
  refreshPermissions: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [role, setRole] = useState<AppRole | null>(null);
  const [permissions, setPermissions] = useState<Set<PermissionKey>>(() => new Set());
  const [permissionsLoaded, setPermissionsLoaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const realtimeRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  const loadPermissions = useCallback(async () => {
    const { data, error } = await supabase.rpc("my_permissions");
    if (error) {
      // RPC fehlt (Edge-Case: Migration noch nicht deployed) — leeres Set.
      console.warn("[AuthContext] my_permissions failed:", error.message);
      setPermissions(new Set());
    } else {
      setPermissions(new Set((data ?? []) as PermissionKey[]));
    }
    setPermissionsLoaded(true);
  }, []);

  const loadProfile = useCallback(async (userId: string) => {
    const [{ data: prof }, { data: roleData }] = await Promise.all([
      supabase
        .from("profiles")
        .select("id, vorname, nachname, email, is_active, is_partieleiter, partie_id, pers_nr")
        .eq("id", userId)
        .maybeSingle(),
      supabase.from("user_roles").select("role").eq("user_id", userId).maybeSingle(),
    ]);
    setProfile((prof as Profile) ?? null);
    setRole((roleData?.role as AppRole) ?? null);
    await loadPermissions();
  }, [loadPermissions]);

  // Initial-Load + Auth-State-Changes
  useEffect(() => {
    let mounted = true;
    const handle = async (s: Session | null) => {
      if (!mounted) return;
      setSession(s);
      setUser(s?.user ?? null);
      if (s?.user) {
        await loadProfile(s.user.id);
      } else {
        setProfile(null);
        setRole(null);
        setPermissions(new Set());
        setPermissionsLoaded(true);
      }
      setLoading(false);
    };
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, s) => {
      window.setTimeout(() => void handle(s), 0);
    });
    supabase.auth.getSession().then(({ data: { session } }) => {
      void handle(session);
    });
    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [loadProfile]);

  // Realtime: Permissions reloaden wenn user_roles oder
  // rollen_berechtigungen sich ändern.
  useEffect(() => {
    if (!user) return;
    if (realtimeRef.current) {
      void supabase.removeChannel(realtimeRef.current);
      realtimeRef.current = null;
    }
    const ch = supabase
      .channel(`auth-perms:${user.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "user_roles", filter: `user_id=eq.${user.id}` },
        () => void loadPermissions(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "rollen_berechtigungen" },
        () => void loadPermissions(),
      )
      .subscribe();
    realtimeRef.current = ch;
    return () => {
      if (realtimeRef.current) {
        void supabase.removeChannel(realtimeRef.current);
        realtimeRef.current = null;
      }
    };
  }, [user, loadPermissions]);

  const signOut = async () => {
    await supabase.auth.signOut({ scope: "local" });
    setProfile(null);
    setRole(null);
    setPermissions(new Set());
  };

  const refresh = async () => {
    if (user) await loadProfile(user.id);
  };

  const refreshPermissions = useCallback(async () => {
    if (user) await loadPermissions();
  }, [user, loadPermissions]);

  const hasPermission = useCallback(
    (key: PermissionKey) => permissions.has(key),
    [permissions],
  );

  // Legacy-Flags aus Permissions ableiten (Backward-Compat für ~180
  // Frontend-Stellen). Wenn Permissions noch nicht geladen sind,
  // fallback auf konservatives FALSE (außer im Loading-State).
  const isAdmin = useMemo(() => {
    if (!permissionsLoaded) {
      // während Loading: alter Pfad über ENUM, damit der UI-State
      // nicht kurz auf "kein Admin" springt
      return role === "geschaeftsfuehrung" || role === "buero" || role === "bauleiter";
    }
    return permissions.has("system.admin_panel" as PermissionKey) || permissions.has("admin.view" as PermissionKey);
  }, [permissionsLoaded, permissions, role]);

  const canReview = useMemo(() => {
    if (!permissionsLoaded) return isAdmin || role === "zimmermeister";
    return (
      permissions.has("stunden.freigeben_zm" as PermissionKey) ||
      permissions.has("stunden.freigeben_buero" as PermissionKey)
    );
  }, [permissionsLoaded, permissions, isAdmin, role]);

  const canPlan = useMemo(() => {
    if (!permissionsLoaded) return isAdmin;
    return (
      permissions.has("arbeitsplanung.edit" as PermissionKey) ||
      permissions.has("tagesplanung.edit" as PermissionKey)
    );
  }, [permissionsLoaded, permissions, isAdmin]);

  const canCreateBaustelle = useMemo(() => {
    if (!permissionsLoaded) return isAdmin || !!profile?.is_partieleiter;
    return permissions.has("baustellen.create" as PermissionKey);
  }, [permissionsLoaded, permissions, isAdmin, profile?.is_partieleiter]);

  const isPolier = !!profile?.is_partieleiter;

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      user,
      profile,
      role,
      loading,
      permissions,
      permissionsLoaded,
      hasPermission,
      isAdmin,
      isPolier,
      canPlan,
      canReview,
      canCreateBaustelle,
      signOut,
      refresh,
      refreshPermissions,
    }),
    [
      session, user, profile, role, loading,
      permissions, permissionsLoaded, hasPermission,
      isAdmin, isPolier, canPlan, canReview, canCreateBaustelle,
      refreshPermissions,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
