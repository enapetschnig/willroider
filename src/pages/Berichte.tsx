/**
 * Berichte-Übersicht (Bautages- + Regieberichte).
 * - Filter: Baustelle / Datum / Status / Typ / Polier
 * - „Neuer Bericht"-Modal: wenn schon vorhanden für Tag+Baustelle+Typ → öffnen statt erstellen
 */

import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { FileText, Plus, Building2, FileCheck2, Loader2, ChevronRight } from "lucide-react";
import type { Database, BerichtStatus, BerichtTyp } from "@/integrations/supabase/types";
import { useBerichteList } from "@/hooks/useBerichte";
import { findeOderErstelleBericht } from "@/hooks/useBericht";

type Baustelle = Database["public"]["Tables"]["baustellen"]["Row"];
type Profile = Database["public"]["Tables"]["profiles"]["Row"];

const TYP_LABEL: Record<BerichtTyp, string> = {
  bautagesbericht: "Bautagesbericht",
  regiebericht: "Regiebericht",
};

const STATUS_BADGE: Record<BerichtStatus, { label: string; cls: string }> = {
  entwurf: { label: "Entwurf", cls: "bg-slate-100 text-slate-900 border-slate-300" },
  eingereicht: { label: "Eingereicht", cls: "bg-blue-100 text-blue-900 border-blue-300" },
  freigegeben: { label: "Freigegeben", cls: "bg-emerald-100 text-emerald-900 border-emerald-300" },
  archiviert: { label: "Archiviert", cls: "bg-gray-200 text-gray-900 border-gray-400" },
};

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}
function daysAgo(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

export default function Berichte() {
  const [params, setParams] = useSearchParams();
  const [baustellen, setBaustellen] = useState<Baustelle[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [openNeu, setOpenNeu] = useState(false);

  const filter = {
    fromDate: params.get("from") ?? daysAgo(30),
    toDate: params.get("to") ?? todayIso(),
    status: (params.get("status") as BerichtStatus) || undefined,
    typ: (params.get("typ") as BerichtTyp) || undefined,
    baustelleId: params.get("baustelle") ?? undefined,
  };
  const { data: berichte = [], isLoading } = useBerichteList(filter);

  useEffect(() => {
    (async () => {
      const [{ data: bs }, { data: ps }] = await Promise.all([
        supabase
          .from("baustellen")
          .select("*")
          .order("bvh_name"),
        supabase
          .from("profiles")
          .select("id, vorname, nachname")
          .eq("is_active", true)
          .order("nachname"),
      ]);
      setBaustellen((bs as Baustelle[]) ?? []);
      setProfiles((ps as Profile[]) ?? []);
    })();
  }, []);

  const baustelleById = useMemo(
    () => new Map(baustellen.map((b) => [b.id, b])),
    [baustellen],
  );
  const profileById = useMemo(
    () => new Map(profiles.map((p) => [p.id, p])),
    [profiles],
  );

  const setFilter = (key: string, val: string | null) => {
    const next = new URLSearchParams(params);
    if (val === null || val === "") next.delete(key);
    else next.set(key, val);
    setParams(next, { replace: true });
  };

  return (
    <div className="space-y-4 max-w-4xl mx-auto">
      <PageHeader
        title="Berichte"
        actions={
          <Button onClick={() => setOpenNeu(true)}>
            <Plus className="h-4 w-4 mr-1.5" /> Neuer Bericht
          </Button>
        }
      />

      {/* Filter */}
      <Card>
        <CardContent className="p-4 grid sm:grid-cols-5 gap-2">
          <div className="space-y-1">
            <Label className="text-xs">Von</Label>
            <Input
              type="date"
              value={filter.fromDate}
              onChange={(e) => setFilter("from", e.target.value)}
              className="h-9"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Bis</Label>
            <Input
              type="date"
              value={filter.toDate}
              onChange={(e) => setFilter("to", e.target.value)}
              className="h-9"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Typ</Label>
            <select
              value={filter.typ ?? ""}
              onChange={(e) => setFilter("typ", e.target.value || null)}
              className="h-9 w-full rounded-md border bg-background px-2 text-sm"
            >
              <option value="">alle</option>
              <option value="bautagesbericht">Bautagesbericht</option>
              <option value="regiebericht">Regiebericht</option>
            </select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Status</Label>
            <select
              value={filter.status ?? ""}
              onChange={(e) => setFilter("status", e.target.value || null)}
              className="h-9 w-full rounded-md border bg-background px-2 text-sm"
            >
              <option value="">alle</option>
              <option value="entwurf">Entwurf</option>
              <option value="eingereicht">Eingereicht</option>
              <option value="freigegeben">Freigegeben</option>
              <option value="archiviert">Archiviert</option>
            </select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Baustelle</Label>
            <select
              value={filter.baustelleId ?? ""}
              onChange={(e) => setFilter("baustelle", e.target.value || null)}
              className="h-9 w-full rounded-md border bg-background px-2 text-sm"
            >
              <option value="">alle</option>
              {baustellen.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.bvh_name}
                </option>
              ))}
            </select>
          </div>
        </CardContent>
      </Card>

      {/* Liste */}
      {isLoading ? (
        <Card>
          <CardContent className="p-6 flex items-center justify-center text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin mr-2" /> Lade…
          </CardContent>
        </Card>
      ) : berichte.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            <FileText className="h-10 w-10 mx-auto mb-2 opacity-30" />
            Keine Berichte im Filter.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {berichte.map((b) => {
            const bs = baustelleById.get(b.baustelle_id);
            const polier = b.erfasst_von ? profileById.get(b.erfasst_von) : null;
            const sb = STATUS_BADGE[b.status];
            return (
              <Link
                key={b.id}
                to={`/berichte/${b.id}`}
                className="block rounded-md border bg-card hover:bg-muted/40 transition p-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-sm tabular-nums">
                        {new Date(b.datum).toLocaleDateString("de-AT", {
                          weekday: "short",
                          day: "2-digit",
                          month: "2-digit",
                          year: "numeric",
                        })}
                      </span>
                      <Badge variant="outline" className="text-[10px]">
                        {TYP_LABEL[b.typ]}
                      </Badge>
                      <Badge variant="outline" className={`text-[10px] ${sb.cls}`}>
                        {sb.label}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-1.5 text-sm text-muted-foreground mt-1 truncate">
                      <Building2 className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate">{bs?.bvh_name ?? "—"}</span>
                    </div>
                    {polier && (
                      <div className="text-[11px] text-muted-foreground">
                        Polier: {polier.vorname} {polier.nachname}
                      </div>
                    )}
                  </div>
                  <ChevronRight className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" />
                </div>
              </Link>
            );
          })}
        </div>
      )}

      <NeuerBerichtDialog
        open={openNeu}
        onClose={() => setOpenNeu(false)}
        baustellen={baustellen}
      />
    </div>
  );
}

