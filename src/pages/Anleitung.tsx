/**
 * Anleitung — je Rolle ein kurzer Abschnitt, drei bis fünf Schritte.
 * Bewusst knapp: Wer hier liest, steht meist mit dem Handy auf der Baustelle.
 * Abschnitte erscheinen nur, wenn sie für die angemeldete Person gelten.
 */
import { useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { InstallPromptDialog } from "@/components/InstallPromptDialog";
import { isStandalone } from "@/components/InstallGuide";
import {
  Smartphone,
  ClipboardList,
  ShieldCheck,
  PenLine,
  Building2,
  Send,
  type LucideIcon,
} from "lucide-react";

function Abschnitt({
  icon: Icon,
  titel,
  wer,
  schritte,
  hinweis,
  children,
}: {
  icon: LucideIcon;
  titel: string;
  wer?: string;
  schritte: string[];
  hinweis?: string;
  children?: React.ReactNode;
}) {
  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start gap-3">
          <div className="h-9 w-9 rounded-md bg-primary/10 text-primary flex items-center justify-center shrink-0">
            <Icon className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <div className="font-semibold text-base">{titel}</div>
            {wer && <div className="text-xs text-muted-foreground">{wer}</div>}
          </div>
        </div>
        <ol className="space-y-2 text-sm">
          {schritte.map((s, i) => (
            <li key={i} className="flex gap-3">
              <span className="h-6 w-6 rounded-full bg-primary text-primary-foreground text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">
                {i + 1}
              </span>
              <span className="leading-relaxed">{s}</span>
            </li>
          ))}
        </ol>
        {hinweis && (
          <div className="text-xs text-muted-foreground border-t pt-2">{hinweis}</div>
        )}
        {children}
      </CardContent>
    </Card>
  );
}

