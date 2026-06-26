import { type ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useHasPermission } from "@/hooks/useHasPermission";
import { usePermissionContext } from "@/contexts/PermissionContext";
import type { PermissionKey } from "@/lib/permissionKeys";

interface RequirePermissionProps {
  perm: PermissionKey;
  children: ReactNode;
  /** Pfad für Redirect bei fehlender Permission. Default: "/" */
  redirectTo?: string;
}

/**
 * Route-Guard: rendert children nur wenn der User die Permission hat,
 * sonst Redirect.
 *
 *   <Route path="/admin" element={
 *     <RequirePermission perm="admin.view">
 *       <Admin />
 *     </RequirePermission>
 *   } />
 */
export function RequirePermission({ perm, children, redirectTo = "/" }: RequirePermissionProps) {
  const { loading } = usePermissionContext();
  const ok = useHasPermission(perm);
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[40vh] text-sm text-muted-foreground">
        Lade Berechtigungen …
      </div>
    );
  }
  if (!ok) return <Navigate to={redirectTo} replace />;
  return <>{children}</>;
}
