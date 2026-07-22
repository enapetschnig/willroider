/**
 * Eigene Menü-Seite für Änderungswünsche.
 *
 * Zweck laut Wunsch: In der Besprechung sollen ALLE Beteiligten (auch
 * Polier und Vorarbeiter) alle Wünsche durchgehen, Notizen dazuschreiben
 * und freigeben können — ohne den Umweg über die Verwaltung.
 *
 * „Sofort umsetzen" bleibt Führung/Büro vorbehalten (Berechtigung
 * feedback.sofort_freigeben); alle anderen Status darf jeder mit
 * feedback.bearbeiten setzen UND zurücksetzen.
 */

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Loader2,
  UsersRound,
  MessagesSquare,
  Zap,
  Check,
  X,
  RotateCcw,
  Mic,
  Paperclip,
  Lightbulb,
  Bug,
  MessageCircle,
  HelpCircle,
} from "lucide-react";
import { FeedbackFaden } from "@/components/feedback/FeedbackFaden";
import { BesprechungsModus, type BesprechungsWunsch } from "@/components/admin/BesprechungsModus";

type Row = BesprechungsWunsch & {
  offene_frage: boolean | null;
  letzter_kommentar_von: string | null;
};

const KAT: Record<string, { label: string; icon: typeof Lightbulb; cls: string }> = {
  idee: { label: "Idee", icon: Lightbulb, cls: "text-amber-700 border-amber-300 bg-amber-50" },
  problem: { label: "Problem", icon: Bug, cls: "text-red-700 border-red-300 bg-red-50" },
  sonstiges: { label: "Sonstiges", icon: MessageCircle, cls: "text-slate-700 border-slate-300 bg-slate-50" },
};

const STATUS: Record<string, { label: string; cls: string }> = {
  neu: { label: "Neu", cls: "bg-blue-100 text-blue-800" },
  gesehen: { label: "Gesehen", cls: "bg-slate-100 text-slate-700" },
  sofort: { label: "Sofort umsetzen", cls: "bg-orange-100 text-orange-800" },
  besprechung: { label: "Zur Besprechung", cls: "bg-violet-100 text-violet-800" },
  umgesetzt: { label: "Umgesetzt", cls: "bg-green-100 text-green-800" },
  abgelehnt: { label: "Abgelehnt", cls: "bg-zinc-100 text-zinc-500" },
};

const DRINGLICHKEIT: Record<string, { label: string; cls: string; rang: number }> = {
  sofort: { label: "🔴 Dringend", cls: "border-red-300 text-red-800 bg-red-50", rang: 0 },
  normal: { label: "🟡 Normal", cls: "border-amber-300 text-amber-800 bg-amber-50", rang: 1 },
  besprechen: { label: "💬 Zuerst besprechen", cls: "border-violet-300 text-violet-800 bg-violet-50", rang: 2 },
  irgendwann: { label: "💡 Nur eine Idee", cls: "border-slate-300 text-slate-600 bg-slate-50", rang: 3 },
};

type Filter = "offen" | "sofort" | "besprechung" | "erledigt" | "alle";

