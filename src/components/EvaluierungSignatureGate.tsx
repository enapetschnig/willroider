import { ReactNode, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ShieldAlert, CheckCircle2, Eraser } from "lucide-react";
import { getUnterweisung } from "@/lib/unterweisungen";
import type { EvaluierungTyp, Json } from "@/integrations/supabase/types";

type OpenSignature = {
  unterschriftId: string;
  evaluierungId: string;
  typ: EvaluierungTyp;
  checkliste: Json;
  notizen: string | null;
  baustelleName: string;
  kostenstelle: string | null;
  datum: string;
};

export function EvaluierungSignatureGate({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [pending, setPending] = useState<OpenSignature[]>([]);
  const [step, setStep] = useState<"read" | "sign">("read");
  const [scrolledToBottom, setScrolledToBottom] = useState(false);
  const [hasDrawn, setHasDrawn] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef(false);

  const load = async () => {
    if (!user) return;
    const { data } = await supabase
      .from("evaluierung_unterschriften")
      .select(
        "id, evaluierung_id, evaluierungen(id, typ, checkliste, notizen, datum, baustelle_id, baustellen(bvh_name, kostenstelle))"
      )
      .eq("mitarbeiter_id", user.id)
      .is("unterschrift_data", null);

    const list: OpenSignature[] = (data ?? []).map((r: any) => ({
      unterschriftId: r.id,
      evaluierungId: r.evaluierung_id,
      typ: r.evaluierungen?.typ ?? "baustelle",
      checkliste: r.evaluierungen?.checkliste ?? {},
      notizen: r.evaluierungen?.notizen ?? null,
      baustelleName: r.evaluierungen?.baustellen?.bvh_name ?? "Baustelle",
      kostenstelle: r.evaluierungen?.baustellen?.kostenstelle ?? null,
      datum: r.evaluierungen?.datum ?? new Date().toISOString().slice(0, 10),
    }));
    setPending(list);
    if (list.length > 0) {
      setStep("read");
      setScrolledToBottom(false);
      setHasDrawn(false);
    }
  };

  useEffect(() => {
    load();
  }, [user]);

  const current = pending[0];

  // Canvas signature
  useEffect(() => {
    if (step !== "sign" || !current) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.strokeStyle = "#111";
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, rect.width, rect.height);

    let lastX = 0,
      lastY = 0;

    const point = (e: MouseEvent | TouchEvent) => {
      const rect = canvas.getBoundingClientRect();
      const t = "touches" in e ? e.touches[0] : (e as MouseEvent);
      return { x: t.clientX - rect.left, y: t.clientY - rect.top };
    };
    const start = (e: any) => {
      e.preventDefault();
      drawingRef.current = true;
      const { x, y } = point(e);
      lastX = x;
      lastY = y;
      setHasDrawn(true);
    };
    const move = (e: any) => {
      if (!drawingRef.current) return;
      e.preventDefault();
      const { x, y } = point(e);
      ctx.beginPath();
      ctx.moveTo(lastX, lastY);
      ctx.lineTo(x, y);
      ctx.stroke();
      lastX = x;
      lastY = y;
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
    return () => {
      canvas.removeEventListener("mousedown", start);
      canvas.removeEventListener("mousemove", move);
      canvas.removeEventListener("mouseup", end);
      canvas.removeEventListener("mouseleave", end);
      canvas.removeEventListener("touchstart", start);
      canvas.removeEventListener("touchmove", move);
      canvas.removeEventListener("touchend", end);
    };
  }, [step, current]);

  if (!user || pending.length === 0) {
    return <>{children}</>;
  }

  if (!current) return <>{children}</>;

  const u = getUnterweisung(current.typ);
  const checkliste = (current.checkliste as Record<string, string>) || {};

  const onScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 30) {
      setScrolledToBottom(true);
    }
  };

  const clearCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const rect = canvas.getBoundingClientRect();
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, rect.width, rect.height);
    setHasDrawn(false);
  };

  const submit = async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    setSubmitting(true);
    const dataUrl = canvas.toDataURL("image/png");
    const { error } = await supabase
      .from("evaluierung_unterschriften")
      .update({
        unterschrift_data: dataUrl,
        unterschrieben_am: new Date().toISOString(),
      })
      .eq("id", current.unterschriftId);
    if (error) {
      alert("Fehler: " + error.message);
      setSubmitting(false);
      return;
    }
    const remaining = pending.slice(1);
    setPending(remaining);
    setStep("read");
    setScrolledToBottom(false);
    setHasDrawn(false);
    setSubmitting(false);
    if (remaining.length === 0) load();
  };

  return (
    <div className="fixed inset-0 z-50 bg-background overflow-hidden flex flex-col">
      <div className="bg-primary text-primary-foreground px-4 py-3 flex items-center gap-3">
        <ShieldAlert className="h-5 w-5 shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="font-bold text-sm sm:text-base">
            {u?.title ?? "Unterweisung erforderlich"}
          </div>
          <div className="text-xs opacity-90 truncate">
            {current.baustelleName}
            {current.kostenstelle ? ` · ${current.kostenstelle}` : ""}
          </div>
        </div>
        {pending.length > 1 && (
          <div className="text-[10px] opacity-90 shrink-0">
            {pending.length} offen
          </div>
        )}
      </div>

      {step === "read" ? (
        <>
          <div
            className="flex-1 overflow-y-auto p-4 space-y-3"
            onScroll={onScroll}
            style={{ WebkitOverflowScrolling: "touch" }}
          >
            <Card className="border-primary/30">
              <CardContent className="p-3">
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  {u?.subtitle ?? "Sicherheitsunterweisung"}
                </div>
                <div className="font-bold text-base">{u?.title}</div>
                <div className="text-[11px] text-muted-foreground mt-1">
                  {u?.rechtsgrundlage}
                </div>
                <div className="text-xs mt-2 pt-2 border-t">
                  Baustelle: <strong>{current.baustelleName}</strong>
                  {current.kostenstelle && ` · ${current.kostenstelle}`} · Datum{" "}
                  {new Date(current.datum).toLocaleDateString("de-AT")}
                </div>
              </CardContent>
            </Card>

            <div className="text-sm text-muted-foreground">
              Bitte lies die Unterweisung sorgfältig durch. Erst danach kannst du unterschreiben
              und die App weiter nutzen.
            </div>

            {(u?.sections ?? []).map((sec, i) => {
              if (sec.kind === "text") {
                return (
                  <Card key={i}>
                    <CardContent className="p-3 space-y-1.5">
                      {sec.heading && (
                        <div className="text-xs font-bold uppercase tracking-wide text-primary">
                          {sec.heading}
                        </div>
                      )}
                      <ul className="space-y-1 text-sm leading-relaxed">
                        {sec.lines.map((l, j) => (
                          <li key={j} className="flex gap-2">
                            <span className="text-primary shrink-0">•</span>
                            <span>{l}</span>
                          </li>
                        ))}
                      </ul>
                    </CardContent>
                  </Card>
                );
              }
              if (sec.kind === "checklist") {
                return (
                  <Card key={i}>
                    <CardContent className="p-3 space-y-1.5">
                      <div className="text-xs font-bold uppercase tracking-wide text-primary mb-1">
                        {sec.heading}
                      </div>
                      <ul className="space-y-1.5 text-sm">
                        {sec.items.map((it) => {
                          const v = checkliste[it.key];
                          return (
                            <li key={it.key} className="flex items-start gap-2 border-b pb-1.5 last:border-0">
                              <span
                                className={`text-[10px] px-1.5 py-0.5 rounded shrink-0 mt-0.5 font-semibold ${
                                  v === "i.O."
                                    ? "bg-emerald-600 text-white"
                                    : v === "nicht i.O."
                                    ? "bg-destructive text-white"
                                    : "bg-muted text-muted-foreground"
                                }`}
                              >
                                {v ?? "–"}
                              </span>
                              <span className="flex-1">{it.label}</span>
                            </li>
                          );
                        })}
                      </ul>
                    </CardContent>
                  </Card>
                );
              }
              if (sec.kind === "arbeitsmittel") {
                return (
                  <Card key={i}>
                    <CardContent className="p-3 space-y-1.5">
                      <div className="text-xs font-bold uppercase tracking-wide text-primary mb-1">
                        {sec.heading}
                      </div>
                      <ul className="space-y-1 text-sm">
                        {sec.items.map((it) => {
                          const v = checkliste[it.key];
                          return (
                            <li key={it.key} className="flex items-center gap-2 border-b pb-1 last:border-0">
                              <span className="flex-1">{it.label}</span>
                              <span
                                className={`text-[10px] px-1.5 py-0.5 rounded shrink-0 font-semibold ${
                                  v === "i.O."
                                    ? "bg-emerald-600 text-white"
                                    : v === "nicht i.O."
                                    ? "bg-destructive text-white"
                                    : "bg-muted text-muted-foreground"
                                }`}
                              >
                                {v ?? "n.v."}
                              </span>
                            </li>
                          );
                        })}
                      </ul>
                    </CardContent>
                  </Card>
                );
              }
              return null;
            })}

            {current.notizen && (
              <Card>
                <CardContent className="p-3 text-sm">
                  <div className="text-xs font-bold uppercase tracking-wide text-primary mb-1">
                    Hinweise / Notizen vom Bauleiter
                  </div>
                  {current.notizen}
                </CardContent>
              </Card>
            )}

            <Card className="border-2 border-primary/30 bg-primary/5">
              <CardContent className="p-3 text-sm">
                <div className="text-xs font-bold uppercase tracking-wide text-primary mb-1">
                  Bestätigung
                </div>
                {u?.bestätigung}
              </CardContent>
            </Card>

            {!scrolledToBottom && (
              <div className="text-center text-[11px] text-muted-foreground italic pb-2">
                ↓ bitte ans Ende scrollen, um zu bestätigen
              </div>
            )}
          </div>
          <div
            className="border-t bg-card p-3"
            style={{ paddingBottom: "max(env(safe-area-inset-bottom, 0px), 12px)" }}
          >
            <Button
              className="w-full h-12"
              disabled={!scrolledToBottom}
              onClick={() => setStep("sign")}
            >
              Verstanden – jetzt unterschreiben
            </Button>
          </div>
        </>
      ) : (
        <>
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            <div className="text-sm">Unterschreibe mit dem Finger im Feld unten:</div>
            <div className="border-2 border-dashed rounded-md bg-white">
              <canvas
                ref={canvasRef}
                style={{ width: "100%", height: 220, touchAction: "none", display: "block" }}
              />
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={clearCanvas} className="flex-1">
                <Eraser className="h-4 w-4 mr-2" /> Löschen
              </Button>
              <Button variant="ghost" onClick={() => setStep("read")} className="flex-1">
                Zurück
              </Button>
            </div>
          </div>
          <div
            className="border-t bg-card p-3"
            style={{ paddingBottom: "max(env(safe-area-inset-bottom, 0px), 12px)" }}
          >
            <Button
              className="w-full h-12"
              disabled={!hasDrawn || submitting}
              onClick={submit}
            >
              <CheckCircle2 className="h-4 w-4 mr-2" />
              {submitting ? "Speichert…" : "Unterschrift speichern"}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
