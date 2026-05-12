import { useCallback, useEffect, useRef, useState } from "react";

export type RecorderState = "idle" | "recording" | "processing" | "error";

const MAX_SEC = 60;

function pickMimeType(): string {
  // Browser-Kompatibilität: Safari liefert mp4, Chrome/Firefox webm
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/mpeg",
  ];
  if (typeof MediaRecorder === "undefined") return "";
  for (const c of candidates) {
    if (MediaRecorder.isTypeSupported(c)) return c;
  }
  return "";
}

export function useRecorder(opts: {
  onResult: (blob: Blob) => Promise<void> | void;
  onError?: (msg: string) => void;
}) {
  const { onResult, onError } = opts;
  const [state, setState] = useState<RecorderState>("idle");
  const [duration, setDuration] = useState(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const timerRef = useRef<number | null>(null);
  const stoppingRef = useRef(false);

  const cleanup = useCallback(() => {
    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    recorderRef.current = null;
    chunksRef.current = [];
    stoppingRef.current = false;
  }, []);

  useEffect(() => {
    return () => cleanup();
  }, [cleanup]);

  const start = useCallback(async () => {
    if (state !== "idle") return;
    setDuration(0);
    if (
      typeof navigator === "undefined" ||
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === "undefined"
    ) {
      onError?.("Mikrofon wird von diesem Browser nicht unterstützt.");
      setState("error");
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e: any) {
      const msg = e?.name === "NotAllowedError"
        ? "Mikrofon-Zugriff verweigert. Bitte in den Browser-Einstellungen erlauben."
        : "Mikrofon konnte nicht geöffnet werden.";
      onError?.(msg);
      setState("error");
      return;
    }
    const mime = pickMimeType();
    let recorder: MediaRecorder;
    try {
      recorder = mime
        ? new MediaRecorder(stream, { mimeType: mime })
        : new MediaRecorder(stream);
    } catch {
      stream.getTracks().forEach((t) => t.stop());
      onError?.("Aufnahme nicht möglich (MediaRecorder).");
      setState("error");
      return;
    }
    streamRef.current = stream;
    recorderRef.current = recorder;
    chunksRef.current = [];

    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
    };
    recorder.onstop = async () => {
      const blob = new Blob(chunksRef.current, {
        type: recorder.mimeType || "audio/webm",
      });
      cleanup();
      if (blob.size < 800) {
        // sehr kurz/leer
        setState("idle");
        onError?.("Keine Aufnahme erkannt. Bitte länger sprechen.");
        return;
      }
      setState("processing");
      try {
        await onResult(blob);
        setState("idle");
      } catch (e: any) {
        setState("error");
        onError?.(e?.message ?? "Transkription fehlgeschlagen.");
        // Nach kurzer Anzeige zurück auf idle
        window.setTimeout(() => setState("idle"), 1500);
      }
    };
    recorder.start();
    setState("recording");
    const t0 = Date.now();
    timerRef.current = window.setInterval(() => {
      const sec = Math.floor((Date.now() - t0) / 1000);
      setDuration(sec);
      if (sec >= MAX_SEC) {
        if (recorder.state === "recording" && !stoppingRef.current) {
          stoppingRef.current = true;
          recorder.stop();
        }
      }
    }, 250);
  }, [cleanup, onError, onResult, state]);

  const stop = useCallback(() => {
    if (state !== "recording") return;
    const r = recorderRef.current;
    if (r && r.state === "recording") {
      stoppingRef.current = true;
      r.stop();
    }
  }, [state]);

  const cancel = useCallback(() => {
    chunksRef.current = [];
    cleanup();
    setState("idle");
    setDuration(0);
  }, [cleanup]);

  return { state, duration, start, stop, cancel };
}
