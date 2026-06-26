import { useAuth } from "@/contexts/AuthContext";
import type { PermissionKey } from "@/lib/permissionKeys";

/**
 * Hook für Permission-Checks. Delegiert an AuthContext.hasPermission.
 *
 * Beispiel:
 *   const canDelete = useHasPermission('baustellen.delete');
 */
export function useHasPermission(key: PermissionKey): boolean {
  return useAuth().hasPermission(key);
}
