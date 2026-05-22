/**
 * AdminTagEditModal — voller Tag-Editor für die Stundenauswertung.
 *
 * Ein Tag ist eine Liste typisierter Einträge (Baustelle/Firma/Krank/
 * Urlaub/Schlechtwetter). Jeder Eintrag hat eine eigene Art — mehrere
 * Arten am selben Tag sind möglich. tag_status + netto_stunden leitet
 * der DB-Trigger aus den Einträgen ab.
 *
 * Wiederverwendet useSaveStundenTag — RLS-Policy lässt Admin via
 * is_admin_role(auth.uid()) zu.
 */

import { useEffect, useState } from "react";
import { Plus, Trash2, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  useSaveStundenTag,
  type StundenTagFull,
  type SaveEintrag,
  type SaveZulage,
} from "@/hooks/useStundenTag";
import { useTaetigkeitenStamm, useZulagenTypen } from "@/hooks/useStammdatenStunden";
import { fmtH } from "@/lib/zeiterfassung";
import { supabase } from "@/integrations/supabase/client";
import type { Database, TagStatus } from "@/integrations/supabase/types";

type Baustelle = Database["public"]["Tables"]["baustellen"]["Row"];

const ART_OPTIONS: { value: TagStatus; label: string }[] = [
  { value: "baustelle", label: "Baustelle" },
  { value: "firma", label: "Firma" },
  { value: "krank", label: "Krank" },
  { value: "urlaub", label: "Urlaub" },
  { value: "schlechtwetter", label: "Schlechtwetter" },
  { value: "feiertag", label: "Feiertag" },
];

const istArbeitArt = (art: TagStatus) => art === "baustelle" || art === "firma";

interface FormEintrag {
  art: TagStatus;
  taetigkeit_id: string | null;
  taetigkeit_freitext: string;
  baustelle_id: string | null;
  stunden: number;
  notiz: string;
}

interface FormZul {
  zulagen_typ_id: string;
  stunden: number | null;
  notiz: string;
}

