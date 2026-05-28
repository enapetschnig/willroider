// Gemeinsame Konfiguration für Setup/Teardown.
// Service-Role-Key NICHT committen — der wird zur Laufzeit aus dem
// Environment gelesen (vom Skript-Aufrufer gesetzt).

export const SUPABASE_URL = "https://ylqbxnsxksbtsqrcwtuq.supabase.co";
export const SUPABASE_ANON =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlscWJ4bnN4a3NidHNxcmN3dHVxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcyODM0MDYsImV4cCI6MjA5Mjg1OTQwNn0.XvOCZVQu3WR4Qfq3yCyOfq9tw1izIplDe_k1sGZGc5s";

// Marker, mit dem JEDE Test-Erzeugung getaggt wird → einfache Cleanup-Queries.
export const TEST_PREFIX = "PWTEST";
// Eindeutige Test-User-Mail.
export const TEST_EMAIL = "playwright-test-runner@willroider-test.invalid";
export const TEST_PASSWORD = "PwTest!2026-Willroider";
export const TEST_VORNAME = "Playwright";
export const TEST_NACHNAME = "Test-Runner";

export function requireServiceKey() {
  const k = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!k) {
    console.error("SUPABASE_SERVICE_ROLE_KEY env-var fehlt.");
    process.exit(1);
  }
  return k;
}
