/**
 * Schlanker Unterschrift-Dialog — Finger/Maus zeichnen auf einem Canvas,
 * Ergebnis wird als Base64-PNG zurückgegeben.
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
import { Eraser, Check, Loader2 } from "lucide-react";

export function UnterschriftDialog({
  open,
  onOpenChange,
  onSave,
  titel = "Unterschrift",
  busy = false,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSave: (dataUrl: string) => void;
  titel?: string;
  busy?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef(false);
  const [hasDrawn, setHasDrawn] = useState(false);

  useEffect(() => {
    if (!open) return;
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
  }, [open]);

  const clear = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.clientWidth, canvas.clientHeight);
    setHasDrawn(false);
  };

  const save = () => {
    const canvas = canvasRef.current;
    if (!canvas || !hasDrawn) return;
    onSave(canvas.toDataURL("image/png"));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{titel}</DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            Mit dem Finger im Feld unterschreiben.
          </p>
          <canvas
            ref={canvasRef}
            className="w-full h-44 rounded-md border-2 border-dashed bg-white touch-none"
          />
          <Button variant="outline" size="sm" onClick={clear} className="w-full">
            <Eraser className="h-3.5 w-3.5 mr-1.5" />
            Löschen
          </Button>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Abbrechen
          </Button>
          <Button onClick={save} disabled={!hasDrawn || busy}>
            {busy ? (
              <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
            ) : (
              <Check className="h-4 w-4 mr-1.5" />
            )}
            Unterschreiben
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
