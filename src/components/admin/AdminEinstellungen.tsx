import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { Settings, Save } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { istWochenSoll, type WochenSoll } from "@/lib/taetigkeitsbericht";
import type {
  Database,
  UrlaubModell,
  ArbeitszeitModell,
} from "@/integrations/supabase/types";

type Profile = Database["public"]["Tables"]["profiles"]["Row"];
type PKS = Database["public"]["Tables"]["profile_konten_settings"]["Row"];

type Editable = {
  profile_id: string;
  eintrittsdatum: string;
  beschaeftigungsgrad: string;
  tagesnorm_stunden: string;
  urlaub_jahresanspruch_tage: string;
  urlaub_modell: UrlaubModell;
  urlaub_stichtag_tag: string;
  urlaub_stichtag_monat: string;
  za_faktor: string;
  arbeitszeitmodell: ArbeitszeitModell;
};

const DEFAULT: Omit<Editable, "profile_id"> = {
  eintrittsdatum: "",
  beschaeftigungsgrad: "1.00",
  tagesnorm_stunden: "8.0",
  urlaub_jahresanspruch_tage: "25",
  urlaub_modell: "fix_datum",
  urlaub_stichtag_tag: "1",
  urlaub_stichtag_monat: "4",
  za_faktor: "1.00",
  arbeitszeitmodell: "zimmerei_sommer",
};

const TAGE = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
const zahl = (n: number) => String(n).replace(".", ",");
/** Kurzanzeige: „2 · 2 · 2 · 1/1,5 · 0 = 7,25 h/Wo" */
const wochenSollText = (ws: WochenSoll) => {
  const tag = (i: number) => {
    const a = Number(ws.woche[i] ?? 0);
    const b = ws.gerade_kw ? Number(ws.gerade_kw[i] ?? 0) : a;
    return a === b ? zahl(a) : `${zahl(a)}/${zahl(b)}`;
  };
  const summe = (w: number[]) => w.reduce((x, y) => x + (Number(y) || 0), 0);
  const schnitt = ws.gerade_kw ? (summe(ws.woche) + summe(ws.gerade_kw)) / 2 : summe(ws.woche);
  return `${[0, 1, 2, 3, 4].map(tag).join(" · ")} = ${zahl(Math.round(schnitt * 100) / 100)} h/Wo`;
};

/**
 * Eigenes Wochen-Soll (Wunsch J. Maurer 22.10.2026, geringfügig
 * Beschäftigte): Stunden je Wochentag, auf Wunsch in geraden
 * Kalenderwochen anders. Geht dem Arbeitszeit-Modell vor.
 */
