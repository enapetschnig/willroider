/**
 * Evaluierung Tagesbaustellen (SiGe-Dokument lt. §§ 4-5 ASchG, Vorlage
 * Ingenieurbüro Wulz) — Eingabe und Ansicht.
 *
 * Die Werte liegen flach in evaluierungen.checkliste (siehe
 * lib/unterweisungen.ts, Abschnitt TAGESBAUSTELLE). Zwei Spalten wie auf
 * dem Papier: links die Gefährdung (☒ vorhanden), rechts die Maßnahmen
 * (☒ umzusetzen). Maßnahmen sind nur anwählbar, wenn die Gefährdung
 * vorhanden ist — so bleibt das Dokument in sich stimmig.
 */

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Wand2 } from "lucide-react";
import type { FeldItem, GefahrGruppe } from "@/lib/unterweisungen";

export type Werte = Record<string, string>;

const istAn = (w: Werte, key: string) => w[key] === "x";

/** Vorbelegung aus der Baustelle — füllt nur leere Felder. */
export type TagesbaustelleVorbelegung = {
  verfasser?: string | null;
  anschrift?: string | null;
  beschreibung?: string | null;
  baubeginn?: string | null;
  bauende?: string | null;
  objekt?: string | null;
  bauleiter?: string | null;
  bauleiterTel?: string | null;
  partiefuehrer?: string | null;
  partiefuehrerTel?: string | null;
  maxAn?: string | null;
};

export function vorbelegen(werte: Werte, v: TagesbaustelleVorbelegung): Werte {
  const out = { ...werte };
  const setze = (key: string, wert: string | null | undefined) => {
    if (!out[key] && wert) out[key] = wert;
  };
  setze("f.verfasser", v.verfasser);
  setze("f.anschrift", v.anschrift);
  setze("f.beschreibung", v.beschreibung);
  setze("f.baubeginn", v.baubeginn);
  setze("f.bauende", v.bauende);
  setze("f.objekt", v.objekt);
  setze("f.bauleiter", v.bauleiter);
  setze("f.bauleiter_tel", v.bauleiterTel);
  setze("f.partiefuehrer", v.partiefuehrer);
  setze("f.partiefuehrer_tel", v.partiefuehrerTel);
  setze("f.max_an", v.maxAn);
  return out;
}

// ─── Eingabe ──────────────────────────────────────────────────────────────

