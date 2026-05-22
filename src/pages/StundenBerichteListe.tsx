/**
 * Kontroll-Liste der Baustellenstundenberichte (Büro/Admin).
 * Periodenauswahl + Test-Button zum manuellen Erzeugen der Berichte.
 */

import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Sparkles, ChevronRight } from "lucide-react";
import type { StundenBerichtStatus } from "@/integrations/supabase/types";
import {
  useStundenBerichteList,
  useStundenBerichtAktionen,
} from "@/hooks/useStundenBericht";

const STATUS_BADGE: Record<StundenBerichtStatus, { label: string; cls: string }> = {
  offen: { label: "Offen", cls: "bg-slate-100 text-slate-800 border-slate-300" },
  unterschrieben: {
    label: "Unterschrieben",
    cls: "bg-blue-100 text-blue-900 border-blue-300",
  },
  bestaetigt: {
    label: "Bestätigt",
    cls: "bg-emerald-100 text-emerald-900 border-emerald-300",
  },
  versendet: {
    label: "Versendet",
    cls: "bg-emerald-100 text-emerald-900 border-emerald-300",
  },
};

export default function StundenBerichteListe() {
  const navigate = useNavigate();
  const { toast } = useToast();

  const now = new Date();
  const [monatIso, setMonatIso] = useState(
    `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`,
  );
  const [teil, setTeil] = useState<number>(now.getDate() <= 16 ? 1 : 2);

  const [jahr, monat] = useMemo(() => {
    const [y, m] = monatIso.split("-").map(Number);
    return [y, m];
  }, [monatIso]);

  const { data: berichte = [], isLoading } = useStundenBerichteList({
    jahr,
    monat,
    teil,
  });
  const aktionen = useStundenBerichtAktionen();

  const periodeLabel = `${new Date(jahr, monat - 1, 1).toLocaleDateString("de-AT", {
    month: "long",
    year: "numeric",
  })} · ${teil === 1 ? "Teil I (1.–16.)" : "Teil II (17.–Ende)"}`;

  const erzeugen = async () => {
    if (
      !window.confirm(
        `Baustellenstundenberichte für ${periodeLabel} erzeugen? Es werden nur fehlende Berichte angelegt.`,
      )
    )
      return;
    try {
      const n = await aktionen.erzeugen.mutateAsync({ jahr, monat, teil });
      toast({
        title:
          n > 0
            ? `${n} Bericht${n === 1 ? "" : "e"} erzeugt`
            : "Keine neuen Berichte — alle existieren bereits",
      });
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Fehler",
        description: (e as Error).message,
      });
    }
  };

  return (
    <div className="space-y-4 max-w-3xl mx-auto">
      <PageHeader title="Baustellenstundenberichte" />

      {/* Periodenauswahl + Erzeugen */}
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex items-end gap-3 flex-wrap">
            <div>
              <Label className="text-xs">Monat</Label>
              <Input
                type="month"
                value={monatIso}
                onChange={(e) => setMonatIso(e.target.value)}
                className="h-9"
              />
            </div>
            <div>
              <Label className="text-xs">Teil</Label>
              <div className="flex gap-1">
                <Button
                  size="sm"
                  variant={teil === 1 ? "default" : "outline"}
                  onClick={() => setTeil(1)}
                  className="h-9"
                >
                  1.–16.
                </Button>
                <Button
                  size="sm"
                  variant={teil === 2 ? "default" : "outline"}
                  onClick={() => setTeil(2)}
                  className="h-9"
                >
                  17.–Ende
                </Button>
              </div>
            </div>
          </div>
          <div className="flex items-center justify-between gap-2 flex-wrap border-t pt-3">
            <div className="text-xs text-muted-foreground">
              Erzeugt die Berichte für alle Mitarbeiter mit Stunden in dieser
              Periode (simuliert die Abend-Automatik).
            </div>
            <Button
              size="sm"
              onClick={erzeugen}
              disabled={aktionen.erzeugen.isPending}
            >
              {aktionen.erzeugen.isPending ? (
                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
              ) : (
                <Sparkles className="h-3.5 w-3.5 mr-1.5" />
              )}
              Berichte erzeugen
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Liste */}
      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-4 flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Lade…
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Mitarbeiter</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-12"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {berichte.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={3}
                      className="text-center text-sm text-muted-foreground p-6"
                    >
                      Keine Berichte für {periodeLabel}. Oben „Berichte erzeugen".
                    </TableCell>
                  </TableRow>
                )}
                {berichte.map((b) => {
                  const badge = STATUS_BADGE[b.status];
                  return (
                    <TableRow
                      key={b.id}
                      className="cursor-pointer hover:bg-muted/40"
                      onClick={() => navigate(`/stundenbericht/${b.id}`)}
                    >
                      <TableCell className="font-medium">
                        {b.mitarbeiter
                          ? `${b.mitarbeiter.nachname ?? ""} ${b.mitarbeiter.vorname ?? ""}`.trim()
                          : "—"}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={badge.cls}>
                          {badge.label}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
