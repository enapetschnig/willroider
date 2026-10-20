/**
 * Reiter „Leasing Personal" in Mitarbeiter & Partien (Kundenwunsch
 * 20.10.2026): Leasing-Arbeiter sind einteilbar, einer Partie zuteilbar und
 * der Polier schreibt ihre Stunden — sie bekommen aber KEINEN Zugang zur App.
 *
 * Technisch normale Profile mit zeiterfassung_typ = 'leasing' und einer
 * Platzhalter-Adresse (admin-create-employee, leasing: true). Kein
 * Baustellenstundenbericht; die Stunden prüft das Büro in der
 * Stundenauswertung (Filter „Leasing", Summe je Leasing-Firma).
 */
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Edit, Loader2, UserPlus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { pruefeEdgeAntwort } from "@/lib/edgeError";
import type { Database } from "@/integrations/supabase/types";

type Profile = Database["public"]["Tables"]["profiles"]["Row"];
type Partie = Database["public"]["Tables"]["partien"]["Row"];

const firmaVon = (p: Profile) => ((p as any).leasing_firma as string | null) ?? "";

export function LeasingPersonalTab({
  personen,
  partien,
  darfBearbeiten,
  onPartie,
  onBearbeiten,
  onAktivUmschalten,
  onNeu,
}: {
  personen: Profile[];
  partien: Partie[];
  /** Archivieren/Wiederherstellen — nur mit „Mitarbeiter bearbeiten". */
  darfBearbeiten: boolean;
  onPartie: (id: string, partieId: string | null) => void;
  onBearbeiten: (p: Profile) => void;
  onAktivUmschalten: (p: Profile) => void;
  onNeu: () => void;
}) {
  const { toast } = useToast();
  const [zeigeArchiv, setZeigeArchiv] = useState(false);
  const [neuOffen, setNeuOffen] = useState(false);
  const [speichert, setSpeichert] = useState(false);
  const [form, setForm] = useState({ vorname: "", nachname: "", firma: "", partie: "", telefon: "" });

  const firmen = useMemo(
    () => [...new Set(personen.map(firmaVon).filter(Boolean))].sort((a, b) => a.localeCompare(b, "de")),
    [personen],
  );
  const liste = personen
    .filter((p) => !!p.is_active !== zeigeArchiv)
    .sort(
      (a, b) =>
        firmaVon(a).localeCompare(firmaVon(b), "de") ||
        `${a.nachname} ${a.vorname}`.localeCompare(`${b.nachname} ${b.vorname}`, "de"),
    );

  const anlegen = async () => {
    if (!form.vorname.trim() || !form.nachname.trim()) {
      toast({ variant: "destructive", title: "Vor- und Nachname fehlen" });
      return;
    }
    setSpeichert(true);
    try {
      await pruefeEdgeAntwort(
        await supabase.functions.invoke("admin-create-employee", {
          body: {
            leasing: true,
            vorname: form.vorname.trim(),
            nachname: form.nachname.trim(),
            leasing_firma: form.firma.trim() || null,
            partie_id: form.partie || null,
            telefon: form.telefon.trim() || undefined,
            rolle: "mitarbeiter",
            invite_kanal: "keine",
          },
        }),
      );
      toast({
        title: `${form.vorname.trim()} ${form.nachname.trim()} angelegt`,
        description: "Leasing Personal — ohne Zugang zur App, einteilbar und für den Polier zum Stundenschreiben.",
      });
      setForm({ vorname: "", nachname: "", firma: "", partie: "", telefon: "" });
      setNeuOffen(false);
      onNeu();
    } catch (e) {
      toast({ variant: "destructive", title: "Nicht angelegt", description: (e as Error).message });
    } finally {
      setSpeichert(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Button variant={!zeigeArchiv ? "default" : "outline"} size="sm" onClick={() => setZeigeArchiv(false)}>
              Aktive ({personen.filter((p) => p.is_active).length})
            </Button>
            <Button variant={zeigeArchiv ? "default" : "outline"} size="sm" onClick={() => setZeigeArchiv(true)}>
              Archiv ({personen.filter((p) => !p.is_active).length})
            </Button>
          </div>
          <p className="text-xs text-muted-foreground max-w-xl">
            Leasing Personal hat keinen Zugang zur App. Es ist in der Tages- und Arbeitsplanung
            einteilbar, einer Partie zuteilbar, und der Polier schreibt die Stunden. Es gibt keinen
            Stundenbericht — die Stunden stehen in der Stundenauswertung unter „Leasing“.
          </p>
        </div>
        <Button size="sm" onClick={() => setNeuOffen(true)}>
          <UserPlus className="h-4 w-4 mr-1.5" />
          Neues Leasing Personal
        </Button>
      </div>

      <Card>
        <CardContent className="p-0 divide-y">
          {liste.length === 0 && (
            <div className="p-4 text-sm text-muted-foreground italic">
              {zeigeArchiv ? "Archiv ist leer." : "Noch kein Leasing Personal angelegt."}
            </div>
          )}
          {liste.map((p) => (
            <div key={p.id} className="flex items-center gap-2 p-3 flex-wrap">
              <div className="min-w-0 flex-1">
                <div className="font-medium text-sm">
                  {p.nachname} {p.vorname}
                </div>
                <div className="text-xs text-muted-foreground">
                  {firmaVon(p) || "ohne Leasing-Firma"}
                  {p.telefon ? ` · ${p.telefon}` : ""}
                </div>
              </div>
              <Badge variant="outline" className="text-[10px]">Leasing</Badge>
              <select
                value={p.partie_id ?? ""}
                onChange={(e) => onPartie(p.id, e.target.value || null)}
                className="h-9 text-xs rounded-md border bg-background px-2 w-44"
                aria-label="Partie"
              >
                <option value="">— keine Partie —</option>
                {partien.map((pa) => (
                  <option key={pa.id} value={pa.id}>
                    {pa.name}
                  </option>
                ))}
              </select>
              <Button size="sm" variant="ghost" className="h-9 w-9 p-0" onClick={() => onBearbeiten(p)} aria-label="Bearbeiten">
                <Edit className="h-4 w-4" />
              </Button>
              {darfBearbeiten && (
                <Button size="sm" variant="outline" className="h-9" onClick={() => onAktivUmschalten(p)}>
                  {p.is_active ? "Archivieren" : "Wiederherstellen"}
                </Button>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      <Dialog open={neuOffen} onOpenChange={(o) => !speichert && setNeuOffen(o)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Neues Leasing Personal</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Vorname *</Label>
                <Input value={form.vorname} onChange={(e) => setForm({ ...form, vorname: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Nachname *</Label>
                <Input value={form.nachname} onChange={(e) => setForm({ ...form, nachname: e.target.value })} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Leasing-Firma (optional)</Label>
              <Input
                list="leasing-firmen"
                value={form.firma}
                onChange={(e) => setForm({ ...form, firma: e.target.value })}
                placeholder="z. B. Trenkwalder"
              />
              <datalist id="leasing-firmen">
                {firmen.map((f) => (
                  <option key={f} value={f} />
                ))}
              </datalist>
            </div>
            <div className="space-y-1.5">
              <Label>Partie (optional)</Label>
              <select
                value={form.partie}
                onChange={(e) => setForm({ ...form, partie: e.target.value })}
                className="h-10 w-full text-sm rounded-md border bg-background px-2"
              >
                <option value="">— keine Partie —</option>
                {partien.map((pa) => (
                  <option key={pa.id} value={pa.id}>
                    {pa.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label>Telefon (optional, nur zur Info)</Label>
              <Input
                inputMode="tel"
                value={form.telefon}
                onChange={(e) => setForm({ ...form, telefon: e.target.value })}
                placeholder="0664 …"
              />
              <p className="text-[11px] text-muted-foreground">
                Wird nur angezeigt — damit kann man sich nicht in der App anmelden.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNeuOffen(false)} disabled={speichert}>
              Abbrechen
            </Button>
            <Button onClick={anlegen} disabled={speichert}>
              {speichert && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
              Anlegen
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
