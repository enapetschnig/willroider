/**
 * Tablet-Modus: Der Polier (oder Bauleiter) lässt die Mannschaft nacheinander
 * an seinem Gerät unterschreiben.
 *
 * Ablauf je Person: Name antippen → Unterweisung lesen (bis unten scrollen)
 * → „Gelesen und verstanden" → Unterschrift → gespeichert über die
 * Datenbank-Funktion `unterweisung_bestaetigen` mit p_ueber = 'tablet'.
 * Die Funktion prüft serverseitig, dass der Angemeldete Polier/Bauleiter
 * dieser Baustelle ist, und setzt Zeitstempel + Erfasser selbst.
 */
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { UnterschriftDialog } from "@/components/UnterschriftDialog";
import { UnterweisungInhalt } from "@/components/EvaluierungSignatureGate";
import { CheckCircle2, ChevronLeft, Clock, Loader2, PenLine, X } from "lucide-react";
import type { EvaluierungTyp, Json } from "@/integrations/supabase/types";

type Zeile = {
  id: string;
  mitarbeiter_id: string;
  vorname: string;
  nachname: string;
  status: string;
  faellig_am: string | null;
  unterschrieben_am: string | null;
  heuteEingeteilt: boolean;
};

type Unterweisung = {
  typ: EvaluierungTyp;
  checkliste: Json;
  notizen: string | null;
  datum: string;
};

const uhr = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString("de-AT", { hour: "2-digit", minute: "2-digit" }) : "";

