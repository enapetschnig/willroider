import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { edgeFunctionErrorMessage } from "@/lib/edgeError";
import type { AppRole, Database } from "@/integrations/supabase/types";
import { normalizeAtPhone } from "@/lib/phone";
import { Loader2, UserPlus } from "lucide-react";

type Partie = Database["public"]["Tables"]["partien"]["Row"];

const ROLES: { value: AppRole; label: string }[] = [
  { value: "mitarbeiter", label: "Mitarbeiter" },
  { value: "bauleiter", label: "Vorarbeiter" },
  { value: "zimmermeister", label: "Zimmermeister" },
  { value: "buero", label: "Büro" },
  { value: "geschaeftsfuehrung", label: "Geschäftsführung" },
];

const ARBEITSZEITMODELLE: { value: string; label: string }[] = [
  { value: "zimmerei_sommer", label: "Zimmerei (lange/kurze Woche)" },
  { value: "fix_40h", label: "Fix 40 h (Mo–Fr 8 h)" },
  { value: "individuell", label: "Individuell (Tagesnorm)" },
];

const todayIso = () => {
  const d = new Date();
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, "0"),
    String(d.getDate()).padStart(2, "0"),
  ].join("-");
};

// edgeFunctionErrorMessage lebt jetzt zentral in lib/edgeError.ts —
// damit alle Aufrufer denselben echten Fehlertext bekommen.

export interface CredentialsResult {
  user_id: string;
  telefon: string;
  email: string | null;
  initial_password: string;
  magic_link: string | null;
  sms_status: "sent" | "skipped" | "error";
  sms_error: string | null;
  twilio_sid: string | null;
  vorname: string;
  nachname: string;
}