export function AdminTagEditModal({
  open,
  onOpenChange,
  tag,
  mitarbeiterName,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  tag: StundenTagFull | null;
  mitarbeiterName: string;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const save = useSaveStundenTag();
  const { data: taetigkeitenStamm = [] } = useTaetigkeitenStamm();
  const { data: zulagenTypen = [] } = useZulagenTypen();

  const [arbeitsbeginn, setArbeitsbeginn] = useState<string>("");
  const [anmerkung, setAnmerkung] = useState<string>("");
  const [eintraege, setEintraege] = useState<FormEintrag[]>([]);
  const [zulagen, setZulagen] = useState<FormZul[]>([]);
  const [baustellen, setBaustellen] = useState<Baustelle[]>([]);

  // Reset Form wenn ein neuer Tag geladen wird
  useEffect(() => {
    if (!tag) return;
    setArbeitsbeginn(tag.tag.arbeitsbeginn?.slice(0, 5) ?? "");
    setAnmerkung(tag.tag.anmerkung ?? "");
    setEintraege(
      tag.taetigkeiten.map((t) => ({
        art: t.art,
        taetigkeit_id: t.taetigkeit_id,
        taetigkeit_freitext: t.taetigkeit_freitext ?? "",
        baustelle_id: t.baustelle_id,
        stunden: Number(t.stunden),
        notiz: t.notiz ?? "",
      })),
    );
    setZulagen(
      tag.zulagen.map((z) => ({
        zulagen_typ_id: z.zulagen_typ_id,
        stunden: z.stunden != null ? Number(z.stunden) : null,
        notiz: z.notiz ?? "",
      })),
    );
  }, [tag]);

  // Baustellen laden (für Eintrags-Picker)
  useEffect(() => {
    if (!open) return;
    (async () => {
      const { data } = await supabase
        .from("baustellen")
        .select("*")
        .in("status", ["aktiv", "geplant"])
        .order("bvh_name");
      setBaustellen((data as Baustelle[]) ?? []);
    })();
  }, [open]);

  if (!tag) return null;

  const summe =
    Math.round(eintraege.reduce((s, e) => s + Number(e.stunden || 0), 0) * 100) /
    100;

  const addEintrag = () =>
    setEintraege((cur) => [
      ...cur,
      {
        art: "baustelle",
        taetigkeit_id: null,
        taetigkeit_freitext: "",
        baustelle_id:
          [...cur].reverse().find((e) => e.art === "baustelle")?.baustelle_id ??
          null,
        stunden: 0,
        notiz: "",
      },
    ]);
  const removeEintrag = (idx: number) =>
    setEintraege((cur) => cur.filter((_, i) => i !== idx));
  const updateEintrag = (idx: number, patch: Partial<FormEintrag>) =>
    setEintraege((cur) => cur.map((e, i) => (i === idx ? { ...e, ...patch } : e)));

  const addZul = () =>
    setZulagen((cur) => [
      ...cur,
      { zulagen_typ_id: zulagenTypen[0]?.id ?? "", stunden: null, notiz: "" },
    ]);
  const removeZul = (idx: number) =>
    setZulagen((cur) => cur.filter((_, i) => i !== idx));
  const updateZul = (idx: number, patch: Partial<FormZul>) =>
    setZulagen((cur) => cur.map((z, i) => (i === idx ? { ...z, ...patch } : z)));

  const handleSave = async () => {
    try {
      const taetigkeitenPayload: SaveEintrag[] = eintraege
        .filter(
          (e) =>
            e.stunden > 0 || e.taetigkeit_id || e.taetigkeit_freitext.trim(),
        )
        .map((e, idx) => {
          const arbeit = istArbeitArt(e.art);
          return {
            position: idx + 1,
            art: e.art,
            taetigkeit_id: arbeit ? e.taetigkeit_id : null,
            taetigkeit_freitext:
              arbeit && !e.taetigkeit_id
                ? e.taetigkeit_freitext.trim() || null
                : null,
            baustelle_id: e.art === "baustelle" ? e.baustelle_id : null,
            stunden: Number(e.stunden),
            notiz: e.notiz.trim() || null,
          };
        });
      if (taetigkeitenPayload.length === 0) {
        toast({
          variant: "destructive",
          title: "Kein Eintrag",
          description: "Mindestens ein Eintrag mit Stunden ist nötig.",
        });
        return;
      }
      const zulagenPayload: SaveZulage[] = zulagen
        .filter((z) => z.zulagen_typ_id)
        .map((z) => ({
          zulagen_typ_id: z.zulagen_typ_id,
          stunden: z.stunden != null ? Number(z.stunden) : null,
          notiz: z.notiz.trim() || null,
        }));

      await save.mutateAsync({
        id: tag.tag.id,
        mitarbeiter_id: tag.tag.mitarbeiter_id,
        datum: tag.tag.datum,
        arbeitsbeginn: arbeitsbeginn || null,
        anmerkung: anmerkung.trim() || null,
        taetigkeiten: taetigkeitenPayload,
        zulagen: zulagenPayload,
        fahrt: tag.fahrt
          ? {
              fahrtgeld_eur: Number(tag.fahrt.fahrtgeld_eur ?? 0),
              privat_pkw: tag.fahrt.privat_pkw,
              km_gefahren:
                tag.fahrt.km_gefahren != null ? Number(tag.fahrt.km_gefahren) : null,
              taggeld_kurz: Number(tag.fahrt.taggeld_kurz ?? 0),
              taggeld_lang: Number(tag.fahrt.taggeld_lang ?? 0),
              taggeld_manuell: tag.fahrt.taggeld_manuell,
            }
          : null,
      });
      toast({ title: "Tag gespeichert" });
      onSaved();
      onOpenChange(false);
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Fehler beim Speichern",
        description: (e as Error).message,
      });
    }
  };

  const datumLabel = new Date(tag.tag.datum + "T00:00:00").toLocaleDateString(
    "de-AT",
    { weekday: "long", day: "2-digit", month: "2-digit", year: "numeric" },
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {mitarbeiterName} · {datumLabel}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Arbeitsbeginn + Tages-Summe */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Arbeitsbeginn</Label>
              <Input
                type="time"
                value={arbeitsbeginn}
                onChange={(e) => setArbeitsbeginn(e.target.value)}
                className="h-9"
              />
            </div>
            <div>
              <Label className="text-xs">Tages-Summe</Label>
              <div className="h-9 flex items-center px-2 rounded-md border bg-muted/40 text-sm font-bold tabular-nums">
                {fmtH(summe)}
              </div>
            </div>
          </div>

          {/* Einträge */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <Label className="text-sm font-semibold">Einträge</Label>
              <Button
                size="sm"
                variant="outline"
                onClick={addEintrag}
                className="h-7 px-2"
              >
                <Plus className="h-3.5 w-3.5 mr-1" /> Eintrag
              </Button>
            </div>
            {eintraege.length === 0 && (
              <div className="text-xs text-muted-foreground italic">
                Keine Einträge — Eintrag hinzufügen.
              </div>
            )}
            <div className="space-y-2">
              {eintraege.map((e, idx) => {
                const arbeit = istArbeitArt(e.art);
                return (
                  <div
                    key={idx}
                    className="rounded-md border p-2 space-y-2 bg-muted/20"
                  >
                    <div className="flex items-center gap-2">
                      <select
                        value={e.art}
                        onChange={(ev) =>
                          updateEintrag(idx, {
                            art: ev.target.value as TagStatus,
                          })
                        }
                        className="h-8 rounded-md border bg-background px-1 text-xs font-semibold"
                      >
                        {ART_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                      <Input
                        type="number"
                        step="0.25"
                        min={0}
                        value={e.stunden}
                        onChange={(ev) =>
                          updateEintrag(idx, {
                            stunden: Number(ev.target.value) || 0,
                          })
                        }
                        className="h-8 w-20 text-xs text-center tabular-nums"
                      />
                      <span className="text-xs text-muted-foreground">h</span>
                      <span className="flex-1" />
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => removeEintrag(idx)}
                        className="h-8 w-8 p-0 text-destructive"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>

                    {e.art === "baustelle" && (
                      <select
                        value={e.baustelle_id ?? ""}
                        onChange={(ev) =>
                          updateEintrag(idx, {
                            baustelle_id: ev.target.value || null,
                          })
                        }
                        className="h-8 w-full rounded-md border bg-background px-1 text-xs"
                      >
                        <option value="">— Baustelle wählen —</option>
                        {baustellen.map((b) => (
                          <option key={b.id} value={b.id}>
                            {b.bvh_name}
                          </option>
                        ))}
                      </select>
                    )}

                    {arbeit && (
                      <>
                        <select
                          value={e.taetigkeit_id ?? ""}
                          onChange={(ev) =>
                            updateEintrag(idx, {
                              taetigkeit_id: ev.target.value || null,
                              taetigkeit_freitext: "",
                            })
                          }
                          className="h-8 w-full rounded-md border bg-background px-1 text-xs"
                        >
                          <option value="">— Tätigkeit / Freitext —</option>
                          {taetigkeitenStamm.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.bezeichnung}
                            </option>
                          ))}
                        </select>
                        {!e.taetigkeit_id && (
                          <Input
                            value={e.taetigkeit_freitext}
                            onChange={(ev) =>
                              updateEintrag(idx, {
                                taetigkeit_freitext: ev.target.value,
                              })
                            }
                            placeholder="Freitext"
                            className="h-7 text-xs"
                          />
                        )}
                      </>
                    )}

                    <Input
                      value={e.notiz}
                      onChange={(ev) =>
                        updateEintrag(idx, { notiz: ev.target.value })
                      }
                      placeholder="Notiz (optional)"
                      className="h-7 text-xs"
                    />
                  </div>
                );
              })}
            </div>
          </div>

          {/* Zulagen */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <Label className="text-sm font-semibold">Zulagen</Label>
              <Button
                size="sm"
                variant="outline"
                onClick={addZul}
                className="h-7 px-2"
                disabled={zulagenTypen.length === 0}
              >
                <Plus className="h-3.5 w-3.5 mr-1" /> Zeile
              </Button>
            </div>
            {zulagen.length === 0 && (
              <div className="text-xs text-muted-foreground italic">
                Keine Zulagen.
              </div>
            )}
            <div className="space-y-2">
              {zulagen.map((z, idx) => (
                <div key={idx} className="grid grid-cols-12 gap-2 items-end">
                  <div className="col-span-7">
                    <Label className="text-[10px]">Zulagen-Typ</Label>
                    <select
                      value={z.zulagen_typ_id}
                      onChange={(e) => updateZul(idx, { zulagen_typ_id: e.target.value })}
                      className="h-8 w-full rounded-md border bg-background px-1 text-xs"
                    >
                      {zulagenTypen.map((zt) => (
                        <option key={zt.id} value={zt.id}>
                          {zt.bezeichnung}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="col-span-4">
                    <Label className="text-[10px]">Stunden (leer = ganzer Tag)</Label>
                    <Input
                      type="number"
                      step="0.25"
                      value={z.stunden ?? ""}
                      onChange={(e) =>
                        updateZul(idx, {
                          stunden: e.target.value === "" ? null : Number(e.target.value),
                        })
                      }
                      className="h-8 text-xs"
                    />
                  </div>
                  <div className="col-span-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => removeZul(idx)}
                      className="h-8 w-8 p-0"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Anmerkung */}
          <div>
            <Label className="text-xs">Anmerkung</Label>
            <Textarea
              value={anmerkung}
              onChange={(e) => setAnmerkung(e.target.value)}
              rows={2}
              className="text-sm"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Abbrechen
          </Button>
          <Button onClick={handleSave} disabled={save.isPending}>
            {save.isPending && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
            Speichern
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
