import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
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
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { Hourglass, Trash2, Plus } from "lucide-react";
import type { Database, ZaBuchungArt } from "@/integrations/supabase/types";
import { fmtStunden, ZA_ART_LABEL } from "@/lib/konten";
import { localIso } from "@/lib/dateFmt";

type Profile = Database["public"]["Tables"]["profiles"]["Row"];
type ZaBuchung = Database["public"]["Tables"]["za_buchungen"]["Row"];

export function AdminZaKonten() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [salden, setSalden] = useState<Record<string, number>>({});
  const [letzte, setLetzte] = useState<Record<string, string | null>>({});
  const [selected, setSelected] = useState<Profile | null>(null);
  const [buchungen, setBuchungen] = useState<ZaBuchung[]>([]);
  const [newBuchungOpen, setNewBuchungOpen] = useState(false);

  const load = async () => {
    const [{ data: ps }, { data: sal }] = await Promise.all([
      supabase.from("profiles").select("*").eq("is_active", true).order("nachname"),
      supabase.from("v_za_saldo" as any).select("*"),
    ]);
    setProfiles((ps as Profile[]) ?? []);
    const s: Record<string, number> = {};
    const l: Record<string, string | null> = {};
    ((sal as any[]) ?? []).forEach((r) => {
      s[r.mitarbeiter_id] = Number(r.saldo_stunden ?? 0);
      l[r.mitarbeiter_id] = r.letzte_buchung;
    });
    setSalden(s);
    setLetzte(l);
  };

  useEffect(() => {
    load();
  }, []);

  const loadBuchungen = async (uid: string) => {
    const { data } = await supabase
      .from("za_buchungen")
      .select("*")
      .eq("mitarbeiter_id", uid)
      .order("wirksam_am", { ascending: false })
      .limit(200);
    setBuchungen((data as ZaBuchung[]) ?? []);
  };

  const openDetail = (p: Profile) => {
    setSelected(p);
    loadBuchungen(p.id);
  };

  return (
    <div className="space-y-3">
      <Card>
        <CardContent className="p-3 flex items-center gap-2 flex-wrap">
          <Hourglass className="h-4 w-4 text-sky-500" />
          <span className="text-sm font-semibold">ZA-Konten (Zeitausgleich)</span>
          <span className="text-xs text-muted-foreground">
            {profiles.length} aktive Mitarbeiter
          </span>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="bg-muted text-xs">
              <tr>
                <th className="text-left px-3 py-2">Mitarbeiter</th>
                <th className="text-right px-3 py-2">Saldo</th>
                <th className="text-left px-3 py-2 hidden sm:table-cell">
                  Letzte Buchung
                </th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {profiles.map((p) => {
                const sal = salden[p.id] ?? 0;
                const lb = letzte[p.id];
                return (
                  <tr
                    key={p.id}
                    className="border-t hover:bg-muted/30 cursor-pointer"
                    onClick={() => openDetail(p)}
                  >
                    <td className="px-3 py-2">
                      <div className="font-medium">
                        {p.vorname} {p.nachname}
                      </div>
                      {p.pers_nr && (
                        <div className="text-[10px] text-muted-foreground">
                          {p.pers_nr}
                        </div>
                      )}
                    </td>
                    <td
                      className={`px-3 py-2 text-right font-bold tabular-nums ${
                        sal < 0 ? "text-red-700" : sal > 0 ? "text-emerald-700" : ""
                      }`}
                    >
                      {fmtStunden(sal)}
                    </td>
                    <td className="px-3 py-2 hidden sm:table-cell text-xs text-muted-foreground">
                      {lb ? new Date(lb).toLocaleDateString("de-AT") : "—"}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Button variant="outline" size="sm">
                        Verlauf
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col p-0">
          <DialogHeader className="px-4 pt-4 pb-2">
            <DialogTitle>
              ZA-Konto: {selected?.vorname} {selected?.nachname}
            </DialogTitle>
            <div className="text-sm text-muted-foreground">
              Aktueller Saldo:{" "}
              <strong className="text-foreground">
                {fmtStunden(selected ? salden[selected.id] ?? 0 : 0)}
              </strong>
            </div>
          </DialogHeader>
          <div className="px-4 pb-2">
            <Button onClick={() => setNewBuchungOpen(true)} size="sm">
              <Plus className="h-4 w-4 mr-1" />
              Manuelle Buchung
            </Button>
          </div>
          <div className="flex-1 overflow-y-auto px-4 pb-4">
            <table className="w-full text-xs">
              <thead className="bg-muted">
                <tr>
                  <th className="text-left px-2 py-1">Datum</th>
                  <th className="text-left px-2 py-1">Art</th>
                  <th className="text-left px-2 py-1">Monat</th>
                  <th className="text-right px-2 py-1">Stunden</th>
                  <th className="text-left px-2 py-1">Notiz</th>
                  <th className="px-2 py-1"></th>
                </tr>
              </thead>
              <tbody>
                {buchungen.map((b) => (
                  <tr key={b.id} className="border-t">
                    <td className="px-2 py-1 tabular-nums">
                      {new Date(b.wirksam_am).toLocaleDateString("de-AT")}
                    </td>
                    <td className="px-2 py-1">{ZA_ART_LABEL[b.art] ?? b.art}</td>
                    <td className="px-2 py-1 text-muted-foreground">{b.monat ?? "—"}</td>
                    <td
                      className={`px-2 py-1 text-right tabular-nums font-semibold ${
                        Number(b.stunden) < 0 ? "text-red-700" : "text-emerald-700"
                      }`}
                    >
                      {Number(b.stunden) > 0 ? "+" : ""}
                      {Number(b.stunden).toFixed(2).replace(".", ",")}
                    </td>
                    <td className="px-2 py-1 text-muted-foreground">
                      {b.notiz ?? ""}
                    </td>
                    <td className="px-2 py-1 text-right">
                      {b.art !== "monatsabschluss" && (
                        <button
                          onClick={async () => {
                            if (!confirm("Buchung löschen?")) return;
                            await supabase
                              .from("za_buchungen")
                              .delete()
                              .eq("id", b.id);
                            if (selected) loadBuchungen(selected.id);
                            load();
                          }}
                          title="Löschen"
                          className="text-muted-foreground hover:text-destructive"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {buchungen.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-2 py-4 text-center text-muted-foreground">
                      Noch keine Buchungen.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </DialogContent>
      </Dialog>

      <NewZaBuchungDialog
        open={newBuchungOpen}
        onOpenChange={setNewBuchungOpen}
        profile={selected}
        onSaved={() => {
          setNewBuchungOpen(false);
          if (selected) loadBuchungen(selected.id);
          load();
        }}
      />
    </div>
  );
}

function NewZaBuchungDialog({
  open,
  onOpenChange,
  profile,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (b: boolean) => void;
  profile: Profile | null;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [art, setArt] = useState<ZaBuchungArt>("korrektur");
  const [stunden, setStunden] = useState<string>("");
  const [datum, setDatum] = useState<string>(localIso());
  const [notiz, setNotiz] = useState<string>("");

  useEffect(() => {
    if (open) {
      setArt("korrektur");
      setStunden("");
      setDatum(localIso());
      setNotiz("");
    }
  }, [open]);

  const save = async () => {
    if (!profile) return;
    const s = Number(stunden.replace(",", "."));
    if (!Number.isFinite(s) || s === 0) {
      toast({ variant: "destructive", title: "Stunden-Wert ungültig" });
      return;
    }
    const { data: u } = await supabase.auth.getUser();
    const { error } = await supabase.from("za_buchungen").insert({
      mitarbeiter_id: profile.id,
      art,
      stunden: s,
      wirksam_am: datum,
      notiz: notiz.trim() || null,
      erstellt_von: u.user?.id ?? null,
    });
    if (error) {
      toast({ variant: "destructive", title: "Fehler", description: error.message });
      return;
    }
    toast({ title: "Buchung gespeichert" });
    onSaved();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Manuelle ZA-Buchung</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs">Art</Label>
            <select
              value={art}
              onChange={(e) => setArt(e.target.value as ZaBuchungArt)}
              className="w-full h-9 rounded-md border bg-background px-2 text-sm"
            >
              <option value="initial">Initial-Saldo</option>
              <option value="zeitausgleich_genommen">Zeitausgleich genommen</option>
              <option value="korrektur">Korrektur</option>
              <option value="auszahlung">Auszahlung</option>
            </select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs">Stunden (+/−)</Label>
              <Input
                inputMode="decimal"
                value={stunden}
                onChange={(e) => setStunden(e.target.value)}
                placeholder="z.B. 8 oder -4,5"
              />
            </div>
            <div>
              <Label className="text-xs">Wirksam ab</Label>
              <Input type="date" value={datum} onChange={(e) => setDatum(e.target.value)} />
            </div>
          </div>
          <div>
            <Label className="text-xs">Notiz</Label>
            <Textarea value={notiz} onChange={(e) => setNotiz(e.target.value)} rows={2} />
          </div>
        </div>
        <DialogFooter className="flex-row gap-2">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="flex-1"
          >
            Abbrechen
          </Button>
          <Button onClick={save} className="flex-1">
            Speichern
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
