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
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <div className="max-w-md text-center space-y-4">
          <h2 className="text-xl font-semibold">Konto nicht freigeschaltet</h2>
          <p className="text-sm text-muted-foreground">
            Ihr Konto wartet auf die Freischaltung durch einen Administrator. Bitte kontaktieren Sie
            das Büro.
          </p>
          <a href="/auth" className="text-primary text-sm hover:underline">
            Zur Anmeldung
          </a>
        </div>
      </div>
    );
  }

  return (
    <EvaluierungSignatureGate>
      <AppShell>
        <Outlet />
      </AppShell>
    </EvaluierungSignatureGate>
  );
}
