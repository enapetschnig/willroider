import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Plus, ShieldCheck, ShieldAlert, CheckCircle2, Clock, ChevronDown, ChevronUp, Sparkles, FileText } from "lucide-react";
import type { Database, EvaluierungTyp, Json } from "@/integrations/supabase/types";
import { UNTERWEISUNG_OPTIONS, getUnterweisung, unterweisungLabel } from "@/lib/unterweisungen";
import { localIso } from "@/lib/dateFmt";
import { EvaluierungKiDialog } from "@/components/EvaluierungKiDialog";
import { EvaluierungVorlagenCard } from "@/components/admin/EvaluierungVorlagenCard";
import { makeEvaluierungPdf } from "@/lib/evaluierungPdf";

type Eval = Database["public"]["Tables"]["evaluierungen"]["Row"];
type Baustelle = Database["public"]["Tables"]["baustellen"]["Row"];
type Profile = Database["public"]["Tables"]["profiles"]["Row"];
type Unterschrift = Database["public"]["Tables"]["evaluierung_unterschriften"]["Row"];
type Vorlage = Database["public"]["Tables"]["evaluierung_vorlagen"]["Row"];

function getCheckItems(typ: EvaluierungTyp) {
  const u = getUnterweisung(typ);
  if (!u) return [] as { key: string; label: string; section: string }[];
  const items: { key: string; label: string; section: string }[] = [];
  u.sections.forEach((sec) => {
    if (sec.kind === "checklist" || sec.kind === "arbeitsmittel") {
      sec.items.forEach((it) => items.push({ ...it, section: sec.heading }));
    }
  });
  return items;
}

