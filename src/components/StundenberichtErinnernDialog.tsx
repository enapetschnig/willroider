/**
 * Mitarbeiter an die Unterschrift des Baustellenstundenberichts erinnern
 * (Wunsch J. Maurer, 22.10.2026: „die Möglichkeit, den Mitarbeiter mit einer
 * Nachricht nochmals zu erinnern").
 *
 * Eine Nachricht je Person — auch wenn mehrere Berichte offen sind; der Link
 * führt zum ältesten. Versand über push-senden: Push aufs Handy, ohne Push
 * per SMS, sonst per Mail. Protokoll in benachrichtigungen_log
 * (art „bsb_erinnerung").
 */
import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { pruefeEdgeAntwort } from "@/lib/edgeError";
import { BellRing, Loader2 } from "lucide-react";

export type ErinnerBericht = {
  id: string;
  mitarbeiter_id: string;
  jahr: number;
  monat: number;
  teil: number;
  mitarbeiter?: { vorname?: string | null; nachname?: string | null } | null;
};

const MONATE_KURZ = ["Jän.", "Feb.", "März", "Apr.", "Mai", "Juni", "Juli", "Aug.", "Sep.", "Okt.", "Nov.", "Dez."];
const periodeKurz = (b: ErinnerBericht) => `${MONATE_KURZ[b.monat - 1]} ${b.jahr} Teil ${b.teil === 1 ? "I" : "II"}`;
const KANAL: Record<string, string> = {
  push: "Push",
  sms: "SMS",
  mail: "Mail",
  keiner: "nicht erreichbar",
  fehler: "Fehler beim Senden",
};

/** Wann wurde wer zuletzt an die Unterschrift erinnert (Cron oder von Hand)? */
export function useLetzteErinnerung(mitarbeiterIds: string[]) {
  const [map, setMap] = useState<Record<string, string>>({});
  const key = [...new Set(mitarbeiterIds)].sort().join(",");
  useEffect(() => {
    if (!key) return;
    let aktiv = true;
    void (supabase as any)
      .from("benachrichtigungen_log")
      .select("user_id, gesendet_am")
      .in("art", ["bsb_unterschrift", "bsb_erinnerung"])
      .neq("kanal", "keiner")
      .in("user_id", key.split(","))
      .order("gesendet_am", { ascending: false })
      .then(({ data }: { data: { user_id: string; gesendet_am: string }[] | null }) => {
        if (!aktiv) return;
        const m: Record<string, string> = {};
        for (const r of data ?? []) if (!m[r.user_id]) m[r.user_id] = r.gesendet_am;
        setMap(m);
      });
    return () => {
      aktiv = false;
    };
  }, [key]);
  return {
    letzte: map,
    vermerken: (ids: string[]) =>
      setMap((m) => {
        const n = { ...m };
        const jetzt = new Date().toISOString();
        ids.forEach((id) => (n[id] = jetzt));
        return n;
      }),
  };
}