// ─── Neuer-Bericht-Modal ──────────────────────────────────────────────────

function NeuerBerichtDialog({
  open,
  onClose,
  baustellen,
}: {
  open: boolean;
  onClose: () => void;
  baustellen: Baustelle[];
}) {
  const { toast } = useToast();
  const navigate = useNavigate();
  const [datum, setDatum] = useState(todayIso());
  const [baustelleId, setBaustelleId] = useState("");
  const [typ, setTyp] = useState<BerichtTyp>("bautagesbericht");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open) {
      setDatum(todayIso());
      setBaustelleId("");
      setTyp("bautagesbericht");
    }
  }, [open]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!baustelleId) return;
    setLoading(true);
    try {
      const { id, created } = await findeOderErstelleBericht(baustelleId, datum, typ);
      toast({
        title: created ? "Bericht angelegt" : "Bericht existiert bereits — geöffnet",
      });
      onClose();
      navigate(`/berichte/${id}`);
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Fehler",
        description: (e as Error).message,
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && !loading && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileCheck2 className="h-5 w-5 text-primary" />
            Neuer Bericht
          </DialogTitle>
          <DialogDescription>
            Wenn für Tag + Baustelle + Typ schon ein Bericht existiert, wird der vorhandene
            geöffnet — kein Duplikat.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div className="space-y-1">
            <Label>Datum</Label>
            <Input
              type="date"
              value={datum}
              onChange={(e) => setDatum(e.target.value)}
              required
            />
          </div>
          <div className="space-y-1">
            <Label>Baustelle</Label>
            <select
              value={baustelleId}
              onChange={(e) => setBaustelleId(e.target.value)}
              required
              className="h-10 w-full rounded-md border bg-background px-3 text-sm"
            >
              <option value="">— wählen —</option>
              {baustellen.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.bvh_name}
                  {b.kostenstelle ? ` · ${b.kostenstelle}` : ""}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label>Typ</Label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setTyp("bautagesbericht")}
                className={`h-11 rounded-md border-2 text-sm font-semibold transition ${
                  typ === "bautagesbericht"
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border bg-background text-muted-foreground"
                }`}
              >
                Bautagesbericht
              </button>
              <button
                type="button"
                onClick={() => setTyp("regiebericht")}
                className={`h-11 rounded-md border-2 text-sm font-semibold transition ${
                  typ === "regiebericht"
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border bg-background text-muted-foreground"
                }`}
              >
                Regiebericht
              </button>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={loading}>
              Abbrechen
            </Button>
            <Button type="submit" disabled={!baustelleId || loading}>
              {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Öffnen / Anlegen
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
