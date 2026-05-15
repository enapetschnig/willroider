import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { AppShell } from "./AppShell";
import { EvaluierungSignatureGate } from "./EvaluierungSignatureGate";

export function ProtectedRoute() {
  const { loading, user, profile } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center space-y-3">
          <div className="h-10 w-10 mx-auto rounded-full border-2 border-primary border-t-transparent animate-spin" />
          <p className="text-sm text-muted-foreground">Lädt…</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/auth" replace state={{ from: location }} />;
  }

  if (profile && !profile.is_active) {
    return <Navigate to="/registriert" replace />;
  }

  return (
    <EvaluierungSignatureGate>
      <AppShell>
        <Outlet />
      </AppShell>
    </EvaluierungSignatureGate>
  );
}
