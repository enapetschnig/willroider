import { useEffect, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { CheckCircle2, XCircle, Download } from "lucide-react";
import type { Database, StundenStatus } from "@/integrations/supabase/types";

type Stunde = Database["public"]["Tables"]["stundenbuchungen"]["Row"];
type Profile = Database["public"]["Tables"]["profiles"]["Row"];
type Baustelle = Database["public"]["Tables"]["baustellen"]["Row"];

const TAB_STATUS: Record<string, StundenStatus[]> = {
  offen: ["offen"],
  zm: ["zm_freigabe"],
  buero: ["buero_freigabe"],
  exportiert: ["exportiert"],
  abgelehnt: ["abgelehnt"],
};

export default function StundenFreigabe() {
  const { user, role, canReview } = useAuth();
  const { toast } = useToast();
  const [tab, setTab] = useState("zm");
  const [rows, setRows] = useState<Stunde[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [baustellen, setBaustellen] = useState<Baustelle[]>([]);
  const [reject, setReject] = useState<Stunde | null>(null);

  const load = async () => {
    const statuses = TAB_STATUS[tab];
    const [r, p, b] = await Promise.all([
      supabase
        .from("stundenbuchungen")
        .select("*")
        .in("status", statuses)
        .order("datum", { ascending: false })
        .limit(500),
      supabase.from("profiles").select("*"),
      supabase.from("baustellen").select("*"),
    ]);
    setRows((r.data as Stunde[]) ?? []);
    setProfiles((p.data as Profile[]) ?? []);
    setBaustellen((b.data as Baustelle[]) ?? []);
  };

  useEffect(() => {
    load();
  }, [tab]);

  if (!canReview) {
    return (
      <Card>
        <CardContent className="p-8 text-center text-sm text-muted-foreground">
          Keine Berechtigung zur Stundenfreigabe.
        </CardContent>
      </Card>
    );
  }

  const approveZM = async (id: string) => {
    if (!user) return;
    const { error } = await supabase
      .from("stundenbuchungen")
      .update({
        status: "buero_freigabe",
        freigegeben_zm_id: user.id,
        freigegeben_zm_am: new Date().toISOString(),
      })
      .eq("id", id);
    if (error) {
      toast({ variant: "destructive", title: "Fehler", description: error.message });
    } else {
      toast({ title: "ZM-Freigabe erteilt" });
      load();
    }
  };

  const approveBuero = async (id: string) => {
    if (!user) return;
    const { error } = await supabase
      .from("stundenbuchungen")
      .update({
        status: "exportiert",
        freigegeben_buero_id: user.id,
        freigegeben_buero_am: new Date().toISOString(),
      })
      .eq("id", id);
    if (error) {
      toast({ variant: "destructive", title: "Fehler", description: error.message });
    } else {
      toast({ title: "Büro-Freigabe erteilt – exportbereit" });
      load();
    }
  };

  const submitReject = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!reject) return;
    const fd = new FormData(e.currentTarget);
    const grund = fd.get("grund") as string;
    await supabase
      .from("stundenbuchungen")
      .update({ status: "abgelehnt", abgelehnt_grund: grund })
      .eq("id", reject.id);
    toast({ title: "Buchung abgelehnt" });
    setReject(null);
    load();
  };

  const exportCSV = () => {
    const exportRows = rows.filter((r) => r.status === "buero_freigabe");
    if (exportRows.length === 0) {
      toast({ title: "Keine Daten zum Export", variant: "destructive" });
      return;
    }
    const header = [
      "Datum",
      "Mitarbeiter",
      "PersNr",
      "Kostenstelle",
      "Baustelle",
      "Arbeitsstunden",
      "Fahrstunden",
      "TG_Kurz",
      "TG_Lang",
      "KM",
      "Fehlzeit",
      "Fz_Stunden",
      "Tätigkeit",
    ];
    const lines = [header.join(";")];
    exportRows.forEach((r) => {
      const p = profiles.find((x) => x.id === r.mitarbeiter_id);
      const b = baustellen.find((x) => x.id === r.baustelle_id);
      lines.push(
        [
          r.datum,
          p ? `${p.nachname} ${p.vorname}` : r.mitarbeiter_id,
          p?.pers_nr ?? "",
          b?.kostenstelle ?? "",
          b?.bvh_name ?? "",
          r.arbeitsstunden ?? 0,
          r.fahrstunden ?? 0,
          r.taggeld_kurz ?? 0,
          r.taggeld_lang ?? 0,
          r.km_gefahren ?? 0,
          r.fehlzeit_typ ?? "",
          r.fehlzeit_stunden ?? 0,
          (r.taetigkeit ?? "").replace(/;/g, ","),
        ].join(";")
      );
    });
    const csv = lines.join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `stunden_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast({ title: "CSV exportiert" });
  };

  const isZM = role === "zimmermeister";
  const isOfficeOrAdmin = role === "buero" || role === "geschaeftsfuehrung" || role === "bauleiter";

  return (
    <div className="space-y-4">
      <PageHeader
        title="Stunden-Freigaben"
        description="Zweistufige Freigabe: Zimmermeister (fachlich) → Büro (verrechnungsfähig)."
        actions={
          isOfficeOrAdmin ? (
            <Button onClick={exportCSV}>
              <Download className="h-4 w-4 mr-2" /> CSV exportieren
            </Button>
          ) : undefined
        }
      />

      <Tabs value={tab} onValueChange={setTab}>
        <div className="-mx-3 sm:mx-0 px-3 sm:px-0 overflow-x-auto pb-1">
          <TabsList className="inline-flex w-max">
            <TabsTrigger value="offen" className="shrink-0">Offen</TabsTrigger>
            <TabsTrigger value="zm" className="shrink-0">ZM-Freigabe</TabsTrigger>
            <TabsTrigger value="buero" className="shrink-0">Büro-Freigabe</TabsTrigger>
            <TabsTrigger value="exportiert" className="shrink-0">Exportiert</TabsTrigger>
            <TabsTrigger value="abgelehnt" className="shrink-0">Abgelehnt</TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value={tab}>
          <div className="space-y-2">
            {rows.map((r) => {
              const p = profiles.find((x) => x.id === r.mitarbeiter_id);
              const b = baustellen.find((x) => x.id === r.baustelle_id);
              return (
                <Card key={r.id}>
                  <CardContent className="p-3 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold text-sm">
                        {p?.vorname} {p?.nachname}
                        <span className="text-muted-foreground font-normal">
                          {" "}
                          · {new Date(r.datum).toLocaleDateString("de-AT")}
                        </span>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {b?.bvh_name ?? "Ohne Baustelle"}
                        {b?.kostenstelle ? ` · ${b.kostenstelle}` : ""}
                      </div>
                      {r.taetigkeit && (
                        <div className="text-xs">{r.taetigkeit}</div>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge variant="secondary">{Number(r.arbeitsstunden ?? 0).toFixed(1)}h</Badge>
                      {Number(r.fahrstunden ?? 0) > 0 && (
                        <Badge variant="outline">F {Number(r.fahrstunden).toFixed(1)}h</Badge>
                      )}
                      {r.fehlzeit_typ && (
                        <Badge variant="outline">
                          {r.fehlzeit_typ} {Number(r.fehlzeit_stunden ?? 0).toFixed(1)}h
                        </Badge>
                      )}
                      {tab === "zm" && isZM && (
                        <>
                          <Button size="sm" onClick={() => approveZM(r.id)}>
                            <CheckCircle2 className="h-4 w-4 mr-1" /> ZM-Freigabe
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => setReject(r)}>
                            <XCircle className="h-4 w-4 mr-1" /> Ablehnen
                          </Button>
                        </>
                      )}
                      {tab === "zm" && isOfficeOrAdmin && !isZM && (
                        <Button size="sm" onClick={() => approveZM(r.id)}>
                          ZM-Freigabe
                        </Button>
                      )}
                      {tab === "buero" && isOfficeOrAdmin && (
                        <>
                          <Button size="sm" onClick={() => approveBuero(r.id)}>
                            <CheckCircle2 className="h-4 w-4 mr-1" /> Büro-Freigabe
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => setReject(r)}>
                            <XCircle className="h-4 w-4 mr-1" /> Ablehnen
                          </Button>
                        </>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
            {rows.length === 0 && (
              <Card>
                <CardContent className="p-8 text-center text-sm text-muted-foreground">
                  Keine Buchungen in dieser Kategorie.
                </CardContent>
              </Card>
            )}
          </div>
        </TabsContent>
      </Tabs>

      <Dialog open={!!reject} onOpenChange={(o) => !o && setReject(null)}>
        <DialogContent className="max-w-sm sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Buchung ablehnen</DialogTitle>
          </DialogHeader>
          <form onSubmit={submitReject} className="space-y-3">
            <div className="space-y-1.5">
              <Label>Grund *</Label>
              <Textarea name="grund" rows={4} required />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setReject(null)}>
                Abbrechen
              </Button>
              <Button type="submit" variant="destructive">
                Ablehnen
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
