/**
 * PermissionContext — lädt die Permissions des angemeldeten Users
 * einmal pro Session via `my_permissions()`-RPC und stellt sie als Set
 * bereit. Hört auf Realtime-Updates (user_roles + rollen_berechtigungen)
 * und re-lädt automatisch bei Änderungen.
 *
 * Graceful Fallback: falls die RPC nicht existiert (Deploy-Order-Edge-
 * Case) bleibt das Set leer und der Hook delegiert über `useHasPermission`
 * an die alten AuthContext-Flags via `legacyFallback` Parameter.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import type { PermissionKey } from "@/lib/permissionKeys";

interface PermissionContextValue {
  perms: Set<PermissionKey>;
  loading: boolean;
  /** True wenn die RPC einen Fehler zurückgegeben hat (z. B. weil die
   *  Migration noch nicht deployt ist). Hook fällt dann auf
   *  AuthContext-Flags zurück. */
  fallbackActive: boolean;
  refresh: () => Promise<void>;
}

const PermissionContext = createContext<PermissionContextValue | undefined>(undefined);

export function PermissionProvider({ children }: { children: ReactNode }) {
  const { user, loading: authLoading } = useAuth();
  const [perms, setPerms] = useState<Set<PermissionKey>>(() => new Set());
  const [loading, setLoading] = useState(true);
  const [fallbackActive, setFallbackActive] = useState(false);

  const load = useCallback(async () => {
    if (!user) {
      setPerms(new Set());
      setLoading(false);
      setFallbackActive(false);
      return;
    }
    setLoading(true);
    const { data, error } = await supabase.rpc("my_permissions");
    if (error) {
      // RPC nicht vorhanden oder anderer Fehler → Legacy-Fallback
      console.warn("[PermissionContext] my_permissions() failed, falling back:", error.message);
      setFallbackActive(true);
      setPerms(new Set());
      setLoading(false);
      return;
    }
    setFallbackActive(false);
    setPerms(new Set((data ?? []) as PermissionKey[]));
    setLoading(false);
  }, [user]);

  useEffect(() => {
    if (authLoading) return;
    void load();
  }, [authLoading, load]);

  // Realtime-Refresh: wenn meine Rolle oder eine beliebige Rolle-Berechtigungs-
  // Kombi geändert wird, neu laden.
  useEffect(() => {
    if (!user) return;
    const ch = supabase
      .channel(`perms:${user.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "user_roles", filter: `user_id=eq.${user.id}` },
        () => void load(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "rollen_berechtigungen" },
        () => void load(),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(ch);
    };
  }, [user, load]);

  const value = useMemo(
    () => ({ perms, loading, fallbackActive, refresh: load }),
    [perms, loading, fallbackActive, load],
  );

  return <PermissionContext.Provider value={value}>{children}</PermissionContext.Provider>;
}

export function usePermissionContext(): PermissionContextValue {
  const ctx = useContext(PermissionContext);
  if (!ctx) throw new Error("usePermissionContext must be used within PermissionProvider");
  return ctx;
}
