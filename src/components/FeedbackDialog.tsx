import { useState } from "react";
import { useLocation } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/components/ui/use-toast";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Lightbulb, Bug, Heart, MessageCircle, Loader2, Send } from "lucide-react";

type Kategorie = "idee" | "problem" | "lob" | "sonstiges";

const KATEGORIEN: { key: Kategorie; label: string; icon: typeof Lightbulb }[] = [
  { key: "idee", label: "Idee / Wunsch", icon: Lightbulb },
  { key: "problem", label: "Problem / Fehler", icon: Bug },
  { key: "lob", label: "Lob", icon: Heart },
  { key: "sonstiges", label: "Sonstiges", icon: MessageCircle },
];

/**
 * Feedback-Dialog für ALLE eingeloggten Nutzer. Speichert Text + Kategorie
 * und erfasst automatisch die aktuelle Seite und die App-Version — landet in
 * der Verwaltung → Feedback (nur Admins sehen es).
 */
export function FeedbackDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { user } = useAuth();
  const { toast } = useToast();
  const location = useLocation();
  const [kategorie, setKategorie] = useState<Kategorie>("idee");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setText("");
    setKategorie("idee");
  };

  const submit = async () => {
    if (!text.trim()) {
      toast({ variant: "destructive", title: "Bitte schreib kurz, worum es geht." });
      return;
    }
    setBusy(true);
    const appVersion =
      typeof __APP_BUILD__ !== "undefined" ? __APP_BUILD__ : null;
    const { error } = await supabase.from("feedback" as any).insert({
      erstellt_von: user?.id ?? null,
      text: text.trim(),
      kategorie,
      seiten_kontext: location.pathname,
      app_version: appVersion,
    });
    setBusy(false);
    if (error) {
      toast({
        variant: "destructive",
        title: "Konnte nicht gesendet werden",
        description: error.message,
      });
      return;
    }
    toast({
      title: "Danke für dein Feedback! 🙌",
      description: "Wir schauen es uns an.",
    });
    reset();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Feedback geben</DialogTitle>
          <DialogDescription>
            Dein Vorschlag, ein Fehler oder einfach ein Lob — alles hilft, die
            App besser zu machen. Geht direkt ans Büro.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-1">
          <div className="space-y-1.5">
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">
              Worum geht's?
            </Label>
            <div className="grid grid-cols-2 gap-2">
              {KATEGORIEN.map((k) => {
                const Icon = k.icon;
                const active = kategorie === k.key;
                return (
                  <button
                    key={k.key}
                    type="button"
                    onClick={() => setKategorie(k.key)}
                    className={`flex items-center gap-2 rounded-md border px-3 py-2 text-sm transition ${
                      active
                        ? "border-primary bg-primary/10 text-primary font-medium"
                        : "border-input hover:bg-muted"
                    }`}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    {k.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="feedback-text" className="text-xs uppercase tracking-wide text-muted-foreground">
              Deine Nachricht
            </Label>
            <Textarea
              id="feedback-text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Was sollte besser sein? Je konkreter, desto besser."
              rows={5}
              className="resize-none"
              autoFocus
            />
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Abbrechen
          </Button>
          <Button onClick={submit} disabled={busy || !text.trim()}>
            {busy ? (
              <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
            ) : (
              <Send className="h-4 w-4 mr-1.5" />
            )}
            Absenden
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
