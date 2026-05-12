import { Mic, MicOff, Loader2, Square } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useRecorder } from "@/hooks/useRecorder";
import { transcribeAudio } from "@/lib/openaiClient";

/**
 * Mikrofon-Button: Aufnahme starten/stoppen, Whisper-Transkription,
 * Text via onText(text) zurückgeben.
 *
 * State:
 * - idle: graues Mic-Icon
 * - recording: rotes Pulse + Sekunden-Counter + Stop-Icon, Klick → stop
 * - processing: Spinner
 * - error: kurzer error-State, dann zurück auf idle (Toast siehe useRecorder.onError)
 */
export function MicButton({
  onText,
  className,
  title,
}: {
  onText: (text: string) => void;
  className?: string;
  title?: string;
}) {
  const { toast } = useToast();
  const { state, duration, start, stop } = useRecorder({
    onResult: async (blob) => {
      const text = await transcribeAudio(blob);
      if (!text.trim()) {
        toast({ variant: "destructive", title: "Keine Sprache erkannt" });
        return;
      }
      onText(text.trim());
    },
    onError: (msg) =>
      toast({ variant: "destructive", title: "Mikrofon", description: msg }),
  });

  const handleClick = () => {
    if (state === "idle" || state === "error") start();
    else if (state === "recording") stop();
  };

  const base =
    "inline-flex items-center justify-center rounded-md transition-colors shrink-0 disabled:opacity-50";
  const sizeClass = "h-9 w-9";

  if (state === "processing") {
    return (
      <button
        type="button"
        disabled
        className={`${base} ${sizeClass} border bg-muted ${className ?? ""}`}
        title="Transkription läuft…"
      >
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      </button>
    );
  }

  if (state === "recording") {
    return (
      <button
        type="button"
        onClick={handleClick}
        className={`${base} px-2 h-9 gap-1.5 bg-red-500 text-white hover:bg-red-600 ${className ?? ""}`}
        title="Aufnahme stoppen"
      >
        <Square className="h-3.5 w-3.5 fill-white" />
        <span className="text-xs font-bold tabular-nums">{duration}s</span>
        <span className="h-2 w-2 rounded-full bg-white animate-pulse" />
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      className={`${base} ${sizeClass} border bg-background hover:bg-muted ${className ?? ""}`}
      title={title ?? "Spracheingabe"}
      aria-label="Spracheingabe starten"
    >
      {state === "error" ? (
        <MicOff className="h-4 w-4 text-red-500" />
      ) : (
        <Mic className="h-4 w-4 text-muted-foreground" />
      )}
    </button>
  );
}
