/**
 * PermissionContext ist seit dem RBAC-Refactor ein dünner Pass-Through
 * an AuthContext — die Single Source of Truth für Permissions ist dort
 * (sonst gäbe es zwei parallele Loads + Realtime-Channels).
 *
 * Der Provider rendert nur die Kinder (kein Effekt), die Hooks lesen
 * direkt aus AuthContext.
 */
import { type ReactNode } from "react";
import { useAuth } from "@/contexts/AuthContext";
import type { PermissionKey } from "@/lib/permissionKeys";

interface PermissionContextValue {
  perms: Set<PermissionKey>;
  loading: boolean;
  fallbackActive: boolean;
  refresh: () => Promise<void>;
}

export function PermissionProvider({ children }: { children: ReactNode }) {
  // Keine eigene Logik mehr — AuthContext hält die Permissions.
  return <>{children}</>;
}

export function usePermissionContext(): PermissionContextValue {
  const auth = useAuth();
  return {
    perms: auth.permissions,
    loading: !auth.permissionsLoaded,
    fallbackActive: false,
    refresh: auth.refreshPermissions,
  };
}
