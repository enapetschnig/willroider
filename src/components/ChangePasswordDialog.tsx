import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Key } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

const MIN_PASSWORD_LENGTH = 8;

export default function ChangePasswordDialog() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const handleChangePassword = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);

    const formData = new FormData(e.currentTarget);
    const currentPassword = formData.get("current-password") as string;
    const newPassword = formData.get("new-password") as string;
    const confirmPassword = formData.get("confirm-password") as string;

    if (newPassword !== confirmPassword) {
      toast({
        variant: "destructive",
        title: "Passwörter stimmen nicht überein",
        description: "Bitte überprüfen Sie Ihre Eingabe.",
      });
      setLoading(false);
      return;
    }

    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      toast({
        variant: "destructive",
        title: "Passwort zu kurz",
        description: `Das Passwort muss mindestens ${MIN_PASSWORD_LENGTH} Zeichen lang sein.`,
      });
      setLoading(false);
      return;
    }

    // Aktuelles Passwort verifizieren: re-auth mit Email ODER Telefonnummer.
    // Telefon-only-Accounts haben keine Email — dort über phone verifizieren,
    // damit die Prüfung nicht stillschweigend übersprungen wird.
    const { data: u } = await supabase.auth.getUser();
    const email = u.user?.email;
    const phone = u.user?.phone;
    if (!email && !phone) {
      toast({
        variant: "destructive",
        title: "Verifizierung nicht möglich",
        description: "Konto ohne Email/Telefonnummer — bitte an den Administrator wenden.",
      });
      setLoading(false);
      return;
    }
    const { error: reauthErr } = email
      ? await supabase.auth.signInWithPassword({ email, password: currentPassword })
      : await supabase.auth.signInWithPassword({ phone: phone!, password: currentPassword });
    if (reauthErr) {
      toast({
        variant: "destructive",
        title: "Aktuelles Passwort falsch",
        description: "Bitte überprüfe deine Eingabe.",
      });
      setLoading(false);
      return;
    }

    const { error } = await supabase.auth.updateUser({
      password: newPassword,
    });

    if (error) {
      toast({
        variant: "destructive",
        title: "Fehler",
        description: error.message,
      });
    } else {
      toast({
        title: "Passwort geändert",
        description: "Ihr Passwort wurde erfolgreich aktualisiert.",
      });
      setOpen(false);
      (e.target as HTMLFormElement).reset();
    }
    setLoading(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <DropdownMenuItem onSelect={(e) => {
          e.preventDefault();
          setOpen(true);
        }}>
          <Key className="mr-2 h-4 w-4" />
          <span>Passwort ändern</span>
        </DropdownMenuItem>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Passwort ändern</DialogTitle>
          <DialogDescription>
            Aktuelles Passwort bestätigen + neues Passwort eingeben (min. {MIN_PASSWORD_LENGTH} Zeichen).
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleChangePassword} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="current-password">Aktuelles Passwort</Label>
            <Input
              id="current-password"
              name="current-password"
              type="password"
              required
              autoComplete="current-password"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="new-password">Neues Passwort</Label>
            <Input
              id="new-password"
              name="new-password"
              type="password"
              required
              minLength={MIN_PASSWORD_LENGTH}
              placeholder={`Mindestens ${MIN_PASSWORD_LENGTH} Zeichen`}
              autoComplete="new-password"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirm-password">Passwort bestätigen</Label>
            <Input
              id="confirm-password"
              name="confirm-password"
              type="password"
              required
              minLength={MIN_PASSWORD_LENGTH}
              placeholder="Passwort wiederholen"
              autoComplete="new-password"
            />
          </div>
          <div className="flex gap-2 pt-2">
            <Button type="submit" className="flex-1" disabled={loading}>
              {loading ? "Lädt..." : "Passwort ändern"}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="flex-1"
              onClick={() => setOpen(false)}
              disabled={loading}
            >
              Abbrechen
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
