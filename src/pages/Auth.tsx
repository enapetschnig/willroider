import { useEffect, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { normalizeAtPhone } from "@/lib/phone";
import { Phone, Mail, Loader2 } from "lucide-react";

type Tab = "telefon" | "email";
type EmailMode = "login" | "signup" | "reset";
type PhoneMode = "request-code" | "verify-code" | "password";

export default function Auth() {
  const navigate = useNavigate();
  const location = useLocation();
  const { toast } = useToast();
  const [params] = useSearchParams();

  // Deep-Link-Ziel: ProtectedRoute legt beim Redirect das ursprüngliche
  // location-Objekt in state.from ab — nur interne Pfade ("/…") akzeptieren.
  const fromState = (
    location.state as { from?: { pathname?: string; search?: string; hash?: string } } | null
  )?.from;
  const redirectTo =
    fromState?.pathname && fromState.pathname.startsWith("/")
      ? `${fromState.pathname}${fromState.search ?? ""}${fromState.hash ?? ""}`
      : "/";
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<Tab>("telefon");
  const [emailMode, setEmailMode] = useState<EmailMode>("login");
  const [phoneMode, setPhoneMode] = useState<PhoneMode>("request-code");

  // Telefon-State
  const [phoneInput, setPhoneInput] = useState("");
  const [phoneE164, setPhoneE164] = useState<string | null>(null);
  const [otp, setOtp] = useState("");
  const [phonePassword, setPhonePassword] = useState("");

  // Schon eingeloggt? → Startseite.
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) navigate("/", { replace: true });
    });
  }, [navigate]);

  // Wenn ?phone=… aus SMS-Link kommt → Telefon-Tab + vorausfüllen
  useEffect(() => {
    const fromUrl = params.get("phone");
    if (fromUrl) {
      const norm = normalizeAtPhone(fromUrl);
      if (norm) {
        setTab("telefon");
        setPhoneInput(norm);
        setPhoneE164(norm);
      }
    }
  }, [params]);

  // ─── nach erfolgreichem Login: is_active prüfen + weiterleiten ─────────
  const finalizeLogin = async (userId: string) => {
    const { data: profile, error } = await supabase
      .from("profiles")
      .select("is_active")
      .eq("id", userId)
      .maybeSingle();

    // Query-Fehler (Netzwerk/RLS) NICHT mit "nicht freigeschaltet" verwechseln —
    // das Konto kann aktiv sein, nur die Prüfung ist fehlgeschlagen.
    if (error) {
      await supabase.auth.signOut({ scope: "local" });
      toast({
        variant: "destructive",
        title: "Anmeldung fehlgeschlagen",
        description: `Bitte nochmal versuchen: ${error.message}`,
      });
      return;
    }

    if (!profile?.is_active) {
      await supabase.auth.signOut({ scope: "local" });
      toast({
        variant: "destructive",
        title: "Konto noch nicht freigeschaltet",
        description:
          "Ihr Konto wartet auf die Freischaltung durch das Büro / die Bauleitung.",
      });
      return;
    }
    toast({ title: "Willkommen zurück!" });
    // Zurück zum ursprünglichen Deep-Link (state.from), sonst Startseite
    navigate(redirectTo, { replace: true });
  };

  // ─── Telefon: Code anfordern (OTP per SMS) ─────────────────────────────
  const handleRequestOtp = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const norm = normalizeAtPhone(phoneInput);
    if (!norm) {
      toast({
        variant: "destructive",
        title: "Telefonnummer ungültig",
        description: "Bitte als 0664… oder +43… eingeben.",
      });
      return;
    }
    setLoading(true);
    setPhoneE164(norm);
    const { error } = await supabase.auth.signInWithOtp({ phone: norm });
    setLoading(false);
    if (error) {
      toast({
        variant: "destructive",
        title: "Code konnte nicht gesendet werden",
        description: error.message,
      });
      return;
    }
    toast({
      title: "Code wurde gesendet",
      description: `SMS an ${norm} — Code in der App eingeben.`,
    });
    setPhoneMode("verify-code");
  };

  // ─── Telefon: OTP-Code verifizieren ────────────────────────────────────
  const handleVerifyOtp = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!phoneE164) return;
    setLoading(true);
    const { data, error } = await supabase.auth.verifyOtp({
      phone: phoneE164,
      token: otp.trim(),
      type: "sms",
    });
    setLoading(false);
    if (error || !data.user) {
      toast({
        variant: "destructive",
        title: "Code nicht akzeptiert",
        description: error?.message ?? "Bitte prüfen und neu versuchen.",
      });
      return;
    }
    await finalizeLogin(data.user.id);
  };

  // ─── Telefon: mit Passwort statt OTP ───────────────────────────────────
  const handlePhonePasswordLogin = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const norm = normalizeAtPhone(phoneInput);
    if (!norm) {
      toast({
        variant: "destructive",
        title: "Telefonnummer ungültig",
        description: "Bitte als 0664… oder +43… eingeben.",
      });
      return;
    }
    setLoading(true);
    const { data, error } = await supabase.auth.signInWithPassword({
      phone: norm,
      password: phonePassword,
    });
    setLoading(false);
    if (error || !data.user) {
      toast({
        variant: "destructive",
        title: "Anmeldung fehlgeschlagen",
        description: error?.message ?? "Telefon oder Passwort falsch.",
      });
      return;
    }
    await finalizeLogin(data.user.id);
  };

  // ─── E-Mail-Login ──────────────────────────────────────────────────────
  const handleEmailLogin = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);
    const formData = new FormData(e.currentTarget);
    const email = formData.get("email") as string;
    const password = formData.get("password") as string;
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    setLoading(false);
    if (error || !data.user) {
      toast({
        variant: "destructive",
        title: "Fehler beim Anmelden",
        description: error?.message ?? "Unbekannter Fehler",
      });
      return;
    }
    await finalizeLogin(data.user.id);
  };

  // ─── E-Mail-Signup (Self-Service) ──────────────────────────────────────
  const handleEmailSignup = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);
    const formData = new FormData(e.currentTarget);
    const vorname = formData.get("vorname") as string;
    const nachname = formData.get("nachname") as string;
    const email = formData.get("email") as string;
    const password = formData.get("password") as string;

    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/`,
        data: { vorname, nachname },
      },
    });
    setLoading(false);
    if (error) {
      toast({
        variant: "destructive",
        title: "Registrierung fehlgeschlagen",
        description: error.message,
      });
      return;
    }
    await supabase.auth.signOut({ scope: "local" });
    toast({ title: "Registrierung erfolgreich" });
    navigate("/registriert");
  };

  // ─── E-Mail-Passwort-Reset ─────────────────────────────────────────────
  const handlePasswordReset = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);
    const formData = new FormData(e.currentTarget);
    const email = formData.get("reset-email") as string;
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth`,
    });
    setLoading(false);
    if (error) {
      toast({ variant: "destructive", title: "Fehler", description: error.message });
    } else {
      toast({
        title: "E-Mail gesendet",
        description: "Prüfen Sie Ihr Postfach für den Reset-Link.",
      });
      setEmailMode("login");
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-background">
      <Card className="w-full max-w-md shadow-sm border">
        <CardHeader className="text-center pb-4 pt-8">
          <img
            src="/willroider-logo.jpg"
            alt="Holzbau Willroider"
            className="h-14 w-auto mx-auto mb-4"
          />
          <CardTitle className="text-xl font-semibold">Holzbau Willroider</CardTitle>
          <CardDescription className="text-xs">Baustellenmanagement</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {/* Tab-Auswahl */}
          <div className="flex bg-muted rounded-md p-1">
            <button
              type="button"
              onClick={() => {
                setTab("telefon");
                setPhoneMode("request-code");
              }}
              className={`flex-1 h-10 rounded text-sm font-medium transition flex items-center justify-center gap-1.5 ${
                tab === "telefon"
                  ? "bg-background shadow-sm text-foreground"
                  : "text-muted-foreground"
              }`}
            >
              <Phone className="h-4 w-4" />
              Telefon
            </button>
            <button
              type="button"
              onClick={() => {
                setTab("email");
                setEmailMode("login");
              }}
              className={`flex-1 h-10 rounded text-sm font-medium transition flex items-center justify-center gap-1.5 ${
                tab === "email"
                  ? "bg-background shadow-sm text-foreground"
                  : "text-muted-foreground"
              }`}
            >
              <Mail className="h-4 w-4" />
              E-Mail
            </button>
          </div>

          {/* ─── Telefon-Tab ─── */}
          {tab === "telefon" && phoneMode === "request-code" && (
            <form onSubmit={handleRequestOtp} className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="phone">Telefonnummer</Label>
                <Input
                  id="phone"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  value={phoneInput}
                  onChange={(e) => setPhoneInput(e.target.value)}
                  placeholder="0664 1234567"
                  required
                />
              </div>
              <Button type="submit" className="w-full h-11" disabled={loading}>
                {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Code per SMS anfordern
              </Button>
              <button
                type="button"
                onClick={() => setPhoneMode("password")}
                className="text-xs text-primary hover:underline mx-auto block"
              >
                Stattdessen mit Passwort anmelden
              </button>
            </form>
          )}

          {tab === "telefon" && phoneMode === "verify-code" && (
            <form onSubmit={handleVerifyOtp} className="space-y-3">
              <div className="text-xs text-muted-foreground text-center">
                SMS an{" "}
                <span className="font-semibold text-foreground">{phoneE164}</span>{" "}
                gesendet. 6-stelligen Code unten eingeben:
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="otp">Code</Label>
                <Input
                  id="otp"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={otp}
                  onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  placeholder="123456"
                  maxLength={6}
                  required
                  className="text-center text-lg tracking-widest"
                />
              </div>
              <Button
                type="submit"
                className="w-full h-11"
                disabled={loading || otp.length < 6}
              >
                {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Anmelden
              </Button>
              <div className="flex justify-between text-xs">
                <button
                  type="button"
                  onClick={() => {
                    setPhoneMode("request-code");
                    setOtp("");
                  }}
                  className="text-muted-foreground hover:underline"
                >
                  ← Andere Nummer
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    if (!phoneE164) return;
                    setLoading(true);
                    const { error } = await supabase.auth.signInWithOtp({
                      phone: phoneE164,
                    });
                    setLoading(false);
                    if (error) {
                      toast({
                        variant: "destructive",
                        title: "Erneutes Senden fehlgeschlagen",
                        description: error.message,
                      });
                    } else {
                      toast({ title: "Neuer Code gesendet" });
                    }
                  }}
                  className="text-primary hover:underline"
                  disabled={loading}
                >
                  Code erneut senden
                </button>
              </div>
            </form>
          )}

          {tab === "telefon" && phoneMode === "password" && (
            <form onSubmit={handlePhonePasswordLogin} className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="phone-pw">Telefonnummer</Label>
                <Input
                  id="phone-pw"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  value={phoneInput}
                  onChange={(e) => setPhoneInput(e.target.value)}
                  placeholder="0664 1234567"
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="phone-password">Passwort</Label>
                <Input
                  id="phone-password"
                  type="password"
                  value={phonePassword}
                  onChange={(e) => setPhonePassword(e.target.value)}
                  required
                  minLength={6}
                />
              </div>
              <Button type="submit" className="w-full h-11" disabled={loading}>
                {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Anmelden
              </Button>
              <button
                type="button"
                onClick={() => setPhoneMode("request-code")}
                className="text-xs text-primary hover:underline mx-auto block"
              >
                ← Mit SMS-Code anmelden
              </button>
            </form>
          )}

          {/* ─── E-Mail-Tab ─── */}
          {tab === "email" && emailMode === "reset" && (
            <form onSubmit={handlePasswordReset} className="space-y-4">
              <div>
                <h3 className="text-lg font-semibold">Passwort zurücksetzen</h3>
                <p className="text-sm text-muted-foreground">
                  Geben Sie Ihre E-Mail ein, um einen Reset-Link zu erhalten.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="reset-email">E-Mail</Label>
                <Input id="reset-email" name="reset-email" type="email" required />
              </div>
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? "Lädt…" : "Reset-Link senden"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="w-full"
                onClick={() => setEmailMode("login")}
              >
                Zurück zur Anmeldung
              </Button>
            </form>
          )}

          {tab === "email" && emailMode !== "reset" && (
            <div className="space-y-4">
              <div className="flex bg-muted rounded-md p-1">
                <button
                  type="button"
                  onClick={() => setEmailMode("login")}
                  className={`flex-1 h-9 rounded text-sm font-medium transition ${
                    emailMode === "login"
                      ? "bg-background shadow-sm text-foreground"
                      : "text-muted-foreground"
                  }`}
                >
                  Anmelden
                </button>
                <button
                  type="button"
                  onClick={() => setEmailMode("signup")}
                  className={`flex-1 h-9 rounded text-sm font-medium transition ${
                    emailMode === "signup"
                      ? "bg-background shadow-sm text-foreground"
                      : "text-muted-foreground"
                  }`}
                >
                  Registrieren
                </button>
              </div>

              <form
                onSubmit={emailMode === "login" ? handleEmailLogin : handleEmailSignup}
                className="space-y-3"
              >
                {emailMode === "signup" && (
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="vorname">Vorname</Label>
                      <Input id="vorname" name="vorname" required />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="nachname">Nachname</Label>
                      <Input id="nachname" name="nachname" required />
                    </div>
                  </div>
                )}
                <div className="space-y-1.5">
                  <Label htmlFor="email">E-Mail</Label>
                  <Input id="email" name="email" type="email" autoComplete="email" required />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="password">Passwort</Label>
                  <Input
                    id="password"
                    name="password"
                    type="password"
                    required
                    minLength={6}
                  />
                </div>
                {emailMode === "login" && (
                  <button
                    type="button"
                    onClick={() => setEmailMode("reset")}
                    className="text-xs text-primary hover:underline"
                  >
                    Passwort vergessen?
                  </button>
                )}
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? "Lädt…" : emailMode === "login" ? "Anmelden" : "Registrieren"}
                </Button>
              </form>

              {emailMode === "signup" && (
                <p className="text-xs text-muted-foreground text-center">
                  Neue Konten müssen vom Büro freigeschaltet werden, bevor sie genutzt
                  werden können.
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