export function UnterweisungTablet({
  open,
  onClose,
  baustelleId,
  baustelleName,
  kostenstelle,
  evaluierungId,
}: {
  open: boolean;
  onClose: () => void;
  baustelleId: string;
  baustelleName: string;
  kostenstelle: string | null;
  evaluierungId: string;
}) {
  const { toast } = useToast();
  const [zeilen, setZeilen] = useState<Zeile[]>([]);
  const [unterweisung, setUnterweisung] = useState<Unterweisung | null>(null);
  const [laden, setLaden] = useState(false);
  const [aktiv, setAktiv] = useState<Zeile | null>(null);
  const [untenAngekommen, setUntenAngekommen] = useState(false);
  const [signatur, setSignatur] = useState(false);
  const [speichert, setSpeichert] = useState(false);

  const load = useCallback(async () => {
    setLaden(true);
    const heute = new Date();
    const heuteIso = [
      heute.getFullYear(),
      String(heute.getMonth() + 1).padStart(2, "0"),
      String(heute.getDate()).padStart(2, "0"),
    ].join("-");
    const [ev, us, ein] = await Promise.all([
      supabase
        .from("evaluierungen")
        .select("typ, checkliste, notizen, datum")
        .eq("id", evaluierungId)
        .maybeSingle(),
      supabase
        .from("evaluierung_unterschriften")
        .select("id, mitarbeiter_id, status, faellig_am, unterschrieben_am, profiles!evaluierung_unterschriften_mitarbeiter_id_fkey(vorname, nachname)")
        .eq("evaluierung_id", evaluierungId),
      supabase
        .from("einteilungen")
        .select("einteilung_mitarbeiter(mitarbeiter_id, abwesend)")
        .eq("baustelle_id", baustelleId)
        .eq("datum", heuteIso),
    ]);
    setUnterweisung((ev.data as Unterweisung) ?? null);
    const heuteDa = new Set<string>();
    for (const e of (ein.data as any[]) ?? []) {
      for (const em of e.einteilung_mitarbeiter ?? []) {
        if (!em.abwesend) heuteDa.add(em.mitarbeiter_id);
      }
    }
    const list: Zeile[] = ((us.data as any[]) ?? []).map((u) => ({
      id: u.id,
      mitarbeiter_id: u.mitarbeiter_id,
      vorname: u.profiles?.vorname ?? "?",
      nachname: u.profiles?.nachname ?? "",
      status: u.status,
      faellig_am: u.faellig_am,
      unterschrieben_am: u.unterschrieben_am,
      heuteEingeteilt: heuteDa.has(u.mitarbeiter_id),
    }));
    // Offene zuerst, darin heute Eingeteilte oben; dann alphabetisch.
    list.sort((a, b) => {
      const ao = a.status === "offen" ? 0 : 1;
      const bo = b.status === "offen" ? 0 : 1;
      if (ao !== bo) return ao - bo;
      if (a.heuteEingeteilt !== b.heuteEingeteilt) return a.heuteEingeteilt ? -1 : 1;
      return `${a.nachname} ${a.vorname}`.localeCompare(`${b.nachname} ${b.vorname}`, "de");
    });
    setZeilen(list);
    setLaden(false);
  }, [evaluierungId, baustelleId]);

  useEffect(() => {
    if (open) {
      setAktiv(null);
      void load();
    }
  }, [open, load]);

  const speichern = async (dataUrl: string) => {
    if (!aktiv) return;
    setSpeichert(true);
    const { error } = await (supabase as any).rpc("unterweisung_bestaetigen", {
      p_unterschrift_id: aktiv.id,
      p_unterschrift_data: dataUrl,
      p_ueber: "tablet",
    });
    setSpeichert(false);
    setSignatur(false);
    if (error) {
      toast({ variant: "destructive", title: "Nicht gespeichert", description: error.message });
      return;
    }
    toast({
      title: `${aktiv.vorname} ${aktiv.nachname} hat bestätigt`,
      description: `Am Tablet erfasst, ${new Date().toLocaleTimeString("de-AT", { hour: "2-digit", minute: "2-digit" })} Uhr.`,
    });
    setAktiv(null);
    setUntenAngekommen(false);
    void load();
  };

  if (!open) return null;

  const offen = zeilen.filter((z) => z.status === "offen");
  const erledigt = zeilen.filter((z) => z.status !== "offen");

  return (
    <div
      className="fixed inset-0 z-50 bg-background flex flex-col"
      style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}
    >
      <div className="bg-primary text-primary-foreground px-4 py-3 flex items-center gap-3">
        {aktiv ? (
          <button
            type="button"
            onClick={() => {
              setAktiv(null);
              setUntenAngekommen(false);
            }}
            className="shrink-0 -ml-1 p-1 rounded hover:bg-primary/80"
            aria-label="Zurück zur Liste"
          >
            <ChevronLeft className="h-6 w-6" />
          </button>
        ) : (
          <PenLine className="h-5 w-5 shrink-0" />
        )}
        <div className="flex-1 min-w-0">
          <div className="font-bold text-base truncate">
            {aktiv ? `${aktiv.vorname} ${aktiv.nachname}` : "Unterweisung am Tablet"}
          </div>
          <div className="text-xs opacity-90 truncate">
            {baustelleName}
            {kostenstelle ? ` · ${kostenstelle}` : ""}
            {!aktiv && ` · ${offen.length} offen`}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 p-1 rounded hover:bg-primary/80"
          aria-label="Schließen"
        >
          <X className="h-6 w-6" />
        </button>
      </div>

      {!aktiv ? (
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          <div className="text-sm text-muted-foreground">
            Gerät dem Mitarbeiter geben. Er tippt seinen Namen, liest die Unterweisung und
            unterschreibt. Dann der Nächste.
          </div>
          {laden && zeilen.length === 0 && (
            <div className="text-center text-sm text-muted-foreground py-8">
              <Loader2 className="h-4 w-4 inline mr-2 animate-spin" />
              Lade …
            </div>
          )}
          {!laden && zeilen.length === 0 && (
            <Card>
              <CardContent className="p-6 text-center text-sm text-muted-foreground">
                Niemand zugeteilt. Die Zuteilung passiert automatisch über den Tagesplan.
              </CardContent>
            </Card>
          )}
          {offen.map((z) => (
            <button
              key={z.id}
              type="button"
              onClick={() => setAktiv(z)}
              className="w-full text-left rounded-lg border-2 border-primary/30 bg-card p-4 flex items-center gap-3 active:bg-muted"
            >
              <div className="flex-1 min-w-0">
                <div className="text-lg font-semibold">
                  {z.vorname} {z.nachname}
                </div>
                <div className="text-xs text-muted-foreground flex items-center gap-1.5">
                  {z.heuteEingeteilt && (
                    <span className="px-1.5 py-0.5 rounded bg-primary/10 text-primary font-medium">
                      heute eingeteilt
                    </span>
                  )}
                  {z.faellig_am && (
                    <span className="inline-flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {new Date(z.faellig_am).getTime() <= Date.now()
                        ? `überfällig seit ${uhr(z.faellig_am)}`
                        : `fällig ${uhr(z.faellig_am)}`}
                    </span>
                  )}
                </div>
              </div>
              <PenLine className="h-6 w-6 text-primary shrink-0" />
            </button>
          ))}
          {erledigt.length > 0 && (
            <div className="pt-2">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1.5">
                Bereits bestätigt
              </div>
              <div className="space-y-1.5">
                {erledigt.map((z) => (
                  <div
                    key={z.id}
                    className="rounded-md border bg-muted/40 px-3 py-2 flex items-center gap-2 text-sm"
                  >
                    <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                    <span className="flex-1">
                      {z.vorname} {z.nachname}
                    </span>
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {z.unterschrieben_am
                        ? new Date(z.unterschrieben_am).toLocaleString("de-AT", {
                            day: "2-digit",
                            month: "2-digit",
                            hour: "2-digit",
                            minute: "2-digit",
                          })
                        : ""}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : (
        <>
          <div
            className="flex-1 overflow-y-auto p-4 space-y-3"
            onScroll={(e) => {
              const el = e.currentTarget;
              if (el.scrollHeight - el.scrollTop - el.clientHeight < 30) setUntenAngekommen(true);
            }}
            style={{ WebkitOverflowScrolling: "touch" }}
          >
            <Card className="border-2 border-primary/30 bg-primary/5">
              <CardContent className="p-3 text-sm">
                <strong>
                  {aktiv.vorname} {aktiv.nachname}
                </strong>
                , bitte lies die Unterweisung bis zum Ende. Danach bestätigst du mit deiner
                Unterschrift, dass du sie gelesen und verstanden hast.
              </CardContent>
            </Card>
            {unterweisung && (
              <UnterweisungInhalt
                typ={unterweisung.typ}
                checkliste={unterweisung.checkliste}
                notizen={unterweisung.notizen}
                baustelleName={baustelleName}
                kostenstelle={kostenstelle}
                datum={unterweisung.datum}
              />
            )}
            {!untenAngekommen && (
              <div className="text-center text-[11px] text-muted-foreground italic pb-2">
                ↓ bis ans Ende scrollen
              </div>
            )}
          </div>
          <div
            className="border-t bg-card p-3"
            style={{ paddingBottom: "max(env(safe-area-inset-bottom, 0px), 12px)" }}
          >
            <Button
              className="w-full h-12 text-base"
              disabled={!untenAngekommen || speichert}
              onClick={() => setSignatur(true)}
            >
              <CheckCircle2 className="h-5 w-5 mr-2" />
              Gelesen und verstanden — unterschreiben
            </Button>
          </div>
          <UnterschriftDialog
            open={signatur}
            onOpenChange={(v) => !v && setSignatur(false)}
            onSave={speichern}
            busy={speichert}
            titel={`Unterschrift ${aktiv.vorname} ${aktiv.nachname}`}
          />
        </>
      )}
    </div>
  );
}
