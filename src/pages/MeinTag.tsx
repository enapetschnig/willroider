import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import {
  Building2,
  Truck,
  Users,
  Clock as ClockIcon,
  MapPin,
  Navigation,
  Eye,
  CheckCircle2,
} from "lucide-react";
import type { Database } from "@/integrations/supabase/types";

type EM = Database["public"]["Tables"]["einteilung_mitarbeiter"]["Row"] & {
  einteilungen: Database["public"]["Tables"]["einteilungen"]["Row"] & {
    baustellen: Database["public"]["Tables"]["baustellen"]["Row"] | null;
    fahrzeuge: Database["public"]["Tables"]["fahrzeuge"]["Row"] | null;
  };
};

export default function MeinTag() {
  const { user, profile } = useAuth();
  const { toast } = useToast();
  const [today, setToday] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [tomorrow, setTomorrow] = useState<string>(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d.toISOString().slice(0, 10);
  });
  const [todayRows, setTodayRows] = useState<EM[]>([]);
  const [tomorrowRows, setTomorrowRows] = useState<EM[]>([]);

  const fetchAssignments = async (date: string) => {
    if (!user) return [];
    const { data } = await supabase
      .from("einteilung_mitarbeiter")
      .select(
        "*, einteilungen!inner(*, baustellen(*), fahrzeuge(*))"
      )
      .eq("mitarbeiter_id", user.id)
      .eq("einteilungen.datum", date);
    return (data as EM[]) ?? [];
  };

  const load = async () => {
    const [t, n] = await Promise.all([fetchAssignments(today), fetchAssignments(tomorrow)]);
    setTodayRows(t);
    setTomorrowRows(n);
  };

  useEffect(() => {
    load();

    const ch = supabase
      .channel("mein-tag")
      .on("postgres_changes", { event: "*", schema: "public", table: "einteilungen" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "einteilung_mitarbeiter" }, load)
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [user, today, tomorrow]);

  const confirmRead = async (emId: string) => {
    await supabase
      .from("einteilung_mitarbeiter")
      .update({ gelesen_am: new Date().toISOString(), bestaetigt_am: new Date().toISOString() })
      .eq("id", emId);
    toast({ title: "Bestätigt", description: "Du hast die Einteilung gelesen." });
    load();
  };

  const reportAbsent = async (emId: string) => {
    const grund = prompt("Grund für Abwesenheit (Krank/Urlaub/...)?");
    if (!grund) return;
    await supabase
      .from("einteilung_mitarbeiter")
      .update({ abwesend: true, abwesenheitsgrund: grund })
      .eq("id", emId);
    toast({ title: "Abwesenheit gemeldet", description: "Bauleitung wurde informiert." });
    load();
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Mein Tag"
        description={
          profile
            ? `Hallo ${profile.vorname}, hier siehst du deine Einteilung.`
            : "Heutige und morgige Einteilung."
        }
      />

      <DaySection
        label="Heute"
        date={today}
        rows={todayRows}
        confirmRead={confirmRead}
        reportAbsent={reportAbsent}
      />
      <DaySection
        label="Morgen"
        date={tomorrow}
        rows={tomorrowRows}
        confirmRead={confirmRead}
        reportAbsent={reportAbsent}
      />

      <Card>
        <CardContent className="p-3 text-center">
          <Link to="/stunden">
            <Button>
              <ClockIcon className="h-4 w-4 mr-2" /> Stunden für heute erfassen
            </Button>
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}

function DaySection({
  label,
  date,
  rows,
  confirmRead,
  reportAbsent,
}: {
  label: string;
  date: string;
  rows: EM[];
  confirmRead: (id: string) => void;
  reportAbsent: (id: string) => void;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between mb-2">
        <h2 className="text-lg font-semibold">{label}</h2>
        <span className="text-sm text-muted-foreground">
          {new Date(date).toLocaleDateString("de-AT", {
            weekday: "long",
            day: "2-digit",
            month: "long",
          })}
        </span>
      </div>
      {rows.length === 0 && (
        <Card>
          <CardContent className="p-6 text-center text-sm text-muted-foreground">
            Keine Einteilung für {label.toLowerCase()}.
          </CardContent>
        </Card>
      )}
      {rows.map((r) => {
        const e = r.einteilungen;
        const b = e.baustellen;
        const f = e.fahrzeuge;
        return (
          <Card key={r.id} className="mb-2">
            <CardContent className="p-4 space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="text-xs text-muted-foreground">Baustelle</div>
                  <div className="font-bold text-base flex items-center gap-2">
                    <Building2 className="h-4 w-4 text-primary" />
                    {b?.bvh_name ?? "—"}
                  </div>
                  {b?.kostenstelle && (
                    <div className="text-xs text-muted-foreground">{b.kostenstelle}</div>
                  )}
                </div>
                {r.abwesend ? (
                  <Badge variant="destructive">Abwesend</Badge>
                ) : r.bestaetigt_am ? (
                  <Badge className="bg-emerald-600">
                    <CheckCircle2 className="h-3 w-3 mr-1" /> Bestätigt
                  </Badge>
                ) : (
                  <Badge variant="outline">Neu</Badge>
                )}
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                <Tile icon={ClockIcon} label="Abfahrt" value={e.abfahrtszeit?.slice(0, 5) ?? "—"} />
                <Tile icon={MapPin} label="Treffpunkt" value={e.treffpunkt ?? "—"} />
                <Tile icon={Truck} label="Fahrzeug" value={f?.kennzeichen ?? "—"} />
                <Tile icon={Users} label="Rolle" value={r.rolle ?? "Mitarbeiter"} />
              </div>

              {b?.baustellen_adresse && (
                <div className="text-xs flex items-center gap-2">
                  <MapPin className="h-3 w-3" />
                  <span>{[b.baustellen_adresse, b.plz, b.ort].filter(Boolean).join(", ")}</span>
                  <a
                    href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
                      [b.baustellen_adresse, b.plz, b.ort].filter(Boolean).join(", ")
                    )}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-primary text-xs hover:underline ml-auto inline-flex items-center gap-1"
                  >
                    <Navigation className="h-3 w-3" /> Navigieren
                  </a>
                </div>
              )}

              {(e.material_hinweise || e.sonderaufgaben) && (
                <div className="border-t pt-2 space-y-1 text-xs">
                  {e.material_hinweise && (
                    <div>
                      <strong>Material:</strong> {e.material_hinweise}
                    </div>
                  )}
                  {e.sonderaufgaben && (
                    <div>
                      <strong>Sonderaufgaben:</strong> {e.sonderaufgaben}
                    </div>
                  )}
                </div>
              )}

              {!r.bestaetigt_am && !r.abwesend && (
                <div className="flex flex-wrap gap-2 pt-1">
                  <Button size="sm" onClick={() => confirmRead(r.id)}>
                    <Eye className="h-4 w-4 mr-1" /> Gelesen & bestätigt
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => reportAbsent(r.id)}>
                    Abwesenheit melden
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

function Tile({ icon: Icon, label, value }: { icon: typeof ClockIcon; label: string; value: any }) {
  return (
    <div className="border rounded-md p-2">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground flex items-center gap-1">
        <Icon className="h-3 w-3" /> {label}
      </div>
      <div className="font-semibold text-sm truncate">{value}</div>
    </div>
  );
}
