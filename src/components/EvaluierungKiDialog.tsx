import { useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import {
  Sparkles,
  FileText,
  Upload as UploadIcon,
  Loader2,
  Trash2,
  Plus,
} from "lucide-react";
import { extractPdfText } from "@/lib/pdfExtract";
import { analyzeUnterweisung, type UnterweisungAiResult } from "@/lib/openaiClient";
import { sanitizeStorageName } from "@/lib/uploadHelpers";
import { localIso } from "@/lib/dateFmt";
import type { Database } from "@/integrations/supabase/types";

type Baustelle = Database["public"]["Tables"]["baustellen"]["Row"];

type Step = "upload" | "preview";

type EditableItem = { key: string; label: string; required: boolean };

export function EvaluierungKiDialog({
  open,
  onOpenChange,
  baustellen,
  defaultBaustelleId,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (b: boolean) => void;
  baustellen: Baustelle[];
  defaultBaustelleId?: string;
  onCreated: (id: string) => void;
}) {
  const { toast } = useToast();
  const { user } = useAuth();
  const [step, setStep] = useState<Step>("upload");
  const [file, setFile] = useState<File | null>(null);
  const [pasted, setPasted] = useState<string>("");
  const [analyzing, setAnalyzing] = useState(false);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Vorschau-Form
  const [aiResult, setAiResult] = useState<UnterweisungAiResult | null>(null);
  const [items, setItems] = useState<EditableItem[]>([]);
  const [titel, setTitel] = useState("");
  const [typ, setTyp] = useState<"werkstatt" | "baustelle" | "fertigteilmontage">(
    "baustelle"
  );
  const [notizen, setNotizen] = useState("");
  const [datum, setDatum] = useState<string>(localIso());
  const [baustelleId, setBaustelleId] = useState<string>(defaultBaustelleId ?? "");

  const reset = () => {
    setStep("upload");
    setFile(null);
    setPasted("");
    setAnalyzing(false);
    setSaving(false);
    setAiResult(null);
    setItems([]);
    setTitel("");
    setTyp("baustelle");
    setNotizen("");
    setDatum(localIso());
    setBaustelleId(defaultBaustelleId ?? "");
  };

  const close = () => {
    onOpenChange(false);
    setTimeout(reset, 200);
  };

  const runAnalysis = async () => {
    let text = pasted.trim();
    if (!text && file) {
      if (file.type === "application/pdf" || /\.pdf$/i.test(file.name)) {
        try {
          text = await extractPdfText(file);
        } catch (e: any) {
          toast({
            variant: "destructive",
            title: "PDF-Fehler",
            description: e?.message ?? "Konnte PDF nicht lesen.",
          });
          return;
        }
      } else if (
        file.type.startsWith("text/") ||
        /\.(txt|md)$/i.test(file.name)
      ) {
        text = await file.text();
      } else {
        toast({
          variant: "destructive",
          title: "Format nicht unterstützt",
          description: "PDF oder Text (.txt/.md) hochladen, oder Text direkt einfügen.",
        });
        return;
      }
    }
    if (!text || text.length < 50) {
      toast({
        variant: "destructive",
        title: "Zu wenig Text",
        description: "Mindestens ein paar Sätze nötig.",
      });
      return;
    }
    setAnalyzing(true);
    try {
      const r = await analyzeUnterweisung(text);
      setAiResult(r);
      setTitel(r.titel);
      setTyp(r.typ);
      setNotizen(r.zusammenfassung);
      setItems(
        r.checkliste.map((c) => ({
          key: c.key,
          label: c.label,
          required: c.required,
        }))
      );
      setStep("preview");
    } catch (e: any) {
      toast({
        variant: "destructive",
        title: "KI-Fehler",
        description: e?.message ?? "Analyse fehlgeschlagen.",
      });
    } finally {
      setAnalyzing(false);
    }
  };

  const addItem = () =>
    setItems((p) => [
      ...p,
      { key: `item_${p.length + 1}`, label: "", required: false },
    ]);
  const removeItem = (i: number) =>
    setItems((p) => p.filter((_, idx) => idx !== i));
  const updateItem = (i: number, patch: Partial<EditableItem>) =>
    setItems((p) => p.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));

  const save = async () => {
    if (!baustelleId) {
      toast({ variant: "destructive", title: "Baustelle wählen" });
      return;
    }
    if (!titel.trim()) {
      toast({ variant: "destructive", title: "Titel fehlt" });
      return;
    }
    setSaving(true);

    let quellDokumentId: string | null = null;
    // Originaldokument hochladen (falls vorhanden)
    if (file) {
      const safe = sanitizeStorageName(file.name);
      const path = `${baustelleId}/evaluierung/${Date.now()}_${safe}`;
      const { error: upErr } = await supabase.storage
        .from("baustellen")
        .upload(path, file, { contentType: file.type || undefined });
      if (!upErr) {
        const { data: u } = await supabase.auth.getUser();
        const { data: dokRow, error: dokErr } = await supabase
          .from("dokumente")
          .insert({
            baustelle_id: baustelleId,
            ordner: "evaluierung",
            dateiname: file.name,
            storage_path: path,
            mimetype: file.type,
            groesse: file.size,
            hochgeladen_von: u.user?.id ?? null,
          } as any)
          .select()
          .single();
        if (!dokErr && dokRow) quellDokumentId = (dokRow as any).id;
      }
    }

    // Checkliste in JSONB-Form: {[key]: label}
    const checkliste: Record<string, string> = {};
    items.forEach((it) => {
      if (it.label.trim()) checkliste[it.key] = it.label.trim();
    });

    const titelLine = `[${titel}]`;
    const fullNotiz = `${titelLine}\n\n${notizen.trim()}`;

    const insertPayload: any = {
      baustelle_id: baustelleId,
      datum,
      typ,
      checkliste,
      notizen: fullNotiz,
      vortragender_id: user?.id ?? null,
    };
    if (quellDokumentId) insertPayload.quell_dokument_id = quellDokumentId;

    const { data, error } = await supabase
      .from("evaluierungen")
      .insert(insertPayload)
      .select()
      .single();
    setSaving(false);
    if (error || !data) {
      toast({
        variant: "destructive",
        title: "Fehler",
        description: error?.message,
      });
      return;
    }
    toast({
      title: "Evaluierung erstellt",
      description: `${items.length} Checklisten-Items, KI-erstellt`,
    });
    onCreated((data as any).id);
    close();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? onOpenChange(true) : close())}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            KI: Aus Dokument erstellen
          </DialogTitle>
        </DialogHeader>

        {step === "upload" && (
          <div className="space-y-4">
            <p className="text-xs text-muted-foreground">
              Lade ein Unterweisungs-PDF hoch oder füge den Text ein — die KI
              schlägt Typ, Titel, Checklisten-Items und eine Zusammenfassung
              vor. Du kannst alles vor dem Speichern korrigieren.
            </p>

            <div className="rounded-md border-2 border-dashed p-6 text-center">
              <FileText className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
              <input
                ref={fileRef}
                type="file"
                accept=".pdf,.txt,.md,application/pdf,text/plain"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) setFile(f);
                  if (fileRef.current) fileRef.current.value = "";
                }}
              />
              {file ? (
                <div className="space-y-1">
                  <div className="text-sm font-medium">{file.name}</div>
                  <div className="text-[11px] text-muted-foreground">
                    {(file.size / 1024).toFixed(0)} KB · {file.type || "unbekannt"}
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setFile(null)}
                  >
                    <Trash2 className="h-3.5 w-3.5 mr-1" />
                    Entfernen
                  </Button>
                </div>
              ) : (
                <>
                  <div className="text-sm text-muted-foreground mb-2">
                    PDF, TXT oder MD (max 20 MB)
                  </div>
                  <Button onClick={() => fileRef.current?.click()}>
                    <UploadIcon className="h-4 w-4 mr-2" />
                    Datei wählen
                  </Button>
                </>
              )}
            </div>

            <div className="text-center text-xs text-muted-foreground">
              ODER Text direkt einfügen
            </div>

            <Textarea
              value={pasted}
              onChange={(e) => setPasted(e.target.value)}
              placeholder="Text aus Word, E-Mail, … hier einfügen…"
              rows={6}
              disabled={!!file}
            />
          </div>
        )}

        {step === "preview" && (
          <div className="space-y-3">
            <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-emerald-700" />
              <span className="text-emerald-900">
                KI-Vorschlag — überprüfe + korrigiere alle Felder.
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">Baustelle *</Label>
                <select
                  value={baustelleId}
                  onChange={(e) => setBaustelleId(e.target.value)}
                  className="w-full h-9 rounded-md border bg-background px-2 text-sm"
                >
                  <option value="">— wählen —</option>
                  {baustellen.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.bvh_name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <Label className="text-xs">Datum</Label>
                <Input
                  type="date"
                  value={datum}
                  onChange={(e) => setDatum(e.target.value)}
                />
              </div>
              <div className="col-span-2">
                <Label className="text-xs">Titel</Label>
                <Input value={titel} onChange={(e) => setTitel(e.target.value)} />
              </div>
              <div>
                <Label className="text-xs">Typ</Label>
                <select
                  value={typ}
                  onChange={(e) => setTyp(e.target.value as any)}
                  className="w-full h-9 rounded-md border bg-background px-2 text-sm"
                >
                  <option value="werkstatt">Werkstatt</option>
                  <option value="baustelle">Baustelle</option>
                  <option value="fertigteilmontage">Fertigteilmontage</option>
                </select>
              </div>
              <div className="col-span-2">
                <Label className="text-xs">Zusammenfassung / Notizen</Label>
                <Textarea
                  value={notizen}
                  onChange={(e) => setNotizen(e.target.value)}
                  rows={3}
                />
              </div>
            </div>

            <Card>
              <CardContent className="p-2 space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label className="text-xs uppercase tracking-wide font-semibold text-muted-foreground">
                    Checkliste ({items.length})
                  </Label>
                  <Button variant="outline" size="sm" onClick={addItem}>
                    <Plus className="h-3.5 w-3.5 mr-1" />
                    Item
                  </Button>
                </div>
                <div className="space-y-1.5">
                  {items.map((it, i) => (
                    <div key={i} className="flex items-center gap-1.5">
                      <Input
                        value={it.label}
                        onChange={(e) =>
                          updateItem(i, { label: e.target.value })
                        }
                        placeholder="Beschreibung"
                        className="h-9 flex-1"
                      />
                      <label className="flex items-center gap-1 text-[10px] text-muted-foreground shrink-0">
                        <Switch
                          checked={it.required}
                          onCheckedChange={(v) => updateItem(i, { required: !!v })}
                        />
                        Pflicht
                      </label>
                      <button
                        onClick={() => removeItem(i)}
                        className="text-muted-foreground hover:text-destructive p-1"
                        title="Entfernen"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                  {items.length === 0 && (
                    <div className="text-xs text-muted-foreground italic py-2 text-center">
                      Noch keine Items — KI hatte keinen Vorschlag oder du hast
                      alle gelöscht.
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        <DialogFooter className="flex-row gap-2">
          <Button variant="outline" onClick={close} className="flex-1">
            Abbrechen
          </Button>
          {step === "upload" && (
            <Button
              onClick={runAnalysis}
              disabled={(!file && !pasted.trim()) || analyzing}
              className="flex-1"
            >
              {analyzing ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  KI analysiert…
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4 mr-2" />
                  Mit KI analysieren
                </>
              )}
            </Button>
          )}
          {step === "preview" && (
            <Button onClick={save} disabled={saving || !baustelleId} className="flex-1">
              {saving ? "Speichere…" : "Evaluierung erstellen"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
