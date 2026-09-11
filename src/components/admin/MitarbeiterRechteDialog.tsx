/**
 * Rechte je Person — Ausnahmen zur Rolle.
 *
 * Die Rolle bleibt die Grundlage; hier lässt sich für EINE Person ein
 * einzelnes Recht zusätzlich erlauben oder trotz Rolle verbieten, und die
 * sichtbaren Baustellen-Ordner abweichend vom Rollenstandard setzen.
 * Geprüft wird serverseitig (has_permission / darf_ordner_sehen).
 * Nur mit system.manage_permissions.
 */
import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { BAUSTELLEN_ORDNER, DEFAULT_VISIBILITY, type Visibility } from "@/lib/baustellenOrdner";
import { Loader2, ShieldCheck } from "lucide-react";

type Recht = {
  id: string;
  schluessel: string;
  modul: string | null;
  bezeichnung: string | null;
  ist_kritisch: boolean | null;
  sort_order: number | null;
};
type Wahl = "rolle" | "erlauben" | "verbieten";

export function MitarbeiterRechteDialog({
  open,
  onClose,
  profil,
  rolleId,
  rolleSchluessel,
}: {
  open: boolean;
  onClose: () => void;
  profil: { id: string; vorname: string; nachname: string; ordner_sichtbar?: string[] | null } | null;
  rolleId: string | null;
  rolleSchluessel: string | null;
}) {
  const { toast } = useToast();
  const { user } = useAuth();
  const [rechte, setRechte] = useState<Recht[]>([]);
  const [rollenKeys, setRollenKeys] = useState<Set<string>>(new Set());
  const [wahl, setWahl] = useState<Record<string, Wahl>>({});
  const [ursprung, setUrsprung] = useState<Record<string, Wahl>>({});
  const [ordnerStandard, setOrdnerStandard] = useState(true);
  const [ordner, setOrdner] = useState<Set<string>>(new Set());
  const [rollenOrdner, setRollenOrdner] = useState<string[]>([]);
  const [laden, setLaden] = useState(false);
  const [speichert, setSpeichert] = useState(false);

  useEffect(() => {
    if (!open || !profil) return;
    setLaden(true);
    (async () => {
      // Rechte-Tabellen fehlen in den generierten Typen (wie feedback) → any
      const sb = supabase as any;
      const [r, rb, ub, vis] = await Promise.all([
        sb.from("berechtigungen").select("id, schluessel, modul, bezeichnung, ist_kritisch, sort_order").order("modul").order("sort_order"),
        rolleId
          ? sb.from("rollen_berechtigungen").select("berechtigung_id").eq("rolle_id", rolleId)
          : Promise.resolve({ data: [] as any[] }),
        sb.from("user_berechtigungen").select("berechtigung_id, erlaubt").eq("user_id", profil.id),
        sb.from("app_settings").select("value").eq("key", "ordner_visibility").maybeSingle(),
      ]);
      const liste = ((r.data as unknown as Recht[]) ?? []);
      setRechte(liste);
      setRollenKeys(new Set(((rb.data as any[]) ?? []).map((x) => x.berechtigung_id)));
      const w: Record<string, Wahl> = {};
      for (const x of ((ub.data as any[]) ?? [])) w[x.berechtigung_id] = x.erlaubt ? "erlauben" : "verbieten";
      setWahl(w);
      setUrsprung(w);
      const visibility = ((vis.data as any)?.value as Visibility) ?? DEFAULT_VISIBILITY;
      const rs = rolleSchluessel ?? "mitarbeiter";
      setRollenOrdner(visibility[rs] ?? DEFAULT_VISIBILITY[rs] ?? DEFAULT_VISIBILITY.mitarbeiter);
      const eigene = profil.ordner_sichtbar ?? null;
      setOrdnerStandard(!eigene);
      setOrdner(new Set(eigene ?? visibility[rs] ?? DEFAULT_VISIBILITY[rs] ?? []));
      setLaden(false);
    })();
  }, [open, profil, rolleId, rolleSchluessel]);

  const gruppen = useMemo(() => {
    const m = new Map<string, Recht[]>();
    for (const r of rechte) {
      const k = r.modul ?? "Sonstiges";
      m.set(k, [...(m.get(k) ?? []), r]);
    }
    return [...m.entries()];
  }, [rechte]);

  const speichern = async () => {
    if (!profil) return;
    setSpeichert(true);
    try {
      const tbl = supabase.from("user_berechtigungen" as any) as any;
      for (const r of rechte) {
        const neu = wahl[r.id] ?? "rolle";
        const alt = ursprung[r.id] ?? "rolle";
        if (neu === alt) continue;
        if (neu === "rolle") {
          const { error } = await tbl.delete().eq("user_id", profil.id).eq("berechtigung_id", r.id);
          if (error) throw error;
        } else {
          const { error } = await tbl.upsert({
            user_id: profil.id,
            berechtigung_id: r.id,
            erlaubt: neu === "erlauben",
            geaendert_von: user?.id ?? null,
            geaendert_am: new Date().toISOString(),
          });
          if (error) throw error;
        }
      }
      const { error: pErr } = await supabase
        .from("profiles")
        .update({ ordner_sichtbar: ordnerStandard ? null : [...ordner] } as any)
        .eq("id", profil.id);
      if (pErr) throw pErr;
      toast({
        title: "Rechte gespeichert",
        description: `${profil.vorname} ${profil.nachname} — gilt sofort nach dem nächsten Laden der App.`,
      });
      onClose();
    } catch (e) {
      toast({ variant: "destructive", title: "Nicht gespeichert", description: (e as Error).message });
    } finally {
      setSpeichert(false);
    }
  };

  const anzahlAusnahmen = Object.values(wahl).filter((w) => w !== "rolle").length;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && !speichert && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" />
            Rechte: {profil?.vorname} {profil?.nachname}
          </DialogTitle>
          <DialogDescription>
            Die Rolle bleibt die Grundlage. Hier nur Ausnahmen für diese Person: ein Recht
            zusätzlich erlauben oder trotz Rolle verbieten — und welche Baustellen-Ordner sie sieht.
          </DialogDescription>
        </DialogHeader>

        {laden ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 inline mr-2 animate-spin" /> Lade …
          </div>
        ) : (
          <div className="space-y-5">
            {/* Ordner */}
            <section className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground border-b pb-1">
                Baustellen-Ordner
              </h3>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={ordnerStandard}
                  onChange={(e) => {
                    setOrdnerStandard(e.target.checked);
                    if (e.target.checked) setOrdner(new Set(rollenOrdner));
                  }}
                />
                Standard der Rolle ({rolleSchluessel ?? "mitarbeiter"}) verwenden
              </label>
              <div className={`grid grid-cols-2 sm:grid-cols-3 gap-1.5 ${ordnerStandard ? "opacity-50 pointer-events-none" : ""}`}>
                {BAUSTELLEN_ORDNER.map((o) => (
                  <label key={o.key} className="flex items-center gap-2 text-xs cursor-pointer border rounded px-2 py-1.5">
                    <input
                      type="checkbox"
                      className="h-3.5 w-3.5"
                      checked={ordner.has(o.key)}
                      onChange={(e) =>
                        setOrdner((prev) => {
                          const n = new Set(prev);
                          if (e.target.checked) n.add(o.key);
                          else n.delete(o.key);
                          return n;
                        })
                      }
                    />
                    <span className="h-2 w-2 rounded-full shrink-0" style={{ background: o.color }} />
                    <span className="truncate">{o.label}</span>
                  </label>
                ))}
              </div>
              <p className="text-[11px] text-muted-foreground">
                „Berichte" für Mitarbeiter = die Berichts-PDFs im Ordner 2-Schriftverkehr; anderes darin bleibt unsichtbar.
              </p>
            </section>

            {/* Rechte */}
            <section className="space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground border-b pb-1">
                Rechte {anzahlAusnahmen > 0 && <span className="normal-case font-normal">· {anzahlAusnahmen} Ausnahme{anzahlAusnahmen === 1 ? "" : "n"}</span>}
              </h3>
              {gruppen.map(([modul, liste]) => (
                <div key={modul} className="space-y-1">
                  <div className="text-xs font-semibold">{modul}</div>
                  {liste.map((r) => {
                    const vonRolle = rollenKeys.has(r.id);
                    const w = wahl[r.id] ?? "rolle";
                    const effektiv = w === "rolle" ? vonRolle : w === "erlauben";
                    return (
                      <div
                        key={r.id}
                        className={`flex items-center gap-2 text-xs rounded px-2 py-1 ${w !== "rolle" ? "bg-primary/5" : ""}`}
                      >
                        <span
                          className={`h-2 w-2 rounded-full shrink-0 ${effektiv ? "bg-emerald-500" : "bg-muted-foreground/30"}`}
                          title={effektiv ? "gilt" : "gilt nicht"}
                        />
                        <span className="flex-1 min-w-0 truncate" title={r.schluessel}>
                          {r.bezeichnung ?? r.schluessel}
                          {r.ist_kritisch && <span className="text-destructive ml-1" title="kritisch">•</span>}
                        </span>
                        <span className="text-[10px] text-muted-foreground w-16 text-right">
                          Rolle: {vonRolle ? "ja" : "nein"}
                        </span>
                        <select
                          value={w}
                          onChange={(e) => setWahl((p) => ({ ...p, [r.id]: e.target.value as Wahl }))}
                          className="h-7 rounded border bg-background px-1 text-xs"
                        >
                          <option value="rolle">wie Rolle</option>
                          <option value="erlauben">erlauben</option>
                          <option value="verbieten">verbieten</option>
                        </select>
                      </div>
                    );
                  })}
                </div>
              ))}
            </section>
          </div>
        )}

        <DialogFooter className="sticky bottom-0 bg-card pt-3 border-t">
          <Button variant="outline" onClick={onClose} disabled={speichert}>
            Abbrechen
          </Button>
          <Button onClick={speichern} disabled={speichert || laden}>
            {speichert && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Speichern
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
