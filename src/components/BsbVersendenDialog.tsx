/**
 * Versendet einen oder mehrere Baustellenstundenberichte per Mail ans
 * Büro. Erzeugt pro Bericht das PDF im Browser, hängt sie an eine
 * gemeinsame Resend-Mail und triggert über die Edge-Function den
 * Status-Wechsel auf 'versendet' (RPC stunden_bericht_versenden, das
 * intern auch die Bestätigung mitsetzt, falls noch nötig).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, Mail, FileText } from "lucide-react";
import { buildBerichtPdf } from "@/lib/bsbPdfHelper";

interface PreparedAttachment {
  berichtId: string;
  filename: string;
  contentBase64: string;
  blobUrl: string;
  maName: string;
}

export function BsbVersendenDialog({
  open,
  onOpenChange,
  berichtIds,
  onSent,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  berichtIds: string[];
  onSent?: () => void;
}) {
  const { toast } = useToast();
  const [prepared, setPrepared] = useState<PreparedAttachment[]>([]);
  const [busyBuilding, setBusyBuilding] = useState(false);
  const [empfaenger, setEmpfaenger] = useState("");
  const [cc, setCc] = useState("");
  const [betreff, setBetreff] = useState("");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const isBulk = berichtIds.length > 1;

  // PDFs + Default-Empfänger laden, wenn der Dialog geöffnet wird
  useEffect(() => {
    if (!open) return;
    setPrepared([]);
    setSending(false);
    let cancelled = false;
    (async () => {
      setBusyBuilding(true);
      try {
        // Default-Empfänger aus app_einstellungen
        const { data: setting } = await supabase
          .from("app_einstellungen")
          .select("wert")
          .eq("schluessel", "bsb_buero_mail")
          .maybeSingle();
        if (!cancelled) {
          setEmpfaenger(((setting as any)?.wert as string) ?? "");
        }

        // PDFs der gewählten Berichte bauen (parallel, ca. 50–100 KB pro PDF)
        const built = await Promise.all(
          berichtIds.map(async (id) => {
            const { doc, fileName, maName } = await buildBerichtPdf(id);
            const blob = doc.output("blob") as Blob;
            const dataUrl = doc.output("datauristring") as unknown as string;
            const contentBase64 = dataUrl.split(",")[1] ?? "";
            return {
              berichtId: id,
              filename: fileName,
              contentBase64,
              blobUrl: URL.createObjectURL(blob),
              maName,
            } as PreparedAttachment;
          }),
        );
        if (cancelled) {
          built.forEach((p) => URL.revokeObjectURL(p.blobUrl));
          return;
        }
        setPrepared(built);

        // Betreff + Body sinnvoll vorbefüllen
        const titel =
          built.length === 1
            ? `Baustellenstundenbericht ${built[0].maName}`
            : `Baustellenstundenberichte (${built.length} MA)`;
        if (!cancelled) {
          setBetreff(titel);
          setBody(
            built.length === 1
              ? `Im Anhang der Baustellenstundenbericht für ${built[0].maName}.\n\nBei Rückfragen bitte melden.`
              : `Im Anhang die Baustellenstundenberichte für ${built.length} Mitarbeiter.\n\nBei Rückfragen bitte melden.`,
          );
        }
      } catch (e) {
        if (!cancelled) {
          toast({
            variant: "destructive",
            title: "PDF-Erzeugung fehlgeschlagen",
            description: (e as Error).message,
          });
        }
      } finally {
        if (!cancelled) setBusyBuilding(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // berichtIds als Stringliste, damit useEffect bei gleichem Inhalt nicht
    // erneut feuert
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, berichtIds.join(",")]);

  // Blob-URLs aufräumen, wenn Dialog schließt
  useEffect(() => {
    if (open) return;
    return () => {
      prepared.forEach((p) => URL.revokeObjectURL(p.blobUrl));
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const empfaengerValid = useMemo(
    () => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(empfaenger.trim()),
    [empfaenger],
  );
  const ccValid = useMemo(
    () => !cc.trim() || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cc.trim()),
    [cc],
  );

  const handleSend = useCallback(async () => {
    if (!empfaengerValid) {
      toast({
        variant: "destructive",
        title: "Empfänger ungültig",
        description: "Bitte gültige E-Mail-Adresse eintragen.",
      });
      return;
    }
    setSending(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) throw new Error("Nicht angemeldet");

      const { data, error } = await supabase.functions.invoke(
        "stundenbericht-versenden",
        {
          body: {
            empfaenger: empfaenger.trim(),
            cc: cc.trim() || undefined,
            betreff,
            text: body,
            attachments: prepared.map((p) => ({
              filename: p.filename,
              contentBase64: p.contentBase64,
            })),
            berichtIds: prepared.map((p) => p.berichtId),
          },
        },
      );
      if (error) throw error;
      const res = data as any;
      if (!res?.ok) {
        throw new Error(res?.error ?? "Versand fehlgeschlagen");
      }
      toast({
        title: `${res.count} Bericht${res.count === 1 ? "" : "e"} versendet`,
        description: `an ${res.sentTo}`,
      });
      onSent?.();
      onOpenChange(false);
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Versand-Fehler",
        description: (e as Error).message,
      });
    } finally {
      setSending(false);
    }
  }, [
    empfaengerValid,
    empfaenger,
    cc,
    betreff,
    body,
    prepared,
    onSent,
    onOpenChange,
    toast,
  ]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mail className="h-4 w-4" />
            {isBulk
              ? `${berichtIds.length} Berichte ans Büro senden`
              : "Bericht ans Büro senden"}
          </DialogTitle>
        </DialogHeader>

        {busyBuilding ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground p-4">
            <Loader2 className="h-4 w-4 animate-spin" />
            PDFs werden erzeugt …
          </div>
        ) : (
          <div className="space-y-3">
            {/* Empfänger + CC */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Empfänger (Büro) *</Label>
                <Input
                  type="email"
                  value={empfaenger}
                  onChange={(e) => setEmpfaenger(e.target.value)}
                  placeholder="buero@willroider.at"
                />
                {!empfaengerValid && empfaenger.length > 0 && (
                  <div className="text-[11px] text-destructive">
                    Ungültige E-Mail-Adresse
                  </div>
                )}
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">CC (optional)</Label>
                <Input
                  type="email"
                  value={cc}
                  onChange={(e) => setCc(e.target.value)}
                  placeholder=""
                />
                {!ccValid && (
                  <div className="text-[11px] text-destructive">
                    Ungültige CC-Adresse
                  </div>
                )}
              </div>
            </div>

            {/* Betreff + Body */}
            <div className="space-y-1.5">
              <Label className="text-xs">Betreff</Label>
              <Input
                value={betreff}
                onChange={(e) => setBetreff(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Nachricht</Label>
              <Textarea
                rows={4}
                value={body}
                onChange={(e) => setBody(e.target.value)}
              />
            </div>

            {/* PDF-Vorschau Akkordeon */}
            <div className="space-y-1.5">
              <Label className="text-xs">
                Anhänge ({prepared.length} PDF{prepared.length === 1 ? "" : "s"})
              </Label>
              <Accordion
                type="single"
                collapsible
                defaultValue={prepared.length === 1 ? "v-0" : undefined}
                className="border rounded-md divide-y"
              >
                {prepared.map((p, i) => (
                  <AccordionItem key={p.berichtId} value={`v-${i}`}>
                    <AccordionTrigger className="px-3 text-sm">
                      <div className="flex items-center gap-2 text-left">
                        <FileText className="h-4 w-4 text-primary shrink-0" />
                        <span className="font-medium">{p.maName}</span>
                        <Badge variant="outline" className="text-[10px] ml-2">
                          {p.filename}
                        </Badge>
                      </div>
                    </AccordionTrigger>
                    <AccordionContent className="px-3 pb-3">
                      <iframe
                        title={p.filename}
                        src={p.blobUrl}
                        className="w-full h-[400px] border rounded"
                      />
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={sending}
          >
            Abbrechen
          </Button>
          <Button
            onClick={handleSend}
            disabled={
              sending ||
              busyBuilding ||
              prepared.length === 0 ||
              !empfaengerValid ||
              !ccValid
            }
          >
            {sending ? (
              <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
            ) : (
              <Mail className="h-4 w-4 mr-1.5" />
            )}
            Jetzt senden
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
