/**
 * Bausatz-Kalkulator — eigenständiges Holzbau-Kalkulationstool von
 * Holzbau Willroider, eingebunden als iframe. Sichtbar nur für die
 * Geschäftsführung.
 *
 * Auto-Login: der iframe-Aufruf packt name + role als Query-Param mit,
 * damit das HTML direkt im Admin-Modus startet (kein zweiter Login mit
 * KUNDE-2026/MA-2026/ADMIN-2026 mehr nötig). Die K3-Sätze und der
 * Anfragen-Versand laufen über die Edge-Function kalkulator-bridge in
 * die App-Datenbank.
 */

import { PageHeader } from "@/components/PageHeader";
import { useAuth } from "@/contexts/AuthContext";
import { useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";

export default function Kalkulator() {
  const { profile } = useAuth();
  const navigate = useNavigate();

  const src = useMemo(() => {
    if (!profile) return "/bausatz-kalkulator.html";
    const name = `${profile.vorname ?? ""} ${profile.nachname ?? ""}`.trim() ||
      profile.email ||
      "Geschäftsführung";
    const params = new URLSearchParams({ name, role: "admin" });
    return `/bausatz-kalkulator.html?${params.toString()}`;
  }, [profile]);

  // Auf Logout-Klick im iframe reagieren — zurück aufs Dashboard
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.data && typeof e.data === "object" && e.data.type === "kalkulator:logout") {
        navigate("/");
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [navigate]);

  return (
    <div className="space-y-3">
      <PageHeader
        title="Bausatz-Kalkulator"
        description="Holzbau Willroider — Zimmermeisterarbeiten · K3/K7-Preisermittlung nach ÖNORM B2061"
      />
      <div className="rounded-md border bg-card overflow-hidden shadow-sm">
        <iframe
          src={src}
          title="Bausatz-Kalkulator"
          className="w-full"
          // sandbox: erlaubt Skripte + Forms + same-origin (für fetch/localStorage),
          // verbietet aber Top-Level-Navigation und Popups — Defense-in-Depth.
          sandbox="allow-same-origin allow-scripts allow-forms allow-modals allow-downloads"
          style={{ height: "calc(100vh - 200px)", minHeight: 600, border: 0 }}
        />
      </div>
    </div>
  );
}
