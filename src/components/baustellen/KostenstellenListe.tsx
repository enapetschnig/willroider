/**
 * Kostenstellenübersicht — zweiter Reiter der Baustellen-Seite.
 *
 * Aufbau wie die Papierliste „Kostenstellen 08.2026", nur lebendig:
 *  - „Zimmerei – Allgemein": die statische Liste aus lib/kostenstellen.ts.
 *    Fremdauftrags-Kostenstellen klappen ihre Sammel-Baustellen auf
 *    (1404030-2601 …); existiert zu einer allgemeinen Kostenstelle ein
 *    Baustellenordner (Maschinen wie „140-4755 Hundegger K2"), führt der
 *    Ordner-Knopf direkt hinein.
 *  - „Zimmerei – Baustellen": alle echten Baustellen aus dem Stamm,
 *    sortiert nach Kostenstelle — aktualisiert sich mit jeder neu
 *    angelegten Baustelle (der Realtime-Reload der Seite liefert sie).
 *
 * Kostenstelle + BVH-Name stehen groß und fett, die Adresse klein —
 * sie ist Nebensache. Der Ordner-Knopf öffnet den Baustellenordner.
 */

import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ChevronDown, ChevronRight, FolderOpen, Search } from "lucide-react";
import {
  ALLGEMEINE_KOSTENSTELLEN,
  kstFormat,
  kstNormal,
} from "@/lib/kostenstellen";
import type { Database } from "@/integrations/supabase/types";

type Baustelle = Database["public"]["Tables"]["baustellen"]["Row"];

const adresse = (b: Baustelle): string =>
  [[b.plz, b.ort].filter(Boolean).join(" "), b.baustellen_adresse]
    .filter(Boolean)
    .join(" · ");

/** Eine Baustellen-Zeile: Kst + Name fett, Adresse klein, Ordner-Knopf. */
function BaustellenZeile({ b, klein }: { b: Baustelle; klein?: boolean }) {
  return (
    <Link
      to={`/baustellen/${b.id}`}
      className="flex items-center gap-3 px-3 py-2 rounded-md border bg-card hover:border-primary/40 hover:shadow-sm transition-all"
    >
      <div className="flex-1 min-w-0">
        <div className={`font-bold truncate ${klein ? "text-sm" : "text-[15px]"}`}>
          <span className="tabular-nums">{kstFormat(b.kostenstelle ?? "")}</span>
          {" · "}
          {b.bvh_name}
        </div>
        {adresse(b) && (
          <div className="text-xs text-muted-foreground truncate">{adresse(b)}</div>
        )}
      </div>
      {b.status !== "aktiv" && (
        <Badge variant="outline" className="text-[10px] shrink-0">
          {b.status}
        </Badge>
      )}
      <FolderOpen className="h-4 w-4 text-primary shrink-0" />
    </Link>
  );
}