export function NewMitarbeiterDialog({
  open,
  onClose,
  partien,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  partien: Partie[];
  onCreated: (result: CredentialsResult) => void;
}) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);

  // Stammdaten
  const [vorname, setVorname] = useState("");
  const [nachname, setNachname] = useState("");
  const [email, setEmail] = useState("");
  const [telefon, setTelefon] = useState("");
  const [geburtsdatum, setGeburtsdatum] = useState("");

  // Rolle + Partie
  const [rolle, setRolle] = useState<AppRole>("mitarbeiter");
  const [partieId, setPartieId] = useState<string>("");
  const [isPartieleiter, setIsPartieleiter] = useState(false);

  // Konto-Start
  const [eintrittsdatum, setEintrittsdatum] = useState<string>(todayIso());
  const [beschaeftigungsgrad, setBeschaeftigungsgrad] = useState<number>(1.0);
  const [tagesnorm, setTagesnorm] = useState<number>(8.0);
  const [arbeitszeitmodell, setArbeitszeitmodell] = useState<string>("zimmerei_sommer");
  const [urlaubJahresanspruch, setUrlaubJahresanspruch] = useState<number>(25);

  // Initial-Saldi
  const [initialUrlaub, setInitialUrlaub] = useState<number>(0);
  const [initialZa, setInitialZa] = useState<number>(0);

  // Einladung
  const [sendSms, setSendSms] = useState<boolean>(true);

  const reset = () => {
    setVorname("");
    setNachname("");
    setEmail("");
    setTelefon("");
    setGeburtsdatum("");
    setRolle("mitarbeiter");
    setPartieId("");
    setIsPartieleiter(false);
    setEintrittsdatum(todayIso());
    setBeschaeftigungsgrad(1.0);
    setTagesnorm(8.0);
    setArbeitszeitmodell("zimmerei_sommer");
    setUrlaubJahresanspruch(25);
    setInitialUrlaub(0);
    setInitialZa(0);
    setSendSms(true);
  };

  useEffect(() => {
    if (open) reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const telefonNorm = telefon.trim() ? normalizeAtPhone(telefon) : null;
  const telefonValid = telefonNorm !== null;

  const emailValid =
    !email.trim() || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

  const canSubmit =
    !!vorname.trim() &&
    !!nachname.trim() &&
    emailValid &&
    !!eintrittsdatum &&
    telefonValid &&
    !loading;

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;

    if (sendSms && !telefonNorm) {
      toast({
        variant: "destructive",
        title: "Telefonnummer fehlt",
        description: "Für die SMS-Einladung wird eine gültige Telefonnummer benötigt.",
      });
      return;
    }

    setLoading(true);
    const { data, error } = await supabase.functions.invoke("admin-create-employee", {
      body: {
        vorname: vorname.trim(),
        nachname: nachname.trim(),
        email: email.trim().toLowerCase() || undefined,
        telefon: telefonNorm || undefined,
        geburtsdatum: geburtsdatum || undefined,
        rolle,
        partie_id: partieId || null,
        is_partieleiter: isPartieleiter,
        eintrittsdatum,
        beschaeftigungsgrad,
        tagesnorm_stunden: tagesnorm,
        arbeitszeitmodell,
        urlaub_jahresanspruch_tage: urlaubJahresanspruch,
        initial_urlaub_tage: initialUrlaub,
        initial_za_stunden: initialZa,
        send_sms_invite: sendSms,
      },
    });
    setLoading(false);

    if (error) {
      toast({
        variant: "destructive",
        title: "Anlegen fehlgeschlagen",
        // Echte Fehlermeldung aus dem Response-Body statt "non-2xx status code"
        description: await edgeFunctionErrorMessage(error),
      });
      return;
    }

    if (data?.error) {
      toast({
        variant: "destructive",
        title: "Anlegen fehlgeschlagen",
        description: data.error,
      });
      return;
    }

    const result: CredentialsResult = {
      user_id: data.user_id,
      telefon: data.telefon ?? telefonNorm!,
      email: data.email ?? null,
      initial_password: data.initial_password,
      magic_link: data.magic_link ?? null,
      sms_status: data.sms_status ?? "skipped",
      sms_error: data.sms_error ?? null,
      twilio_sid: data.twilio_sid ?? null,
      vorname: vorname.trim(),
      nachname: nachname.trim(),
    };

    toast({
      title: `${vorname} ${nachname} angelegt`,
      description:
        result.sms_status === "sent"
          ? "SMS-Einladung gesendet."
          : result.sms_status === "error"
          ? `SMS-Fehler: ${result.sms_error}`
          : "Keine SMS gesendet.",
    });

    onCreated(result);
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && !loading && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserPlus className="h-5 w-5 text-primary" />
            Neuer Mitarbeiter
          </DialogTitle>
          <DialogDescription>
            Legt ein Konto an + verschickt optional sofort eine SMS-Einladung mit
            Login-Link + Initial-Passwort.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="space-y-5">
          {/* 1. Stammdaten */}
          <section className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground border-b pb-1">
              Stammdaten
            </h3>
            <div className="grid sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="nm-vorname">Vorname *</Label>
                <Input
                  id="nm-vorname"
                  value={vorname}
                  onChange={(e) => setVorname(e.target.value)}
                  required
                  autoComplete="given-name"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="nm-nachname">Nachname *</Label>
                <Input
                  id="nm-nachname"
                  value={nachname}
                  onChange={(e) => setNachname(e.target.value)}
                  required
                  autoComplete="family-name"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="nm-tel">Telefon *</Label>
                <Input
                  id="nm-tel"
                  type="tel"
                  value={telefon}
                  onChange={(e) => setTelefon(e.target.value)}
                  required
                  placeholder="z.B. 0664 1234567"
                  autoComplete="tel"
                />
                {telefon.trim() ? (
                  <div
                    className={`text-[11px] ${
                      telefonNorm ? "text-emerald-700" : "text-destructive"
                    }`}
                  >
                    {telefonNorm
                      ? `→ wird gespeichert als ${telefonNorm}`
                      : "Ungültiges Format"}
                  </div>
                ) : (
                  <div className="text-[11px] text-muted-foreground">
                    Wird zum Anmelden verwendet — Mitarbeiter erhält 6-stelligen
                    SMS-Code, kein E-Mail-Konto nötig.
                  </div>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="nm-email">E-Mail (optional)</Label>
                <Input
                  id="nm-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                  placeholder="Nur eingeben, falls echte E-Mail vorhanden"
                />
                {email.trim() && !emailValid && (
                  <div className="text-[11px] text-destructive">Ungültiges E-Mail-Format</div>
                )}
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="nm-geb">Geburtsdatum</Label>
                <Input
                  id="nm-geb"
                  type="date"
                  value={geburtsdatum}
                  onChange={(e) => setGeburtsdatum(e.target.value)}
                />
              </div>
            </div>
          </section>

          {/* 2. Rolle + Partie */}
          <section className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground border-b pb-1">
              Rolle &amp; Partie
            </h3>
            <div className="grid sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="nm-rolle">Rolle</Label>
                <select
                  id="nm-rolle"
                  value={rolle}
                  onChange={(e) => setRolle(e.target.value as AppRole)}
                  className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                >
                  {ROLES.map((r) => (
                    <option key={r.value} value={r.value}>
                      {r.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="nm-partie">Partie</Label>
                <select
                  id="nm-partie"
                  value={partieId}
                  onChange={(e) => setPartieId(e.target.value)}
                  className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                >
                  <option value="">— keine —</option>
                  {partien.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex items-center gap-2 sm:col-span-2 pt-1">
                <Switch
                  id="nm-partieleiter"
                  checked={isPartieleiter}
                  onCheckedChange={setIsPartieleiter}
                />
                <Label htmlFor="nm-partieleiter" className="text-sm cursor-pointer">
                  Ist Partieleiter (Polier)
                </Label>
              </div>
            </div>
          </section>

          {/* 3. Konto-Start */}
          <section className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground border-b pb-1">
              Konto-Start
            </h3>
            <div className="grid sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="nm-eintritt">Eintrittsdatum *</Label>
                <Input
                  id="nm-eintritt"
                  type="date"
                  value={eintrittsdatum}
                  onChange={(e) => setEintrittsdatum(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="nm-bg">Beschäftigungsgrad</Label>
                <Input
                  id="nm-bg"
                  type="number"
                  step="0.05"
                  min="0.1"
                  max="1"
                  value={beschaeftigungsgrad}
                  onChange={(e) => setBeschaeftigungsgrad(Number(e.target.value))}
                />
                <div className="text-[11px] text-muted-foreground">
                  1.00 = 100 %, 0.50 = halbtags
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="nm-tagesnorm">Tagesnorm (h)</Label>
                <Input
                  id="nm-tagesnorm"
                  type="number"
                  step="0.5"
                  min="0"
                  value={tagesnorm}
                  onChange={(e) => setTagesnorm(Number(e.target.value))}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="nm-azm">Arbeitszeitmodell</Label>
                <select
                  id="nm-azm"
                  value={arbeitszeitmodell}
                  onChange={(e) => setArbeitszeitmodell(e.target.value)}
                  className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                >
                  {ARBEITSZEITMODELLE.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="nm-urlaub">Urlaubs-Jahresanspruch (Tage)</Label>
                <Input
                  id="nm-urlaub"
                  type="number"
                  step="0.5"
                  min="0"
                  value={urlaubJahresanspruch}
                  onChange={(e) => setUrlaubJahresanspruch(Number(e.target.value))}
                />
              </div>
            </div>
          </section>

          {/* 4. Initial-Saldi */}
          <section className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground border-b pb-1">
              Initial-Saldi (optional)
            </h3>
            <div className="grid sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="nm-init-urlaub">Urlaubstage zum Eintritt</Label>
                <Input
                  id="nm-init-urlaub"
                  type="number"
                  step="0.5"
                  min="0"
                  value={initialUrlaub}
                  onChange={(e) => setInitialUrlaub(Number(e.target.value))}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="nm-init-za">ZA-Stunden zum Eintritt</Label>
                <Input
                  id="nm-init-za"
                  type="number"
                  step="0.25"
                  value={initialZa}
                  onChange={(e) => setInitialZa(Number(e.target.value))}
                />
                <div className="text-[11px] text-muted-foreground">
                  Negative Werte = Mitarbeiter hat Schulden
                </div>
              </div>
            </div>
          </section>

          {/* 5. Einladung */}
          <section className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground border-b pb-1">
              Einladung
            </h3>
            <div className="flex items-start gap-2">
              <Switch
                id="nm-sms"
                checked={sendSms}
                onCheckedChange={setSendSms}
              />
              <div className="flex-1">
                <Label htmlFor="nm-sms" className="text-sm cursor-pointer">
                  SMS-Einladung sofort senden
                </Label>
                <div className="text-[11px] text-muted-foreground">
                  Enthält Login-Anleitung + Backup-Passwort + Install-Hinweis.
                </div>
              </div>
            </div>
          </section>

          <DialogFooter className="sticky bottom-0 bg-card pt-3 border-t flex-row gap-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={loading}>
              Abbrechen
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Anlegen
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
