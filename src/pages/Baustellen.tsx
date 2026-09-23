import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Plus, Building2, ListOrdered, Search, Cloud, CloudOff, PencilRuler, ArrowRight } from "lucide-react";
import { KostenstellenListe } from "@/components/baustellen/KostenstellenListe";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { BaustellenmeldungForm, type BaustellenArt } from "@/components/BaustellenmeldungForm";
import { SharePointVerknuepfenDialog } from "@/components/baustelle/SharePointVerknuepfenDialog";
import type { Database, BaustellenStatus } from "@/integrations/supabase/types";

type Baustelle = Database["public"]["Tables"]["baustellen"]["Row"];
type Partie = Database["public"]["Tables"]["partien"]["Row"];

const STATUS_LABEL: Record<BaustellenStatus, string> = {
  geplant: "Geplant",
  aktiv: "Aktiv",
  pausiert: "Pausiert",
  abgeschlossen: "Abgeschlossen",
};

export default function Baustellen() {
  const { canCreateBaustelle, user, isAdmin, canReview } = useAuth();
  /** Baustelle, für die gerade ein SharePoint-Ordner gesucht wird. */
  const [verknuepfen, setVerknuepfen] = useState<Baustelle | null>(null);
  const navigate = useNavigate();
  const [data, setData] = useState<Baustelle[]>([]);
  const [partien, setPartien] = useState<Partie[]>([]);
  // Suche + Statusfilter liegen in der URL, nicht in lokalem State: Beim
  // Öffnen einer Baustelle und Zurückgehen wird die Seite neu gemountet —
  // lokaler State ginge dabei verloren. Über die URL bleibt die Suche
  // erhalten (und ist per Zurück-Taste/Teilen wiederherstellbar).
  const [params, setParams] = useSearchParams();
  const search = params.get("q") ?? "";
  // Reiter Baustellen/Planung/Kostenstellen — in der URL, damit Zurück-
  // Navigation aus einem Baustellenordner wieder im selben Reiter landet.
  type Reiter = "baustellen" | "planung" | "kostenstellen";
  const tabParam = params.get("tab");
  const tab: Reiter = tabParam === "kostenstellen" || tabParam === "planung" ? tabParam : "baustellen";
  const setTab = (t: Reiter) => {
    const n = new URLSearchParams(params);
    if (t !== "baustellen") n.set("tab", t);
    else n.delete("tab");
    setParams(n, { replace: true });
  };
  const statusFilter = params.get("status") ?? "alle";
  const setSearch = (v: string) => {
    const n = new URLSearchParams(params);
    if (v) n.set("q", v);
    else n.delete("q");
    setParams(n, { replace: true });
  };
  const setStatusFilter = (v: string) => {
    const n = new URLSearchParams(params);
    if (v && v !== "alle") n.set("status", v);
    else n.delete("status");
    setParams(n, { replace: true });
  };
  const [dialogOpen, setDialogOpen] = useState(false);
  /** Planung, die gerade in eine Ausführung übernommen wird. */
  const [uebernahmeVon, setUebernahmeVon] = useState<Baustelle | null>(null);

  const load = async () => {
    const [bs, p] = await Promise.all([
      supabase.from("baustellen").select("*").order("start_datum", { ascending: false }),
      supabase.from("partien").select("*").order("name"),
    ]);
    setData((bs.data as Baustelle[]) ?? []);
    setPartien((p.data as Partie[]) ?? []);
  };

  useEffect(() => {
    load();
    // Realtime: bei jeder Mutation an baustellen oder partien neu laden
    const ch = supabase
      .channel("baustellen-liste")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "baustellen" },
        () => load(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "partien" },
        () => load(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, []);

  const artVon = (b: Baustelle): BaustellenArt => ((b as any).art === "planung" ? "planung" : "ausfuehrung");
  /** Baustellen bzw. Planungen — je nach Reiter. */
  const reiterListe = useMemo(
    () => data.filter((b) => artVon(b) === (tab === "planung" ? "planung" : "ausfuehrung")),
    [data, tab],
  );
  const kstVon = useMemo(() => new Map(data.map((b) => [b.id, b.kostenstelle])), [data]);

  const filtered = useMemo(() => {
    const list = reiterListe.filter((b) => {
      if (statusFilter !== "alle" && b.status !== statusFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        return (
          b.bvh_name.toLowerCase().includes(q) ||
          (b.kostenstelle ?? "").toLowerCase().includes(q) ||
          (b.bauherr ?? "").toLowerCase().includes(q) ||
          (b.ort ?? "").toLowerCase().includes(q)
        );
      }
      return true;
    });
    // Sortierung: Baustellen des angemeldeten Bauleiters zuerst, dann nach
    // Kostenstelle aufsteigend (14040xx zuerst). Ohne KST ans Ende.
    const kstKey = (b: (typeof data)[number]) => {
      const k = (b.kostenstelle ?? "").trim();
      return k ? k : "￿"; // leere KST hinten einsortieren
    };
    return [...list].sort((a, b) => {
      const aMine = user && a.bauleiter_id === user.id ? 0 : 1;
      const bMine = user && b.bauleiter_id === user.id ? 0 : 1;
      if (aMine !== bMine) return aMine - bMine;
      return kstKey(a).localeCompare(kstKey(b), "de", { numeric: true });
    });
  }, [reiterListe, search, statusFilter, user]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Baustellen"
        description="Alle Baustellen mit Stammdaten, Status und Zuordnungen."
        actions={
          canCreateBaustelle ? (
            <Button onClick={() => setDialogOpen(true)}>
              <Plus className="h-4 w-4 mr-2" /> {tab === "planung" ? "Neue Planung" : "Neue Baustelle"}
            </Button>
          ) : undefined
        }
      />

      {/* Umschalter wie Jahresplanung (Poliereinsatz/Mitarbeiter) und
          Tätigkeitsbericht (Bericht/Fahrtenbuch) */}
      <div className="flex items-center gap-2">
        <Button
          variant={tab === "baustellen" ? "default" : "outline"}
          size="sm"
          onClick={() => setTab("baustellen")}
        >
          <Building2 className="h-4 w-4 mr-1.5" /> Baustellen
        </Button>
        <Button
          variant={tab === "planung" ? "default" : "outline"}
          size="sm"
          onClick={() => setTab("planung")}
        >
          <PencilRuler className="h-4 w-4 mr-1.5" /> Planung
        </Button>
        <Button
          variant={tab === "kostenstellen" ? "default" : "outline"}
          size="sm"
          onClick={() => setTab("kostenstellen")}
        >
          <ListOrdered className="h-4 w-4 mr-1.5" /> Kostenstellen
        </Button>
      </div>

      {tab === "kostenstellen" && <KostenstellenListe baustellen={data} />}

      {tab !== "kostenstellen" && (
      <>
      <Card>
        <CardContent className="p-3 flex flex-col sm:flex-row gap-2 sm:gap-3 items-stretch sm:items-center">
          <div className="relative flex-1 sm:max-w-sm">
            <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Suche BVH, Kostenstelle, Bauherr, Ort"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 h-11 sm:h-10"
            />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-full sm:w-44 h-11 sm:h-10">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="alle">Alle Status</SelectItem>
              <SelectItem value="aktiv">Aktiv</SelectItem>
              <SelectItem value="geplant">Geplant</SelectItem>
              <SelectItem value="pausiert">Pausiert</SelectItem>
              <SelectItem value="abgeschlossen">Abgeschlossen</SelectItem>
            </SelectContent>
          </Select>
          <div className="text-xs text-muted-foreground">
            {filtered.length} / {reiterListe.length} {tab === "planung" ? "Planungen" : "Baustellen"}
            <span className="ml-2">
              · {reiterListe.filter((x) => (x as any).sharepoint_item_id).length} mit OneDrive
            </span>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {filtered.map((b) => {
          const partie = partien.find((p) => p.id === b.partie_id);
          const istPlanung = artVon(b) === "planung";
          const inAusfuehrung: string | null = (b as any).in_ausfuehrung_id ?? null;
          const ausPlanung: string | null = (b as any).aus_planung_id ?? null;
          return (
            <Link to={`/baustellen/${b.id}`} key={b.id}>
              <Card className="hover:shadow-md hover:border-primary/40 transition-all h-full">
                <CardContent className="p-4 space-y-2">
                  <div className="flex items-start gap-2">
                    <div className="h-10 w-10 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
                      {istPlanung ? (
                        <PencilRuler className="h-5 w-5 text-primary" />
                      ) : (
                        <Building2 className="h-5 w-5 text-primary" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold truncate">{b.bvh_name}</div>
                      <div className="text-xs text-muted-foreground truncate">
                        {b.kostenstelle ?? "—"}
                      </div>
                    </div>
                    <Badge variant="outline">
                      {istPlanung && inAusfuehrung ? "Übernommen" : STATUS_LABEL[b.status]}
                    </Badge>
                  </div>
                  {istPlanung && inAusfuehrung && (
                    <button
                      type="button"
                      onClick={(e) => {
                        // Die Karte ist selbst ein Link — kein <a> im <a>.
                        e.preventDefault();
                        e.stopPropagation();
                        navigate(`/baustellen/${inAusfuehrung}`);
                      }}
                      className="inline-flex items-center gap-1 rounded-full bg-emerald-50 border border-emerald-200 px-2 py-0.5 text-[10px] font-medium text-emerald-800 hover:underline"
                    >
                      <ArrowRight className="h-3 w-3" />
                      In Ausführung: {kstVon.get(inAusfuehrung) ?? "Baustelle"}
                    </button>
                  )}
                  {istPlanung && !inAusfuehrung && canCreateBaustelle && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-8 w-full"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setUebernahmeVon(b);
                      }}
                    >
                      <ArrowRight className="h-3.5 w-3.5 mr-1.5" /> In Ausführung übernehmen
                    </Button>
                  )}
                  {!istPlanung && ausPlanung && (
                    <div className="text-[10px] text-muted-foreground">
                      Aus Planung {kstVon.get(ausPlanung) ?? ""}
                    </div>
                  )}
                  {/* Übernommene Planung: OneDrive liegt jetzt bei der Baustelle */}
                  {istPlanung && inAusfuehrung ? null : (b as any).sharepoint_item_id ? (
                    <div
                      className="inline-flex items-center gap-1 rounded-full bg-sky-50 border border-sky-200 px-2 py-0.5 text-[10px] font-medium text-sky-800"
                      title={(b as any).sharepoint_pfad ?? ""}
                    >
                      <Cloud className="h-3 w-3" />
                      OneDrive verknüpft
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="inline-flex items-center gap-1 rounded-full bg-muted border px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                        <CloudOff className="h-3 w-3" />
                        Nicht verknüpft
                      </span>
                      {(isAdmin || canReview) && (
                        <button
                          type="button"
                          onClick={(e) => {
                            // Die Karte ist ein Link — der Knopf darf nicht mitnavigieren.
                            e.preventDefault();
                            e.stopPropagation();
                            setVerknuepfen(b);
                          }}
                          className="text-[10px] font-medium text-primary hover:underline"
                        >
                          Mit OneDrive verknüpfen
                        </button>
                      )}
                    </div>
                  )}
                  <div className="text-xs space-y-0.5">
                    {b.bauherr && (
                      <div>
                        <span className="text-muted-foreground">Bauherr: </span>
                        {b.bauherr}
                      </div>
                    )}
                    {(b.ort || b.plz) && (
                      <div>
                        <span className="text-muted-foreground">Ort: </span>
                        {[b.plz, b.ort].filter(Boolean).join(" ")}
                      </div>
                    )}
                    <div>
                      <span className="text-muted-foreground">Zeitraum: </span>
                      {b.start_datum
                        ? new Date(b.start_datum).toLocaleDateString("de-AT")
                        : "—"}{" "}
                      →{" "}
                      {b.end_datum ? new Date(b.end_datum).toLocaleDateString("de-AT") : "offen"}
                    </div>
                    {partie && (
                      <div>
                        <span className="text-muted-foreground">Partie: </span>
                        <Badge
                          variant="outline"
                          style={{ borderColor: partie.farbcode, color: partie.farbcode }}
                          className="text-[10px]"
                        >
                          {partie.name}
                        </Badge>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            </Link>
          );
        })}
        {filtered.length === 0 && (
          <Card className="md:col-span-2 lg:col-span-3">
            <CardContent className="p-8 text-center text-sm text-muted-foreground space-y-3">
              {reiterListe.length === 0 ? (
                <>
                  <div>{tab === "planung" ? "Noch keine Planungen angelegt." : "Noch keine Baustellen angelegt."}</div>
                  {canCreateBaustelle && (
                    <div>
                      <Button onClick={() => setDialogOpen(true)} size="sm">
                        <Plus className="h-4 w-4 mr-2" /> {tab === "planung" ? "Erste Planung anlegen" : "Erste Baustelle anlegen"}
                      </Button>
                    </div>
                  )}
                </>
              ) : (
                <>
                  <div>
                    Nichts passt zu deinem Filter. Filter ändern oder zurücksetzen.
                  </div>
                  <div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setSearch("");
                        setStatusFilter("alle");
                      }}
                    >
                      Filter zurücksetzen
                    </Button>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        )}
      </div>
      </>
      )}

      <SharePointVerknuepfenDialog
        open={!!verknuepfen}
        onClose={() => setVerknuepfen(null)}
        baustelleId={verknuepfen?.id ?? ""}
        kostenstelle={verknuepfen?.kostenstelle ?? null}
        bvhName={verknuepfen?.bvh_name ?? ""}
        onVerknuepft={load}
      />

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{tab === "planung" ? "Neue Planung" : "Baustellenmeldung"}</DialogTitle>
          </DialogHeader>
          <BaustellenmeldungForm
            vorwahl={tab === "planung" ? "planung" : undefined}
            onCancel={() => setDialogOpen(false)}
            onSaved={() => {
              setDialogOpen(false);
              load();
            }}
          />
        </DialogContent>
      </Dialog>

      <Dialog open={!!uebernahmeVon} onOpenChange={(o) => !o && setUebernahmeVon(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>In Ausführung übernehmen</DialogTitle>
          </DialogHeader>
          {uebernahmeVon && (
            <BaustellenmeldungForm
              initial={uebernahmeVon}
              modus="uebernahme"
              onCancel={() => setUebernahmeVon(null)}
              onSaved={() => {
                setUebernahmeVon(null);
                load();
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