export function TagesbaustelleFelderForm({
  items,
  werte,
  onChange,
  onVorbelegen,
}: {
  items: FeldItem[];
  werte: Werte;
  onChange: (key: string, wert: string) => void;
  onVorbelegen?: () => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs font-bold uppercase tracking-wide text-primary">
          Angaben zur Baustelle
        </div>
        {onVorbelegen && (
          <Button type="button" size="sm" variant="outline" onClick={onVorbelegen}>
            <Wand2 className="h-3.5 w-3.5 mr-1.5" />
            Aus Baustelle übernehmen
          </Button>
        )}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {items.map((f) => (
          <div key={f.key} className={`space-y-1 ${f.breit ? "sm:col-span-2" : ""}`}>
            <Label className="text-xs">{f.label}</Label>
            {f.typ === "textarea" ? (
              <Textarea
                value={werte[f.key] ?? ""}
                onChange={(e) => onChange(f.key, e.target.value)}
                rows={2}
              />
            ) : (
              <Input
                type={f.typ === "date" ? "date" : f.typ === "number" ? "number" : f.typ === "tel" ? "tel" : "text"}
                inputMode={f.typ === "number" ? "numeric" : undefined}
                value={werte[f.key] ?? ""}
                onChange={(e) => onChange(f.key, e.target.value)}
                className="h-10"
              />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export function TagesbaustelleGefahrenForm({
  gruppen,
  werte,
  onChange,
}: {
  gruppen: GefahrGruppe[];
  werte: Werte;
  onChange: (key: string, wert: string) => void;
}) {
  const toggle = (key: string) => onChange(key, istAn(werte, key) ? "" : "x");
  return (
    <div className="space-y-2">
      <div className="text-xs font-bold uppercase tracking-wide text-primary">
        Besondere Gefahren im Arbeitsbereich
      </div>
      <div className="text-[11px] text-muted-foreground">
        Links ankreuzen, was auf dieser Baustelle vorhanden ist. Rechts die Maßnahmen,
        die dafür umzusetzen sind.
      </div>
      {gruppen.map((g) => {
        const gKey = `g.${g.key}`;
        const vorhanden = istAn(werte, gKey);
        return (
          <div
            key={g.key}
            className={`rounded-lg border ${vorhanden ? "border-primary/50 bg-primary/5" : "bg-background"}`}
          >
            <label className="flex items-start gap-3 p-3 cursor-pointer">
              <Checkbox
                checked={vorhanden}
                onCheckedChange={() => toggle(gKey)}
                className="mt-0.5 h-5 w-5"
              />
              <div className="flex-1 min-w-0">
                <div className="font-medium text-sm">{g.label}</div>
                {g.hinweis && (
                  <div className="text-[11px] text-muted-foreground">{g.hinweis}</div>
                )}
              </div>
              <span
                className={`text-[10px] px-1.5 py-0.5 rounded shrink-0 font-semibold ${
                  vorhanden ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                }`}
              >
                {vorhanden ? "vorhanden" : "nicht vorhanden"}
              </span>
            </label>

            {vorhanden && (
              <div className="px-3 pb-3 space-y-2 border-t pt-2">
                {g.zusatz?.map((z) => (
                  <div key={z.key} className="space-y-1">
                    <Label className="text-xs">{z.label}</Label>
                    <Input
                      value={werte[z.key] ?? ""}
                      onChange={(e) => onChange(z.key, e.target.value)}
                      className="h-9"
                    />
                  </div>
                ))}
                <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Erforderliche Sicherheitsmaßnahmen
                </div>
                {g.massnahmen.map((m) => {
                  // Bei „Sonstige Gefährdung“ gibt es nur die Maßnahme als Text.
                  if (g.frei) {
                    return (
                      <div key={m.key} className="space-y-1">
                        <Label className="text-xs">{m.label}</Label>
                        <Textarea
                          value={werte[`t.${m.key}`] ?? ""}
                          onChange={(e) => {
                            onChange(`t.${m.key}`, e.target.value);
                            onChange(m.key, e.target.value.trim() ? "x" : "");
                          }}
                          rows={2}
                        />
                      </div>
                    );
                  }
                  const an = istAn(werte, m.key);
                  return (
                    <div key={m.key} className="space-y-1">
                      <label className="flex items-start gap-2 text-sm cursor-pointer">
                        <Checkbox
                          checked={an}
                          onCheckedChange={() => toggle(m.key)}
                          className="mt-0.5"
                        />
                        <span className={an ? "" : "text-muted-foreground"}>{m.label}</span>
                      </label>
                      {m.freitext && an && (
                        <Input
                          placeholder="Was genau?"
                          value={werte[`t.${m.key}`] ?? ""}
                          onChange={(e) => onChange(`t.${m.key}`, e.target.value)}
                          className="h-9 ml-6 w-[calc(100%-1.5rem)]"
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Ansicht (Mitarbeiter liest vor der Unterschrift) ─────────────────────

export function TagesbaustelleFelderAnsicht({ items, werte }: { items: FeldItem[]; werte: Werte }) {
  const gefuellt = items.filter((f) => (werte[f.key] ?? "").trim() !== "");
  return (
    <Card>
      <CardContent className="p-3 space-y-1.5">
        <div className="text-xs font-bold uppercase tracking-wide text-primary">
          Angaben zur Baustelle
        </div>
        {gefuellt.length === 0 ? (
          <div className="text-xs text-muted-foreground">Noch keine Angaben.</div>
        ) : (
          <dl className="grid grid-cols-[minmax(7rem,auto)_1fr] gap-x-3 gap-y-1 text-sm">
            {gefuellt.map((f) => (
              <div key={f.key} className="contents">
                <dt className="text-muted-foreground text-xs pt-0.5">{f.label}</dt>
                <dd className="whitespace-pre-line">{anzeigeWert(f, werte[f.key])}</dd>
              </div>
            ))}
          </dl>
        )}
      </CardContent>
    </Card>
  );
}

function anzeigeWert(f: FeldItem, wert: string): string {
  if (f.typ === "date" && /^\d{4}-\d{2}-\d{2}$/.test(wert)) {
    return new Date(wert + "T00:00:00").toLocaleDateString("de-AT");
  }
  return wert;
}

export function TagesbaustelleGefahrenAnsicht({
  gruppen,
  werte,
}: {
  gruppen: GefahrGruppe[];
  werte: Werte;
}) {
  const vorhandene = gruppen.filter((g) => istAn(werte, `g.${g.key}`));
  return (
    <Card>
      <CardContent className="p-3 space-y-2">
        <div className="text-xs font-bold uppercase tracking-wide text-primary">
          Besondere Gefahren im Arbeitsbereich
        </div>
        {vorhandene.length === 0 ? (
          <div className="text-sm">
            Für diese Baustelle wurden keine besonderen Gefahren festgestellt.
          </div>
        ) : (
          vorhandene.map((g) => {
            const art = g.frei ? werte[`t.sonstige${g.key.replace("sonstige", "")}_art`] : null;
            const massnahmen = g.massnahmen.filter((m) => istAn(werte, m.key));
            return (
              <div key={g.key} className="rounded border border-primary/40 bg-primary/5 p-2.5 space-y-1.5">
                <div className="flex items-start gap-2">
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary text-primary-foreground font-semibold shrink-0 mt-0.5">
                    vorhanden
                  </span>
                  <div className="text-sm font-semibold">
                    {g.frei && art ? art : g.label}
                    {g.hinweis && !g.frei && (
                      <span className="font-normal text-muted-foreground"> ({g.hinweis})</span>
                    )}
                  </div>
                </div>
                {g.zusatz
                  ?.filter((z) => !g.frei && (werte[z.key] ?? "").trim())
                  .map((z) => (
                    <div key={z.key} className="text-xs">
                      <span className="text-muted-foreground">{z.label}: </span>
                      {werte[z.key]}
                    </div>
                  ))}
                <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Umzusetzen
                </div>
                {massnahmen.length === 0 ? (
                  <div className="text-xs text-muted-foreground">Keine Maßnahme angekreuzt.</div>
                ) : (
                  <ul className="space-y-1 text-sm">
                    {massnahmen.map((m) => (
                      <li key={m.key} className="flex gap-2">
                        <span className="text-primary shrink-0">☒</span>
                        <span>
                          {g.frei ? werte[`t.${m.key}`] : m.label}
                          {!g.frei && m.freitext && werte[`t.${m.key}`] ? `: ${werte[`t.${m.key}`]}` : ""}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}
