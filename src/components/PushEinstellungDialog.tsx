/**
 * Benachrichtigungen (Push) für dieses Gerät ein-/ausschalten und testen.
 * Erreichbar über das Konto-Menü und die Karte auf der Startseite.
 */

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { Bell, BellOff, BellRing, Loader2, Smartphone } from "lucide-react";
import { pushAusschalten, pushEinschalten, pushStatus, pushTest, type PushStatus } from "@/lib/push";

export function PushEinstellungDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [status, setStatus] = useState<PushStatus | null>(null);
  const [busy, setBusy] = useState(false);

  const lade = () => {
    pushStatus().then(setStatus).catch(() => setStatus("nicht_unterstuetzt"));
  };
  useEffect(() => {
    if (open) lade();
  }, [open]);

  const einschalten = async () => {
    if (!user) return;
    setBusy(true);
    try {
      await pushEinschalten(user.id);
      toast({ title: "Benachrichtigungen eingeschaltet" });
      lade();
    } catch (e) {
      toast({ variant: "destructive", title: "Nicht eingeschaltet", description: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const ausschalten = async () => {
    setBusy(true);
    try {
      await pushAusschalten();
      toast({ title: "Benachrichtigungen ausgeschaltet" });
      lade();
    } finally {
      setBusy(false);
    }
  };

  const testen = async () => {
    setBusy(true);
    try {
      const r = await pushTest();
      if (r.ok) toast({ title: "Testnachricht geschickt", description: "Sie sollte gleich auf diesem Gerät erscheinen." });
      else toast({ variant: "destructive", title: "Keine Nachricht angekommen", description: r.fehler?.join(", ") || "Kein Gerät angemeldet." });
    } catch (e) {
      toast({ variant: "destructive", title: "Test fehlgeschlagen", description: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bell className="h-5 w-5 text-primary" /> Benachrichtigungen
          </DialogTitle>
          <DialogDescription>
            Die App erinnert dich auf diesem Gerät, wenn ein Bericht zu unterschreiben, eine
            Unterweisung fällig oder etwas freizugeben ist.
          </DialogDescription>
        </DialogHeader>

        {status === null && (
          <div className="text-sm text-muted-foreground flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" /> Prüfe…
          </div>
        )}

        {status === "ios_nicht_installiert" && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm space-y-1">
            <div className="flex items-center gap-2 font-semibold text-amber-900">
              <Smartphone className="h-4 w-4" /> Zuerst die App installieren
            </div>
            <div className="text-amber-900">
              Auf dem iPhone gibt es Benachrichtigungen nur, wenn die App am Home-Bildschirm
              liegt: in Safari unten „Teilen“ antippen, dann „Zum Home-Bildschirm“. Danach die
              App von dort öffnen und hier einschalten.
            </div>
          </div>
        )}

        {status === "nicht_unterstuetzt" && (
          <div className="text-sm text-muted-foreground">
            Dieser Browser unterstützt keine Push-Nachrichten. Am Handy die App installieren, am
            PC Chrome oder Edge verwenden.
          </div>
        )}

        {status === "verweigert" && (
          <div className="text-sm text-muted-foreground">
            Benachrichtigungen sind für diese App im Browser blockiert. Bitte in den
            Browser-Einstellungen (Schloss-Symbol neben der Adresse) wieder erlauben.
          </div>
        )}

        {status === "aus" && (
          <Button className="w-full h-11" onClick={einschalten} disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <BellRing className="h-4 w-4 mr-2" />}
            Auf diesem Gerät einschalten
          </Button>
        )}

        {status === "an" && (
          <div className="space-y-2">
            <div className="rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900 flex items-center gap-2">
              <BellRing className="h-4 w-4" /> Eingeschaltet auf diesem Gerät.
            </div>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={testen} disabled={busy}>
                Testnachricht
              </Button>
              <Button variant="ghost" className="flex-1" onClick={ausschalten} disabled={busy}>
                <BellOff className="h-4 w-4 mr-1.5" /> Ausschalten
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
