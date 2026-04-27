import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";

export default function Auth() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [isLogin, setIsLogin] = useState(true);
  const [showPasswordReset, setShowPasswordReset] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        navigate("/", { replace: true });
      }
    });
  }, [navigate]);

  const handleLogin = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);
    const formData = new FormData(e.currentTarget);
    const email = formData.get("email") as string;
    const password = formData.get("password") as string;

    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      toast({ variant: "destructive", title: "Fehler beim Anmelden", description: error.message });
      setLoading(false);
      return;
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("is_active")
      .eq("id", data.user.id)
      .maybeSingle();

    if (!profile?.is_active) {
      await supabase.auth.signOut({ scope: "local" });
      toast({
        variant: "destructive",
        title: "Konto noch nicht freigeschaltet",
        description:
          "Ihr Konto wartet auf die Freischaltung durch das Büro / die Bauleitung.",
      });
      setLoading(false);
      return;
    }

    toast({ title: "Willkommen zurück!" });
    navigate("/");
    setLoading(false);
  };

  const handleSignup = async (e: React.FormEvent<HTMLFormElement>) => {
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
    if (error) {
      toast({ variant: "destructive", title: "Registrierung fehlgeschlagen", description: error.message });
      setLoading(false);
      return;
    }

    await supabase.auth.signOut({ scope: "local" });
    toast({
      title: "Registrierung erfolgreich",
      description:
        "Ihr Konto wurde angelegt und wartet auf die Freischaltung durch das Büro.",
    });
    setIsLogin(true);
    setLoading(false);
  };

  const handlePasswordReset = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);
    const formData = new FormData(e.currentTarget);
    const email = formData.get("reset-email") as string;
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth`,
    });
    if (error) {
      toast({ variant: "destructive", title: "Fehler", description: error.message });
    } else {
      toast({ title: "E-Mail gesendet", description: "Prüfen Sie Ihr Postfach für den Reset-Link." });
      setShowPasswordReset(false);
    }
    setLoading(false);
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
        <CardContent>
          {showPasswordReset ? (
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
                onClick={() => setShowPasswordReset(false)}
              >
                Zurück zur Anmeldung
              </Button>
            </form>
          ) : (
            <div className="space-y-5">
              <div className="flex bg-muted rounded-md p-1">
                <button
                  type="button"
                  onClick={() => setIsLogin(true)}
                  className={`flex-1 h-9 rounded text-sm font-medium transition ${
                    isLogin ? "bg-background shadow-sm text-foreground" : "text-muted-foreground"
                  }`}
                >
                  Anmelden
                </button>
                <button
                  type="button"
                  onClick={() => setIsLogin(false)}
                  className={`flex-1 h-9 rounded text-sm font-medium transition ${
                    !isLogin ? "bg-background shadow-sm text-foreground" : "text-muted-foreground"
                  }`}
                >
                  Registrieren
                </button>
              </div>

              <form onSubmit={isLogin ? handleLogin : handleSignup} className="space-y-3">
                {!isLogin && (
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
                  <Input id="password" name="password" type="password" required minLength={6} />
                </div>
                {isLogin && (
                  <button
                    type="button"
                    onClick={() => setShowPasswordReset(true)}
                    className="text-xs text-primary hover:underline"
                  >
                    Passwort vergessen?
                  </button>
                )}
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? "Lädt…" : isLogin ? "Anmelden" : "Registrieren"}
                </Button>
              </form>

              {!isLogin && (
                <p className="text-xs text-muted-foreground text-center">
                  Neue Konten müssen vom Büro freigeschaltet werden, bevor sie genutzt werden können.
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
