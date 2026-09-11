/**
 * Unterschrift-Dialog — drei Wege, ein Ergebnis (Base64-PNG):
 *   1. gespeicherte Unterschrift mit einem Klick einfügen (am Rechner!)
 *   2. mit Finger oder Maus zeichnen — und auf Wunsch als „meine" merken
 *   3. ein Bild der Unterschrift hochladen
 *
 * Die gespeicherte Unterschrift gehört dem Angemeldeten. Wo jemand ANDERER
 * unterschreibt (Kunde am Bericht, Mitarbeiter am Tablet des Poliers),
 * schaltet der Aufrufer sie mit `gespeicherteErlauben={false}` ab.
 */

import { useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Eraser, Check, Loader2, PenLine, Upload, Star } from "lucide-react";

const isDesktop = () =>
  typeof window !== "undefined" && window.matchMedia("(pointer: fine)").matches;

export function UnterschriftDialog({
  open,
  onOpenChange,
  onSave,
  titel = "Unterschrift",
  busy = false,
  gespeicherteErlauben = true,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSave: (dataUrl: string) => void;
  titel?: string;
  busy?: boolean;
  /** false, wenn jemand anderer als der Angemeldete unterschreibt. */
  gespeicherteErlauben?: boolean;
}) {
  const { user } = useAuth();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const drawingRef = useRef(false);
  const [hasDrawn, setHasDrawn] = useState(false);
  const [gespeichert, setGespeichert] = useState<string | null>(null);
  const [modus, setModus] = useState<"wahl" | "zeichnen">("zeichnen");
  const [merken, setMerken] = useState(false);

  // Gespeicherte Unterschrift laden; wenn vorhanden, zuerst anbieten.
  useEffect(() => {
    if (!open) return;
    setHasDrawn(false);
    if (!gespeicherteErlauben || !user?.id) {
      setGespeichert(null);
      setModus("zeichnen");
      setMerken(false);
      return;
    }
    (async () => {
      const { data } = await supabase
        .from("unterschrift_vorlagen" as any)
        .select("data")
        .eq("profile_id", user.id)
        .maybeSingle();
      const d = (data as any)?.data ?? null;
      setGespeichert(d);
      setModus(d ? "wahl" : "zeichnen");
      // Ohne gespeicherte Unterschrift: Merken vorschlagen — am Rechner
      // ist das genau der Punkt, um es nicht ständig mit der Maus zu tun.
      setMerken(!d && isDesktop());
    })();
  }, [open, user?.id, gespeicherteErlauben]);

  useEffect(() => {
    if (!open || modus !== "zeichnen") return;
    let raf = 0;
    let cleanup: (() => void) | undefined;

    const setup = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (w === 0 || h === 0) {
        raf = requestAnimationFrame(setup);
        return;
      }
      const dpr = window.devicePixelRatio || 1;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.scale(dpr, dpr);
      ctx.lineWidth = 2.5;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.strokeStyle = "#111";
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, w, h);
      setHasDrawn(false);

      let lastX = 0;
      let lastY = 0;
      const point = (e: MouseEvent | TouchEvent) => {
        const rect = canvas.getBoundingClientRect();
        const t = "touches" in e ? e.touches[0] : (e as MouseEvent);
        return {
          x: ((t.clientX - rect.left) / rect.width) * w,
          y: ((t.clientY - rect.top) / rect.height) * h,
        };
      };
      const start = (e: Event) => {
        e.preventDefault();
        drawingRef.current = true;
        const p = point(e as MouseEvent | TouchEvent);
        lastX = p.x;
        lastY = p.y;
        setHasDrawn(true);
      };
      const move = (e: Event) => {
        if (!drawingRef.current) return;
        e.preventDefault();
        const p = point(e as MouseEvent | TouchEvent);
        ctx.beginPath();
        ctx.moveTo(lastX, lastY);
        ctx.lineTo(p.x, p.y);
        ctx.stroke();
        lastX = p.x;
        lastY = p.y;
      };
      const end = () => {
        drawingRef.current = false;
      };
      canvas.addEventListener("mousedown", start);
      canvas.addEventListener("mousemove", move);
      canvas.addEventListener("mouseup", end);
      canvas.addEventListener("mouseleave", end);
      canvas.addEventListener("touchstart", start, { passive: false });
      canvas.addEventListener("touchmove", move, { passive: false });
      canvas.addEventListener("touchend", end);
      cleanup = () => {
        canvas.removeEventListener("mousedown", start);
        canvas.removeEventListener("mousemove", move);
        canvas.removeEventListener("mouseup", end);
        canvas.removeEventListener("mouseleave", end);
        canvas.removeEventListener("touchstart", start);
        canvas.removeEventListener("touchmove", move);
        canvas.removeEventListener("touchend", end);
      };
    };

    raf = requestAnimationFrame(setup);
    return () => {
      cancelAnimationFrame(raf);
      cleanup?.();
    };
  }, [open, modus]);

  const clear = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.clientWidth, canvas.clientHeight);
    setHasDrawn(false);
  };

  /** Bild-Datei (Foto/Scan der Unterschrift) eingepasst auf den Canvas. */
  const bildLaden = (file: File) => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const img = new Image();
    img.onload = () => {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, w, h);
      const scale = Math.min((w - 16) / img.width, (h - 16) / img.height, 1.5);
      const dw = img.width * scale;
      const dh = img.height * scale;
      ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
      setHasDrawn(true);
      URL.revokeObjectURL(img.src);
    };
    img.src = URL.createObjectURL(file);
  };

  const merkenSpeichern = async (dataUrl: string) => {
    if (!user?.id) return;
    await supabase
      .from("unterschrift_vorlagen" as any)
      .upsert({ profile_id: user.id, data: dataUrl, updated_at: new Date().toISOString() });
  };

  const save = async () => {
    const canvas = canvasRef.current;
    if (!canvas || !hasDrawn) return;
    const dataUrl = canvas.toDataURL("image/png");
    if (merken && gespeicherteErlauben) await merkenSpeichern(dataUrl);
    onSave(dataUrl);
  };

  const vergessen = async () => {
    if (!user?.id) return;
    await supabase.from("unterschrift_vorlagen" as any).delete().eq("profile_id", user.id);
    setGespeichert(null);
    setModus("zeichnen");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{titel}</DialogTitle>
        </DialogHeader>

        {modus === "wahl" && gespeichert ? (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">Deine gespeicherte Unterschrift:</p>
            <div className="rounded-md border bg-white p-2">
              <img src={gespeichert} alt="Gespeicherte Unterschrift" className="h-28 w-full object-contain" />
            </div>
            <Button className="w-full h-11" onClick={() => onSave(gespeichert)} disabled={busy}>
              {busy ? (
                <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
              ) : (
                <Check className="h-4 w-4 mr-1.5" />
              )}
              Diese Unterschrift verwenden
            </Button>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" className="flex-1" onClick={() => setModus("zeichnen")}>
                <PenLine className="h-3.5 w-3.5 mr-1.5" />
                Neu zeichnen
              </Button>
              <Button variant="ghost" size="sm" className="flex-1 text-muted-foreground" onClick={vergessen}>
                Gespeicherte löschen
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              {isDesktop()
                ? "Mit der Maus zeichnen — oder ein Bild deiner Unterschrift hochladen."
                : "Mit dem Finger im Feld unterschreiben."}
            </p>
            <canvas
              ref={canvasRef}
              className="w-full h-44 rounded-md border-2 border-dashed bg-white touch-none"
            />
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={clear} className="flex-1">
                <Eraser className="h-3.5 w-3.5 mr-1.5" />
                Löschen
              </Button>
              <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()} className="flex-1">
                <Upload className="h-3.5 w-3.5 mr-1.5" />
                Bild hochladen
              </Button>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) bildLaden(f);
                  e.target.value = "";
                }}
              />
            </div>
            {gespeicherteErlauben && (
              <label className="flex items-center gap-2 text-xs cursor-pointer pt-1">
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={merken}
                  onChange={(e) => setMerken(e.target.checked)}
                />
                <Star className="h-3.5 w-3.5 text-primary" />
                Als meine Unterschrift merken — danach mit einem Klick einfügen
              </label>
            )}
            {gespeichert && (
              <button
                type="button"
                className="text-xs text-primary hover:underline"
                onClick={() => setModus("wahl")}
              >
                ← Gespeicherte Unterschrift verwenden
              </button>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Abbrechen
          </Button>
          {modus === "zeichnen" && (
            <Button onClick={save} disabled={!hasDrawn || busy}>
              {busy ? (
                <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
              ) : (
                <Check className="h-4 w-4 mr-1.5" />
              )}
              Unterschreiben
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
