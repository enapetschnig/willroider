import { usePermissionContext } from "@/contexts/PermissionContext";
import { useAuth } from "@/contexts/AuthContext";
import type { PermissionKey } from "@/lib/permissionKeys";

/**
 * Hook für Permission-Checks. Liefert `true` wenn der eingeloggte User
 * die übergebene Permission hat.
 *
 * Wenn der PermissionContext im Fallback-Modus läuft (RPC-Fehler),
 * delegiert der Hook über bestimmte Permission-Keys an die alten
 * AuthContext-Flags (Backward-Compat in der Deploy-Übergangsphase).
 */
export function useHasPermission(key: PermissionKey): boolean {
  const { perms, fallbackActive } = usePermissionContext();
  const auth = useAuth();

  if (!fallbackActive) {
    return perms.has(key);
  }

  // Fallback-Map: ohne RPC nähern wir die wichtigsten Keys aus den
  // alten AuthContext-Flags an. Least-privilege: unbekannte Keys → false.
  switch (key) {
    case "system.manage_permissions":
    case "system.view_audit":
      return false;
    case "system.admin_panel":
    case "admin.view":
      return auth.isAdmin;
    case "stunden.freigeben_zm":
    case "stunden.freigeben_buero":
    case "stunden.bsb.bestaetigen":
      return auth.canReview;
    case "baustellen.create":
    case "baustellen.edit":
      return auth.canCreateBaustelle;
    case "stunden.view_eigene":
    case "stunden.create_eigene":
    case "konten.view_eigene":
    case "meintag.view":
    case "dashboard.view":
      return true;
    default:
      return auth.isAdmin;
  }
}
