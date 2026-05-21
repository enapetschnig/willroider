import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import {
  Building2,
  MapPin,
  Navigation,
  Clock as ClockIcon,
  Users,
  Sun,
  Hourglass,
  Loader2,
  Phone,
  Camera,
  Truck,
  FileText,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { findeOderErstelleBerichtMitVorausfuellung } from "@/hooks/useBericht";
import { werktagePlus } from "@/lib/feiertage";
import { UrlaubAntraegeCard } from "@/components/UrlaubAntragDialog";
import { KrankmeldungenCard } from "@/components/MeinTag/KrankmeldungenCard";
import { LohnzettelCard } from "@/components/MeinTag/LohnzettelCard";
import { TagesplanPreview } from "@/components/TagesplanPreview";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { Database } from "@/integrations/supabase/types";
import { localIso } from "@/lib/dateFmt";
import { fmtStunden, fmtTage } from "@/lib/konten";
import { useToast } from "@/hooks/use-toast";

type Baustelle = Database["public"]["Tables"]["baustellen"]["Row"];
type Partie = Database["public"]["Tables"]["partien"]["Row"];

/**
 * Heute-Karte: zeigt dem MA seine konkrete heutige Einteilung
 * (Baustelle, Fahrzeug, Polier) — fallback auf den letzten freigegebenen Tag.
 *
 * UI-Prinzip: Der MA sieht nur seine Einteilung, NICHT den Workflow-Status
 * (freigegeben/in Bearbeitung). Wenn nichts da ist → Card erscheint nicht.
 */
function HeuteEinteilungCard({ userId }: { userId: string }) {
  const { toast } = useToast();
  const navigate = useNavigate();
  const today = localIso();
  const [loading, setLoading] = useState(true);
  const [planOpen, setPlanOpen] = useState(false);
  const [data, setData] = useState<{
    datum: string;
    isToday: boolean;
    baustelle: Baustelle | null;
    taetigkeit: string | null;
    abfahrtszeit: string | null;
    treffpunkt: string | null;
    fahrzeuge: { kennzeichen: string }[];
    polier: { vorname: string; nachname: string; telefon: string | null } | null;
    einteilungId: string | null;
  } | null>(null);

  const lade = async () => {
    setLoading(true);
    // Strategie: erst heute, sonst letzten freigegebenen Tag suchen
    const datumKandidaten: string[] = [today];
    const { data: letzte } = await supabase
      .from("tagesplanung_freigaben")
      .select("datum")
      .lte("datum", today)
      .order("datum", { ascending: false })
      .limit(3);
    (letzte ?? []).forEach((r: any) => {
      if (!datumKandidaten.includes(r.datum)) datumKandidaten.push(r.datum);
    });

    for (const datum of datumKandidaten) {
      const { data: frei } = await supabase
        .from("tagesplanung_freigaben")
        .select("datum")
        .eq("datum", datum)
        .maybeSingle();
      if (datum !== today && !frei) continue;

      const { data: ems } = await supabase
        .from("einteilung_mitarbeiter")
        .select("id, einteilung_id, einteilung:einteilungen!inner(datum,baustelle_id,taetigkeit,abfahrtszeit,treffpunkt)")
        .eq("mitarbeiter_id", userId)
        .eq("einteilung.datum", datum);
      if (!ems || ems.length === 0) {
        // an diesem Tag keine Einteilung für den MA → nächsten Kandidat
        if (datum === today) {
          // heute keine Einteilung, aber heute IST der Tag → trotzdem Ergebnis zurück
          setData({
            datum,
            isToday: true,
            baustelle: null,
            taetigkeit: null,
            abfahrtszeit: null,
            treffpunkt: null,
            fahrzeuge: [],
            polier: null,
            einteilungId: null,
          });
          setLoading(false);
          return;
        }
        continue;
      }
      const em = ems[0] as any;
      const einteilung = em.einteilung;
      const [{ data: bs }, { data: efs }] = await Promise.all([
        einteilung.baustelle_id
          ? supabase.from("baustellen").select("*").eq("id", einteilung.baustelle_id).maybeSingle()
          : Promise.resolve({ data: null }),
        supabase
          .from("einteilung_fahrzeuge")
          .select("fahrzeug:fahrzeuge(kennzeichen)")
          .eq("einteilung_id", em.einteilung_id),
      ]);
      const baustelle = (bs as Baustelle) ?? null;
      let polier: { vorname: string; nachname: string; telefon: string | null } | null = null;
      if (baustelle?.partie_id) {
        const { data: p } = await supabase
          .from("partien")
          .select("partieleiter:profiles!partien_partieleiter_id_fkey(vorname,nachname,telefon)")
          .eq("id", baustelle.partie_id)
          .maybeSingle();
        polier = ((p as any)?.partieleiter as any) ?? null;
      }
      setData({
        datum,
        isToday: datum === today,
        baustelle,
        taetigkeit: einteilung.taetigkeit,
        abfahrtszeit: einteilung.abfahrtszeit,
        treffpunkt: einteilung.treffpunkt,
        fahrzeuge: (efs ?? []).map((e: any) => e.fahrzeug).filter(Boolean),
        polier,
        einteilungId: em.einteilung_id,
      });
      setLoading(false);
      return;
    }
    setData(null);
    setLoading(false);
  };

  useEffect(() => {
    lade();
    const channel = supabase
      .channel(`mein-tag-heute-${userId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "tagesplanung_freigaben" },
        () => lade(),
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "einteilung_mitarbeiter",
          filter: `mitarbeiter_id=eq.${userId}`,
        },
        () => lade(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  if (loading) {
    return (
      <Card>
        <CardContent className="p-6 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Lade heutige Einteilung…
        </CardContent>
      </Card>
    );
  }

  // Wenn weder heute noch ein letzter freigegebener Tag eine Einteilung
  // liefert, zeigen wir gar nichts — der MA sieht nur Begrüßung + Vorschau.
  if (!data) return null;

  const fotoUpload = async () => {
    if (!data.baustelle) return;
    try {
      const r = await findeOderErstelleBerichtMitVorausfuellung(
        data.baustelle.id,
        today,
        "bautagesbericht",
      );
      navigate(`/berichte/${r.id}`);
    } catch (e) {
      toast({ variant: "destructive", title: "Fehler", description: (e as Error).message });
    }
  };

  const mapsUrl = data.baustelle
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
        [data.baustelle.baustellen_adresse, data.baustelle.plz, data.baustelle.ort]
          .filter(Boolean)
          .join(", "),
      )}`
    : null;

  return (
    <Card className="border-primary/30 bg-primary/5">
      <CardContent className="p-4 space-y-3">
        <div className="text-xs uppercase tracking-wide text-primary font-semibold">
          {data.isToday ? "Heute" : `Plan vom ${data.datum}`}
        </div>

        {data.baustelle ? (
          <>
            <div className="flex items-start gap-2">
              <Building2 className="h-5 w-5 text-primary shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <div className="text-base font-bold leading-tight">
                  {data.baustelle.bvh_name}
                </div>
                {data.baustelle.kostenstelle && (
                  <div className="text-[11px] text-muted-foreground">
                    KS {data.baustelle.kostenstelle}
                  </div>
                )}
              </div>
            </div>
            {data.taetigkeit && (
              <div className="text-sm italic pl-7">{data.taetigkeit}</div>
            )}
            <div className="grid grid-cols-2 gap-2 pl-7 text-sm">
              {data.fahrzeuge.length > 0 && (
                <div className="flex items-center gap-1.5">
                  <Truck className="h-4 w-4 text-muted-foreground shrink-0" />
                  <span className="font-medium">
                    {data.fahrzeuge.map((f) => f.kennzeichen).join(", ")}
                  </span>
                </div>
              )}
              {data.abfahrtszeit && (
                <div className="flex items-center gap-1.5">
                  <ClockIcon className="h-4 w-4 text-muted-foreground shrink-0" />
                  <span className="font-medium">Ab {data.abfahrtszeit.slice(0, 5)}</span>
                </div>
              )}
              {data.treffpunkt && (
                <div className="flex items-center gap-1.5 col-span-2">
                  <MapPin className="h-4 w-4 text-muted-foreground shrink-0" />
                  <span>{data.treffpunkt}</span>
                </div>
              )}
            </div>

            {data.polier && (
              <div className="border-t border-primary/15 pt-2 flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-1.5 text-sm">
                  <Users className="h-4 w-4 text-muted-foreground shrink-0" />
                  <span>
                    Polier:{" "}
                    <span className="font-medium">
                      {data.polier.vorname} {data.polier.nachname}
                    </span>
                  </span>
                </div>
                {data.polier.telefon && (
                  <a
                    href={`tel:${data.polier.telefon}`}
                    className="inline-flex items-center gap-1 text-sm bg-primary text-primary-foreground px-3 py-1.5 rounded-md font-medium hover:opacity-90"
                  >
                    <Phone className="h-4 w-4" /> Anrufen
                  </a>
                )}
              </div>
            )}

            <div className="flex gap-2 flex-wrap pt-1">
              {mapsUrl && (
                <a
                  href={mapsUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 text-sm bg-background border rounded-md px-3 py-1.5 hover:bg-muted"
                >
                  <Navigation className="h-4 w-4" /> In Maps öffnen
                </a>
              )}
              <button
                type="button"
                onClick={() => setPlanOpen(true)}
                className="inline-flex items-center gap-1.5 text-sm bg-background border rounded-md px-3 py-1.5 hover:bg-muted"
              >
                <FileText className="h-4 w-4" /> Tagesplan ansehen
              </button>
              <button
                type="button"
                onClick={fotoUpload}
                className="inline-flex items-center gap-1.5 text-sm bg-background border rounded-md px-3 py-1.5 hover:bg-muted"
              >
                <Camera className="h-4 w-4" /> Foto hochladen
              </button>
            </div>

          </>
        ) : (
          <div className="text-sm text-muted-foreground italic">
            Heute keine Baustellen-Einteilung. Verwaltung kontaktieren.
          </div>
        )}
      </CardContent>

      {/* Tagesplan-Vorschau im Word-Layout — live aus der Tagesplanung */}
      <Dialog open={planOpen} onOpenChange={setPlanOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Tagesplan</DialogTitle>
          </DialogHeader>
          <TagesplanPreview datum={data.datum} />
        </DialogContent>
      </Dialog>
    </Card>
  );
}

/** Nächste 7 Werktage — Kompakt-Liste der freigegebenen Einteilungen. */
function VorschauCard({ userId }: { userId: string }) {
  const [eintraege, setEintraege] = useState<
    { datum: string; isFreigegeben: boolean; bvh: string | null; taetigkeit: string | null }[]
  >([]);
  const [loading, setLoading] = useState(true);

  const lade = async () => {
    setLoading(true);
    const today = localIso();
    const tage = werktagePlus(today, 7);
    const von = tage[0];
    const bis = tage[tage.length - 1];

    const [{ data: frei }, { data: ems }] = await Promise.all([
      supabase.from("tagesplanung_freigaben").select("datum").gte("datum", von).lte("datum", bis),
      supabase
        .from("einteilung_mitarbeiter")
        .select(
          "einteilung:einteilungen!inner(datum,taetigkeit,baustelle:baustellen(bvh_name))",
        )
        .eq("mitarbeiter_id", userId)
        .gte("einteilung.datum", von)
        .lte("einteilung.datum", bis),
    ]);

    const freiSet = new Set((frei ?? []).map((r: any) => r.datum));
    const emByDate = new Map<string, { bvh: string | null; taetigkeit: string | null }>();
    (ems ?? []).forEach((e: any) => {
      const ei = e.einteilung;
      if (!ei) return;
      emByDate.set(ei.datum, {
        bvh: ei.baustelle?.bvh_name ?? null,
        taetigkeit: ei.taetigkeit ?? null,
      });
    });

    const result = tage
      .filter((t) => t !== today) // Heute zeigt die HeuteEinteilungCard
      .map((datum) => ({
        datum,
        bvh: emByDate.get(datum)?.bvh ?? null,
        taetigkeit: emByDate.get(datum)?.taetigkeit ?? null,
        isFreigegeben: freiSet.has(datum),
      }))
      // Nur freigegebene Tage mit Einteilung zeigen — der MA soll
      // den Freigabe-Workflow gar nicht mitkriegen.
      .filter((e) => e.isFreigegeben && e.bvh)
      .slice(0, 7);

    setEintraege(result);
    setLoading(false);
  };

  useEffect(() => {
    lade();
    const channel = supabase
      .channel("mein-tag-vorschau")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "tagesplanung_freigaben" },
        () => lade(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  if (loading || eintraege.length === 0) return null;

  return (
    <Card>
      <CardContent className="p-4 space-y-2">
        <div className="text-xs font-semibold uppercase text-muted-foreground">
          Nächste 7 Tage
        </div>
        <div className="space-y-1.5">
          {eintraege.map((e) => {
            const d = new Date(e.datum + "T00:00:00");
            const dStr = d.toLocaleDateString("de-AT", {
              weekday: "short",
              day: "2-digit",
              month: "2-digit",
            });
            return (
              <div
                key={e.datum}
                className="flex items-center gap-2 text-sm px-2 py-1.5 rounded bg-muted/30"
              >
                <span className="font-bold tabular-nums w-20 shrink-0">{dStr}</span>
                <span className="flex-1 truncate font-medium">{e.bvh}</span>
                {e.taetigkeit && (
                  <span className="text-xs italic text-muted-foreground truncate">
                    {e.taetigkeit}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

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

      {/* Heutige Einteilung aus Tagesplanung */}
      <HeuteEinteilungCard userId={user!.id} />

      {/* Nächste Tage */}
      <VorschauCard userId={user!.id} />

      {/* Urlaubsanträge */}
      <UrlaubAntraegeCard userId={user!.id} />

      {/* Krankmeldungen */}
      <KrankmeldungenCard userId={user!.id} />

      {/* Lohnzettel */}
      <LohnzettelCard userId={user!.id} />

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
