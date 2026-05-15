import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Check, Copy, MessageSquare, AlertTriangle, ShieldCheck } from "lucide-react";
import type { CredentialsResult } from "./NewMitarbeiterDialog";

export function CredentialsResultDialog({
  result,
  onClose,
}: {
  result: CredentialsResult | null;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [copied, setCopied] = useState<string | null>(null);

  const copy = async (label: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(label);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      toast({
        variant: "destructive",
        title: "Kopieren fehlgeschlagen",
        description: "Bitte den Wert manuell markieren und kopieren.",
      });
    }
  };

  const open = !!result;
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-emerald-600" />
            Anmeldedaten
          </DialogTitle>
          <DialogDescription>
            {result &&
              `${result.vorname} ${result.nachname} wurde angelegt. Die folgenden Daten werden nur jetzt einmalig angezeigt — sie sollten auch in der SMS angekommen sein.`}
          </DialogDescription>
        </DialogHeader>

        {result && (
          <div className="space-y-3">
            {/* SMS-Status */}
            <div
              className={`rounded-md border p-2.5 text-xs flex items-start gap-2 ${
                result.sms_status === "sent"
                  ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                  : result.sms_status === "error"
                  ? "border-amber-300 bg-amber-50 text-amber-900"
                  : "border-border bg-muted/40 text-foreground"
              }`}
            >
              {result.sms_status === "sent" ? (
                <MessageSquare className="h-4 w-4 shrink-0 mt-0.5" />
              ) : (
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              )}
              <div className="flex-1">
                {result.sms_status === "sent" && (
                  <>
                    <strong>SMS gesendet</strong>
                    <div className="mt-0.5">
                      Der Mitarbeiter erhält in Kürze eine SMS mit Login-Link.
                    </div>
                  </>
                )}
                {result.sms_status === "error" && (
                  <>
                    <strong>SMS-Versand fehlgeschlagen</strong>
                    <div className="mt-0.5">
                      {result.sms_error ?? "Unbekannter Fehler"} — bitte die Daten unten
                      manuell weitergeben.
                    </div>
                  </>
                )}
                {result.sms_status === "skipped" && (
                  <>
                    <strong>Keine SMS gesendet</strong>
                    <div className="mt-0.5">
                      Die Anmeldedaten unten manuell an den Mitarbeiter weitergeben.
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* Email */}
            <div className="space-y-1">
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                E-Mail
              </div>
              <div className="flex items-center gap-2">
                <code className="flex-1 px-2 py-1.5 bg-muted rounded text-sm font-mono break-all">
                  {result.email}
                </code>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => copy("email", result.email)}
                  className="h-9 w-9 p-0 shrink-0"
                  aria-label="E-Mail kopieren"
                >
                  {copied === "email" ? (
                    <Check className="h-4 w-4 text-emerald-600" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </div>

            {/* Initial-Passwort */}
            <div className="space-y-1">
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
                <span>Initial-Passwort</span>
                <Badge variant="outline" className="text-[9px] h-4 px-1.5">
                  einmalig
                </Badge>
              </div>
              <div className="flex items-center gap-2">
                <code className="flex-1 px-2 py-1.5 bg-muted rounded text-sm font-mono tracking-wider break-all">
                  {result.initial_password}
                </code>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => copy("password", result.initial_password)}
                  className="h-9 w-9 p-0 shrink-0"
                  aria-label="Passwort kopieren"
                >
                  {copied === "password" ? (
                    <Check className="h-4 w-4 text-emerald-600" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </Button>
              </div>
              <div className="text-[11px] text-muted-foreground">
                Wird nach Schließen nicht mehr angezeigt. Bei Bedarf jetzt kopieren oder
                aufschreiben.
              </div>
            </div>

            {/* Magic Link (optional, kopierbar — falls SMS nicht ankommt) */}
            {result.magic_link && (
              <div className="space-y-1">
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  Login-Link (alternativ)
                </div>
                <div className="flex items-center gap-2">
                  <code className="flex-1 px-2 py-1.5 bg-muted rounded text-[11px] font-mono break-all truncate">
                    {result.magic_link}
                  </code>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => copy("link", result.magic_link!)}
                    className="h-9 w-9 p-0 shrink-0"
                    aria-label="Link kopieren"
                  >
                    {copied === "link" ? (
                      <Check className="h-4 w-4 text-emerald-600" />
                    ) : (
                      <Copy className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button type="button" onClick={onClose} className="w-full">
            Schließen
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
