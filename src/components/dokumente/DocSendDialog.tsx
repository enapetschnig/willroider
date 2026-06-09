/**
 * Generischer Mail-Versand für 1..n Dokumente aus Supabase Storage.
 *
 * Frontend lädt die Dateien als Blob, kodiert sie base64 und schickt sie
 * an die Edge-Function `dokument-versenden` (siehe
 * supabase/functions/dokument-versenden/index.ts). Der Empfänger wird im
 * Dialog vom User eingetippt — Default ist der zuletzt verwendete (in
 * localStorage). Betreff/Body kommen mit sinnvollen Defaults, sind
 * editierbar.
 *
 * Wiederverwendbar überall, wo Dateien aus einem Storage-Bucket angezeigt
 * werden (BaustelleDokumente, AngebotDokumente, Berichte, …).
 */

import { useEffect, useMemo, useState } from "react";
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
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, Mail, FileIcon } from "lucide-react";

export interface DocSendItem {
  bucket: string;
  storage_path: string;
  dateiname: string;
  groesse?: number | null;
  mimetype?: string | null;
}

interface DocSendDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: DocSendItem[];
  /** Kontext-Titel ("Vorvertrag_Neustifter.docx" oder "3 Dokumente") */
  defaultBetreff?: string;
  defaultBody?: string;
  /** Default-Empfänger (aus app_einstellungen oder einer prop) */
  defaultEmpfaenger?: string;
  onSent?: () => void;
}

const LS_LAST_RECIPIENT = "willroider:lastDocRecipient";
const MAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function blobToBase64(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let bin = "";
  // chunk weise um Stack-Overflow zu vermeiden
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(
      null,
      bytes.subarray(i, i + chunk) as unknown as number[],
    );
  }
  return btoa(bin);
}

export function DocSendDialog({
  open,
  onOpenChange,
  items,
  defaultBetreff,
  defaultBody,
  defaultEmpfaenger,
  onSent,
}: DocSendDialogProps) {
  const { toast } = useToast();
  const [empfaenger, setEmpfaenger] = useState("");
  const [cc, setCc] = useState("");
  const [betreff, setBetreff] = useState("");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);

  const totalKB = useMemo(
    () => items.reduce((s, i) => s + (i.groesse ?? 0), 0) / 1024,
    [items],
  );

  // Defaults beim Öffnen befüllen
  useEffect(() => {
    if (!open) return;
    const last = localStorage.getItem(LS_LAST_RECIPIENT) ?? "";
    setEmpfaenger(defaultEmpfaenger || last);
    setCc("");
    setBetreff(
      defaultBetreff ||
        (items.length === 1
          ? items[0].dateiname
          : `${items.length} Dokumente`),
    );
    setBody(
      defaultBody ||
        `Hallo,\n\nim Anhang findest du ${
          items.length === 1
            ? `die Datei „${items[0].dateiname}"`
            : `${items.length} Dokumente`
        }.\n\nMit freundlichen Grüßen`,
    );
  }, [open, defaultBetreff, defaultBody, defaultEmpfaenger, items]);

  const handleSend = async () => {
    const to = empfaenger.trim();
    if (!MAIL_RE.test(to)) {
      toast({
        variant: "destructive",
        title: "Empfänger-Adresse ungültig",
        description: "Bitte gültige E-Mail-Adresse eintragen.",
      });
      return;
    }
    const ccTrim = cc.trim();
    if (ccTrim && !MAIL_RE.test(ccTrim)) {
      toast({
        variant: "destructive",
        title: "CC-Adresse ungültig",
        description: "Bitte gültige E-Mail-Adresse oder leer lassen.",
      });
      return;
    }
    setSending(true);
    try {
      // Dateien aus Storage laden + base64-kodieren
      const attachments: { filename: string; contentBase64: string }[] = [];
      for (const item of items) {
        const { data, error } = await supabase.storage
          .from(item.bucket)
          .download(item.storage_path);
        if (error || !data) {
          throw new Error(
            `„${item.dateiname}" konnte nicht geladen werden: ${error?.message ?? "unbekannt"}`,
          );
        }
        attachments.push({
          filename: item.dateiname,
          contentBase64: await blobToBase64(data),
        });
      }

      const { data, error } = await supabase.functions.invoke(
        "dokument-versenden",
        {
          body: {
            empfaenger: to,
            cc: ccTrim || undefined,
            betreff,
            text: body,
            attachments,
          },
        },
      );
      if (error) throw error;
      if (data && (data as any).ok === false) {
        throw new Error((data as any).error ?? "Unbekannter Fehler");
      }
      localStorage.setItem(LS_LAST_RECIPIENT, to);
      toast({
        title: "Mail versendet",
        description: `${attachments.length} Datei${attachments.length === 1 ? "" : "en"} an ${to}.`,
      });
      onOpenChange(false);
      onSent?.();
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Versand fehlgeschlagen",
        description: (e as Error).message,
      });
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !sending && onOpenChange(o)}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5 text-primary" />
            {items.length === 1
              ? "Dokument per Mail senden"
              : `${items.length} Dokumente per Mail senden`}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="empf">Empfänger *</Label>
            <Input
              id="empf"
              type="email"
              value={empfaenger}
              onChange={(e) => setEmpfaenger(e.target.value)}
              placeholder="name@firma.at"
              className="h-11"
              autoFocus
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="cc">CC (optional)</Label>
            <Input
              id="cc"
              type="email"
              value={cc}
              onChange={(e) => setCc(e.target.value)}
              placeholder=""
              className="h-11"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="betr">Betreff</Label>
            <Input
              id="betr"
              value={betreff}
              onChange={(e) => setBetreff(e.target.value)}
              className="h-11"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="body">Nachricht</Label>
            <Textarea
              id="body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={5}
              className="resize-none"
            />
          </div>

          <div className="space-y-1">
            <Label>Anhänge ({items.length})</Label>
            <ul className="space-y-1 max-h-40 overflow-y-auto border rounded-md p-2 bg-muted/30">
              {items.map((it, i) => (
                <li
                  key={i}
                  className="text-xs flex items-center gap-2 truncate"
                >
                  <FileIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="truncate flex-1">{it.dateiname}</span>
                  {it.groesse ? (
                    <span className="text-muted-foreground tabular-nums shrink-0">
                      {(it.groesse / 1024).toFixed(0)} KB
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
            <p className="text-[11px] text-muted-foreground">
              Gesamt: {totalKB.toFixed(0)} KB · max. 35 MB pro Mail
            </p>
          </div>
        </div>

        <DialogFooter className="flex-row gap-2">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={sending}
            className="flex-1"
          >
            Abbrechen
          </Button>
          <Button onClick={handleSend} disabled={sending} className="flex-1">
            {sending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Sende…
              </>
            ) : (
              <>
                <Mail className="h-4 w-4 mr-2" />
                Jetzt senden
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
