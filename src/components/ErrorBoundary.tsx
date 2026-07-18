import { Component, type ReactNode } from "react";

/**
 * App-weiter Absturz-Fänger: Ein Laufzeitfehler führte bisher zum weißen
 * Bildschirm ohne jede Info. Jetzt: freundliche Meldung, Neu-laden-Knopf
 * und die Fehlerdetails zum Weiterschicken (Änderungswunsch/Screenshot).
 */
export class ErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    // Bewusst nur loggen — kein externer Dienst.
    console.error("App-Fehler:", error);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted/30 p-4">
        <div className="max-w-md w-full bg-card border rounded-lg shadow-sm p-6 space-y-4 text-center">
          <div className="text-4xl">😵</div>
          <h1 className="text-lg font-semibold">Hoppla — da ist etwas schiefgelaufen</h1>
          <p className="text-sm text-muted-foreground">
            Die Seite konnte nicht angezeigt werden. Bitte neu laden. Wenn es
            wieder passiert: Screenshot machen und als Änderungswunsch schicken.
          </p>
          <button
            onClick={() => window.location.reload()}
            className="w-full h-11 rounded-md bg-primary text-primary-foreground font-medium"
          >
            Seite neu laden
          </button>
          <details className="text-left">
            <summary className="text-xs text-muted-foreground cursor-pointer">
              Technische Details
            </summary>
            <pre className="mt-2 text-[10px] whitespace-pre-wrap break-all text-muted-foreground max-h-40 overflow-y-auto">
              {String(this.state.error?.stack ?? this.state.error)}
            </pre>
          </details>
        </div>
      </div>
    );
  }
}