export function StundenberichtErinnernDialog({
  open,
  onOpenChange,
  berichte,
  onGesendet,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** Offene Berichte (Status „offen") — werden je Person zusammengefasst. */
  berichte: ErinnerBericht[];
  onGesendet?: (mitarbeiterIds: string[]) => void;
}) {
  const { toast } = useToast();
  const [zusatz, setZusatz] = useState("");
  const [sende, setSende] = useState(false);
  const [ergebnis, setErgebnis] = useState<{ name: string; kanal: string }[] | null>(null);

  useEffect(() => {
    if (open) {
      setZusatz("");
      setErgebnis(null);
    }
  }, [open]);

  /** Je Person: Name + Berichte (älteste zuerst). */
  const personen = useMemo(() => {
    const m = new Map<string, { name: string; berichte: ErinnerBericht[] }>();
    for (const b of berichte) {
      const e = m.get(b.mitarbeiter_id) ?? {
        name: `${b.mitarbeiter?.vorname ?? ""} ${b.mitarbeiter?.nachname ?? ""}`.trim() || "—",
        berichte: [],
      };
      e.berichte.push(b);
      m.set(b.mitarbeiter_id, e);
    }
    for (const e of m.values())
      e.berichte.sort((a, c) => a.jahr - c.jahr || a.monat - c.monat || a.teil - c.teil);
    return [...m.entries()].sort((a, c) => a[1].name.localeCompare(c[1].name, "de-AT"));
  }, [berichte]);

  const textFuer = (bs: ErinnerBericht[]) =>
    (bs.length === 1
      ? `Bitte unterschreib deinen Baustellenstundenbericht ${periodeKurz(bs[0])} in der App.`
      : `Bitte unterschreib deine Baustellenstundenberichte ${bs.map(periodeKurz).join(", ")} in der App.`) +
    (zusatz.trim() ? `\n${zusatz.trim()}` : "");

  const senden = async () => {
    setSende(true);
    const aus: { name: string; kanal: string }[] = [];
    const erreicht: string[] = [];
    let ersterFehler = "";
    try {
      // In kleinen Gruppen parallel — bei 30 Personen sonst eine halbe Minute.
      for (let i = 0; i < personen.length; i += 5) {
        await Promise.all(
          personen.slice(i, i + 5).map(async ([maId, p]) => {
            try {
              const r = await pruefeEdgeAntwort<{ ergebnis?: Record<string, { kanal: string }> }>(
                await supabase.functions.invoke("push-senden", {
                  body: {
                    user_ids: [maId],
                    titel: "Stundenbericht unterschreiben",
                    text: textFuer(p.berichte),
                    url: `/stundenbericht/${p.berichte[0].id}`,
                    art: "bsb_erinnerung",
                    bezug: p.berichte[0].id,
                    sms_ersatz: true,
                    mail_ersatz: true,
                  },
                }),
              );
              const kanal = r?.ergebnis?.[maId]?.kanal ?? "keiner";
              aus.push({ name: p.name, kanal });
              if (kanal !== "keiner") erreicht.push(maId);
            } catch (e) {
              ersterFehler ||= (e as Error).message;
              aus.push({ name: p.name, kanal: "fehler" });
            }
          }),
        );
      }
      aus.sort((a, c) => a.name.localeCompare(c.name, "de-AT"));
      setErgebnis(aus);
      onGesendet?.(erreicht);
      toast({
        variant: ersterFehler && erreicht.length === 0 ? "destructive" : undefined,
        title: `${erreicht.length} von ${personen.length} erinnert`,
        description: ersterFehler || (erreicht.length < personen.length ? "Nicht erreichbar: siehe Liste im Fenster." : undefined),
      });
    } finally {
      setSende(false);
    }
  };

  const beispiel = personen[0]?.[1];

  return (
    <Dialog open={open} onOpenChange={(o) => !sende && onOpenChange(o)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {personen.length === 1 ? `${personen[0][1].name} erinnern` : `${personen.length} Mitarbeiter erinnern`}
          </DialogTitle>
        </DialogHeader>

        {ergebnis ? (
          <div className="space-y-1 max-h-[50vh] overflow-y-auto text-sm">
            {ergebnis.map((e) => (
              <div key={e.name} className="flex items-center justify-between gap-2">
                <span>{e.name}</span>
                <span className={e.kanal === "keiner" || e.kanal === "fehler" ? "text-destructive font-medium" : "text-muted-foreground"}>
                  {KANAL[e.kanal] ?? e.kanal}
                </span>
              </div>
            ))}
            {ergebnis.some((e) => e.kanal === "keiner") && (
              <p className="text-[11px] text-muted-foreground pt-2">
                „Nicht erreichbar“: kein Handy mit Benachrichtigungen, keine Telefonnummer und keine
                Mail-Adresse — bitte direkt ansprechen.
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {personen.length > 1 && (
              <div className="text-xs text-muted-foreground max-h-24 overflow-y-auto">
                {personen.map(([, p]) => p.name).join(", ")}
              </div>
            )}
            {beispiel && (
              <div className="rounded-md border bg-muted/40 p-2.5 text-sm whitespace-pre-line">
                <div className="font-semibold">Stundenbericht unterschreiben</div>
                {textFuer(beispiel.berichte)}
              </div>
            )}
            <div className="space-y-1.5">
              <Label className="text-xs">Eigener Zusatz (optional)</Label>
              <Textarea
                rows={2}
                value={zusatz}
                onChange={(e) => setZusatz(e.target.value)}
                placeholder="z. B. Bitte bis Freitag, sonst kann die Lohnabrechnung nicht raus."
              />
            </div>
            <p className="text-[11px] text-muted-foreground">
              Geht als Push-Nachricht aufs Handy. Wer keine Benachrichtigungen eingeschaltet hat,
              bekommt eine SMS, ohne Telefonnummer eine Mail.
            </p>
          </div>
        )}

        <DialogFooter>
          {ergebnis ? (
            <Button onClick={() => onOpenChange(false)}>Schließen</Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={sende}>
                Abbrechen
              </Button>
              <Button onClick={senden} disabled={sende || personen.length === 0}>
                {sende ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <BellRing className="h-4 w-4 mr-1.5" />}
                Erinnerung senden
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