function WochenSollDialog({
  person,
  wert,
  ohneZeile,
  onClose,
  onSaved,
}: {
  person: Profile;
  wert: WochenSoll | null;
  /** Noch keine Einstellungs-Zeile? Dann das Modell passend zur Person mitgeben. */
  ohneZeile: boolean;
  onClose: () => void;
  onSaved: (ws: WochenSoll | null) => void;
}) {
  const { toast } = useToast();
  const leer = ["", "", "", "", "", "", ""];
  const [woche, setWoche] = useState<string[]>(wert ? wert.woche.map((n) => zahl(Number(n) || 0)) : leer);
  const [abwechselnd, setAbwechselnd] = useState(!!wert?.gerade_kw);
  const [gerade, setGerade] = useState<string[]>(
    wert?.gerade_kw ? wert.gerade_kw.map((n) => zahl(Number(n) || 0)) : wert ? wert.woche.map((n) => zahl(Number(n) || 0)) : leer,
  );
  const [speichert, setSpeichert] = useState(false);
  const zuZahlen = (a: string[]) => a.map((v) => Math.max(0, Number(String(v).replace(",", ".")) || 0));

  const speichern = async (ws: WochenSoll | null) => {
    setSpeichert(true);
    const { error } = await supabase
      .from("profile_konten_settings")
      .upsert(
        {
          profile_id: person.id,
          soll_woche: ws,
          // Sonst stünde eine Angestellte ohne Zeile auf dem Arbeiter-Kalender.
          ...(ohneZeile
            ? { arbeitszeitmodell: (person as any).zeiterfassung_typ === "angestellter" ? "angestellter" : "zimmerei_sommer" }
            : {}),
        } as any,
        { onConflict: "profile_id" },
      );
    setSpeichert(false);
    if (error) {
      toast({ variant: "destructive", title: "Nicht gespeichert", description: error.message });
      return;
    }
    toast({ title: ws ? "Wochen-Soll gespeichert" : "Wochen-Soll entfernt" });
    onSaved(ws);
  };

  const zeile = (werte: string[], setzen: (w: string[]) => void) => (
    <div className="grid grid-cols-7 gap-1">
      {TAGE.map((t, i) => (
        <div key={t} className="space-y-0.5">
          <div className="text-[10px] text-center text-muted-foreground">{t}</div>
          <Input
            inputMode="decimal"
            value={werte[i]}
            onChange={(e) => setzen(werte.map((v, j) => (j === i ? e.target.value : v)))}
            className="h-8 px-1 text-center text-xs"
            placeholder="0"
          />
        </div>
      ))}
    </div>
  );

  return (
    <Dialog open onOpenChange={(o) => !o && !speichert && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            Wochen-Soll · {person.vorname} {person.nachname}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Für Teilzeit oder geringfügig Beschäftigte: Sollstunden je Wochentag. Gilt im
            Tätigkeitsbericht, in der Auswertung und beim Urlaub statt des Arbeitszeit-Modells.
          </p>
          <div className="space-y-1">
            <div className="text-xs font-medium">{abwechselnd ? "Ungerade Kalenderwochen" : "Jede Woche"}</div>
            {zeile(woche, setWoche)}
          </div>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" className="h-4 w-4" checked={abwechselnd} onChange={(e) => setAbwechselnd(e.target.checked)} />
            In geraden Kalenderwochen anders
          </label>
          {abwechselnd && (
            <div className="space-y-1">
              <div className="text-xs font-medium">Gerade Kalenderwochen</div>
              {zeile(gerade, setGerade)}
            </div>
          )}
        </div>
        <DialogFooter className="gap-2 sm:justify-between">
          {wert ? (
            <Button variant="ghost" onClick={() => speichern(null)} disabled={speichert}>
              Entfernen (wieder Modell)
            </Button>
          ) : (
            <span />
          )}
          <Button
            onClick={() =>
              speichern({ woche: zuZahlen(woche), ...(abwechselnd ? { gerade_kw: zuZahlen(gerade) } : {}) })
            }
            disabled={speichert}
          >
            Speichern
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function AdminEinstellungen() {
  const { toast } = useToast();
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [rows, setRows] = useState<Record<string, Editable>>({});
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  const [wochenSoll, setWochenSoll] = useState<Record<string, WochenSoll | null>>({});
  const [wsOffen, setWsOffen] = useState<Profile | null>(null);
  const [mitZeile, setMitZeile] = useState<Set<string>>(new Set());

  const load = async () => {
    const [{ data: ps }, { data: pks }] = await Promise.all([
      supabase.from("profiles").select("*").eq("is_active", true).order("nachname"),
      supabase.from("profile_konten_settings").select("*"),
    ]);
    setProfiles((ps as Profile[]) ?? []);
    const ws: Record<string, WochenSoll | null> = {};
    ((pks as PKS[]) ?? []).forEach((x) => (ws[x.profile_id] = istWochenSoll(x.soll_woche) ? x.soll_woche : null));
    setWochenSoll(ws);
    setMitZeile(new Set(((pks as PKS[]) ?? []).map((x) => x.profile_id)));
    const map: Record<string, Editable> = {};
    ((ps as Profile[]) ?? []).forEach((p) => {
      const s = ((pks as PKS[]) ?? []).find((x) => x.profile_id === p.id);
      map[p.id] = {
        profile_id: p.id,
        eintrittsdatum: s?.eintrittsdatum ?? DEFAULT.eintrittsdatum,
        beschaeftigungsgrad: String(s?.beschaeftigungsgrad ?? DEFAULT.beschaeftigungsgrad),
        tagesnorm_stunden: String(s?.tagesnorm_stunden ?? DEFAULT.tagesnorm_stunden),
        urlaub_jahresanspruch_tage: String(
          s?.urlaub_jahresanspruch_tage ?? DEFAULT.urlaub_jahresanspruch_tage
        ),
        urlaub_modell: (s?.urlaub_modell as UrlaubModell) ?? DEFAULT.urlaub_modell,
        urlaub_stichtag_tag: String(s?.urlaub_stichtag_tag ?? DEFAULT.urlaub_stichtag_tag),
        urlaub_stichtag_monat: String(
          s?.urlaub_stichtag_monat ?? DEFAULT.urlaub_stichtag_monat
        ),
        za_faktor: String(s?.za_faktor ?? DEFAULT.za_faktor),
        arbeitszeitmodell:
          (s?.arbeitszeitmodell as ArbeitszeitModell) ??
          DEFAULT.arbeitszeitmodell,
      };
    });
    setRows(map);
    setDirty(new Set());
  };

  useEffect(() => {
    load();
  }, []);

  const update = (uid: string, key: keyof Editable, val: string) => {
    setRows((p) => ({
      ...p,
      [uid]: { ...p[uid], [key]: val },
    }));
    setDirty((p) => new Set(p).add(uid));
  };

  const saveOne = async (uid: string) => {
    const r = rows[uid];
    if (!r) return;
    const payload: any = {
      profile_id: uid,
      eintrittsdatum: r.eintrittsdatum || null,
      beschaeftigungsgrad: Number(r.beschaeftigungsgrad.replace(",", ".")),
      tagesnorm_stunden: Number(r.tagesnorm_stunden.replace(",", ".")),
      urlaub_jahresanspruch_tage: Number(
        r.urlaub_jahresanspruch_tage.replace(",", ".")
      ),
      urlaub_modell: r.urlaub_modell,
      urlaub_stichtag_tag: Number(r.urlaub_stichtag_tag) || 1,
      urlaub_stichtag_monat: Number(r.urlaub_stichtag_monat) || 4,
      za_faktor: Number(r.za_faktor.replace(",", ".")),
      arbeitszeitmodell: r.arbeitszeitmodell,
    };
    const { error } = await supabase
      .from("profile_konten_settings")
      .upsert(payload, { onConflict: "profile_id" });
    if (error) {
      toast({ variant: "destructive", title: "Fehler", description: error.message });
      return;
    }
    toast({ title: "Gespeichert" });
    setDirty((p) => {
      const n = new Set(p);
      n.delete(uid);
      return n;
    });
  };

  const saveAll = async () => {
    const updates = profiles
      .filter((p) => dirty.has(p.id))
      .map((p) => rows[p.id])
      .filter(Boolean)
      .map((r) => ({
        profile_id: r.profile_id,
        eintrittsdatum: r.eintrittsdatum || null,
        beschaeftigungsgrad: Number(r.beschaeftigungsgrad.replace(",", ".")),
        tagesnorm_stunden: Number(r.tagesnorm_stunden.replace(",", ".")),
        urlaub_jahresanspruch_tage: Number(
          r.urlaub_jahresanspruch_tage.replace(",", ".")
        ),
        urlaub_modell: r.urlaub_modell,
        urlaub_stichtag_tag: Number(r.urlaub_stichtag_tag) || 1,
        urlaub_stichtag_monat: Number(r.urlaub_stichtag_monat) || 4,
        za_faktor: Number(r.za_faktor.replace(",", ".")),
        arbeitszeitmodell: r.arbeitszeitmodell,
      }));
    if (updates.length === 0) return;
    const { error } = await supabase
      .from("profile_konten_settings")
      .upsert(updates, { onConflict: "profile_id" });
    if (error) {
      toast({ variant: "destructive", title: "Fehler", description: error.message });
      return;
    }
    toast({ title: `${updates.length} Mitarbeiter gespeichert` });
    setDirty(new Set());
  };

  return (
    <div className="space-y-3">
      <Card>
        <CardContent className="p-3 flex items-center gap-2 flex-wrap">
          <Settings className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold">
            Mitarbeiter-Einstellungen (Urlaub, ZA, Arbeitszeit)
          </span>
          <Button
            onClick={saveAll}
            disabled={dirty.size === 0}
            className="ml-auto"
            size="sm"
          >
            <Save className="h-4 w-4 mr-1" />
            Alle speichern ({dirty.size})
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <table className="text-xs min-w-[1000px] w-full">
            <thead className="bg-muted">
              <tr>
                <th className="text-left px-2 py-2 sticky left-0 bg-muted">
                  Mitarbeiter
                </th>
                <th className="px-2 py-2">Eintritt</th>
                <th className="px-2 py-2">Beschäft.-Grad</th>
                <th className="px-2 py-2">Tagesnorm (h)</th>
                <th className="px-2 py-2">Urlaub/Jahr (Tg)</th>
                <th className="px-2 py-2">Urlaubs-Modell</th>
                <th className="px-2 py-2">Stichtag T/M</th>
                <th className="px-2 py-2">ZA-Faktor</th>
                <th className="px-2 py-2">Arbeitszeit-Modell</th>
                <th className="px-2 py-2">Eigenes Wochen-Soll</th>
                <th className="px-2 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {profiles.map((p) => {
                const r = rows[p.id];
                if (!r) return null;
                const isDirty = dirty.has(p.id);
                return (
                  <tr key={p.id} className="border-t">
                    <td className="px-2 py-1 sticky left-0 bg-background font-medium">
                      {p.vorname} {p.nachname}
                      {isDirty && (
                        <span className="text-amber-600 ml-1" title="ungespeicherte Änderungen">
                          ●
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-1">
                      <Input
                        type="date"
                        value={r.eintrittsdatum}
                        onChange={(e) => update(p.id, "eintrittsdatum", e.target.value)}
                        className="h-8 w-[130px]"
                      />
                    </td>
                    <td className="px-2 py-1">
                      <Input
                        type="number"
                        step="0.05"
                        min="0"
                        max="1"
                        value={r.beschaeftigungsgrad}
                        onChange={(e) =>
                          update(p.id, "beschaeftigungsgrad", e.target.value)
                        }
                        className="h-8 w-[70px]"
                      />
                    </td>
                    <td className="px-2 py-1">
                      <Input
                        type="number"
                        step="0.5"
                        value={r.tagesnorm_stunden}
                        onChange={(e) =>
                          update(p.id, "tagesnorm_stunden", e.target.value)
                        }
                        className="h-8 w-[60px]"
                      />
                    </td>
                    <td className="px-2 py-1">
                      <Input
                        type="number"
                        step="0.5"
                        value={r.urlaub_jahresanspruch_tage}
                        onChange={(e) =>
                          update(p.id, "urlaub_jahresanspruch_tage", e.target.value)
                        }
                        className="h-8 w-[70px]"
                      />
                    </td>
                    <td className="px-2 py-1">
                      <select
                        value={r.urlaub_modell}
                        onChange={(e) =>
                          update(p.id, "urlaub_modell", e.target.value as any)
                        }
                        className="h-8 w-[130px] rounded-md border bg-background px-1.5 text-xs"
                      >
                        <option value="fix_datum">Fix-Datum</option>
                        <option value="eintrittsdatum">Eintrittsdatum</option>
                        <option value="monatlich">Monatlich</option>
                      </select>
                    </td>
                    <td className="px-2 py-1">
                      <div className="flex items-center gap-1">
                        <Input
                          type="number"
                          min="1"
                          max="31"
                          value={r.urlaub_stichtag_tag}
                          onChange={(e) =>
                            update(p.id, "urlaub_stichtag_tag", e.target.value)
                          }
                          className="h-8 w-[50px]"
                          disabled={r.urlaub_modell !== "fix_datum"}
                        />
                        <span className="text-muted-foreground">/</span>
                        <Input
                          type="number"
                          min="1"
                          max="12"
                          value={r.urlaub_stichtag_monat}
                          onChange={(e) =>
                            update(p.id, "urlaub_stichtag_monat", e.target.value)
                          }
                          className="h-8 w-[50px]"
                          disabled={r.urlaub_modell !== "fix_datum"}
                        />
                      </div>
                    </td>
                    <td className="px-2 py-1">
                      <Input
                        type="number"
                        step="0.1"
                        value={r.za_faktor}
                        onChange={(e) => update(p.id, "za_faktor", e.target.value)}
                        className="h-8 w-[70px]"
                      />
                    </td>
                    <td className="px-2 py-1">
                      <select
                        value={r.arbeitszeitmodell}
                        onChange={(e) =>
                          update(p.id, "arbeitszeitmodell", e.target.value as any)
                        }
                        className="h-8 w-[150px] rounded-md border bg-background px-1.5 text-xs"
                      >
                        <option value="zimmerei_sommer">Wechsel L/K</option>
                        <option value="angestellter">Angestellter (8,5 Mo–Do, 5 Fr)</option>
                        <option value="fix_40h">Fix 40 h Mo–Fr</option>
                        <option value="individuell">Individuell (Tagesnorm)</option>
                      </select>
                    </td>
                    <td className="px-2 py-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 px-2 text-xs font-normal whitespace-nowrap"
                        onClick={() => setWsOffen(p)}
                        title="Sollstunden je Wochentag (z. B. geringfügig)"
                      >
                        {wochenSoll[p.id] ? wochenSollText(wochenSoll[p.id]!) : "— festlegen"}
                      </Button>
                    </td>
                    <td className="px-2 py-1">
                      <Button
                        size="sm"
                        variant={isDirty ? "default" : "outline"}
                        onClick={() => saveOne(p.id)}
                        disabled={!isDirty}
                      >
                        Speichern
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {wsOffen && (
        <WochenSollDialog
          person={wsOffen}
          wert={wochenSoll[wsOffen.id] ?? null}
          ohneZeile={!mitZeile.has(wsOffen.id)}
          onClose={() => setWsOffen(null)}
          onSaved={(ws) => {
            setWochenSoll((m) => ({ ...m, [wsOffen.id]: ws }));
            setMitZeile((m) => new Set(m).add(wsOffen.id));
            setWsOffen(null);
          }}
        />
      )}
    </div>
  );
}
