/**
 * AdminTagEditModal — voller Tag-Editor für die Stundenauswertung.
 *
 * Admin kann einen einzelnen stunden_tage-Eintrag samt Children
 * (Tätigkeiten, Zulagen, Fahrt) bearbeiten. Wiederverwendet useSaveStundenTag —
 * RLS-Policy lässt Admin via is_admin_role(auth.uid()) zu.
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
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import {
  useSaveStundenTag,
  type StundenTagFull,
  type SaveTaetigkeit,
  type SaveZulage,
} from "@/hooks/useStundenTag";
import { useTaetigkeitenStamm, useZulagenTypen } from "@/hooks/useStammdatenStunden";
import { supabase } from "@/integrations/supabase/client";
import type { Database, TagStatus } from "@/integrations/supabase/types";

type Baustelle = Database["public"]["Tables"]["baustellen"]["Row"];

const TAG_STATUS_OPTIONS: { value: TagStatus; label: string }[] = [
  { value: "baustelle", label: "Baustelle" },
  { value: "firma", label: "Firma" },
  { value: "krank", label: "Krank" },
  { value: "urlaub", label: "Urlaub" },
  { value: "schlechtwetter", label: "Schlechtwetter" },
  { value: "feiertag", label: "Feiertag" },
];

interface FormTaet {
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

  const [tagStatus, setTagStatus] = useState<TagStatus>("baustelle");
  const [netto, setNetto] = useState<number>(8);
  const [vmPause, setVmPause] = useState(false);
  const [mittagPause, setMittagPause] = useState(true);
  const [arbeitsbeginn, setArbeitsbeginn] = useState<string>("");
  const [anmerkung, setAnmerkung] = useState<string>("");
  const [taetigkeiten, setTaetigkeiten] = useState<FormTaet[]>([]);
  const [zulagen, setZulagen] = useState<FormZul[]>([]);
  const [baustellen, setBaustellen] = useState<Baustelle[]>([]);

  // Reset Form wenn ein neuer Tag geladen wird
  useEffect(() => {
    if (!tag) return;
    setTagStatus(tag.tag.tag_status as TagStatus);
    setNetto(Number(tag.tag.netto_stunden));
    setVmPause(tag.tag.vm_pause);
    setMittagPause(tag.tag.mittag_pause);
    setArbeitsbeginn(tag.tag.arbeitsbeginn?.slice(0, 5) ?? "");
    setAnmerkung(tag.tag.anmerkung ?? "");
    setTaetigkeiten(
      tag.taetigkeiten.map((t) => ({
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

  // Baustellen laden (für Tätigkeits-Picker)
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

  const addTaet = () =>
    setTaetigkeiten((cur) => [
      ...cur,
      { taetigkeit_id: null, taetigkeit_freitext: "", baustelle_id: null, stunden: 0, notiz: "" },
    ]);
  const removeTaet = (idx: number) =>
    setTaetigkeiten((cur) => cur.filter((_, i) => i !== idx));
  const updateTaet = (idx: number, patch: Partial<FormTaet>) =>
    setTaetigkeiten((cur) => cur.map((t, i) => (i === idx ? { ...t, ...patch } : t)));

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
      const taetigkeitenPayload: SaveTaetigkeit[] = taetigkeiten
        .filter((t) => t.stunden > 0 || t.taetigkeit_id || t.taetigkeit_freitext)
        .map((t, idx) => ({
          position: idx + 1,
          taetigkeit_id: t.taetigkeit_id,
          taetigkeit_freitext: t.taetigkeit_freitext.trim() || null,
          baustelle_id: t.baustelle_id,
          stunden: Number(t.stunden),
          notiz: t.notiz.trim() || null,
        }));
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
        tag_status: tagStatus,
        netto_stunden: Number(netto),
        vm_pause: vmPause,
        mittag_pause: mittagPause,
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
          {/* Status + Stunden + Arbeitsbeginn */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <Label className="text-xs">Status</Label>
              <select
                value={tagStatus}
                onChange={(e) => setTagStatus(e.target.value as TagStatus)}
                className="h-9 w-full rounded-md border bg-background px-2 text-sm"
              >
                {TAG_STATUS_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label className="text-xs">Netto-Stunden</Label>
              <Input
                type="number"
                step="0.25"
                value={netto}
                onChange={(e) => setNetto(Number(e.target.value))}
                className="h-9"
              />
            </div>
            <div>
              <Label className="text-xs">Arbeitsbeginn</Label>
              <Input
                type="time"
                value={arbeitsbeginn}
                onChange={(e) => setArbeitsbeginn(e.target.value)}
                className="h-9"
              />
            </div>
          </div>

          {/* Pausen */}
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2">
              <Switch checked={vmPause} onCheckedChange={setVmPause} />
              <Label className="text-sm">Vormittags-Pause</Label>
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={mittagPause} onCheckedChange={setMittagPause} />
              <Label className="text-sm">Mittagspause</Label>
            </div>
          </div>

          {/* Tätigkeiten */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <Label className="text-sm font-semibold">Tätigkeiten</Label>
              <Button size="sm" variant="outline" onClick={addTaet} className="h-7 px-2">
                <Plus className="h-3.5 w-3.5 mr-1" /> Zeile
              </Button>
            </div>
            {taetigkeiten.length === 0 && (
              <div className="text-xs text-muted-foreground italic">
                Keine Tätigkeiten — Zeile hinzufügen.
              </div>
            )}
            <div className="space-y-2">
              {taetigkeiten.map((t, idx) => (
                <div key={idx} className="grid grid-cols-12 gap-2 items-end">
                  <div className="col-span-5">
                    <Label className="text-[10px]">Baustelle</Label>
                    <select
                      value={t.baustelle_id ?? ""}
                      onChange={(e) =>
                        updateTaet(idx, { baustelle_id: e.target.value || null })
                      }
                      className="h-8 w-full rounded-md border bg-background px-1 text-xs"
                    >
                      <option value="">—</option>
                      {baustellen.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.bvh_name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="col-span-4">
                    <Label className="text-[10px]">Tätigkeit</Label>
                    <select
                      value={t.taetigkeit_id ?? ""}
                      onChange={(e) =>
                        updateTaet(idx, {
                          taetigkeit_id: e.target.value || null,
                          taetigkeit_freitext: "",
                        })
                      }
                      className="h-8 w-full rounded-md border bg-background px-1 text-xs"
                    >
                      <option value="">— Freitext —</option>
                      {taetigkeitenStamm.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.bezeichnung}
                        </option>
                      ))}
                    </select>
                    {!t.taetigkeit_id && (
                      <Input
                        value={t.taetigkeit_freitext}
                        onChange={(e) =>
                          updateTaet(idx, { taetigkeit_freitext: e.target.value })
                        }
                        placeholder="Freitext"
                        className="h-7 mt-1 text-xs"
                      />
                    )}
                  </div>
                  <div className="col-span-2">
                    <Label className="text-[10px]">Stunden</Label>
                    <Input
                      type="number"
                      step="0.25"
                      value={t.stunden}
                      onChange={(e) =>
                        updateTaet(idx, { stunden: Number(e.target.value) })
                      }
                      className="h-8 text-xs"
                    />
                  </div>
                  <div className="col-span-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => removeTaet(idx)}
                      className="h-8 w-8 p-0"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
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
