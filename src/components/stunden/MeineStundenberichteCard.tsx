/**
 * „Mein 14-tägiger Stundenbericht“ auf der Stunden-Seite.
 *
 * Änderungswunsch Bua Sirnitzer (18.09.2026): „Wo sehe ich meinen
 * 14-tägigen Stundenbericht zum Unterschreiben?“ — bisher gab es ihn nur
 * als Karte auf der Startseite, und auch dort nur, wenn schon einer erzeugt
 * war. Jetzt steht auf der Stunden-Seite immer, wo man dran ist:
 *   - offener Bericht → gelb, direkt zum Unterschreiben
 *   - sonst → wann der nächste kommt (16. bzw. Monatsletzter, abends)
 *   - frühere Berichte zum Nachsehen
 */

import { useState } from "react";
import { Link } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PenLine, ArrowRight, ChevronDown, ChevronUp, FileSpreadsheet } from "lucide-react";
import { useStundenBerichteList } from "@/hooks/useStundenBericht";
import type { StundenBerichtStatus } from "@/integrations/supabase/types";

const STATUS: Record<StundenBerichtStatus, { label: string; cls: string }> = {
  offen: { label: "Bitte unterschreiben", cls: "bg-amber-100 text-amber-900 border-amber-300" },
  unterschrieben: { label: "Beim Büro", cls: "bg-blue-100 text-blue-900 border-blue-300" },
  bestaetigt: { label: "Bestätigt", cls: "bg-emerald-100 text-emerald-900 border-emerald-300" },
  versendet: { label: "Abgeschlossen", cls: "bg-emerald-600 text-white border-emerald-700" },
};

function periode(jahr: number, monat: number, teil: number): string {
  const m = new Date(jahr, monat - 1, 1).toLocaleDateString("de-AT", { month: "long", year: "numeric" });
  return `${m} · ${teil === 1 ? "Teil I (1.–16.)" : "Teil II (17.–Ende)"}`;
}

/** Wann der nächste Bericht erzeugt wird: am 16. bzw. am Monatsletzten, abends. */
function naechsterBericht(): string {
  const heute = new Date();
  const j = heute.getFullYear();
  const m = heute.getMonth();
  if (heute.getDate() < 16) {
    return `am 16. ${new Date(j, m, 16).toLocaleDateString("de-AT", { month: "long" })} abends (Teil I)`;
  }
  const letzter = new Date(j, m + 1, 0);
  return `am ${letzter.toLocaleDateString("de-AT", { day: "numeric", month: "long" })} abends (Teil II)`;
}

export function MeineStundenberichteCard({ userId }: { userId: string }) {
  const [offen, setOffen] = useState(false);
  const { data: berichte = [], isLoading } = useStundenBerichteList({
    mitarbeiterId: userId,
    enabled: !!userId,
  });
  if (isLoading) return null;

  const zuUnterschreiben = berichte.filter((b) => b.status === "offen");
  const fruehere = berichte.filter((b) => b.status !== "offen").slice(0, 8);

  return (
    <div className="space-y-2">
      {zuUnterschreiben.map((b) => (
        <Card key={b.id} className="border-2 border-amber-400 bg-gradient-to-r from-amber-50 to-amber-100 shadow-md">
          <CardContent className="p-3 sm:p-4">
            <div className="flex items-start gap-3">
              <div className="h-10 w-10 rounded-full bg-amber-500 flex items-center justify-center text-white shadow-md shrink-0">
                <PenLine className="h-5 w-5" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-bold text-sm sm:text-base text-amber-950 leading-tight">
                  Dein 14-tägiger Stundenbericht wartet auf deine Unterschrift
                </div>
                <div className="text-xs text-amber-900 mt-0.5">
                  {periode(b.jahr, b.monat, b.teil)} — kontrollieren, falls nötig ändern, unterschreiben.
                </div>
              </div>
            </div>
            <Link to={`/stundenbericht/${b.id}`} className="block mt-3">
              <Button className="w-full h-11 bg-amber-600 hover:bg-amber-700 text-white shadow-md">
                Jetzt öffnen und unterschreiben
                <ArrowRight className="h-4 w-4 ml-1.5" />
              </Button>
            </Link>
          </CardContent>
        </Card>
      ))}

      <Card>
        <CardContent className="p-3 space-y-1.5">
          <button
            type="button"
            onClick={() => setOffen((v) => !v)}
            className="w-full flex items-center justify-between text-xs font-semibold uppercase text-muted-foreground"
          >
            <span className="flex items-center gap-1.5">
              <FileSpreadsheet className="h-3.5 w-3.5" />
              Meine 14-tägigen Stundenberichte ({berichte.length})
            </span>
            {offen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
          {zuUnterschreiben.length === 0 && (
            <div className="text-[11px] text-muted-foreground leading-snug">
              Derzeit ist nichts zu unterschreiben. Der nächste Bericht wird {naechsterBericht()}{" "}
              erzeugt und erscheint dann hier und auf der Startseite.
            </div>
          )}
          {offen && (
            <div className="space-y-1 pt-1">
              {fruehere.length === 0 && zuUnterschreiben.length === 0 && (
                <div className="text-xs text-muted-foreground">
                  Noch kein Bericht vorhanden — er wird nur für Perioden erzeugt, in denen
                  du Stunden eingetragen hast.
                </div>
              )}
              {fruehere.map((b) => {
                const s = STATUS[b.status];
                return (
                  <Link
                    key={b.id}
                    to={`/stundenbericht/${b.id}`}
                    className="flex items-center gap-2 text-sm border rounded px-2 py-1.5 hover:bg-muted/40"
                  >
                    <span className="flex-1 min-w-0 truncate">{periode(b.jahr, b.monat, b.teil)}</span>
                    <Badge variant="outline" className={`${s.cls} text-[10px]`}>
                      {s.label}
                    </Badge>
                    <ArrowRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  </Link>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
