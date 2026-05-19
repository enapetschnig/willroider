import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { Plus, Sun, X } from "lucide-react";
import { werktagePlus, isWerktag } from "@/lib/feiertage";
import { localIso } from "@/lib/dateFmt";
import type { Database, UrlaubsantragStatus } from "@/integrations/supabase/types";

type Antrag = Database["public"]["Tables"]["urlaubsantraege"]["Row"];

function arbeitstageInRange(von: string, bis: string): number {
  let d = new Date(von + "T00:00:00");
  const ende = new Date(bis + "T00:00:00");
  let n = 0;
  while (d <= ende) {
    if (isWerktag(d)) n++;
    d.setDate(d.getDate() + 1);
  }
  return n;
}

const STATUS_BADGE: Record<UrlaubsantragStatus, { label: string; cls: string }> = {
  offen: { label: "Offen", cls: "bg-amber-100 text-amber-900 border-amber-300" },
  genehmigt: { label: "Genehmigt", cls: "bg-emerald-100 text-emerald-900 border-emerald-300" },
  abgelehnt: { label: "Abgelehnt", cls: "bg-red-100 text-red-900 border-red-300" },
  storniert: { label: "Storniert", cls: "bg-slate-100 text-slate-700 border-slate-300" },
};

export function UrlaubAntraegeCard({ userId }: { userId: string }) {
  const [eigene, setEigene] = useState<Antrag[]>([]);
  const { toast } = useToast();
  const [open, setOpen] = useState(false);

  const load = async () => {
    const { data } = await supabase
      .from("urlaubsantraege")
      .select("*")
      .eq("mitarbeiter_id", userId)
      .order("eingereicht_am", { ascending: false });
    setEigene((data as Antrag[]) ?? []);
  };

  useEffect(() => {
    load();
    const c = supabase
      .channel(`ua-${userId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "urlaubsantraege",
          filter: `mitarbeiter_id=eq.${userId}`,
        },
        load,
      )
      .subscribe();
    return () => {
      supabase.removeChannel(c);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const stornieren = async (id: string) => {
    if (!window.confirm("Antrag wirklich stornieren?")) return;
    const { error } = await supabase
      .from("urlaubsantraege")
      .update({ status: "storniert" })
      .eq("id", id);
    if (error) toast({ variant: "destructive", title: "Fehler", description: error.message });
    else toast({ title: "Storniert" });
  };

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <Sun className="h-4 w-4 text-primary" />
            <span className="text-sm font-semibold">Urlaubsanträge</span>
          </div>
          <UrlaubAntragDialog
            userId={userId}
            open={open}
            onOpenChange={setOpen}
            trigger={
              <Button size="sm" variant="outline">
                <Plus className="h-3.5 w-3.5 mr-1" /> Urlaub beantragen
              </Button>
            }
          />
        </div>
        {eigene.length === 0 ? (
          <div className="text-xs text-muted-foreground italic">Noch keine Anträge.</div>
        ) : (
          <div className="space-y-1.5">
            {eigene.slice(0, 5).map((a) => (
              <div
                key={a.id}
                className="flex items-center gap-2 text-xs bg-muted/30 rounded px-2 py-1.5"
              >
                <Badge variant="outline" className={`${STATUS_BADGE[a.status].cls} text-[10px]`}>
                  {STATUS_BADGE[a.status].label}
                </Badge>
                <span className="tabular-nums">
                  {new Date(a.von).toLocaleDateString("de-AT", {
                    day: "2-digit",
                    month: "2-digit",
                  })}{" "}
                  –{" "}
                  {new Date(a.bis).toLocaleDateString("de-AT", {
                    day: "2-digit",
                    month: "2-digit",
                  })}
                </span>
                {a.arbeitstage && (
                  <span className="text-muted-foreground">
                    ({a.arbeitstage}{" "}{Number(a.arbeitstage) === 1 ? "Tag" : "Tage"})
                  </span>
                )}
                <span className="flex-1" />
                {a.status === "offen" && (
                  <button
                    type="button"
                    onClick={() => stornieren(a.id)}
                    className="text-red-700 hover:bg-red-50 rounded p-0.5"
                    title="Stornieren"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function UrlaubAntragDialog({
  userId,
  open,
  onOpenChange,
  trigger,
}: {
  userId: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  trigger: React.ReactNode;
}) {
  const { toast } = useToast();
  const today = localIso();
  const [von, setVon] = useState(today);
  const [bis, setBis] = useState(today);
  const [kommentar, setKommentar] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setVon(today);
      setBis(today);
      setKommentar("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const tage = von && bis && bis >= von ? arbeitstageInRange(von, bis) : 0;

  const submit = async () => {
    if (!von || !bis || bis < von) {
      toast({ variant: "destructive", title: "Ungültiges Datum" });
      return;
    }
    setBusy(true);
    const { error } = await supabase.from("urlaubsantraege").insert({
      mitarbeiter_id: userId,
      von,
      bis,
      arbeitstage: tage,
      kommentar: kommentar.trim() || null,
    });
    setBusy(false);
    if (error) {
      toast({ variant: "destructive", title: "Fehler", description: error.message });
      return;
    }
    toast({ title: "Antrag eingereicht" });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Urlaub beantragen</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-sm">Von</Label>
              <Input
                type="date"
                value={von}
                onChange={(e) => setVon(e.target.value)}
                min={today}
              />
            </div>
            <div>
              <Label className="text-sm">Bis</Label>
              <Input
                type="date"
                value={bis}
                onChange={(e) => setBis(e.target.value)}
                min={von || today}
              />
            </div>
          </div>
          {tage > 0 && (
            <div className="text-xs text-muted-foreground">
              = <span className="font-medium tabular-nums">{tage}</span> Arbeitstage
              (Wochenende & Feiertage werden nicht gezählt)
            </div>
          )}
          <div>
            <Label className="text-sm">Kommentar (optional)</Label>
            <Textarea
              value={kommentar}
              onChange={(e) => setKommentar(e.target.value)}
              rows={2}
              placeholder="z.B. Familienurlaub"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Abbrechen
          </Button>
          <Button onClick={submit} disabled={busy || tage === 0}>
            {busy ? "Sende…" : "Einreichen"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Admin-Card: offene Anträge mit Genehmigen/Ablehnen-Buttons. */
export function AdminUrlaubsantraegeCard() {
  const { toast } = useToast();
  const [antraege, setAntraege] = useState<
    (Antrag & { mitarbeiter?: { vorname: string; nachname: string } | null })[]
  >([]);

  const load = async () => {
    const { data } = await supabase
      .from("urlaubsantraege")
      .select("*, mitarbeiter:profiles(vorname,nachname)")
      .eq("status", "offen")
      .order("eingereicht_am", { ascending: true });
    setAntraege((data as any) ?? []);
  };

  useEffect(() => {
    load();
    const c = supabase
      .channel("admin-ua")
      .on("postgres_changes", { event: "*", schema: "public", table: "urlaubsantraege" }, load)
      .subscribe();
    return () => {
      supabase.removeChannel(c);
    };
  }, []);

  const genehmigen = async (a: Antrag) => {
    const { data: u } = await supabase.auth.getUser();
    // 1) Antrag-Status setzen
    const { error: err1 } = await supabase
      .from("urlaubsantraege")
      .update({
        status: "genehmigt",
        entschieden_von: u.user?.id ?? null,
        entschieden_am: new Date().toISOString(),
      })
      .eq("id", a.id);
    if (err1) {
      toast({ variant: "destructive", title: "Fehler", description: err1.message });
      return;
    }
    // 2) Konto-Buchung
    if (a.arbeitstage && a.arbeitstage > 0) {
      await supabase.from("urlaubs_buchungen").insert({
        mitarbeiter_id: a.mitarbeiter_id,
        art: "urlaub_genommen",
        tage: -Math.abs(Number(a.arbeitstage)),
        wirksam_am: a.von,
        notiz: `Antrag: ${a.von} – ${a.bis}`,
        erstellt_von: u.user?.id ?? null,
      });
    }
    // 3) Pro Werktag im Range UPSERT stunden_tage.tag_status='urlaub'
    const werktageInRange: string[] = [];
    let d = new Date(a.von + "T00:00:00");
    const ende = new Date(a.bis + "T00:00:00");
    while (d <= ende) {
      if (isWerktag(d)) werktageInRange.push(localIso(d));
      d.setDate(d.getDate() + 1);
    }
    if (werktageInRange.length > 0) {
      // existierende Einträge laden, dann nur INSERT für fehlende (vermeidet duplicate-Key)
      const { data: existing } = await supabase
        .from("stunden_tage")
        .select("datum")
        .eq("mitarbeiter_id", a.mitarbeiter_id)
        .in("datum", werktageInRange);
      const existingSet = new Set((existing ?? []).map((r: any) => r.datum));
      const toInsert = werktageInRange.filter((d) => !existingSet.has(d));
      if (toInsert.length > 0) {
        await supabase.from("stunden_tage").insert(
          toInsert.map((datum) => ({
            mitarbeiter_id: a.mitarbeiter_id,
            datum,
            tag_status: "urlaub" as const,
            netto_stunden: 0,
            status: "ma_bestaetigt" as const,
          })),
        );
      }
      // Bestehende Einträge auf 'urlaub' überschreiben (nur falls status='erfasst')
      // WICHTIG: netto_stunden=0 setzen, sonst bleibt eine alte Arbeitszeit-Buchung
      // erhalten obwohl der Tag jetzt als Urlaub gilt.
      if (existing && existing.length > 0) {
        await supabase
          .from("stunden_tage")
          .update({ tag_status: "urlaub", netto_stunden: 0 })
          .eq("mitarbeiter_id", a.mitarbeiter_id)
          .in("datum", werktageInRange)
          .eq("status", "erfasst");
      }
    }
    toast({ title: "Antrag genehmigt" });
  };

  const ablehnen = async (a: Antrag) => {
    const { data: u } = await supabase.auth.getUser();
    const { error } = await supabase
      .from("urlaubsantraege")
      .update({
        status: "abgelehnt",
        entschieden_von: u.user?.id ?? null,
        entschieden_am: new Date().toISOString(),
      })
      .eq("id", a.id);
    if (error) {
      toast({ variant: "destructive", title: "Fehler", description: error.message });
      return;
    }
    toast({ title: "Antrag abgelehnt" });
  };

  if (antraege.length === 0) return null;

  return (
    <Card className="border-amber-300 bg-amber-50">
      <CardContent className="p-4 space-y-2">
        <div className="flex items-center gap-1.5 text-sm font-semibold text-amber-900">
          <Sun className="h-4 w-4" />
          {antraege.length} offene{" "}
          {antraege.length === 1 ? "Urlaubsantrag" : "Urlaubsanträge"}
        </div>
        <div className="space-y-2">
          {antraege.map((a) => (
            <div
              key={a.id}
              className="bg-background rounded-md p-2 flex items-center gap-2 flex-wrap text-sm"
            >
              <span className="font-semibold min-w-[160px]">
                {a.mitarbeiter?.nachname ?? "?"} {a.mitarbeiter?.vorname ?? ""}
              </span>
              <span className="tabular-nums">
                {new Date(a.von).toLocaleDateString("de-AT")} –{" "}
                {new Date(a.bis).toLocaleDateString("de-AT")}
              </span>
              {a.arbeitstage && (
                <span className="text-xs text-muted-foreground">
                  ({a.arbeitstage} Tage)
                </span>
              )}
              {a.kommentar && (
                <span className="text-xs italic text-muted-foreground truncate flex-1">
                  „{a.kommentar}"
                </span>
              )}
              <div className="flex gap-1 ml-auto">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  onClick={() => ablehnen(a)}
                >
                  Ablehnen
                </Button>
                <Button
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => genehmigen(a)}
                >
                  Genehmigen
                </Button>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
