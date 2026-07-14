import { useRef, useState } from "react";
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
import {
  Lightbulb,
  Bug,
  MessageCircle,
  Loader2,
  Send,
  Mic,
  Square,
  Trash2,
} from "lucide-react";

type Kategorie = "idee" | "problem" | "sonstiges";

const KATEGORIEN: { key: Kategorie; label: string; icon: typeof Lightbulb }[] = [
  { key: "idee", label: "Idee / Wunsch", icon: Lightbulb },
  { key: "problem", label: "Problem / Fehler", icon: Bug },
  { key: "sonstiges", label: "Sonstiges", icon: MessageCircle },
];

/** Best passende, breit abspielbare Aufnahme-MIME wählen. */
function pickMime(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  const candidates = ["audio/mp4", "audio/webm;codecs=opus", "audio/webm"];
  return candidates.find((c) => MediaRecorder.isTypeSupported?.(c));
}
function extFor(mime: string): string {
  if (mime.includes("mp4")) return "m4a";
  if (mime.includes("webm")) return "webm";
  return "bin";
}
const fmtDauer = (s: number) =>
  `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

const MAX_SEK = 180; // Sicherheitslimit: 3 Minuten

/**
 * Änderungswunsch-Dialog für ALLE Nutzer. Text ODER Sprachnachricht
 * (Audio-Aufnahme). Erfasst Kategorie, Seite und App-Version automatisch.
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

  // ── Audio-Aufnahme ────────────────────────────────────────────────
  const [aufnahme, setAufnahme] = useState<"idle" | "recording">("idle");
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [dauer, setDauer] = useState(0);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const stopTimer = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
  };
  const stopStream = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  };

  const verwerfeAudio = () => {
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    setAudioBlob(null);
    setAudioUrl(null);
    setDauer(0);
  };

  const startAufnahme = async () => {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      toast({ variant: "destructive", title: "Aufnahme nicht möglich", description: "Dein Browser unterstützt keine Tonaufnahme." });
      return;
    }
    const mime = pickMime();
    if (!mime) {
      toast({ variant: "destructive", title: "Aufnahme nicht möglich", description: "Kein unterstütztes Audioformat gefunden." });
      return;
    }
    verwerfeAudio();
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      toast({ variant: "destructive", title: "Mikrofon nicht freigegeben", description: "Bitte erlaube den Mikrofon-Zugriff und versuche es erneut." });
      return;
    }
    streamRef.current = stream;
    chunksRef.current = [];
    const rec = new MediaRecorder(stream, { mimeType: mime });
    recRef.current = rec;
    rec.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };
    rec.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: mime });
      setAudioBlob(blob);
      setAudioUrl(URL.createObjectURL(blob));
      stopStream();
    };
    rec.start();
    setAufnahme("recording");
    setDauer(0);
    stopTimer();
    timerRef.current = setInterval(() => {
      setDauer((d) => {
        if (d + 1 >= MAX_SEK) stopAufnahme();
        return d + 1;
      });
    }, 1000);
  };

  const stopAufnahme = () => {
    stopTimer();
    setAufnahme("idle");
    try {
      recRef.current?.state !== "inactive" && recRef.current?.stop();
    } catch {
      /* ignore */
    }
  };

  const resetAll = () => {
    stopTimer();
    stopStream();
    verwerfeAudio();
    setAufnahme("idle");
    setText("");
    setKategorie("idee");
  };

  const closeDialog = (v: boolean) => {
    if (!v) {
      if (aufnahme === "recording") stopAufnahme();
      resetAll();
    }
    onOpenChange(v);
  };

  const submit = async () => {
    const hatText = !!text.trim();
    if (!hatText && !audioBlob) {
      toast({ variant: "destructive", title: "Bitte schreib etwas oder nimm eine Sprachnachricht auf." });
      return;
    }
    if (!user) {
      toast({ variant: "destructive", title: "Bitte neu anmelden und erneut versuchen." });
      return;
    }
    setBusy(true);

    let audioPfad: string | null = null;
    let audioTyp: string | null = null;
    if (audioBlob) {
      const ext = extFor(audioBlob.type);
      const pfad = `${user.id}/${crypto.randomUUID()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("feedback-audio")
        .upload(pfad, audioBlob, { contentType: audioBlob.type, upsert: false });
      if (upErr) {
        setBusy(false);
        toast({ variant: "destructive", title: "Sprachnachricht konnte nicht hochgeladen werden", description: upErr.message });
        return;
      }
      audioPfad = pfad;
      audioTyp = audioBlob.type;
    }

    const appVersion = typeof __APP_BUILD__ !== "undefined" ? __APP_BUILD__ : null;
    const { error } = await supabase.from("feedback" as any).insert({
      erstellt_von: user.id,
      text: hatText ? text.trim() : null,
      kategorie,
      seiten_kontext: location.pathname,
      app_version: appVersion,
      audio_pfad: audioPfad,
      audio_typ: audioTyp,
      audio_sekunden: audioBlob ? dauer : null,
    });
    setBusy(false);
    if (error) {
      // Verwaiste Audiodatei aufräumen, wenn der Insert scheitert
      if (audioPfad) void supabase.storage.from("feedback-audio").remove([audioPfad]);
      toast({ variant: "destructive", title: "Konnte nicht gesendet werden", description: error.message });
      return;
    }
    toast({ title: "Danke für deinen Änderungswunsch! 🙌", description: "Wir schauen es uns an." });
    resetAll();
    onOpenChange(false);
  };

  const kannSenden = (!!text.trim() || !!audioBlob) && aufnahme !== "recording";

  return (
    <Dialog open={open} onOpenChange={closeDialog}>
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Änderungswunsch senden</DialogTitle>
          <DialogDescription>
            Schreib es oder nimm eine Sprachnachricht auf — beides hilft, die
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

          {/* Sprachnachricht */}
          <div className="space-y-1.5">
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">
              Sprachnachricht
            </Label>
            {aufnahme === "recording" ? (
              <div className="flex items-center gap-3 rounded-md border border-red-300 bg-red-50 px-3 py-2.5">
                <span className="h-3 w-3 rounded-full bg-red-600 animate-pulse shrink-0" />
                <span className="text-sm font-medium text-red-800 tabular-nums flex-1">
                  Aufnahme läuft … {fmtDauer(dauer)}
                </span>
                <Button size="sm" variant="destructive" onClick={stopAufnahme}>
                  <Square className="h-3.5 w-3.5 mr-1.5" /> Stopp
                </Button>
              </div>
            ) : audioBlob && audioUrl ? (
              <div className="flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2">
                <audio src={audioUrl} controls className="h-9 flex-1 min-w-0" />
                <span className="text-xs text-muted-foreground tabular-nums shrink-0">
                  {fmtDauer(dauer)}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-destructive shrink-0"
                  onClick={verwerfeAudio}
                  aria-label="Aufnahme verwerfen"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ) : (
              <Button
                type="button"
                variant="outline"
                className="w-full gap-2"
                onClick={startAufnahme}
              >
                <Mic className="h-4 w-4" /> Sprachnachricht aufnehmen
              </Button>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="feedback-text" className="text-xs uppercase tracking-wide text-muted-foreground">
              … oder schreiben
            </Label>
            <Textarea
              id="feedback-text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Was sollte besser sein? Je konkreter, desto besser."
              rows={4}
              className="resize-none"
            />
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={() => closeDialog(false)} disabled={busy}>
            Abbrechen
          </Button>
          <Button onClick={submit} disabled={busy || !kannSenden}>
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
