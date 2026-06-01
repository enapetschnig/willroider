/**
 * Eingehende Bausatz-Anfragen vom Kalkulator. Geschäftsführung/Büro sieht
 * die Liste, kann eine öffnen, den Status setzen und eine interne Notiz
 * schreiben. RLS schützt die Tabelle — diese Page rendert nur was der User
 * lesen darf.
 */

import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Loader2, Mail, FileText, Pencil } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { useNavigate } from "react-router-dom";

type Anfrage = Database["public"]["Tables"]["kalkulator_anfragen"]["Row"];
type Status = Anfrage["status"];

const STATUS_LABEL: Record<Status, string> = {
  eingegangen: "Eingegangen",
  in_bearbeitung: "In Bearbeitung",
  angeboten: "Angeboten",
  abgeschlossen: "Abgeschlossen",
  storniert: "Storniert",
};
const STATUS_CLS: Record<Status, string> = {
  eingegangen: "bg-amber-100 text-amber-900 border-amber-300",
  in_bearbeitung: "bg-blue-100 text-blue-900 border-blue-300",
  angeboten: "bg-violet-100 text-violet-900 border-violet-300",
  abgeschlossen: "bg-emerald-600 text-white border-emerald-700",
  storniert: "bg-slate-200 text-slate-700 border-slate-300",
};

function fmtEuro(n: number | null | undefined): string {
  if (n == null) return "—";
  return n.toLocaleString("de-AT", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }) + " €";
}
function fmtDt(iso: string): string {
  return new Date(iso).toLocaleString("de-AT", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function KalkulatorAnfragen() {
  const { toast } = useToast();
  const navigate = useNavigate();
  const [rows, setRows] = useState<Anfrage[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<Anfrage | null>(null);
  const [statusEdit, setStatusEdit] = useState<Status>("eingegangen");
  const [notizEdit, setNotizEdit] = useState("");

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("kalkulator_anfragen")
      .select("*")
      .order("erstellt_am", { ascending: false })
      .limit(200);
    if (error) {
      toast({ variant: "destructive", title: "Fehler", description: error.message });
    } else {
      setRows((data ?? []) as Anfrage[]);
    }
    setLoading(false);
  };
  useEffect(() => {
    load();
  }, []);

  const offene = useMemo(
    () => rows.filter((r) => r.status === "eingegangen" || r.status === "in_bearbeitung").length,
    [rows],
  );

  const openDetail = (a: Anfrage) => {
    setOpen(a);
    setStatusEdit(a.status);
    setNotizEdit(a.notiz_intern ?? "");
  };
  const saveDetail = async () => {
    if (!open) return;
    const { error } = await supabase
      .from("kalkulator_anfragen")
      .update({ status: statusEdit, notiz_intern: notizEdit || null })
      .eq("id", open.id);
    if (error) {
      toast({ variant: "destructive", title: "Fehler", description: error.message });
      return;
    }
    toast({ title: "Gespeichert" });
    setOpen(null);
    load();
  };

  return (
    <div className="space-y-4 max-w-5xl mx-auto">
      <PageHeader
        title="Bausatz-Anfragen"
        description="Eingehende Anfragen aus dem Kalkulator — vom Büro/GF zu bearbeiten."
      />

      <Card>
        <CardContent className="p-3 flex items-center gap-3 text-sm">
          <Badge variant="outline" className={STATUS_CLS.eingegangen}>
            {offene} offen
          </Badge>
          <span className="text-muted-foreground">
            Hier landen alle im Kalkulator gespeicherten Anfragen. Klick auf
            „Bearbeiten" öffnet die Anfrage wieder im Kalkulator — Positionen
            und Mengen lassen sich jederzeit anpassen und neu speichern.
          </span>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-4 flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Lade …
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead style={{ width: 150 }}>Eingegangen</TableHead>
                  <TableHead>Kunde</TableHead>
                  <TableHead style={{ width: 120 }}>Summe (netto)</TableHead>
                  <TableHead style={{ width: 70 }}>Pos.</TableHead>
                  <TableHead style={{ width: 180 }}>Status</TableHead>
                  <TableHead style={{ width: 60 }}></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-sm text-muted-foreground p-6">
                      Noch keine Anfragen.
                    </TableCell>
                  </TableRow>
                )}
                {rows.map((a) => (
                  <TableRow
                    key={a.id}
                    className="cursor-pointer hover:bg-muted/40"
                    onClick={() => openDetail(a)}
                  >
                    <TableCell className="font-medium text-xs">{fmtDt(a.erstellt_am)}</TableCell>
                    <TableCell>
                      <div className="font-medium">{a.kunde_name}</div>
                      {a.kunde_code && (
                        <div className="text-[11px] text-muted-foreground">
                          Code: {a.kunde_code}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="font-medium tabular-nums">
                      {fmtEuro(a.summe_netto)}
                    </TableCell>
                    <TableCell className="text-center text-sm">
                      {a.positionen_anzahl ?? 0}
                      {a.eigene_anzahl ? ` (+${a.eigene_anzahl})` : ""}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={STATUS_CLS[a.status]}>
                        {STATUS_LABEL[a.status]}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right whitespace-nowrap">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 mr-1"
                        onClick={(e) => {
                          e.stopPropagation();
                          navigate(`/kalkulator?anfrage=${a.id}`);
                        }}
                        title="Im Kalkulator bearbeiten"
                      >
                        <Pencil className="h-3.5 w-3.5 mr-1" /> Bearbeiten
                      </Button>
                      <FileText className="h-4 w-4 inline text-muted-foreground" />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!open} onOpenChange={(v) => !v && setOpen(null)}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              Anfrage von {open?.kunde_name}
              <span className="block text-xs text-muted-foreground font-normal">
                Eingegangen {open ? fmtDt(open.erstellt_am) : ""}
                {open?.versendet_an_mail
                  ? ` · Bestätigung gesendet an ${open.versendet_an_mail}`
                  : ""}
              </span>
            </DialogTitle>
          </DialogHeader>
          {open && (
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Status</Label>
                  <select
                    value={statusEdit}
                    onChange={(e) => setStatusEdit(e.target.value as Status)}
                    className="w-full h-9 rounded-md border bg-background px-2 text-sm"
                  >
                    {(Object.keys(STATUS_LABEL) as Status[]).map((s) => (
                      <option key={s} value={s}>
                        {STATUS_LABEL[s]}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <Label className="text-xs">Summe netto</Label>
                  <div className="h-9 flex items-center font-semibold tabular-nums">
                    {fmtEuro(open.summe_netto)}
                  </div>
                </div>
              </div>

              <div>
                <Label className="text-xs">Bedarf (vom Kunden)</Label>
                <pre className="text-xs whitespace-pre-wrap bg-muted/40 border rounded p-3 max-h-[300px] overflow-auto">
                  {open.bedarf_text ?? "—"}
                </pre>
              </div>

              <div>
                <Label className="text-xs">Interne Notiz</Label>
                <Textarea
                  rows={3}
                  value={notizEdit}
                  onChange={(e) => setNotizEdit(e.target.value)}
                  placeholder="z. B. zugewiesen an …, Rückruf am …"
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(null)}>
              Schließen
            </Button>
            <Button onClick={saveDetail}>
              <Mail className="h-4 w-4 mr-1.5" /> Speichern
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