export default function Aenderungswuensche() {
  const { toast } = useToast();
  const { hasPermission, user } = useAuth();
  const darfBearbeiten = hasPermission("feedback.bearbeiten");
  const darfSofort = hasPermission("feedback.sofort_freigeben");

  const [rows, setRows] = useState<Row[]>([]);
  const [namen, setNamen] = useState<Map<string, string>>(new Map());
  const [medien, setMedien] = useState<Map<string, string>>(new Map());
  const [laedt, setLaedt] = useState(true);
  const [filter, setFilter] = useState<Filter>("offen");
  const [fadenOffen, setFadenOffen] = useState<string | null>(null);
  const [besprechung, setBesprechung] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = async () => {
    const { data, error } = await supabase
      .from("feedback" as any)
      .select("*")
      .order("created_at", { ascending: false });
    if (error) {
      toast({ variant: "destructive", title: "Laden fehlgeschlagen", description: error.message });
      setLaedt(false);
      return;
    }
    const list = (data as unknown as Row[]) ?? [];
    setRows(list);

    const { data: profs } = await supabase.from("profiles").select("id, vorname, nachname");
    setNamen(
      new Map(
        ((profs as any[]) ?? []).map((p) => [
          p.id,
          `${p.vorname ?? ""} ${p.nachname ?? ""}`.trim() || "—",
        ]),
      ),
    );

    // Signierte URLs für Bild-/Sprach-Anhänge
    const m = new Map<string, string>();
    await Promise.all([
      ...list
        .filter((r) => r.anhang_pfad)
        .map(async (r) => {
          const { data: s } = await supabase.storage
            .from("feedback-dateien")
            .createSignedUrl(r.anhang_pfad!, 3600);
          if (s?.signedUrl) m.set(`d:${r.id}`, s.signedUrl);
        }),
      ...list
        .filter((r) => r.audio_pfad)
        .map(async (r) => {
          const { data: s } = await supabase.storage
            .from("feedback-audio")
            .createSignedUrl(r.audio_pfad!, 3600);
          if (s?.signedUrl) m.set(`a:${r.id}`, s.signedUrl);
        }),
    ]);
    setMedien(m);
    setLaedt(false);
  };

  useEffect(() => {
    void load();
    const ch = supabase
      .channel("aenderungswuensche")
      .on("postgres_changes", { event: "*", schema: "public", table: "feedback" }, () => void load())
      .subscribe();
    return () => {
      void supabase.removeChannel(ch);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setzeStatus = async (id: string, status: string) => {
    setBusyId(id);
    const { error } = await supabase.from("feedback" as any).update({ status }).eq("id", id);
    setBusyId(null);
    if (error) {
      // Häufigster Fall: „Sofort umsetzen" ohne die nötige Berechtigung —
      // die Regel greift in der Datenbank, hier wird sie erklärt.
      toast({
        variant: "destructive",
        title: "Nicht gespeichert",
        description:
          status === "sofort"
            ? `„Sofort umsetzen" darf nur die Geschäftsführung oder das Büro vergeben.`
            : error.message,
      });
      return;
    }
    void load();
  };

  const gefiltert = useMemo(() => {
    const basis =
      filter === "alle"
        ? rows
        : filter === "erledigt"
          ? rows.filter((r) => r.status === "umgesetzt" || r.status === "abgelehnt")
          : filter === "sofort"
            ? rows.filter((r) => r.status === "sofort")
            : filter === "besprechung"
              ? rows.filter((r) => r.status === "besprechung")
              : rows.filter((r) => r.status !== "umgesetzt" && r.status !== "abgelehnt");
    if (filter === "erledigt" || filter === "alle") return basis;
    const rang = (r: Row) => DRINGLICHKEIT[r.dringlichkeit ?? "normal"]?.rang ?? 1;
    return [...basis].sort(
      (a, b) => rang(a) - rang(b) || b.created_at.localeCompare(a.created_at),
    );
  }, [rows, filter]);

  const antwortCount = rows.filter(
    (r) =>
      r.letzter_kommentar_von &&
      r.letzter_kommentar_von === r.erstellt_von &&
      r.status !== "umgesetzt" &&
      r.status !== "abgelehnt",
  ).length;

  const TABS: { k: Filter; label: string }[] = [
    { k: "offen", label: "Offen" },
    { k: "sofort", label: "Sofort" },
    { k: "besprechung", label: "Besprechung" },
    { k: "erledigt", label: "Erledigt" },
    { k: "alle", label: "Alle" },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Änderungswünsche"
        description="Alle Wünsche aus der Mannschaft — gemeinsam durchgehen, besprechen und freigeben."
        actions={
          <Button onClick={() => setBesprechung(true)} disabled={gefiltert.length === 0}>
            <UsersRound className="h-4 w-4 mr-1.5" />
            Besprechung starten
            {gefiltert.length > 0 && (
              <span className="ml-1 tabular-nums opacity-80">({gefiltert.length})</span>
            )}
          </Button>
        }
      />

      <div className="flex items-center gap-2 flex-wrap">
        {TABS.map((t) => {
          const anzahl =
            t.k === "alle"
              ? rows.length
              : t.k === "erledigt"
                ? rows.filter((r) => r.status === "umgesetzt" || r.status === "abgelehnt").length
                : t.k === "offen"
                  ? rows.filter((r) => r.status !== "umgesetzt" && r.status !== "abgelehnt").length
                  : rows.filter((r) => r.status === t.k).length;
          return (
            <button
              key={t.k}
              onClick={() => setFilter(t.k)}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition ${
                filter === t.k
                  ? "bg-primary text-primary-foreground"
                  : "hover:bg-muted text-muted-foreground"
              }`}
            >
              {t.label} <span className="tabular-nums opacity-70">{anzahl}</span>
            </button>
          );
        })}
        {antwortCount > 0 && (
          <Badge className="bg-emerald-100 text-emerald-800 gap-1 ml-auto">
            <MessagesSquare className="h-3 w-3" />
            {antwortCount} {antwortCount === 1 ? "neue Antwort" : "neue Antworten"}
          </Badge>
        )}
      </div>

      {laedt ? (
        <div className="flex items-center gap-2 justify-center py-12 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Lädt …
        </div>
      ) : gefiltert.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Keine Änderungswünsche in diesem Reiter.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {gefiltert.map((r) => {
            const kat = KAT[r.kategorie] ?? KAT.sonstiges;
            const Icon = kat.icon;
            const st = STATUS[r.status] ?? STATUS.neu;
            const dr = DRINGLICHKEIT[r.dringlichkeit ?? "normal"];
            const wartetAufUns =
              r.letzter_kommentar_von && r.letzter_kommentar_von === r.erstellt_von;
            return (
              <Card key={r.id} className={wartetAufUns ? "border-emerald-300" : undefined}>
                <CardContent className="p-3 sm:p-4 space-y-2">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <Badge variant="outline" className={`${kat.cls} gap-1`}>
                      <Icon className="h-3 w-3" /> {kat.label}
                    </Badge>
                    <Badge className={st.cls}>{st.label}</Badge>
                    {dr && (
                      <Badge variant="outline" className={dr.cls} title="Einschätzung des Melders">
                        {dr.label}
                      </Badge>
                    )}
                    {r.offene_frage && (
                      <Badge className="bg-amber-500 text-white gap-1">
                        <HelpCircle className="h-3 w-3" /> Rückfrage offen
                      </Badge>
                    )}
                    <span className="text-xs text-muted-foreground ml-auto">
                      {namen.get(r.erstellt_von ?? "") ?? "Unbekannt"} ·{" "}
                      {new Date(r.created_at).toLocaleDateString("de-AT")}
                    </span>
                  </div>

                  {r.text && (
                    <div className="text-sm whitespace-pre-wrap break-words">{r.text}</div>
                  )}

                  {medien.get(`a:${r.id}`) && (
                    <div className="flex items-center gap-2">
                      <Mic className="h-4 w-4 text-primary shrink-0" />
                      <audio controls src={medien.get(`a:${r.id}`)} className="h-8 flex-1" />
                    </div>
                  )}
                  {medien.get(`d:${r.id}`) && (
                    <div>
                      {r.anhang_typ?.startsWith("image/") ? (
                        <a href={medien.get(`d:${r.id}`)} target="_blank" rel="noreferrer">
                          <img
                            src={medien.get(`d:${r.id}`)}
                            alt={r.anhang_name ?? "Anhang"}
                            className="max-h-48 rounded-md border object-contain"
                          />
                        </a>
                      ) : (
                        <a
                          href={medien.get(`d:${r.id}`)}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1.5 rounded-md border bg-muted/50 px-2.5 py-1.5 text-xs hover:bg-muted"
                        >
                          <Paperclip className="h-3.5 w-3.5 text-primary" />
                          {r.anhang_name ?? "Anhang"}
                        </a>
                      )}
                    </div>
                  )}

                  {darfBearbeiten && (
                    <div className="flex items-center gap-1.5 flex-wrap pt-1">
                      {r.status !== "sofort" && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-orange-700 border-orange-300"
                          disabled={busyId === r.id || !darfSofort}
                          title={
                            darfSofort
                              ? "Für die Umsetzung freigeben"
                              : "Nur Geschäftsführung/Büro"
                          }
                          onClick={() => setzeStatus(r.id, "sofort")}
                        >
                          <Zap className="h-3.5 w-3.5 mr-1.5" /> Sofort umsetzen
                        </Button>
                      )}
                      {r.status !== "besprechung" && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-violet-700 border-violet-300"
                          disabled={busyId === r.id}
                          onClick={() => setzeStatus(r.id, "besprechung")}
                        >
                          <UsersRound className="h-3.5 w-3.5 mr-1.5" /> Zur Besprechung
                        </Button>
                      )}
                      {r.status !== "umgesetzt" && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-green-700 border-green-300"
                          disabled={busyId === r.id}
                          onClick={() => setzeStatus(r.id, "umgesetzt")}
                        >
                          <Check className="h-3.5 w-3.5 mr-1.5" /> Erledigt
                        </Button>
                      )}
                      {r.status !== "abgelehnt" && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-muted-foreground"
                          disabled={busyId === r.id}
                          onClick={() => setzeStatus(r.id, "abgelehnt")}
                        >
                          <X className="h-3.5 w-3.5 mr-1.5" /> Ablehnen
                        </Button>
                      )}
                      {/* Zurücksetzen: eine Fehlentscheidung muss rückgängig
                          zu machen sein, ohne den Wunsch zu löschen. */}
                      {r.status !== "neu" && (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busyId === r.id}
                          title={`Status auf „Neu" zurücksetzen`}
                          onClick={() => setzeStatus(r.id, "neu")}
                        >
                          <RotateCcw className="h-3.5 w-3.5 mr-1.5" /> Zurücksetzen
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant={wartetAufUns ? "default" : "outline"}
                        className="ml-auto"
                        onClick={() => setFadenOffen(fadenOffen === r.id ? null : r.id)}
                      >
                        <MessagesSquare className="h-3.5 w-3.5 mr-1.5" />
                        {fadenOffen === r.id ? "Verlauf zu" : "Notiz / Rückfrage"}
                      </Button>
                    </div>
                  )}

                  {fadenOffen === r.id && (
                    <div className="border-t pt-2">
                      <FeedbackFaden
                        feedbackId={r.id}
                        melderId={r.erstellt_von}
                        istAdmin={darfBearbeiten}
                        namen={namen}
                        onGeaendert={load}
                      />
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <BesprechungsModus
        open={besprechung}
        onOpenChange={setBesprechung}
        wuensche={gefiltert}
        namen={namen}
        onGeaendert={load}
        darfSofort={darfSofort}
      />
    </div>
  );
}
