/**
 * Startseiten-Hinweis: Benachrichtigungen auf diesem Gerät einschalten.
 * Verschwindet, sobald eingeschaltet, oder nach „Später“ für 14 Tage.
 */

import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Bell } from "lucide-react";
import { pushStatus, type PushStatus } from "@/lib/push";
import { PushEinstellungDialog } from "@/components/PushEinstellungDialog";

const SPAETER_KEY = "push-hinweis-spaeter";

export function PushHinweisCard() {
  const [status, setStatus] = useState<PushStatus | null>(null);
  const [offen, setOffen] = useState(false);
  const [versteckt, setVersteckt] = useState(true);

  useEffect(() => {
    try {
      const bis = Number(localStorage.getItem(SPAETER_KEY) ?? 0);
      setVersteckt(bis > Date.now());
    } catch {
      setVersteckt(false);
    }
    pushStatus().then(setStatus).catch(() => setStatus("nicht_unterstuetzt"));
  }, []);

  const spaeter = () => {
    try {
      localStorage.setItem(SPAETER_KEY, String(Date.now() + 14 * 86400 * 1000));
    } catch {
      /* egal */
    }
    setVersteckt(true);
  };

  // Nur zeigen, wenn es auf diesem Gerät auch gehen kann.
  if (versteckt || status === null || status === "an" || status === "nicht_unterstuetzt" || status === "verweigert") {
    return (
      <PushEinstellungDialog open={offen} onOpenChange={(o) => { setOffen(o); if (!o) pushStatus().then(setStatus); }} />
    );
  }

  return (
    <>
      <Card className="border-primary/30 bg-primary/5">
        <CardContent className="p-3 sm:p-4 flex items-center gap-3 flex-wrap">
          <div className="h-10 w-10 rounded-full bg-primary/15 text-primary flex items-center justify-center shrink-0">
            <Bell className="h-5 w-5" />
          </div>
          <div className="flex-1 min-w-[12rem]">
            <div className="font-semibold text-sm">Benachrichtigungen einschalten</div>
            <div className="text-xs text-muted-foreground">
              {status === "ios_nicht_installiert"
                ? "Dann erinnert dich die App am Handy — dafür zuerst die App auf den Home-Bildschirm legen."
                : "Dann erinnert dich die App, wenn ein Bericht zu unterschreiben oder etwas fällig ist."}
            </div>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" onClick={spaeter}>
              Später
            </Button>
            <Button size="sm" onClick={() => setOffen(true)}>
              Einschalten
            </Button>
          </div>
        </CardContent>
      </Card>
      <PushEinstellungDialog open={offen} onOpenChange={(o) => { setOffen(o); if (!o) pushStatus().then(setStatus); }} />
    </>
  );
}
