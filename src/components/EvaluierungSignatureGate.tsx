import { ReactNode, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ShieldAlert, CheckCircle2, Eraser } from "lucide-react";
import type { Json } from "@/integrations/supabase/types";

const CHECKLIST_KURZ = [
  { key: "absturzsicherung", label: "Absturzsicherung vorhanden" },
  { key: "psa", label: "Persönliche Schutzausrüstung getragen" },
  { key: "werkzeuge", label: "Werkzeuge geprüft" },
  { key: "arbeitsbereich", label: "Arbeitsbereich abgesichert" },
];
const CHECKLIST_LANG = [
  ...CHECKLIST_KURZ,
  { key: "kran_pruefung", label: "Kran-Prüfprotokoll aktuell" },
  { key: "geruest_pruefung", label: "Gerüst-Abnahme erfolgt" },
  { key: "leitern", label: "Leitern auf Stabilität geprüft" },
  { key: "stromversorgung", label: "Elektrik / Verlängerungen geprüft" },
  { key: "fluchtwege", label: "Fluchtwege frei" },
  { key: "erste_hilfe", label: "Erste-Hilfe-Material vorhanden" },
  { key: "feuerloescher", label: "Feuerlöscher vorhanden" },
  { key: "lagerung", label: "Sichere Lagerung Fertigteilelemente" },
  { key: "transport", label: "Transport / Hubmittel geprüft" },
  { key: "versetzung", label: "Versetz-Anweisung vorhanden" },
];

type OpenSignature = {
  unterschriftId: string;
  evaluierungId: string;
  typ: "kurz" | "lang";
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
      typ: r.evaluierungen?.typ ?? "kurz",
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

    // hi-dpi setup
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

  const items = current.typ === "lang" ? CHECKLIST_LANG : CHECKLIST_KURZ;
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
    // Pop current, fetch fresh list (covers race conditions)
    const remaining = pending.slice(1);
    setPending(remaining);
    setStep("read");
    setScrolledToBottom(false);
    setHasDrawn(false);
    setSubmitting(false);
    if (remaining.length === 0) {
      // re-check just in case
      load();
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-background overflow-hidden flex flex-col">
      <div className="bg-primary text-primary-foreground px-4 py-3 flex items-center gap-3">
        <ShieldAlert className="h-5 w-5 shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="font-bold text-sm sm:text-base">
            Sicherheitsunterweisung erforderlich
          </div>
          <div className="text-xs opacity-90 truncate">
            {current.baustelleName}
            {current.kostenstelle ? ` · ${current.kostenstelle}` : ""}
          </div>
        </div>
        <div className="text-[10px] opacity-90 shrink-0">
          {pending.length} offen
        </div>
      </div>

      {step === "read" ? (
        <>
          <div
            className="flex-1 overflow-y-auto p-4 space-y-3"
            onScroll={onScroll}
            style={{ WebkitOverflowScrolling: "touch" }}
          >
            <div className="text-sm text-muted-foreground">
              Bitte lies die Evaluierung sorgfältig durch und unterschreibe danach. Erst dann
              kannst du die App weiter nutzen.
            </div>

            <Card>
              <CardContent className="p-3">
                <div className="text-xs uppercase tracking-wide text-muted-foreground">
                  Evaluierung
                </div>
                <div className="font-semibold">
                  {current.typ === "lang" ? "Langversion" : "Kurzversion"} ·{" "}
                  {new Date(current.datum).toLocaleDateString("de-AT")}
                </div>
              </CardContent>
            </Card>

            <div className="space-y-1.5">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Checkliste
              </div>
              {items.map((it) => {
                const v = checkliste[it.key];
                return (
                  <div
                    key={it.key}
                    className="flex items-center justify-between border-b py-2 text-sm"
                  >
                    <span className="flex-1 pr-2">{it.label}</span>
                    <span
                      className={`text-[11px] px-2 py-1 rounded ${
                        v === "i.O."
                          ? "bg-emerald-600 text-white"
                          : v === "nicht i.O."
                          ? "bg-destructive text-white"
                          : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {v ?? "—"}
                    </span>
                  </div>
                );
              })}
            </div>

            {current.notizen && (
              <Card>
                <CardContent className="p-3 text-sm">
                  <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">
                    Notizen / Hinweise
                  </div>
                  {current.notizen}
                </CardContent>
              </Card>
            )}

            <div className="text-xs text-muted-foreground border rounded p-3 bg-muted/30">
              Mit der Unterschrift bestätigst du, dass du die Sicherheitsunterweisung gelesen und
              verstanden hast. Diese Unterschrift wird gemäß ASchG dokumentiert.
            </div>

            {!scrolledToBottom && (
              <div className="text-center text-[11px] text-muted-foreground italic pb-2">
                ↓ bis zum Ende scrollen
              </div>
            )}
          </div>
          <div className="border-t bg-card p-3" style={{ paddingBottom: "max(env(safe-area-inset-bottom, 0px), 12px)" }}>
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
            <div className="text-sm">
              Unterschreibe mit dem Finger im Feld unten:
            </div>
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
          <div className="border-t bg-card p-3" style={{ paddingBottom: "max(env(safe-area-inset-bottom, 0px), 12px)" }}>
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