export default function Anleitung() {
  const { isAdmin, hasPermission, profile, role } = useAuth();
  const [installOffen, setInstallOffen] = useState(false);
  const istPolier = !!profile?.is_partieleiter || role === "bauleiter" || isAdmin;
  const istVerwaltung =
    isAdmin ||
    hasPermission("evaluierungen.edit") ||
    hasPermission("tagesplanung.freigeben") ||
    hasPermission("mitarbeiter.einladung_resend");
  const installiert = isStandalone();

  return (
    <div className="space-y-4 max-w-2xl mx-auto">
      <PageHeader title="Anleitung" subtitle="Kurz und Schritt für Schritt — was du wo machst." />

      <Abschnitt
        icon={Smartphone}
        titel="Anmelden und App aufs Handy"
        wer="Für alle"
        schritte={[
          "Anmelden mit deiner Handynummer und dem Passwort aus der SMS (willroider + Zahl). Kein Passwort? Auf der Anmeldeseite „Code per SMS anfordern".",
          "App auf den Startbildschirm legen — dann startet sie wie eine normale App und du bleibst angemeldet.",
          "Nach dem Installieren einmal in der neuen App anmelden. Das ist nur einmal nötig.",
          "Passwort ändern: oben rechts auf deinen Namen → „Passwort ändern".",
        ]}
        hinweis="Probleme beim Anmelden? Im Büro melden — dort kann dir ein neuer Zugang geschickt werden."
      >
        {!installiert && (
          <Button variant="outline" className="w-full h-10" onClick={() => setInstallOffen(true)}>
            App auf den Startbildschirm — so geht's
          </Button>
        )}
      </Abschnitt>

      <Abschnitt
        icon={ClipboardList}
        titel="Mein Tag"
        wer="Für alle"
        schritte={[
          "„Mein Tag" zeigt oben deine heutige Baustelle mit Treffpunkt und Abfahrt. Mit „Navigation" öffnet sich die Karte.",
          "Darunter siehst du, ob eine Unterweisung offen ist, und deine Stunden von heute.",
          "Stunden trägst du unter „Stunden" ein — am besten gleich am Abend.",
        ]}
      />

      <Abschnitt
        icon={ShieldCheck}
        titel="Unterweisung bestätigen"
        wer="Für alle — vor dem ersten Arbeitstag auf einer Baustelle"
        schritte={[
          "Bist du für eine Baustelle eingeteilt, steht in „Mein Tag" die Unterweisung mit der Frist — meist am Einsatztag bis 08:00.",
          "Antippen, ganz durchlesen (bis unten scrollen), dann „Verstanden – jetzt unterschreiben".",
          "Mit dem Finger unterschreiben und speichern. Datum und Uhrzeit werden automatisch festgehalten.",
          "Alternativ unterschreibst du am Tablet des Poliers — er ruft deinen Namen auf, du liest und unterschreibst dort.",
        ]}
        hinweis="Ist die Frist vorbei, zeigt die App nur noch die Unterweisung, bis du unterschrieben hast. Der Bauleiter bekommt eine SMS, wer noch fehlt."
      />

      {istPolier && (
        <Abschnitt
          icon={PenLine}
          titel="Unterweisung am Tablet — alle nacheinander"
          wer="Für Poliere und Bauleiter"
          schritte={[
            "Baustellen → deine Baustelle → Reiter „Unterweisung".",
            "„Am Tablet unterschreiben lassen" antippen. Die Liste zeigt alle Zugeteilten, heute Eingeteilte zuerst, Offene oben.",
            "Tablet dem Mitarbeiter geben: Er tippt seinen Namen, liest bis unten, tippt „Gelesen und verstanden" und unterschreibt.",
            "Zurück in der Liste steht er als bestätigt — mit Uhrzeit und „Tablet (dein Name)". Dann der Nächste.",
          ]}
          hinweis="Wer am eigenen Handy schon bestätigt hat, steht bereits als erledigt. Ändert sich etwas auf der Baustelle (Kran, Gerüst, Gefahrenbereich): „Inhalt bearbeiten / Ergänzung anlegen" — dann müssen alle die Ergänzung bestätigen, Frist 30 Minuten."
        />
      )}

      {istVerwaltung && (
        <Abschnitt
          icon={Building2}
          titel="Unterweisung an der Baustelle hinterlegen"
          wer="Für Büro und Bauleitung — einmal je Baustelle"
          schritte={[
            "Baustellen → Baustelle → Reiter „Unterweisung" → Art wählen (Baustelle, Fertigteilmontage, Werkstatt).",
            "Besonderheiten ergänzen: „Inhalt bearbeiten" — Kran, Absturzsicherung, Strom, was auf dieser Baustelle gilt.",
            "Fertig. Wer über den Tagesplan eingeteilt wird, bekommt sie automatisch — fällig am Einsatztag um 08:00.",
            "Beim Freigeben des Tagesplans warnt die App, wenn eine Baustelle noch keine Unterweisung hat — „Standard anlegen" genügt dann.",
            "Nachweis: im Reiter „Unterweisung" die Liste — wer, wann, am eigenen Handy oder am Tablet.",
          ]}
        />
      )}

      {istVerwaltung && (
        <Abschnitt
          icon={Send}
          titel="Mitarbeiter einen Zugang geben"
          wer="Für das Büro"
          schritte={[
            "Verwaltung → „Zugang senden" → Filter „Ohne Zugang".",
            "Handynummer eintippen → „Per SMS senden". Fertig — die SMS enthält Nummer, Passwort und den Link zur App.",
            "Neuer Mitarbeiter? Verwaltung → Mitarbeiter → „Neuer Mitarbeiter", Nummer eintragen, Einladung „SMS".",
            "Nummer ändert sich? Mitarbeiter → Bearbeiten → neue Nummer → Häkchen „auch als Anmeldenummer".",
          ]}
          hinweis="Jeder Versand setzt ein neues Passwort. Steht eine Nummer schon bei jemand anderem, sagt die App, bei wem."
        />
      )}

      <InstallPromptDialog open={installOffen} onClose={() => setInstallOffen(false)} />
    </div>
  );
}
