import { Link } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  CheckCircle2,
  Clock,
  LogIn,
  Smartphone,
  Sparkles,
} from "lucide-react";
import { InstallGuide } from "@/components/InstallGuide";

export default function RegistrierungBestaetigung() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/30 px-4 py-8">
      <div className="max-w-xl mx-auto space-y-4">
        {/* Success-Header */}
        <Card className="border-emerald-300 bg-emerald-50">
          <CardContent className="p-5 sm:p-6 text-center space-y-2">
            <div className="inline-flex h-14 w-14 rounded-full bg-emerald-500 items-center justify-center text-white shadow-md">
              <CheckCircle2 className="h-7 w-7" />
            </div>
            <h1 className="text-xl sm:text-2xl font-bold text-emerald-900">
              Account erstellt!
            </h1>
            <p className="text-sm text-emerald-800">
              Schön dass du dabei bist.
            </p>
          </CardContent>
        </Card>

        {/* Status */}
        <Card className="border-amber-300 bg-amber-50">
          <CardContent className="p-4 sm:p-5">
            <div className="flex items-start gap-3">
              <div className="h-10 w-10 rounded-full bg-amber-500 flex items-center justify-center text-white shrink-0">
                <Clock className="h-5 w-5" />
              </div>
              <div className="flex-1">
                <div className="font-bold text-amber-950">
                  Wartet auf Freischaltung
                </div>
                <p className="text-sm text-amber-900 mt-1">
                  Der Administrator wurde benachrichtigt. Sobald dein Konto
                  freigegeben ist, kannst du dich anmelden und siehst alle
                  deine Baustellen und Stunden.
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Link to="/auth">
                    <Button variant="default" size="sm">
                      <LogIn className="h-4 w-4 mr-1.5" />
                      Zur Anmeldung
                    </Button>
                  </Link>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => window.location.reload()}
                  >
                    Neu prüfen
                  </Button>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Install-Anleitung */}
        <Card>
          <CardContent className="p-4 sm:p-5 space-y-3">
            <div className="flex items-center gap-2">
              <Smartphone className="h-5 w-5 text-primary" />
              <div className="font-bold text-base">App auf Handy installieren</div>
            </div>
            <p className="text-xs text-muted-foreground -mt-1">
              Damit du Stunden, Baustellen und Einteilungen direkt am
              Smartphone zur Hand hast. Wähle dein Gerät:
            </p>
            <InstallGuide />
          </CardContent>
        </Card>

        {/* Footer */}
        <div className="text-center text-xs text-muted-foreground py-2 flex items-center justify-center gap-1.5">
          <Sparkles className="h-3 w-3" />
          Holzbau Willroider · Baustellen-Management
        </div>
      </div>
    </div>
  );
}