export function KostenstellenListe({ baustellen }: { baustellen: Baustelle[] }) {
  const [suche, setSuche] = useState("");
  const [offen, setOffen] = useState<Set<string>>(() => new Set());

  const q = suche.trim().toLowerCase();
  const trifft = (...felder: (string | null | undefined)[]) =>
    !q ||
    felder.some((f) => (f ?? "").toLowerCase().includes(q)) ||
    felder.some((f) => kstNormal(f).includes(kstNormal(q)) && kstNormal(q).length >= 3);

  /** Baustellenordner zu einer allgemeinen Kostenstelle (z. B. Maschinen
   *  „140-4755" ↔ „1404755"). */
  const ordnerZuKst = useMemo(() => {
    const m = new Map<string, Baustelle>();
    for (const b of baustellen) {
      const n = kstNormal(b.kostenstelle);
      if (n.length === 7 && !m.has(n)) m.set(n, b);
    }
    return m;
  }, [baustellen]);

  /** Sammel-Baustellen je Fremdauftrags-Basis (1404030-2601, 1404040_2602 …). */
  const sammelZuBasis = useMemo(() => {
    const m = new Map<string, Baustelle[]>();
    for (const b of baustellen) {
      const match = (b.kostenstelle ?? "").match(/^(140\d{4})[-_](\d+)$/);
      if (!match) continue;
      if (!m.has(match[1])) m.set(match[1], []);
      m.get(match[1])!.push(b);
    }
    for (const list of m.values()) {
      list.sort((a, b) => (a.kostenstelle ?? "").localeCompare(b.kostenstelle ?? "", "de", { numeric: true }));
    }
    return m;
  }, [baustellen]);

  const basen = new Set(ALLGEMEINE_KOSTENSTELLEN.filter((k) => k.fremdauftrag).map((k) => k.kst));
  const allgemeinKsts = new Set(ALLGEMEINE_KOSTENSTELLEN.map((k) => k.kst));

  /** Echte Baustellen: 7-stellige Kostenstelle, keine Fremdauftrags-Basis,
   *  keine Maschinen-/Verwaltungs-Kst der Allgemein-Liste. Alles andere
   *  (Alt-Formate wie „KS-2026-001") landet unter „Weitere". */
  const { echte, weitere } = useMemo(() => {
    const echte: Baustelle[] = [];
    const weitere: Baustelle[] = [];
    for (const b of baustellen) {
      const kst = (b.kostenstelle ?? "").trim();
      if (/^(140\d{4})[-_]\d+$/.test(kst)) continue; // Sammel → beim Fremdauftrag
      const n = kstNormal(kst);
      if (allgemeinKsts.has(n)) continue; // Maschine/Verwaltung → Allgemein-Zeile
      if (/^140\d{4}$/.test(kst)) echte.push(b);
      else weitere.push(b);
    }
    const sortKst = (a: Baustelle, b: Baustelle) =>
      (a.kostenstelle ?? "").localeCompare(b.kostenstelle ?? "", "de", { numeric: true });
    echte.sort(sortKst);
    weitere.sort(sortKst);
    return { echte, weitere };
  }, [baustellen, allgemeinKsts]);

  const allgemeinGefiltert = ALLGEMEINE_KOSTENSTELLEN.filter((k) => {
    if (trifft(k.kst, kstFormat(k.kst), k.name)) return true;
    // Treffer in einer Sammel-Baustelle hält die Basis sichtbar.
    return (sammelZuBasis.get(k.kst) ?? []).some((b) =>
      trifft(b.kostenstelle, b.bvh_name, b.ort, b.baustellen_adresse),
    );
  });
  const echteGefiltert = echte.filter((b) =>
    trifft(b.kostenstelle, b.bvh_name, b.ort, b.baustellen_adresse, b.bauherr),
  );
  const weitereGefiltert = weitere.filter((b) =>
    trifft(b.kostenstelle, b.bvh_name, b.ort, b.baustellen_adresse, b.bauherr),
  );

  const toggle = (kst: string) =>
    setOffen((cur) => {
      const n = new Set(cur);
      if (n.has(kst)) n.delete(kst);
      else n.add(kst);
      return n;
    });

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-3">
          <div className="relative sm:max-w-sm">
            <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Suche Kostenstelle, BVH, Ort …"
              value={suche}
              onChange={(e) => setSuche(e.target.value)}
              className="pl-9 h-11 sm:h-10"
            />
          </div>
        </CardContent>
      </Card>

      {/* ── Zimmerei – Allgemein ── */}
      <div>
        <h2 className="text-lg font-bold mb-2">Zimmerei – Allgemein</h2>
        <div className="space-y-1">
          {allgemeinGefiltert.map((k) => {
            const sammel = sammelZuBasis.get(k.kst) ?? [];
            const ordner = ordnerZuKst.get(k.kst);
            const istOffen = offen.has(k.kst) || (!!q && sammel.length > 0);
            return (
              <div key={k.kst}>
                <div className="flex items-center gap-2 px-3 py-2 rounded-md border bg-card">
                  {k.fremdauftrag ? (
                    <button
                      type="button"
                      onClick={() => toggle(k.kst)}
                      className="flex items-center gap-2 flex-1 min-w-0 text-left"
                      aria-expanded={istOffen}
                    >
                      {istOffen ? (
                        <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
                      ) : (
                        <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                      )}
                      <span className="font-bold text-[15px] truncate">
                        <span className="tabular-nums">{kstFormat(k.kst)}</span> · {k.name}
                      </span>
                      <span className="text-xs text-muted-foreground shrink-0">
                        {sammel.length} Baustelle{sammel.length === 1 ? "" : "n"}
                      </span>
                    </button>
                  ) : (
                    <span className="font-bold text-[15px] flex-1 min-w-0 truncate">
                      <span className="tabular-nums">{kstFormat(k.kst)}</span> · {k.name}
                    </span>
                  )}
                  {ordner && (
                    <Link
                      to={`/baustellen/${ordner.id}`}
                      title="Baustellenordner öffnen"
                      className="shrink-0 p-1.5 rounded hover:bg-muted"
                    >
                      <FolderOpen className="h-4 w-4 text-primary" />
                    </Link>
                  )}
                </div>
                {k.fremdauftrag && istOffen && sammel.length > 0 && (
                  <div className="ml-6 mt-1 mb-2 space-y-1">
                    {sammel
                      .filter((b) => !q || trifft(b.kostenstelle, b.bvh_name, b.ort, b.baustellen_adresse))
                      .map((b) => (
                        <BaustellenZeile key={b.id} b={b} klein />
                      ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Zimmerei – Baustellen ── */}
      <div>
        <h2 className="text-lg font-bold mb-2">Zimmerei – Baustellen</h2>
        <div className="space-y-1">
          {echteGefiltert.map((b) => (
            <BaustellenZeile key={b.id} b={b} />
          ))}
          {echteGefiltert.length === 0 && (
            <div className="text-sm text-muted-foreground px-3 py-2">Keine Treffer.</div>
          )}
        </div>
      </div>

      {weitereGefiltert.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-muted-foreground mb-2">
            Weitere (ohne Zimmerei-Kostenstelle)
          </h2>
          <div className="space-y-1">
            {weitereGefiltert.map((b) => (
              <BaustellenZeile key={b.id} b={b} klein />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
