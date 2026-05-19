import { useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { CalendarCheck, Lock, Unlock } from "lucide-react";
import type { Database } from "@/integrations/supabase/types";
import {
  fmtStunden,
  monatsSoll,
  ladeKalenderMap,
  type TagessollKalender,
} from "@/lib/konten";
import type { ArbeitszeitModell } from "@/integrations/supabase/types";

type Profile = Database["public"]["Tables"]["profiles"]["Row"];
type Monatsabschluss = Database["public"]["Tables"]["monatsabschluss"]["Row"];
type PKS = Database["public"]["Tables"]["profile_konten_settings"]["Row"];

function thisMonthIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function prevMonthIso(): string {
  const d = new Date();
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function AdminMonatsabschluss() {
  const { toast } = useToast();
  const [monat, setMonat] = useState<string>(prevMonthIso());
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [settings, setSettings] = useState<Record<string, PKS>>({});
  const [abschluss, setAbschluss] = useState<Record<string, Monatsabschluss>>({});
  const [ist, setIst] = useState<Record<string, number>>({});
  const [running, setRunning] = useState(false);
  const [kalender, setKalender] = useState<Map<string, TagessollKalender>>(
    new Map()
  );

  const load = async () => {
    const [year, month] = monat.split("-").map(Number);
    const start = `${year}-${String(month).padStart(2, "0")}-01`;
    const endDate = new Date(year, month, 1);
    const end = `${endDate.getFullYear()}-${String(endDate.getMonth() + 1).padStart(2, "0")}-${String(endDate.getDate()).padStart(2, "0")}`;

    const [{ data: ps }, { data: pks }, { data: ma }, { data: stunden }] =
      await Promise.all([
        supabase.from("profiles").select("*").eq("is_active", true).order("nachname"),
        supabase.from("profile_konten_settings").select("*"),
        supabase.from("monatsabschluss").select("*").eq("monat", monat),
        supabase
          .from("stundenbuchungen")
          .select("mitarbeiter_id, arbeitsstunden, fahrstunden, fehlzeit_stunden")
          .gte("datum", start)
          .lt("datum", end),
      ]);
    setProfiles((ps as Profile[]) ?? []);
    const sMap: Record<string, PKS> = {};
    ((pks as PKS[]) ?? []).forEach((s) => (sMap[s.profile_id] = s));
    setSettings(sMap);
    const aMap: Record<string, Monatsabschluss> = {};
    ((ma as Monatsabschluss[]) ?? []).forEach(
      (a) => (aMap[a.mitarbeiter_id] = a)
    );
    setAbschluss(aMap);
    const iMap: Record<string, number> = {};
    ((stunden as any[]) ?? []).forEach((s) => {
      iMap[s.mitarbeiter_id] =
        (iMap[s.mitarbeiter_id] ?? 0) +
        Number(s.arbeitsstunden ?? 0) +
        Number(s.fahrstunden ?? 0) +
        Number(s.fehlzeit_stunden ?? 0);
    });
    setIst(iMap);
  };

  useEffect(() => {
    load();
    const [yr] = monat.split("-").map(Number);
    ladeKalenderMap(yr).then(setKalender);
  }, [monat]);

  const [year, month] = monat.split("-").map(Number);

  const sollFor = (uid: string): number => {
    const s = settings[uid];
    const tagesnorm = Number(s?.tagesnorm_stunden ?? 8);
    const grad = Number(s?.beschaeftigungsgrad ?? 1);
    const modell =
      (s?.arbeitszeitmodell as ArbeitszeitModell) ?? "zimmerei_sommer";
    return monatsSoll(year, month, kalender, modell, tagesnorm, grad);
  };

  const offene = profiles.filter((p) => !abschluss[p.id]);

  const closeAll = async () => {
    // Validierung: alle offenen Tage im Monat müssen mindestens 'buero_freigabe' haben
    const fromDate = `${monat}-01`;
    const toDateD = new Date(fromDate);
    toDateD.setMonth(toDateD.getMonth() + 1);
    toDateD.setDate(0);
    const toDate = toDateD.toISOString().slice(0, 10);
    const { count: ungesichert } = await supabase
      .from("stunden_tage")
      .select("id", { count: "exact", head: true })
      .gte("datum", fromDate)
      .lte("datum", toDate)
      .in("status", ["erfasst", "ma_bestaetigt", "zm_freigabe"]);
    if (ungesichert && ungesichert > 0) {
      toast({
        variant: "destructive",
        title: "Monat kann nicht abgeschlossen werden",
        description: `${ungesichert} Tag(e) sind noch nicht im Status „Büro-Freigabe" oder „Exportiert". Bitte erst freigeben/exportieren.`,
      });
      return;
    }
    if (!confirm(`Monat ${monat} für ${offene.length} Mitarbeiter abschließen?`))
      return;
    setRunning(true);
    const { error } = await supabase.rpc("monatsabschluss_durchfuehren" as any, {
      p_monat: monat,
      p_mitarbeiter_id: null,
    });
    setRunning(false);
    if (error) {
      toast({ variant: "destructive", title: "Fehler", description: error.message });
      return;
    }
    toast({ title: `Monat ${monat} abgeschlossen` });
    load();
  };

  const closeOne = async (uid: string) => {
    if (!confirm(`Monat ${monat} für diesen Mitarbeiter abschließen?`)) return;
    const { error } = await supabase.rpc("monatsabschluss_durchfuehren" as any, {
      p_monat: monat,
      p_mitarbeiter_id: uid,
    });
    if (error) {
      toast({ variant: "destructive", title: "Fehler", description: error.message });
      return;
    }
    toast({ title: "Monat abgeschlossen" });
    load();
  };

  const openOne = async (uid: string) => {
    if (
      !confirm(
        `Monat ${monat} für diesen Mitarbeiter wieder öffnen?\nDie ZA-Buchung wird gelöscht.`
      )
    )
      return;
    const { error } = await supabase.rpc("monatsabschluss_oeffnen" as any, {
      p_monat: monat,
      p_mitarbeiter_id: uid,
    });
    if (error) {
      toast({ variant: "destructive", title: "Fehler", description: error.message });
      return;
    }
    toast({ title: "Monat geöffnet" });
    load();
  };

  return (
    <div className="space-y-3">
      <Card>
        <CardContent className="p-3 flex items-center gap-2 flex-wrap">
          <CalendarCheck className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold">Monatsabschluss</span>
          <Input
            type="month"
            value={monat}
            onChange={(e) => setMonat(e.target.value)}
            className="h-9 w-[150px] ml-2"
          />
          <span className="text-xs text-muted-foreground">
            {profiles.length - offene.length}/{profiles.length} abgeschlossen
          </span>
          <Button
            onClick={closeAll}
            disabled={offene.length === 0 || running}
            className="ml-auto"
            size="sm"
          >
            <Lock className="h-4 w-4 mr-1" />
            Alle offenen abschließen ({offene.length})
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="bg-muted text-xs">
              <tr>
                <th className="text-left px-3 py-2">Mitarbeiter</th>
                <th className="text-right px-3 py-2">Soll</th>
                <th className="text-right px-3 py-2">Ist</th>
                <th className="text-right px-3 py-2">Differenz</th>
                <th className="text-left px-3 py-2">Status</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {profiles.map((p) => {
                const ma = abschluss[p.id];
                const sollVal = ma ? Number(ma.soll_stunden) : sollFor(p.id);
                const istVal = ma ? Number(ma.ist_stunden) : ist[p.id] ?? 0;
                const diff = istVal - sollVal;
                return (
                  <tr key={p.id} className="border-t">
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
                    <td className="px-3 py-2 text-right tabular-nums">
                      {sollVal.toFixed(1).replace(".", ",")} h
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {istVal.toFixed(1).replace(".", ",")} h
                    </td>
                    <td
                      className={`px-3 py-2 text-right tabular-nums font-semibold ${
                        diff < 0 ? "text-red-700" : diff > 0 ? "text-emerald-700" : ""
                      }`}
                    >
                      {fmtStunden(diff)}
                    </td>
                    <td className="px-3 py-2">
                      {ma ? (
                        <span className="text-[10px] uppercase tracking-wide font-bold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-900 border border-emerald-300">
                          Abgeschlossen
                        </span>
                      ) : (
                        <span className="text-[10px] uppercase tracking-wide font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-900 border border-amber-300">
                          Offen
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {ma ? (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => openOne(p.id)}
                        >
                          <Unlock className="h-3.5 w-3.5 mr-1" />
                          Öffnen
                        </Button>
                      ) : (
                        <Button size="sm" onClick={() => closeOne(p.id)}>
                          <Lock className="h-3.5 w-3.5 mr-1" />
                          Abschließen
                        </Button>
                      )}
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
