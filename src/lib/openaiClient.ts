import { supabase } from "@/integrations/supabase/client";

/** Transkribiert Audio-Blob via Edge Function (Whisper-1). */
export async function transcribeAudio(blob: Blob): Promise<string> {
  const form = new FormData();
  form.append("audio", blob, blob.type.includes("mp4") ? "recording.mp4" : "recording.webm");
  const { data, error } = await supabase.functions.invoke("transcribe_audio", {
    body: form,
  });
  if (error) throw new Error(error.message ?? "Transkription fehlgeschlagen");
  if (!data || typeof data !== "object" || !("text" in data)) {
    throw new Error("Unerwartete Antwort von Whisper");
  }
  return String((data as any).text ?? "");
}

export type UnterweisungAiResult = {
  typ: "werkstatt" | "baustelle" | "fertigteilmontage";
  titel: string;
  checkliste: { key: string; label: string; required: boolean }[];
  zusammenfassung: string;
};

/** Analysiert einen Unterweisungs-Text via GPT-4o-mini. */
export async function analyzeUnterweisung(
  text: string,
  hint?: string
): Promise<UnterweisungAiResult> {
  const { data, error } = await supabase.functions.invoke(
    "analyze_unterweisung",
    {
      body: { text, hint },
    }
  );
  if (error) throw new Error(error.message ?? "Analyse fehlgeschlagen");
  if (!data || typeof data !== "object") {
    throw new Error("Unerwartete Antwort von KI");
  }
  const r = data as any;
  if (r.error) throw new Error(r.error);
  return {
    typ: r.typ ?? "baustelle",
    titel: r.titel ?? "",
    checkliste: Array.isArray(r.checkliste) ? r.checkliste : [],
    zusammenfassung: r.zusammenfassung ?? "",
  };
}
