/**
 * „Evaluierung durchgeführt“ unterschreiben (Wunsch J. Maurer 27.10.2026):
 * Vortragender muss eingetragen sein, und wer die Baustelle anlegt,
 * unterschreibt die Evaluierung, BEVOR sie an die Mitarbeiter geht.
 *
 * Neu angelegte Unterweisungen sind bis dahin nicht freigegeben — die
 * Datenbank teilt sie niemandem zu (evaluierung_freigeben verteilt sie
 * dann sofort). Ältere, schon laufende kann man nachträglich unterschreiben.
 */

import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { UnterschriftDialog } from "@/components/UnterschriftDialog";
import type { Database } from "@/integrations/supabase/types";
import { PenLine } from "lucide-react";

type Eval = Database["public"]["Tables"]["evaluierungen"]["Row"];
type Person = { id: string; vorname: string | null; nachname: string | null };

const nameVon = (p: Person | undefined) => (p ? `${p.vorname ?? ""} ${p.nachname ?? ""}`.trim() : "");

export function EvaluierungFreigabe({ ev, onFertig }: { ev: Eval; onFertig: () => void }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [leute, setLeute] = useState<Person[]>([]);
  const [vortragender, setVortragender] = useState<string>(ev.vortragender_id ?? user?.id ?? "");
  const [signOffen, setSignOffen] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setVortragender(ev.vortragender_id ?? user?.id ?? "");
  }, [ev.id, ev.vortragender_id, user?.id]);

  useEffect(() => {
    supabase
      .from("profiles")
      .select("id, vorname, nachname")
      .eq("is_active", true)
      .order("nachname")
      .then(({ data }) => setLeute((data as Person[]) ?? []));
  }, []);

  const freigegeben = !!ev.freigegeben_am;
  const unterschrieben = !!ev.durchgefuehrt_unterschrift;

  const speichern = async (dataUrl: string) => {
    setBusy(true);
    const { error } = await (supabase as any).rpc("evaluierung_freigeben", {
      p_id: ev.id,
      p_unterschrift: dataUrl,
      p_vortragender: vortragender || null,
    });
    setBusy(false);
    if (error) {
      toast({ variant: "destructive", title: "Nicht gespeichert", description: error.message });
      return;
    }
    setSignOffen(false);
    toast({
      title: freigegeben ? "Evaluierung unterschrieben" : "Unterschrieben und an die Baustelle geschickt",
      description: freigegeben
        ? undefined
        : "Wer hier eingeteilt ist, bekommt die Unterweisung jetzt zum Unterschreiben.",
    });
    onFertig();
  };

  if (unterschrieben) {
    return (
      <div className="text-xs text-muted-foreground">
        Evaluierung durchgeführt und unterschrieben
        {ev.durchgefuehrt_am ? ` am ${new Date(ev.durchgefuehrt_am).toLocaleDateString("de-AT")}` : ""}
        {ev.vortragender_id ? ` · Vortragender: ${nameVon(leute.find((p) => p.id === ev.vortragender_id))}` : ""}
      </div>
    );
  }

  return (
    <div
      className={
        freigegeben
          ? "space-y-2 rounded border p-2"
          : "space-y-2 rounded border border-amber-300 bg-amber-50 p-2"
      }
    >
      <div className={freigegeben ? "text-xs text-muted-foreground" : "text-xs text-amber-900"}>
        {freigegeben ? (
          <>„Evaluierung durchgeführt“ ist noch nicht unterschrieben.</>
        ) : (
          <>
            <b>Noch nicht an die Baustelle geschickt.</b> Erst Vortragenden eintragen und die
            Evaluierung unterschreiben — dann bekommen die Mitarbeiter sie zum Unterschreiben.
          </>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-xs font-medium">Vortragender *</label>
        <select
          value={vortragender}
          onChange={(e) => setVortragender(e.target.value)}
          className="h-10 rounded-md border bg-background px-2 text-sm min-w-[12rem]"
        >
          <option value="">— bitte wählen —</option>
          {leute.map((p) => (
            <option key={p.id} value={p.id}>
              {p.nachname} {p.vorname}
            </option>
          ))}
        </select>
        <Button
          size="sm"
          className="h-10"
          disabled={!vortragender || busy}
          onClick={() => setSignOffen(true)}
        >
          <PenLine className="h-4 w-4 mr-1.5" />
          {freigegeben ? "Evaluierung unterschreiben" : "Unterschreiben und an Baustelle schicken"}
        </Button>
      </div>
      <UnterschriftDialog
        open={signOffen}
        onOpenChange={setSignOffen}
        onSave={speichern}
        busy={busy}
        titel="Evaluierung durchgeführt — Unterschrift"
      />
    </div>
  );
}