function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return "gerade eben";
  if (min < 60) return `vor ${min} Min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `vor ${h} Std`;
  const d = Math.floor(h / 24);
  if (d < 7) return `vor ${d} Tag${d === 1 ? "" : "en"}`;
  return new Date(iso).toLocaleDateString("de-AT");
}

export default function Evaluierung() {
  const { user, isAdmin, isPolier } = useAuth();
  const { toast } = useToast();
  const [params] = useSearchParams();
  const [rows, setRows] = useState<Eval[]>([]);
  const [baustellen, setBaustellen] = useState<Baustelle[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [signatures, setSignatures] = useState<Unterschrift[]>([]);
  const [editing, setEditing] = useState<Partial<Eval> | null>(null);
  const [kiOpen, setKiOpen] = useState(false);
  const [checklist, setChecklist] = useState<Record<string, string>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [vorlagen, setVorlagen] = useState<Vorlage[]>([]);

  const baustelleParam = params.get("baustelle");
  const canCreate = isAdmin || isPolier;

  // Polier sieht nur eigene Partie-Baustellen, Admin alle
  const baustellenForCreate = useMemo(() => {
    if (isAdmin) return baustellen;
    if (isPolier) {
      // Eigene Partie ermitteln (über profiles)
      const me = profiles.find((p) => p.id === user?.id);
      if (!me?.partie_id) return [];
      return baustellen.filter((b) => b.partie_id === me.partie_id);
    }
    return [];
  }, [baustellen, profiles, user, isAdmin, isPolier]);

  const load = async () => {
    const [e, b, p, v] = await Promise.all([
      supabase.from("evaluierungen").select("*").order("datum", { ascending: false }).limit(200),
      supabase.from("baustellen").select("*").order("bvh_name"),
      supabase.from("profiles").select("*"),
      supabase
        .from("evaluierung_vorlagen")
        .select("*")
        .eq("aktiv", true)
        .order("name"),
    ]);
    const evals = (e.data as Eval[]) ?? [];
    setRows(evals);
    setBaustellen((b.data as Baustelle[]) ?? []);
    setProfiles((p.data as Profile[]) ?? []);
    setVorlagen((v.data as Vorlage[]) ?? []);

    if (evals.length > 0) {
      const { data: sigs } = await supabase
        .from("evaluierung_unterschriften")
        .select("*")
        .in("evaluierung_id", evals.map((x) => x.id));
      setSignatures((sigs as Unterschrift[]) ?? []);
    } else {
      setSignatures([]);
    }
  };

  useEffect(() => {
    load();
    if (baustelleParam) {
      setEditing({ baustelle_id: baustelleParam, datum: localIso(), typ: "baustelle" });
    }
  }, []);

  const openNew = () => {
    setEditing({ datum: localIso(), typ: "baustelle" });
    setChecklist({});
  };

  /** Vorlage übernehmen: füllt typ + notizen vor. Die hardcoded Checkliste
   *  pro Typ wird im Dialog wie gehabt gerendert. */
  const applyVorlage = (vorlageId: string) => {
    const v = vorlagen.find((x) => x.id === vorlageId);
    if (!v) return;
    setEditing((prev) => ({
      ...prev,
      typ: v.typ,
      notizen: v.notizen ?? prev?.notizen ?? "",
    }));
  };

  const downloadPdf = async (e: Eval, profile: Profile, sig: Unterschrift) => {
    const b = baustellen.find((x) => x.id === e.baustelle_id);
    const v = profiles.find((p) => p.id === e.vortragender_id);
    const cl = (e.checkliste as Record<string, string>) ?? {};
    const items = getCheckItems(e.typ).map((i) => ({
      text: i.label,
      ergebnis: cl[i.key] ?? null,
    }));
    const doc = await makeEvaluierungPdf({
      titel: e.notizen?.slice(0, 80) || "Sicherheits-Unterweisung",
      typLabel: unterweisungLabel(e.typ),
      datum: new Date(e.datum).toLocaleDateString("de-AT"),
      bvhName: b?.bvh_name ?? "—",
      kostenstelle: b?.kostenstelle ?? "",
      ort: b?.ort ?? "",
      vortragender: v ? `${v.vorname} ${v.nachname}` : "",
      checkliste: items,
      notizen: e.notizen ?? "",
      mitarbeiterName: `${profile.vorname} ${profile.nachname}`,
      unterschriftBase64: sig.unterschrift_data,
      unterschriebenAm: sig.unterschrieben_am
        ? new Date(sig.unterschrieben_am).toLocaleString("de-AT", {
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          })
        : null,
    });
    const fname = `Unterweisung-${b?.bvh_name ?? "X"}-${profile.nachname}-${e.datum}.pdf`;
    doc.save(fname);
  };

  const openEdit = (e: Eval) => {
    setEditing(e);
    setChecklist((e.checkliste as Record<string, string>) || {});
  };

  // Verteilung an Partie-Mitglieder: lege evaluierung_unterschriften pro Mitglied an,
  // ohne Duplikate
  const distributeToPartieMembers = async (evaluierungId: string, baustelleId: string) => {
    const baustelle = baustellen.find((b) => b.id === baustelleId);
    if (!baustelle?.partie_id) return 0;
    const { data: members } = await supabase
      .from("profiles")
      .select("id")
      .eq("partie_id", baustelle.partie_id)
      .eq("is_active", true);
    if (!members || members.length === 0) return 0;
    // Bereits existierende Einträge filtern
    const { data: existing } = await supabase
      .from("evaluierung_unterschriften")
      .select("mitarbeiter_id")
      .eq("evaluierung_id", evaluierungId);
    const have = new Set((existing ?? []).map((r: any) => r.mitarbeiter_id));
    const toInsert = (members as { id: string }[])
      .filter((m) => !have.has(m.id))
      .map((m) => ({ evaluierung_id: evaluierungId, mitarbeiter_id: m.id }));
    if (toInsert.length === 0) return 0;
    const { error } = await supabase.from("evaluierung_unterschriften").insert(toInsert as any);
    if (error) {
      toast({ variant: "destructive", title: "Fehler bei Verteilung", description: error.message });
      return 0;
    }
    return toInsert.length;
  };

  const save = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!editing) return;
    const fd = new FormData(e.currentTarget);
    const baustelleId = fd.get("baustelle_id") as string;
    if (!baustelleId) {
      toast({ variant: "destructive", title: "Baustelle wählen" });
      return;
    }
    const payload = {
      baustelle_id: baustelleId,
      datum: fd.get("datum") as string,
      typ: (fd.get("typ") as EvaluierungTyp) || "baustelle",
      vortragender_id: user?.id ?? null,
      checkliste: checklist as unknown as Json,
      notizen: (fd.get("notizen") as string) || null,
      abgeschlossen: false,
    };

    let evalId = editing.id;
    if (evalId) {
      const { error } = await supabase.from("evaluierungen").update(payload).eq("id", evalId);
      if (error) {
        toast({ variant: "destructive", title: "Fehler", description: error.message });
        return;
      }
    } else {
      const { data, error } = await supabase
        .from("evaluierungen")
        .insert(payload as any)
        .select()
        .single();
      if (error) {
        toast({ variant: "destructive", title: "Fehler", description: error.message });
        return;
      }
      evalId = data!.id;
    }

    // Verteilung an Partie-Mitglieder
    const distributed = await distributeToPartieMembers(evalId!, baustelleId);

    toast({
      title: editing.id ? "Aktualisiert" : "Evaluierung angelegt",
      description: distributed > 0 ? `An ${distributed} Mitarbeiter zur Unterschrift verteilt` : undefined,
    });
    setEditing(null);
    load();
  };

  const finalize = async (e: Eval) => {
    await supabase.from("evaluierungen").update({ abgeschlossen: true }).eq("id", e.id);
    toast({ title: "Evaluierung abgeschlossen" });
    load();
  };

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Pro Evaluierung: Liste der Partie-Mitglieder + ihren Unterschriften-Status
  const getMembersForEval = (e: Eval) => {
    const b = baustellen.find((x) => x.id === e.baustelle_id);
    if (!b?.partie_id) return [];
    const members = profiles.filter((p) => p.partie_id === b.partie_id && p.is_active !== false);
    const sigsForEval = signatures.filter((s) => s.evaluierung_id === e.id);
    return members.map((m) => {
      const sig = sigsForEval.find((s) => s.mitarbeiter_id === m.id);
      return { profile: m, signature: sig };
    });
  };

  const getSignatureStats = (e: Eval) => {
    const items = getMembersForEval(e);
    const signed = items.filter((x) => x.signature?.unterschrift_data).length;
    return { signed, total: items.length };
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Unterweisungen"
        description="Werkstatt · Baustelle · Fertigteilmontage – digitale Checklisten gemäß ASchG."
        actions={
          canCreate && (
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => setKiOpen(true)} variant="outline">
                <Sparkles className="h-4 w-4 mr-2" />
                Mit KI aus Dokument
              </Button>
              <Button onClick={openNew}>
                <Plus className="h-4 w-4 mr-2" /> Neue Evaluierung
              </Button>
            </div>
          )
        }
      />

      <EvaluierungVorlagenCard />

      <div className="space-y-2">
        {rows.map((e) => {
          const b = baustellen.find((x) => x.id === e.baustelle_id);
          const v = profiles.find((p) => p.id === e.vortragender_id);
          const stats = getSignatureStats(e);
          const isOpen = expanded.has(e.id);
          return (
            <Card key={e.id}>
              <CardContent className="p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      {e.abgeschlossen ? (
                        <ShieldCheck className="h-4 w-4 text-emerald-600 shrink-0" />
                      ) : (
                        <ShieldAlert className="h-4 w-4 text-amber-500 shrink-0" />
                      )}
                      <div className="font-medium truncate">{b?.bvh_name ?? "—"}</div>
                      <Badge variant="outline" className="text-[10px]">
                        {unterweisungLabel(e.typ)}
                      </Badge>
                      {stats.total > 0 && (
                        <Badge
                          variant={stats.signed === stats.total ? "default" : "outline"}
                          className={`text-[10px] ${
                            stats.signed === stats.total
                              ? "bg-emerald-600"
                              : stats.signed > 0
                              ? "border-amber-500 text-amber-700"
                              : ""
                          }`}
                        >
                          {stats.signed} / {stats.total} unterschrieben
                        </Badge>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {new Date(e.datum).toLocaleDateString("de-AT")}
                      {v ? ` · Vortragender: ${v.vorname} ${v.nachname}` : ""}
                    </div>
                    {e.notizen && (
                      <div className="text-xs mt-1 line-clamp-2">{e.notizen}</div>
                    )}
                  </div>
                  <div className="flex flex-col gap-1 items-end shrink-0">
                    <Badge variant={e.abgeschlossen ? "default" : "outline"} className="text-[10px]">
                      {e.abgeschlossen ? "Abgeschlossen" : "Offen"}
                    </Badge>
                    <div className="flex gap-1">
                      {canCreate && (
                        <Button size="sm" variant="outline" onClick={() => openEdit(e)}>
                          Öffnen
                        </Button>
                      )}
                      {!e.abgeschlossen && canCreate && (
                        <Button size="sm" onClick={() => finalize(e)}>
                          <CheckCircle2 className="h-4 w-4 mr-1" />
                          <span className="hidden sm:inline">Abschließen</span>
                        </Button>
                      )}
                    </div>
                  </div>
                </div>

                {/* Status-Aufklapper */}
                {stats.total > 0 && (
                  <button
                    onClick={() => toggleExpand(e.id)}
                    className="mt-2 w-full flex items-center justify-between text-xs text-muted-foreground hover:text-foreground border-t pt-2"
                  >
                    <span>{isOpen ? "Status verbergen" : "Wer hat unterschrieben?"}</span>
                    {isOpen ? (
                      <ChevronUp className="h-3.5 w-3.5" />
                    ) : (
                      <ChevronDown className="h-3.5 w-3.5" />
                    )}
                  </button>
                )}
                {isOpen && (
                  <div className="mt-2 space-y-1">
                    {getMembersForEval(e).map(({ profile, signature }) => {
                      const signed = !!signature?.unterschrift_data;
                      return (
                        <div
                          key={profile.id}
                          className="flex items-center gap-2 text-xs border rounded px-2 py-1.5"
                        >
                          <div
                            className={`h-6 w-6 rounded-full flex items-center justify-center text-white text-[9px] font-bold shrink-0 ${
                              signed ? "bg-emerald-600" : "bg-muted-foreground"
                            }`}
                          >
                            {profile.vorname[0]}
                            {profile.nachname[0]}
                          </div>
                          <span className="font-medium flex-1 truncate">
                            {profile.vorname} {profile.nachname}
                          </span>
                          {signed ? (
                            <>
                              <span className="flex items-center gap-1 text-emerald-700">
                                <CheckCircle2 className="h-3.5 w-3.5" />
                                <span className="hidden sm:inline">
                                  {signature?.unterschrieben_am
                                    ? relTime(signature.unterschrieben_am)
                                    : "unterschrieben"}
                                </span>
                                <span className="sm:hidden">✓</span>
                              </span>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 w-7 p-0"
                                onClick={() => downloadPdf(e, profile, signature!)}
                                title="PDF herunterladen"
                              >
                                <FileText className="h-3.5 w-3.5" />
                              </Button>
                            </>
                          ) : (
                            <span className="flex items-center gap-1 text-amber-700">
                              <Clock className="h-3.5 w-3.5" />
                              <span className="hidden sm:inline">offen</span>
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
        {rows.length === 0 && (
          <Card>
            <CardContent className="p-8 text-center text-sm text-muted-foreground">
              Noch keine Evaluierungen.
              {canCreate && (
                <div className="mt-2">
                  <Button onClick={openNew} size="sm">
                    <Plus className="h-4 w-4 mr-2" /> Erste Evaluierung anlegen
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing?.id ? "Evaluierung bearbeiten" : "Neue Evaluierung"}</DialogTitle>
          </DialogHeader>
          {editing && (
            <form onSubmit={save} className="space-y-3">
              {!editing.id && vorlagen.length > 0 && (
                <div className="space-y-1.5 border rounded p-2 bg-primary/5">
                  <Label className="text-xs">Aus Vorlage übernehmen (optional)</Label>
                  <select
                    onChange={(e) => e.target.value && applyVorlage(e.target.value)}
                    className="w-full h-9 rounded-md border bg-background px-2 text-sm"
                    defaultValue=""
                  >
                    <option value="">— Vorlage wählen —</option>
                    {vorlagen.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.name} · {unterweisungLabel(v.typ)}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="col-span-2 space-y-1.5">
                  <Label>Baustelle *</Label>
                  <select
                    name="baustelle_id"
                    defaultValue={editing.baustelle_id ?? ""}
                    required
                    className="w-full h-10 rounded-md border bg-background px-3 text-sm"
                  >
                    <option value="">— wählen —</option>
                    {baustellenForCreate.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.bvh_name}
                        {b.kostenstelle ? ` · ${b.kostenstelle}` : ""}
                      </option>
                    ))}
                  </select>
                  {!isAdmin && isPolier && (
                    <div className="text-[11px] text-muted-foreground">
                      Du siehst nur Baustellen deiner Partie. Die Unterweisung wird automatisch an
                      alle deine Partie-Mitglieder verteilt.
                    </div>
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label>Datum *</Label>
                  <Input type="date" name="datum" required defaultValue={editing.datum ?? ""} />
                </div>
                <div className="space-y-1.5">
                  <Label>Unterweisungs-Typ</Label>
                  <select
                    name="typ"
                    value={editing.typ ?? "baustelle"}
                    onChange={(e) =>
                      setEditing((prev) => (prev ? { ...prev, typ: e.target.value as EvaluierungTyp } : prev))
                    }
                    className="w-full h-10 rounded-md border bg-background px-3 text-sm"
                  >
                    {UNTERWEISUNG_OPTIONS.map((u) => (
                      <option key={u.value} value={u.value}>
                        {u.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {(() => {
                const items = getCheckItems(editing.typ ?? "baustelle");
                if (items.length === 0) {
                  return (
                    <div className="text-xs text-muted-foreground border rounded p-3">
                      Diese Unterweisung enthält keine zu prüfenden Punkte – Mitarbeiter müssen
                      den Inhalt nur lesen und bestätigen.
                    </div>
                  );
                }
                const bySection: Record<string, typeof items> = {};
                items.forEach((it) => {
                  (bySection[it.section] = bySection[it.section] || []).push(it);
                });
                return (
                  <div className="space-y-3 border-t pt-3">
                    <Label>Checkliste</Label>
                    {Object.entries(bySection).map(([section, secItems]) => (
                      <div key={section} className="space-y-1">
                        <div className="text-xs font-bold uppercase tracking-wide text-primary">
                          {section}
                        </div>
                        {secItems.map((c) => (
                          <div
                            key={c.key}
                            className="flex items-center justify-between gap-2 text-sm border-b py-1.5"
                          >
                            <span className="flex-1">{c.label}</span>
                            <div className="flex gap-1 shrink-0">
                              {["i.O.", "nicht i.O.", "n.A."].map((opt) => (
                                <button
                                  type="button"
                                  key={opt}
                                  onClick={() => setChecklist((s) => ({ ...s, [c.key]: opt }))}
                                  className={`px-2 py-1 text-[11px] rounded border ${
                                    checklist[c.key] === opt
                                      ? opt === "i.O."
                                        ? "bg-emerald-600 text-white border-emerald-600"
                                        : opt === "nicht i.O."
                                        ? "bg-destructive text-white border-destructive"
                                        : "bg-muted"
                                      : "bg-background"
                                  }`}
                                >
                                  {opt}
                                </button>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                );
              })()}

              <div className="space-y-1.5">
                <Label>Notizen</Label>
                <Textarea
                  name="notizen"
                  value={editing.notizen ?? ""}
                  onChange={(e) =>
                    setEditing((prev) =>
                      prev ? { ...prev, notizen: e.target.value } : prev,
                    )
                  }
                />
              </div>

              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setEditing(null)}>
                  Abbrechen
                </Button>
                <Button type="submit">
                  {editing.id ? "Speichern" : "Anlegen + an Partie verteilen"}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      <EvaluierungKiDialog
        open={kiOpen}
        onOpenChange={setKiOpen}
        baustellen={baustellen}
        onCreated={() => {
          setKiOpen(false);
          load();
        }}
      />
    </div>
  );
}

