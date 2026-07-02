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
import { Loader2, Sparkles, ChevronRight, Mail, AlertCircle } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import type { StundenBerichtStatus } from "@/integrations/supabase/types";
import {
  useStundenBerichteList,
  useStundenBerichtAktionen,
} from "@/hooks/useStundenBericht";
import { BsbVersendenDialog } from "@/components/BsbVersendenDialog";

const STATUS_BADGE: Record<StundenBerichtStatus, { label: string; cls: string }> = {
  offen: {
    label: "Mitarbeiter unterschreibt noch",
    cls: "bg-slate-100 text-slate-800 border-slate-300",
  },
  unterschrieben: {
    label: "Wartet auf Büro",
    cls: "bg-blue-100 text-blue-900 border-blue-300",
  },
  bestaetigt: {
    label: "Bestätigt (noch nicht versendet)",
    cls: "bg-emerald-100 text-emerald-900 border-emerald-300",
  },
  versendet: {
    label: "Abgeschlossen — versendet",
    cls: "bg-emerald-600 text-white border-emerald-700",
  },
};

const STATUS_ORDER: Record<StundenBerichtStatus, number> = {
  offen: 0,
  unterschrieben: 1,
  bestaetigt: 2,
  versendet: 3,
};

const fmtTag = (iso: string | null | undefined): string => {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("de-AT", { day: "2-digit", month: "2-digit" });
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

  const { data: berichteRaw = [], isLoading } = useStundenBerichteList({
    jahr,
    monat,
    teil,
  });
  /** Monat-übergreifende Sicht auf ALLE noch nicht versendeten Berichte:
   *  offen = wartet auf MA-Unterschrift, unterschrieben = wartet auf Büro,
   *  bestaetigt = noch nicht versendet. Wird oben permanent angezeigt,
   *  damit der Beta-Rückstand aus Vormonaten nicht unsichtbar bleibt. */
  const { data: offeneBerichte = [] } = useStundenBerichteList({
    status: ["offen", "unterschrieben", "bestaetigt"],
  });
  const aktionen = useStundenBerichtAktionen();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [versendenOpen, setVersendenOpen] = useState(false);

  // Sortierung: nach Status (offen → unterschrieben → bestaetigt → versendet),
  // innerhalb nach Mitarbeiter-Nachname.
  const berichte = useMemo(() => {
    return [...berichteRaw].sort((a, b) => {
      const sa = STATUS_ORDER[a.status] ?? 99;
      const sb = STATUS_ORDER[b.status] ?? 99;
      if (sa !== sb) return sa - sb;
      const na = (a.mitarbeiter?.nachname ?? "").toLowerCase();
      const nb = (b.mitarbeiter?.nachname ?? "").toLowerCase();
      return na.localeCompare(nb, "de-AT");
    });
  }, [berichteRaw]);

  // Versand erlaubt für alle Status außer „offen"
  const versendbar = berichte.filter((b) => b.status !== "offen");
  const allVersendbarSelected =
    versendbar.length > 0 &&
    versendbar.every((b) => selected.has(b.id));

  const toggleOne = (id: string) =>
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const toggleAll = () =>
    setSelected((prev) => {
      if (allVersendbarSelected) return new Set();
      return new Set(versendbar.map((b) => b.id));
    });

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

  const periodeLabelKurz = (jahr: number, monat: number, teil: number) =>
    `${new Date(jahr, monat - 1, 1).toLocaleDateString("de-AT", {
      month: "short",
      year: "numeric",
    })} · ${teil === 1 ? "T I" : "T II"}`;

  return (
    <div className="space-y-4 max-w-3xl mx-auto">
      <PageHeader title="Baustellenstundenberichte" />

      {/* Permanenter „Noch zu bearbeiten"-Block — zeigt monatsübergreifend
          alle Berichte im Status unterschrieben/bestaetigt. Damit bleiben
          alte Berichte nicht in Vormonaten unsichtbar. */}
      {offeneBerichte.length > 0 && (
        <Card className="border-amber-300 bg-amber-50/60">
          <CardContent className="p-3 space-y-2">
            <div className="flex items-center gap-1.5 text-sm font-semibold text-amber-900">
              <AlertCircle className="h-4 w-4" />
              {offeneBerichte.length} Bericht
              {offeneBerichte.length === 1 ? "" : "e"} warten auf Bearbeitung
            </div>
            <div className="divide-y divide-amber-200/70">
              {offeneBerichte.map((b) => {
                const badge = STATUS_BADGE[b.status];
                return (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => navigate(`/stundenbericht/${b.id}`)}
                    className="w-full flex items-center gap-2 py-1.5 text-left hover:bg-amber-100/60 rounded px-1"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">
                        {b.mitarbeiter
                          ? `${b.mitarbeiter.nachname ?? ""} ${b.mitarbeiter.vorname ?? ""}`.trim()
                          : "—"}
                        <span className="ml-2 text-xs text-muted-foreground font-normal">
                          {periodeLabelKurz(b.jahr, b.monat, b.teil)}
                        </span>
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        {b.unterschrieben_am
                          ? `Unterschrieben am ${fmtTag(b.unterschrieben_am)}`
                          : "Wartet auf Mitarbeiter-Unterschrift"}
                      </div>
                    </div>
                    <Badge variant="outline" className={`${badge.cls} text-[10px]`}>
                      {badge.label}
                    </Badge>
                    <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                  </button>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

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

      {/* Bulk-Aktion */}
      {selected.size > 0 && (
        <Card className="border-primary/40 bg-primary/5">
          <CardContent className="p-3 flex items-center gap-3 flex-wrap">
            <div className="text-sm">
              <strong>{selected.size}</strong> Bericht
              {selected.size === 1 ? "" : "e"} markiert
            </div>
            <div className="ml-auto flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setSelected(new Set())}
              >
                Auswahl löschen
              </Button>
              <Button size="sm" onClick={() => setVersendenOpen(true)}>
                <Mail className="h-3.5 w-3.5 mr-1.5" />
                Markierte ans Büro senden
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

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
                  <TableHead className="w-10">
                    <Checkbox
                      checked={allVersendbarSelected}
                      onCheckedChange={toggleAll}
                      aria-label="Alle versendbaren auswählen"
                      disabled={versendbar.length === 0}
                    />
                  </TableHead>
                  <TableHead>Mitarbeiter</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-12"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {berichte.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={4}
                      className="text-center text-sm text-muted-foreground p-6"
                    >
                      Keine Berichte für {periodeLabel}. Oben „Berichte erzeugen".
                    </TableCell>
                  </TableRow>
                )}
                {berichte.map((b) => {
                  const badge = STATUS_BADGE[b.status];
                  const istVersendbar = b.status !== "offen";
                  const unterschriebenTag = fmtTag(b.unterschrieben_am);
                  const versendetTag = fmtTag(b.versendet_am);
                  return (
                    <TableRow
                      key={b.id}
                      className="cursor-pointer hover:bg-muted/40"
                      onClick={() => navigate(`/stundenbericht/${b.id}`)}
                    >
                      <TableCell
                        className="w-10"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Checkbox
                          checked={selected.has(b.id)}
                          onCheckedChange={() => toggleOne(b.id)}
                          disabled={!istVersendbar}
                          aria-label="Bericht auswählen"
                        />
                      </TableCell>
                      <TableCell className="font-medium">
                        <div>
                          {b.mitarbeiter
                            ? `${b.mitarbeiter.nachname ?? ""} ${b.mitarbeiter.vorname ?? ""}`.trim()
                            : "—"}
                        </div>
                        {versendetTag ? (
                          <div className="text-xs text-muted-foreground font-normal">
                            Versendet am {versendetTag}
                            {b.versendet_an_mail
                              ? ` an ${b.versendet_an_mail}`
                              : ""}
                          </div>
                        ) : unterschriebenTag ? (
                          <div className="text-xs text-muted-foreground font-normal">
                            Unterschrieben am {unterschriebenTag}
                          </div>
                        ) : null}
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

      <BsbVersendenDialog
        open={versendenOpen}
        onOpenChange={setVersendenOpen}
        berichtIds={Array.from(selected)}
        onSent={() => {
          setSelected(new Set());
        }}
      />
    </div>
  );
}
