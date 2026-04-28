import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Smartphone,
  Share2,
  SquareArrowUp,
  Plus,
  CheckCircle2,
  Apple,
  Download,
  MoreHorizontal,
  ChevronDown,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface InstallPromptDialogProps {
  open: boolean;
  onClose: () => void;
}

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream;
}

export function InstallPromptDialog({ open, onClose }: InstallPromptDialogProps) {
  const { toast } = useToast();
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isStandalone, setIsStandalone] = useState(false);

  useEffect(() => {
    setIsStandalone(window.matchMedia("(display-mode: standalone)").matches);

    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", handler);

    const installedHandler = () => {
      setIsStandalone(true);
      toast({ title: "App installiert", description: "Du findest sie jetzt am Startbildschirm." });
    };
    window.addEventListener("appinstalled", installedHandler);

    return () => {
      window.removeEventListener("beforeinstallprompt", handler);
      window.removeEventListener("appinstalled", installedHandler);
    };
  }, [toast]);

  const triggerNativePrompt = async () => {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const choice = await deferredPrompt.userChoice;
    if (choice.outcome === "accepted") {
      onClose();
    }
    setDeferredPrompt(null);
  };

  const ios = isIOS();

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm sm:max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <Smartphone className="h-5 w-5 text-primary" />
            <DialogTitle>App zum Startbildschirm hinzufügen</DialogTitle>
          </div>
          <DialogDescription>
            Installiere die Holzbau-Willroider-App für schnelleren Zugriff direkt vom
            Startbildschirm – wie eine native App.
          </DialogDescription>
        </DialogHeader>

        {isStandalone ? (
          <Card className="border-emerald-300 bg-emerald-50">
            <CardContent className="p-4 flex items-center gap-3">
              <CheckCircle2 className="h-6 w-6 text-emerald-600 shrink-0" />
              <div className="text-sm">
                <strong>App ist bereits installiert.</strong> Du nutzt die App schon im
                Vollbild-Modus.
              </div>
            </CardContent>
          </Card>
        ) : ios ? (
          <div className="space-y-3">
            <Card className="border-primary/30">
              <CardContent className="p-3 flex items-center gap-3">
                <Apple className="h-5 w-5 text-foreground shrink-0" />
                <div className="text-xs">
                  <strong>iPhone / iPad</strong> – wähle deinen Browser:
                </div>
              </CardContent>
            </Card>

            <Tabs defaultValue="safari">
              <TabsList className="grid grid-cols-2 w-full">
                <TabsTrigger value="safari">Safari</TabsTrigger>
                <TabsTrigger value="chrome">Chrome</TabsTrigger>
              </TabsList>

              <TabsContent value="safari" className="pt-3">
                <ol className="space-y-3">
                  <Step
                    n={1}
                    icon={MoreHorizontal}
                    title={'Drei-Punkte-Symbol „· · ·" unten rechts'}
                    desc="In der Safari-Leiste unten rechts auf das Symbol mit den drei waagerechten Punkten tippen."
                  />
                  <Step
                    n={2}
                    icon={Share2}
                    title={'„Teilen"'}
                    desc={'Im Menü auf den Eintrag „Teilen" tippen.'}
                  />
                  <Step
                    n={3}
                    icon={ChevronDown}
                    title={'„Mehr anzeigen"'}
                    desc={'Im Teilen-Sheet ganz nach unten scrollen und auf „Mehr anzeigen" tippen.'}
                  />
                  <Step
                    n={4}
                    icon={Plus}
                    title={'„Zum Home-Bildschirm"'}
                    desc={'Auf „Zum Home-Bildschirm" tippen → oben rechts auf „Hinzufügen" bestätigen.'}
                  />
                </ol>
              </TabsContent>

              <TabsContent value="chrome" className="pt-3">
                <ol className="space-y-3">
                  <Step
                    n={1}
                    icon={Share2}
                    title="Teilen-Symbol oben rechts"
                    desc="Oben rechts neben der Adresszeile auf das Teilen-Symbol tippen."
                  />
                  <Step
                    n={2}
                    icon={ChevronDown}
                    title={'„Mehr anzeigen"'}
                    desc={'Im Sheet auf „Mehr anzeigen" oder den Pfeil nach unten tippen.'}
                  />
                  <Step
                    n={3}
                    icon={Plus}
                    title={'„Zum Home-Bildschirm hinzufügen"'}
                    desc={'Auf „Zum Home-Bildschirm hinzufügen" tippen → bestätigen.'}
                  />
                </ol>
              </TabsContent>
            </Tabs>
          </div>
        ) : (
          // Android / Desktop
          <div className="space-y-3">
            {deferredPrompt ? (
              <>
                <Card className="border-primary/30">
                  <CardContent className="p-3 text-sm">
                    Du kannst die App mit einem Klick installieren:
                  </CardContent>
                </Card>
                <Button onClick={triggerNativePrompt} className="w-full h-12 text-base">
                  <Download className="h-5 w-5 mr-2" />
                  Jetzt installieren
                </Button>
                <div className="text-[11px] text-muted-foreground text-center">
                  Falls der Knopf nicht funktioniert, folge der Anleitung darunter:
                </div>
              </>
            ) : null}

            <Card>
              <CardContent className="p-3 text-xs">
                <strong>Android (Chrome / Edge / Samsung Internet)</strong> – manuelle
                Installation:
              </CardContent>
            </Card>
            <ol className="space-y-3">
              <Step
                n={1}
                icon={MoreHorizontal}
                title="Browser-Menü öffnen"
                desc="Tippe auf die drei Punkte oben rechts (⋮)."
              />
              <Step
                n={2}
                icon={Plus}
                title={'„App installieren" oder „Zum Startbildschirm hinzufügen"'}
                desc={'Je nach Browser unter „App installieren" oder im Untermenü „Zum Startbildschirm hinzufügen".'}
              />
              <Step
                n={3}
                icon={Smartphone}
                title="Bestätigen"
                desc="Die App erscheint auf deinem Startbildschirm wie eine normale App."
              />
            </ol>
          </div>
        )}

        <Button variant="outline" onClick={onClose} className="w-full mt-2">
          {isStandalone ? "Schließen" : "Vielleicht später"}
        </Button>
      </DialogContent>
    </Dialog>
  );
}

function Step({
  n,
  icon: Icon,
  title,
  desc,
}: {
  n: number;
  icon: typeof Smartphone;
  title: string;
  desc: string;
}) {
  return (
    <li className="flex gap-3">
      <div className="flex flex-col items-center shrink-0">
        <div className="h-7 w-7 rounded-full bg-primary text-primary-foreground text-xs font-bold flex items-center justify-center">
          {n}
        </div>
      </div>
      <div className="flex-1">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Icon className="h-4 w-4 text-primary" />
          {title}
        </div>
        <div className="text-xs text-muted-foreground mt-0.5">{desc}</div>
      </div>
    </li>
  );
}
