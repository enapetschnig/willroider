import { useEffect, useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Smartphone,
  Share2,
  Plus,
  CheckCircle2,
  Apple,
  Download,
  MoreHorizontal,
  ChevronDown,
  Monitor,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  getCachedInstallPrompt,
  subscribeInstallPrompt,
  clearCachedInstallPrompt,
  type BeforeInstallPromptEvent,
} from "@/lib/pwaInstall";

type Platform = "ios-safari" | "ios-chrome" | "android" | "desktop";

function detectPlatform(): Platform {
  if (typeof navigator === "undefined") return "desktop";
  const ua = navigator.userAgent;
  const isIOS = /iPad|iPhone|iPod/.test(ua) && !(window as any).MSStream;
  if (isIOS) {
    // Chrome auf iOS sendet "CriOS" im UA
    if (/CriOS/.test(ua)) return "ios-chrome";
    return "ios-safari";
  }
  if (/Android/.test(ua)) return "android";
  return "desktop";
}

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    // iOS Safari spezifisch
    (navigator as any).standalone === true
  );
}

/**
 * OS-spezifische Installations-Anleitung für die PWA.
 * Erkennt automatisch Plattform + Standalone-Status.
 * Kann eigenständig oder im Dialog verwendet werden.
 */
export function InstallGuide({ onInstalled }: { onInstalled?: () => void }) {
  const { toast } = useToast();
  const [deferredPrompt, setDeferredPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [standalone, setStandalone] = useState(false);
  const [platform, setPlatform] = useState<Platform>("desktop");

  useEffect(() => {
    setStandalone(isStandalone());
    setPlatform(detectPlatform());

    // Aktueller Cache-Stand sofort übernehmen (Event wurde u. U. schon
    // vor Mount in main.tsx abgefangen).
    setDeferredPrompt(getCachedInstallPrompt());

    // Spätere Updates des globalen Caches abonnieren.
    const unsubscribe = subscribeInstallPrompt((e) => setDeferredPrompt(e));

    const installedHandler = () => {
      setStandalone(true);
      toast({
        title: "App installiert",
        description: "Du findest sie jetzt am Startbildschirm.",
      });
      onInstalled?.();
    };
    window.addEventListener("appinstalled", installedHandler);

    return () => {
      unsubscribe();
      window.removeEventListener("appinstalled", installedHandler);
    };
  }, [toast, onInstalled]);

  const triggerNativePrompt = async () => {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const choice = await deferredPrompt.userChoice;
    if (choice.outcome === "accepted") {
      onInstalled?.();
    }
    clearCachedInstallPrompt();
    setDeferredPrompt(null);
  };

  if (standalone) {
    return (
      <Card className="border-emerald-300 bg-emerald-50">
        <CardContent className="p-4 flex items-center gap-3">
          <CheckCircle2 className="h-6 w-6 text-emerald-600 shrink-0" />
          <div className="text-sm">
            <strong>App ist bereits installiert.</strong> Du nutzt sie schon im
            Vollbild-Modus — alles bestens.
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      <Tabs defaultValue={platform}>
        <TabsList className="grid grid-cols-4 w-full">
          <TabsTrigger value="ios-safari" className="text-xs">
            <Apple className="h-3.5 w-3.5 mr-1" />
            Safari
          </TabsTrigger>
          <TabsTrigger value="ios-chrome" className="text-xs">
            <Apple className="h-3.5 w-3.5 mr-1" />
            Chrome
          </TabsTrigger>
          <TabsTrigger value="android" className="text-xs">
            <Smartphone className="h-3.5 w-3.5 mr-1" />
            Android
          </TabsTrigger>
          <TabsTrigger value="desktop" className="text-xs">
            <Monitor className="h-3.5 w-3.5 mr-1" />
            Desktop
          </TabsTrigger>
        </TabsList>

        {/* iPhone Safari */}
        <TabsContent value="ios-safari" className="pt-3">
          <Card className="border-primary/30 mb-3">
            <CardContent className="p-2.5 text-xs flex items-center gap-2">
              <Apple className="h-4 w-4 shrink-0" />
              <span>
                <strong>iPhone / iPad</strong> mit Safari-Browser
              </span>
            </CardContent>
          </Card>
          <ol className="space-y-3">
            <Step
              n={1}
              icon={MoreHorizontal}
              title={'Drei-Punkte-Symbol „⋯" unten rechts'}
              desc="In der Safari-Leiste unten rechts auf das Symbol mit den drei waagerechten Punkten tippen."
            />
            <Step
              n={2}
              icon={Share2}
              title={'„Teilen"'}
              desc='Im Menü auf den Eintrag „Teilen" tippen.'
            />
            <Step
              n={3}
              icon={ChevronDown}
              title={'„Mehr anzeigen"'}
              desc='Im Teilen-Sheet ganz nach unten scrollen und auf „Mehr anzeigen" tippen.'
            />
            <Step
              n={4}
              icon={Plus}
              title={'„Zum Home-Bildschirm"'}
              desc='Auf „Zum Home-Bildschirm" tippen → oben rechts auf „Hinzufügen" bestätigen.'
            />
          </ol>
        </TabsContent>

        {/* iPhone Chrome */}
        <TabsContent value="ios-chrome" className="pt-3">
          <Card className="border-primary/30 mb-3">
            <CardContent className="p-2.5 text-xs flex items-center gap-2">
              <Apple className="h-4 w-4 shrink-0" />
              <span>
                <strong>iPhone / iPad</strong> mit Chrome-Browser
              </span>
            </CardContent>
          </Card>
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
              desc='Im Sheet auf „Mehr anzeigen" oder den Pfeil nach unten tippen.'
            />
            <Step
              n={3}
              icon={Plus}
              title={'„Zum Home-Bildschirm hinzufügen"'}
              desc='Auf „Zum Home-Bildschirm hinzufügen" tippen → bestätigen.'
            />
          </ol>
        </TabsContent>

        {/* Android */}
        <TabsContent value="android" className="pt-3 space-y-3">
          <Card className="border-primary/30">
            <CardContent className="p-2.5 text-xs flex items-center gap-2">
              <Smartphone className="h-4 w-4 shrink-0" />
              <span>
                <strong>Android</strong> · Chrome, Edge, Samsung Internet
              </span>
            </CardContent>
          </Card>
          {deferredPrompt ? (
            <>
              <div className="text-xs text-muted-foreground">
                Du kannst die App direkt mit einem Klick installieren:
              </div>
              <Button onClick={triggerNativePrompt} className="w-full h-12 text-base">
                <Download className="h-5 w-5 mr-2" />
                Jetzt installieren
              </Button>
              <div className="text-[11px] text-muted-foreground text-center">
                Falls der Knopf nicht funktioniert, hier die Anleitung:
              </div>
            </>
          ) : null}
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
        </TabsContent>

        {/* Desktop */}
        <TabsContent value="desktop" className="pt-3 space-y-3">
          <Card className="border-primary/30">
            <CardContent className="p-2.5 text-xs flex items-center gap-2">
              <Monitor className="h-4 w-4 shrink-0" />
              <span>
                <strong>Desktop</strong> · Chrome, Edge, Brave, Opera
              </span>
            </CardContent>
          </Card>
          {deferredPrompt ? (
            <>
              <Button onClick={triggerNativePrompt} className="w-full h-11">
                <Download className="h-4 w-4 mr-2" />
                Jetzt installieren
              </Button>
              <div className="text-[11px] text-muted-foreground text-center">
                Oder manuell:
              </div>
            </>
          ) : null}
          <ol className="space-y-3">
            <Step
              n={1}
              icon={Download}
              title="Install-Symbol in der Adresszeile"
              desc="In der Adresszeile rechts neben der URL erscheint ein kleines Install-Symbol (Bildschirm mit Pfeil) — anklicken."
            />
            <Step
              n={2}
              icon={Plus}
              title={'„Installieren" klicken'}
              desc={'Im Pop-up auf „Installieren" klicken. Die App öffnet sich in einem eigenen Fenster.'}
            />
            <Step
              n={3}
              icon={Monitor}
              title="Vom Desktop starten"
              desc="Die App ist jetzt in deinem Anwendungsmenü und auf dem Desktop verfügbar."
            />
          </ol>
        </TabsContent>
      </Tabs>
    </div>
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
