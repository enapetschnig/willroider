import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
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
import { Plus, Building2, Search } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { BaustellenmeldungForm } from "@/components/BaustellenmeldungForm";
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
  const { canCreateBaustelle, user } = useAuth();
  const [data, setData] = useState<Baustelle[]>([]);
  const [partien, setPartien] = useState<Partie[]>([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("alle");
  const [dialogOpen, setDialogOpen] = useState(false);

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

  const filtered = useMemo(() => {
    const list = data.filter((b) => {
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
  }, [data, search, statusFilter, user]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Baustellen"
        description="Alle Baustellen mit Stammdaten, Status und Zuordnungen."
        actions={
          canCreateBaustelle ? (
            <Button onClick={() => setDialogOpen(true)}>
              <Plus className="h-4 w-4 mr-2" /> Neue Baustelle
            </Button>
          ) : undefined
        }
      />

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
            {filtered.length} / {data.length} Baustellen
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {filtered.map((b) => {
          const partie = partien.find((p) => p.id === b.partie_id);
          return (
            <Link to={`/baustellen/${b.id}`} key={b.id}>
              <Card className="hover:shadow-md hover:border-primary/40 transition-all h-full">
                <CardContent className="p-4 space-y-2">
                  <div className="flex items-start gap-2">
                    <div className="h-10 w-10 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
                      <Building2 className="h-5 w-5 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold truncate">{b.bvh_name}</div>
                      <div className="text-xs text-muted-foreground truncate">
                        {b.kostenstelle ?? "—"}
                      </div>
                    </div>
                    <Badge variant="outline">{STATUS_LABEL[b.status]}</Badge>
                  </div>
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
              {data.length === 0 ? (
                <>
                  <div>Noch keine Baustellen angelegt.</div>
                  {canCreateBaustelle && (
                    <div>
                      <Button onClick={() => setDialogOpen(true)} size="sm">
                        <Plus className="h-4 w-4 mr-2" /> Erste Baustelle anlegen
                      </Button>
                    </div>
                  )}
                </>
              ) : (
                <>
                  <div>
                    Keine Baustellen passen zu deinem Filter. Filter ändern oder zurücksetzen.
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

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Baustellenmeldung</DialogTitle>
          </DialogHeader>
          <BaustellenmeldungForm
            onCancel={() => setDialogOpen(false)}
            onSaved={() => {
              setDialogOpen(false);
              load();
            }}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}
