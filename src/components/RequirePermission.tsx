import { type ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useHasPermission } from "@/hooks/useHasPermission";
import { usePermissionContext } from "@/contexts/PermissionContext";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent } from "@/components/ui/card";
import type { PermissionKey } from "@/lib/permissionKeys";

interface RequirePermissionProps {
  perm: PermissionKey;
  children: ReactNode;
}

/** Fallback-Kette bei fehlender Permission: Redirect zur ersten Route,
 *  deren Permission der User tatsächlich HAT. Ein stures Redirect auf "/"
 *  wäre eine Sackgasse, weil "/" selbst mit dashboard.view geguardet ist. */
const FALLBACK_ROUTES: ReadonlyArray<{ perm: PermissionKey; path: string }> = [
  { perm: "dashboard.view", path: "/" },
  { perm: "meintag.view", path: "/mein-tag" },
  { perm: "stunden.view_eigene", path: "/stunden" },
];

/**
 * Route-Guard: rendert children nur wenn der User die Permission hat,
 * sonst Redirect zur ersten erlaubten Fallback-Route — oder eine
 * Inline-Meldung, falls der User gar keine der Fallback-Permissions hat.
 *
 *   <Route path="/admin" element={
 *     <RequirePermission perm="admin.view">
 *       <Admin />
 *     </RequirePermission>
 *   } />
 */
export function RequirePermission({ perm, children }: RequirePermissionProps) {
  const { loading } = usePermissionContext();
  const { hasPermission } = useAuth();
  const ok = useHasPermission(perm);
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[40vh] text-sm text-muted-foreground">
        Lade Berechtigungen …
      </div>
    );
  }
  if (!ok) {
    const fallback = FALLBACK_ROUTES.find((r) => hasPermission(r.perm));
    if (fallback) return <Navigate to={fallback.path} replace />;
    // Keine einzige Fallback-Permission vorhanden: statt Redirect-Sackgasse
    // eine ruhige Meldung anzeigen.
    return (
      <Card className="max-w-md mx-auto mt-10">
        <CardContent className="p-6 text-center text-sm text-muted-foreground">
          Keine Berechtigung — bitte beim Büro melden.
        </CardContent>
      </Card>
    );
  }
  return <>{children}</>;
}
