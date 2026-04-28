import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import type { AppRole } from "@/integrations/supabase/types";

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
  role: AppRole | null;
  loading: boolean;
  isAdmin: boolean;
  isPolier: boolean;
  canPlan: boolean;
  canReview: boolean;
  canCreateBaustelle: boolean;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [role, setRole] = useState<AppRole | null>(null);
  const [loading, setLoading] = useState(true);

  const loadProfile = async (userId: string) => {
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
  };

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
  }, []);

  const signOut = async () => {
    await supabase.auth.signOut({ scope: "local" });
    setProfile(null);
    setRole(null);
  };

  const refresh = async () => {
    if (user) await loadProfile(user.id);
  };

  const isAdmin = role === "geschaeftsfuehrung" || role === "buero" || role === "bauleiter";
  const isPolier = !!profile?.is_partieleiter;
  const canPlan = isAdmin;
  const canReview = isAdmin;
  const canCreateBaustelle = isAdmin || isPolier;

  return (
    <AuthContext.Provider
      value={{
        session,
        user,
        profile,
        role,
        loading,
        isAdmin,
        isPolier,
        canPlan,
        canReview,
        canCreateBaustelle,
        signOut,
        refresh,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
