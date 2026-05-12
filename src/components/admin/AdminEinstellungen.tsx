import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { Settings, Save } from "lucide-react";
import type {
  Database,
  UrlaubModell,
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
};

export function AdminEinstellungen() {
  const { toast } = useToast();
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [rows, setRows] = useState<Record<string, Editable>>({});
  const [dirty, setDirty] = useState<Set<string>>(new Set());

  const load = async () => {
    const [{ data: ps }, { data: pks }] = await Promise.all([
      supabase.from("profiles").select("*").eq("is_active", true).order("nachname"),
      supabase.from("profile_konten_settings").select("*"),
    ]);
    setProfiles((ps as Profile[]) ?? []);
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
    </div>
  );
}
