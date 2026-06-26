import { type ReactNode } from "react";
import { useHasPermission } from "@/hooks/useHasPermission";
import type { PermissionKey } from "@/lib/permissionKeys";

interface CanProps {
  perm: PermissionKey;
  children: ReactNode;
  fallback?: ReactNode;
}

/**
 * Conditional Rendering basierend auf Permission. Beispiel:
 *
 *   <Can perm="baustellen.delete">
 *     <Button onClick={…}>Löschen</Button>
 *   </Can>
 */
export function Can({ perm, children, fallback = null }: CanProps) {
  return useHasPermission(perm) ? <>{children}</> : <>{fallback}</>;
}
