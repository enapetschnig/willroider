import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Building2, MapPin, Navigation, Clock as ClockIcon, Users, Sun, Hourglass } from "lucide-react";
import type { Database } from "@/integrations/supabase/types";
import { localIso } from "@/lib/dateFmt";
import { fmtStunden, fmtTage } from "@/lib/konten";

type Baustelle = Database["public"]["Tables"]["baustellen"]["Row"];
type Partie = Database["public"]["Tables"]["partien"]["Row"];

export default function MeinTag() {
  const { user, profile } = useAuth();
  const [baustellen, setBaustellen] = useState<Baustelle[]>([]);
  const [partie, setPartie] = useState<Partie | null>(null);
  const [colleagues, setColleagues] = useState<{ id: string; vorname: string; nachname: string }[]>([]);
  const [urlaubsSaldo, setUrlaubsSaldo] = useState<number | null>(null);
  const [zaSaldo, setZaSaldo] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    if (!user || !profile) return;
    setLoading(true);

    if (!profile.partie_id) {
      setBaustellen([]);
      setPartie(null);
      setColleagues([]);
      setLoading(false);
      return;
    }

    const today = localIso();

    const [partieRes, bsRes, colleaguesRes] = await Promise.all([
      supabase.from("partien").select("*").eq("id", profile.partie_id).maybeSingle(),
      supabase
        .from("baustellen")
        .select("*")
        .eq("partie_id", profile.partie_id)
        .lte("start_datum", today)
        .or(`end_datum.gte.${today},end_datum.is.null`)
        .order("start_datum", { ascending: false }),
      supabase
        .from("profiles")
        .select("id, vorname, nachname")
        .eq("partie_id", profile.partie_id)
        .neq("id", user.id),
    ]);

    setPartie((partieRes.data as Partie) ?? null);
    setBaustellen((bsRes.data as Baustelle[]) ?? []);
    setColleagues((colleaguesRes.data as any[]) ?? []);
    setLoading(false);
  };

  useEffect(() => {
    load();
    const ch = supabase
      .channel("mein-tag")
      .on("postgres_changes", { event: "*", schema: "public", table: "baustellen" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "partien" }, load)
      // Realtime auf eigenes Profil — wenn Admin Partie wechselt, sehen wir's sofort
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "profiles", filter: `id=eq.${user?.id ?? ""}` },
        load
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [user, profile]);

  // Eigene Konto-Salden laden
  useEffect(() => {
    if (!user) return;
    const loadSalden = async () => {
      const [{ data: u }, { data: z }] = await Promise.all([
        supabase
          .from("v_urlaubs_saldo" as any)
          .select("saldo_tage")
          .eq("mitarbeiter_id", user.id)
          .maybeSingle(),
        supabase
          .from("v_za_saldo" as any)
          .select("saldo_stunden")
          .eq("mitarbeiter_id", user.id)
          .maybeSingle(),
      ]);
      setUrlaubsSaldo(u ? Number((u as any).saldo_tage ?? 0) : 0);
      setZaSaldo(z ? Number((z as any).saldo_stunden ?? 0) : 0);
    };
    loadSalden();
    const ch = supabase
      .channel("mein-konten")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "urlaubs_buchungen", filter: `mitarbeiter_id=eq.${user.id}` },
        loadSalden
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "za_buchungen", filter: `mitarbeiter_id=eq.${user.id}` },
        loadSalden
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [user]);

  if (loading) {
    return <div className="text-sm text-muted-foreground">Lädt…</div>;
  }

  if (!profile?.partie_id) {
    return (
      <div className="space-y-4">
        <PageHeader title="Mein Tag" />
        <Card>
          <CardContent className="p-6 text-center space-y-2">
            <Users className="h-10 w-10 mx-auto text-muted-foreground" />
            <div className="text-sm">
              Du bist noch keiner Partie zugeordnet. Bitte wende dich ans Büro.
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const today = new Date();
  const fmtDate = today.toLocaleDateString("de-AT", {
    weekday: "long",
    day: "2-digit",
    month: "long",
  });

  return (
    <div className="space-y-4">
      <PageHeader
        title={`Hallo ${profile.vorname}!`}
        description={fmtDate}
      />

      {/* Partie-Banner */}
      {partie && (
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div
              className="h-12 w-12 rounded-md flex items-center justify-center text-white font-bold shrink-0"
              style={{ background: partie.farbcode }}
            >
              <Users className="h-6 w-6" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Deine Partie
              </div>
              <div className="font-bold">{partie.name}</div>
              {colleagues.length > 0 && (
                <div className="text-xs text-muted-foreground truncate">
                  mit {colleagues.map((c) => c.vorname).join(", ")}
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Aktuelle Baustellen der Partie */}
      <div>
        <h2 className="text-sm font-semibold mb-2 px-1">
          Aktuelle Baustelle{baustellen.length === 1 ? "" : "n"}
        </h2>
        {baustellen.length === 0 ? (
          <Card>
            <CardContent className="p-6 text-center text-sm text-muted-foreground">
              Aktuell keine Baustelle für deine Partie geplant.
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {baustellen.map((b) => {
              const adresse = [b.baustellen_adresse, b.plz, b.ort].filter(Boolean).join(", ");
              const mapsUrl = adresse
                ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(adresse)}`
                : null;
              return (
                <Card key={b.id} className="overflow-hidden">
                  <div
                    className="h-1.5"
                    style={{ background: partie?.farbcode ?? "#999" }}
                  />
                  <CardContent className="p-4 space-y-3">
                    <div>
                      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                        Baustelle
                      </div>
                      <div className="font-bold text-lg flex items-start gap-2">
                        <Building2 className="h-5 w-5 text-primary mt-0.5 shrink-0" />
                        <span>{b.bvh_name}</span>
                      </div>
                      {b.kostenstelle && (
                        <div className="text-xs text-muted-foreground ml-7">
                          {b.kostenstelle}
                        </div>
                      )}
                    </div>

                    {adresse && (
                      <div className="flex items-center gap-2 text-sm bg-muted/40 rounded-md px-3 py-2">
                        <MapPin className="h-4 w-4 text-muted-foreground shrink-0" />
                        <span className="flex-1 truncate">{adresse}</span>
                        {mapsUrl && (
                          <a
                            href={mapsUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="text-primary text-xs hover:underline inline-flex items-center gap-1 shrink-0"
                          >
                            <Navigation className="h-3.5 w-3.5" />
                            Navigieren
                          </a>
                        )}
                      </div>
                    )}

                    {b.start_datum && (
                      <div className="text-xs text-muted-foreground">
                        Zeitraum: {new Date(b.start_datum).toLocaleDateString("de-AT")} →{" "}
                        {b.end_datum
                          ? new Date(b.end_datum).toLocaleDateString("de-AT")
                          : "offen"}
                      </div>
                    )}

                    <div className="flex gap-2 pt-1">
                      <Link to={`/baustellen/${b.id}`} className="flex-1">
                        <Button variant="outline" className="w-full h-12 text-sm">
                          Baustellen-Details
                        </Button>
                      </Link>
                      <Link to="/stunden" className="flex-1">
                        <Button className="w-full h-12 text-sm">
                          <ClockIcon className="h-4 w-4 mr-1.5" /> Stunden buchen
                        </Button>
                      </Link>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}

        {/* Meine Konto-Salden */}
        <div className="grid grid-cols-2 gap-2 sm:gap-3">
          <Card className="border-amber-200 bg-amber-50">
            <CardContent className="p-3">
              <div className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-amber-900 font-semibold">
                <Sun className="h-3.5 w-3.5" />
                Urlaub
              </div>
              <div className="text-2xl font-bold tabular-nums text-amber-900 mt-1">
                {urlaubsSaldo == null ? "—" : fmtTage(urlaubsSaldo)}
              </div>
              <div className="text-[10px] text-amber-800/70 mt-0.5">
                Aktueller Saldo
              </div>
            </CardContent>
          </Card>
          <Card className="border-sky-200 bg-sky-50">
            <CardContent className="p-3">
              <div className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-sky-900 font-semibold">
                <Hourglass className="h-3.5 w-3.5" />
                Zeitausgleich
              </div>
              <div
                className={`text-2xl font-bold tabular-nums mt-1 ${
                  zaSaldo != null && zaSaldo < 0
                    ? "text-red-700"
                    : "text-sky-900"
                }`}
              >
                {zaSaldo == null ? "—" : fmtStunden(zaSaldo)}
              </div>
              <div className="text-[10px] text-sky-800/70 mt-0.5">
                Aktueller Saldo
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
