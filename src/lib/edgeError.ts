/**
 * Echte Fehlermeldung einer fehlgeschlagenen Edge Function auslesen.
 *
 * supabase.functions.invoke wirft bei 4xx/5xx einen FunctionsHttpError,
 * dessen message FEST "Edge Function returned a non-2xx status code" lautet
 * — die sorgfältig formulierten Fehlertexte der Functions (z.B.
 * „Telefonnummer schon vergeben") erreichten den Nutzer damit NIE. Der
 * echte Text steckt im JSON-Body unter error.context.
 *
 * Zusätzlich behandeln die Functions Teilfehler oft als HTTP 200 mit
 * { ok:false, error }. `pruefeEdgeAntwort` deckt beide Fälle ab.
 */

export async function edgeFunctionErrorMessage(error: unknown): Promise<string> {
  const err = error as { message?: string; context?: Response };
  try {
    if (err?.context && typeof err.context.json === "function") {
      const body = await err.context.json();
      if (body?.error) return String(body.error);
    }
  } catch {
    // Body kein JSON / nicht lesbar → Fallback unten
  }
  return err?.message ?? "Unbekannter Fehler";
}

/**
 * Wertet das Ergebnis von supabase.functions.invoke einheitlich aus und
 * wirft im Fehlerfall mit dem ECHTEN Text — egal ob der Fehler als
 * HTTP-Status (invoke-error) oder als { ok:false } im Body kam.
 * Gibt bei Erfolg die Daten zurück.
 */
export async function pruefeEdgeAntwort<T = unknown>(res: {
  data: T | null;
  error: unknown;
}): Promise<T> {
  if (res.error) {
    throw new Error(await edgeFunctionErrorMessage(res.error));
  }
  const d = res.data as { ok?: boolean; error?: string } | null;
  if (d && d.ok === false) {
    throw new Error(d.error ?? "Unbekannter Fehler");
  }
  return res.data as T;
}
