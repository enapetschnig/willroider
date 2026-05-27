/**
 * Tages-Editor wie die Zeiterfassung — Toggles + Art-Sections + „+ Tätigkeit"
 * für genau einen Mitarbeiter an genau einem Datum. Wird im
 * Baustellenstundenbericht beim Tap auf eine Tages-Spalte geöffnet.
 *
 * Bewusst NICHT im Dialog: Zulagen, Fahrt/Taggeld, Kilometergeld. Bestehende
 * Werte für diese Felder werden unverändert mitgespeichert, damit nichts
 * verloren geht.
 */

import { Fragment, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
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
import { useToast } from "@/hooks/use-toast";
import { Check, Loader2, Plus } from "lucide-react";
import type { Database, TagStatus } from "@/integrations/supabase/types";
import { supabase } from "@/integrations/supabase/client";
import {
  useSaveStundenTag,
  type StundenTagFull,
  type SaveEintrag,
  type SaveZulage,
  type SaveFahrt,
} from "@/hooks/useStundenTag";
import { useTaetigkeitenStamm } from "@/hooks/useStammdatenStunden";
import { StatusButtonsLeiste } from "@/components/stunden/StatusButtonsLeiste";
import { ArtSection } from "@/components/stunden/ArtSection";
import {
  gruppiereSections,
  istArbeitArt,
  newKey,
  type EintragRow,
} from "@/components/stunden/zeiterfassungUi";

type Baustelle = Database["public"]["Tables"]["baustellen"]["Row"];

function rowsAusTag(tag: StundenTagFull | null): EintragRow[] {
  if (!tag) return [];
  return tag.taetigkeiten.map((tt) => ({
    key: newKey(),
    art: tt.art,
    baustelle_id: tt.baustelle_id,
    taetigkeit_id: tt.taetigkeit_id,
    taetigkeit_freitext: tt.taetigkeit_freitext ?? "",
    stunden: Number(tt.stunden),
    notiz: tt.notiz ?? "",
  }));
}

export function TagBearbeitenDialog({
  open,
  onOpenChange,
  tag,
  mitarbeiterId,
  datum,
  mitarbeiterName,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  tag: StundenTagFull | null;
  mitarbeiterId: string;
  datum: string;
  mitarbeiterName: string;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const save = useSaveStundenTag();
  const { data: taetigkeitenStamm = [] } = useTaetigkeitenStamm();
  const { data: baustellen = [] } = useQuery<Baustelle[]>({
    queryKey: ["baustellen_for_tag_edit"],
    queryFn: async () => {
      const { data } = await supabase
        .from("baustellen")
        .select("*")
        .in("status", ["aktiv", "geplant"])
        .order("bvh_name");
      return (data as Baustelle[]) ?? [];
    },
  });

  const [eintraege, setEintraege] = useState<EintragRow[]>([]);
  const [arbeitsbeginn, setArbeitsbeginn] = useState<string>("");
  const [anmerkung, setAnmerkung] = useState<string>("");

  // Beim Öffnen: lokalen Form-State aus dem Tag (oder leer) befüllen
  useEffect(() => {
    if (!open) return;
    setEintraege(rowsAusTag(tag));
    setArbeitsbeginn(tag?.tag.arbeitsbeginn?.slice(0, 5) ?? "");
    setAnmerkung(tag?.tag.anmerkung ?? "");
  }, [open, tag]);

  const aktiveArten = useMemo(() => {
    const s = new Set<TagStatus>();
    for (const r of eintraege) s.add(r.art);
    return s;
  }, [eintraege]);

  const sections = useMemo(() => gruppiereSections(eintraege), [eintraege]);
  const lastBaustelleIdx = sections.reduce(
    (last, s, idx) => (s.art === "baustelle" ? idx : last),
    -1,
  );

  const defaultEintrag = (art: TagStatus): EintragRow => {
    const letzteBaustelle =
      [...eintraege].reverse().find((r) => r.art === "baustelle")
        ?.baustelle_id ?? null;
    return {
      key: newKey(),
      art,
      baustelle_id: art === "baustelle" ? letzteBaustelle : null,
      taetigkeit_id: null,
      taetigkeit_freitext: "",
      stunden: 0,
      notiz: "",
    };
  };

  const toggleArt = (art: TagStatus) => {
    if (aktiveArten.has(art)) {
      setEintraege((es) => es.filter((r) => r.art !== art));
    } else {
      setEintraege((es) => [...es, defaultEintrag(art)]);
    }
  };

  const updateEintrag = (key: string, patch: Partial<EintragRow>) =>
    setEintraege((es) => es.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const removeEintrag = (key: string) =>
    setEintraege((es) => es.filter((r) => r.key !== key));
  const addSplit = (art: TagStatus, baustelle_id: string | null) =>
    setEintraege((es) => [
      ...es,
      {
        key: newKey(),
        art,
        baustelle_id: art === "baustelle" ? baustelle_id : null,
        taetigkeit_id: null,
        taetigkeit_freitext: "",
        stunden: 0,
        notiz: "",
      },
    ]);
  /** Aktualisiert die Baustelle nur für die übergebenen Zeilen (eine Section). */
  const setSectionBaustelle = (rowKeys: string[], baustelle_id: string | null) => {
    const set = new Set(rowKeys);
    setEintraege((es) =>
      es.map((r) => (set.has(r.key) ? { ...r, baustelle_id } : r)),
    );
  };
  const addWeitereBaustelle = () =>
    setEintraege((es) => [
      ...es,
      {
        key: newKey(),
        art: "baustelle",
        baustelle_id: null,
        taetigkeit_id: null,
        taetigkeit_freitext: "",
        stunden: 0,
        notiz: "",
      },
    ]);

  const handleSave = async () => {
    try {
      const taetigkeiten: SaveEintrag[] = eintraege
        .filter(
          (e) =>
            Number(e.stunden) > 0 ||
            e.taetigkeit_id ||
            e.taetigkeit_freitext.trim(),
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

      // Zulagen + Fahrt unverändert übernehmen, damit nichts verloren geht
      const zulagen: SaveZulage[] = (tag?.zulagen ?? []).map((z) => ({
        zulagen_typ_id: z.zulagen_typ_id,
        stunden: z.stunden != null ? Number(z.stunden) : null,
        notiz: z.notiz ?? null,
      }));
      const fahrt: SaveFahrt | null = tag?.fahrt
        ? {
            fahrtgeld_eur: Number(tag.fahrt.fahrtgeld_eur ?? 0),
            privat_pkw: tag.fahrt.privat_pkw,
            km_gefahren:
              tag.fahrt.km_gefahren != null
                ? Number(tag.fahrt.km_gefahren)
                : null,
            taggeld_kurz: Number(tag.fahrt.taggeld_kurz ?? 0),
            taggeld_lang: Number(tag.fahrt.taggeld_lang ?? 0),
            taggeld_manuell: tag.fahrt.taggeld_manuell,
          }
        : null;

      await save.mutateAsync({
        id: tag?.tag.id || undefined,
        mitarbeiter_id: mitarbeiterId,
        datum,
        arbeitsbeginn: arbeitsbeginn || null,
        anmerkung: anmerkung.trim() || null,
        taetigkeiten,
        zulagen,
        fahrt,
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

  const datumLabel = new Date(datum + "T00:00:00").toLocaleDateString("de-AT", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="leading-tight">
            <div>{mitarbeiterName}</div>
            <div className="text-sm font-normal text-muted-foreground">
              {datumLabel}
            </div>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <StatusButtonsLeiste
            fuerAnzahl={1}
            aktiveArten={aktiveArten}
            onToggle={toggleArt}
          />

          {sections.length === 0 && (
            <div className="text-xs text-muted-foreground italic text-center py-3">
              Oben eine Art auswählen, um Stunden einzutragen.
            </div>
          )}

          {sections.map((s, idx) => (
            <Fragment key={s.key}>
              <ArtSection
                art={s.art}
                rows={s.rows}
                baustellen={baustellen}
                taetigkeitenStamm={taetigkeitenStamm}
                onUpdate={updateEintrag}
                onRemove={removeEintrag}
                onAddSplit={() =>
                  addSplit(
                    s.art,
                    s.rows[s.rows.length - 1]?.baustelle_id ?? null,
                  )
                }
                onSectionBaustelle={(b) =>
                  setSectionBaustelle(
                    s.rows.map((r) => r.key),
                    b,
                  )
                }
              />
              {idx === lastBaustelleIdx && (
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full h-11"
                  onClick={addWeitereBaustelle}
                >
                  <Plus className="h-4 w-4 mr-1.5" />
                  weitere Baustelle
                </Button>
              )}
            </Fragment>
          ))}

          <div className="space-y-1 border-t pt-3">
            <Label className="text-xs">Anmerkung (optional)</Label>
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
            {save.isPending ? (
              <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
            ) : (
              <Check className="h-4 w-4 mr-1.5" />
            )}
            Speichern
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
