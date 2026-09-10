import { useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Send, Phone, Mail, Loader2, CheckCircle2, Search } from "lucide-react";
import { normalizeAtPhone } from "@/lib/phone";
import {
  CredentialsResultDialog,
} from "@/components/admin/CredentialsResultDialog";
import type { CredentialsResult } from "@/components/admin/NewMitarbeiterDialog";

type Row = {
  id: string;
  vorname: string;
  nachname: string;
  telefon: string | null;
  email: string | null;
  letzte_einladung: string | null;
  /** false = hat sich selbst registriert → Versand setzt sein Passwort zurück. */
  angelegt_manuell: boolean;
};

type Kanal = "sms" | "email" | "beide";
type Filter = "offen" | "alle";

/** Import-Platzhalter (…@willroider.invalid) sind keine echten Adressen. */
const hatEchteMail = (email: string | null) =>
  !!email && !email.endsWith("@willroider.invalid");

const ziffern = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "");

export function AdminZugangVerschicken() {
  const { toast } = useToast();
  const { hasPermission } = useAuth();
  const canSend = hasPermission("mitarbeiter.einladung_resend");

  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [phoneEdits, setPhoneEdits] = useState<Record<string, string>>({});
  const [sending, setSending] = useState<string | null>(null);
  const [kanalWahl, setKanalWahl] = useState<Record<string, Kanal>>({});
  const [credentials, setCredentials] = useState<CredentialsResult | null>(null);
  const [suche, setSuche] = useState("");
  const [filter, setFilter] = useState<Filter>("offen");

  const load = async () => {
    setLoading(true);
    // Profile + letzte gesendete Einladung. Zwei Queries, weil
    // wir das letzte gesendete Datum pro Profil brauchen.
    const { data: profileRows, error: profErr } = await supabase
      .from("profiles")
      .select("id, vorname, nachname, telefon, email, angelegt_manuell")
      .eq("is_active", true)
      .order("nachname");
    if (profErr) {
      // Ohne diesen Check zeigte ein Query-Fehler "Keine Mitarbeiter
      // gefunden" — falsche Aussage statt Fehlermeldung.
      toast({
        variant: "destructive",
        title: "Laden fehlgeschlagen",
        description: profErr.message,
      });
      setLoading(false);
      return;
    }

    const { data: logRows } = await supabase
      .from("invitation_logs")
      .select("profile_id, gesendet_am, status")
      .eq("status", "gesendet")
      .order("gesendet_am", { ascending: false });

    const letzte = new Map<string, string>();
    (logRows ?? []).forEach((l: any) => {
      if (l.profile_id && !letzte.has(l.profile_id)) {
        letzte.set(l.profile_id, l.gesendet_am);
      }
    });

    const list: Row[] = (profileRows ?? []).map((p: any) => ({
      id: p.id,
      vorname: p.vorname,
      nachname: p.nachname,
      telefon: p.telefon,
      email: p.email,
      letzte_einladung: letzte.get(p.id) ?? null,
      angelegt_manuell: p.angelegt_manuell === true,
    }));

    setRows(list);
    setLoading(false);
  };

  useEffect(() => {
    void load();
  }, []);

  /** Eine Zeile nach dem Versand lokal nachziehen — kein Komplett-Reload,
   *  der beim Durcharbeiten von 30 Leuten jedes Mal nach oben springt. */
  const patchRow = (id: string, patch: Partial<Row>) =>
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  const offen = useMemo(() => rows.filter((r) => !r.letzte_einladung), [rows]);

  /** Sortierung: noch nie verschickt zuerst, dann nach Datum aufsteigend
   *  (älteste Einladung oben), dann Alphabet. */
  const sorted = useMemo(() => {
    const q = suche.trim().toLowerCase();
    return [...rows]
      .filter((r) => (filter === "offen" ? !r.letzte_einladung : true))
      .filter((r) =>
        q
          ? `${r.vorname} ${r.nachname} ${r.telefon ?? ""} ${r.email ?? ""}`
              .toLowerCase()
              .includes(q)
          : true,
      )
      .sort((a, b) => {
        if (!a.letzte_einladung && b.letzte_einladung) return -1;
        if (a.letzte_einladung && !b.letzte_einladung) return 1;
        if (a.letzte_einladung && b.letzte_einladung) {
          return a.letzte_einladung.localeCompare(b.letzte_einladung);
        }
        return (a.nachname ?? "").localeCompare(b.nachname ?? "");
      });
  }, [rows, suche, filter]);

  /** Eingetippte Nummer der Zeile, normalisiert — oder null. */
  const getippteNummer = (row: Row): string | null => {
    const raw = phoneEdits[row.id];
    return raw?.trim() ? normalizeAtPhone(raw) : null;
  };

  /** Nummer, mit der verschickt würde: eingetippt schlägt gespeichert. */
  const nummerFuer = (row: Row): string | null => getippteNummer(row) ?? row.telefon;

  /** Gehört die Nummer schon jemand anderem? Alle aktiven Profile sind
   *  geladen, also lässt sich das vor dem Versand sagen — mit Namen,
   *  statt nach dem Klick ein „Supabase-Fehler oder vergeben". */
  const nummerBelegtVon = (row: Row, nummer: string): Row | undefined =>
    rows.find((r) => r.id !== row.id && ziffern(r.telefon) === ziffern(nummer));

  /** Welcher Kanal ist für die Zeile gewählt bzw. sinnvoll vorbelegt? */
  const kanalFuer = (row: Row): Kanal => {
    const gewaehlt = kanalWahl[row.id];
    if (gewaehlt) return gewaehlt;
    if (nummerFuer(row)) return "sms";
    if (hatEchteMail(row.email)) return "email";
    return "sms";
  };

  /** Nummer nur hinterlegen, ohne Einladung — über die Function, damit
   *  sie auch am Anmeldekonto landet (nur ins Profil schreiben ließ am
   *  04.09. Leute mit einer Nummer stehen, mit der sie nicht reinkamen). */
  const nurSpeichern = async (row: Row) => {
    const nummer = getippteNummer(row);
    if (!nummer) return;
    const belegt = nummerBelegtVon(row, nummer);
    if (belegt) {
      toast({
        variant: "destructive",
        title: "Nummer schon vergeben",
        description: `${nummer} gehört bereits zu ${belegt.vorname} ${belegt.nachname}.`,
      });
      return;
    }
    setSending(row.id);
    const { data, error } = await supabase.functions.invoke("admin-update-email", {
      body: { profile_id: row.id, telefon: nummer, telefon_auch_login: true },
    });
    setSending(null);
    const fehler = error?.message ?? (data as any)?.error;
    if (fehler) {
      toast({ variant: "destructive", title: "Speichern fehlgeschlagen", description: fehler });
      return;
    }
    patchRow(row.id, { telefon: (data as any)?.telefon ?? nummer });
    setPhoneEdits((prev) => {
      const next = { ...prev };
      delete next[row.id];
      return next;
    });
    toast({
      title: "Anmeldenummer gespeichert",
      description: `${row.vorname} ${row.nachname} kann sich ab jetzt mit ${nummer} per SMS-Code anmelden.`,
    });
  };

  const sendZugang = async (row: Row) => {
    const kanal = kanalFuer(row);
    const perSms = kanal === "sms" || kanal === "beide";
    const perMail = kanal === "email" || kanal === "beide";
    const nummer = nummerFuer(row);
    if (perSms && !nummer) return;
    if (perMail && !hatEchteMail(row.email)) return;

    // Frisch eingetippte Nummer vor dem Versand gegen die Kollegen prüfen.
    const getippt = getippteNummer(row);
    if (getippt) {
      const belegt = nummerBelegtVon(row, getippt);
      if (belegt) {
        toast({
          variant: "destructive",
          title: "Nummer schon vergeben",
          description: `${getippt} gehört bereits zu ${belegt.vorname} ${belegt.nachname}. Bitte dort „Erneut senden" verwenden.`,
        });
        return;
      }
    }

    const ziel = [perSms ? `SMS an ${nummer}` : "", perMail ? `E-Mail an ${row.email}` : ""]
      .filter(Boolean)
      .join(" und ");
    // Rückfrage nur, wenn ein bestehendes Passwort ungültig wird: bei
    // Selbstregistrierten (eigenes Passwort) und beim erneuten Versand.
    // Für die Erst-Einladung eines händisch angelegten Kontos gibt es
    // nichts zu verlieren — da wäre die Abfrage nur ein Klick mehr.
    const sentBefore = !!row.letzte_einladung;
    if (!row.angelegt_manuell) {
      const warnung =
        `ACHTUNG: ${row.vorname} ${row.nachname} hat sich SELBST registriert und ` +
        `arbeitet bereits mit einem eigenen Passwort.\n\n` +
        `Beim Verschicken wird dieses Passwort ZURÜCKGESETZT — die bisherige ` +
        `Anmeldung funktioniert dann nicht mehr. Danach gilt das neue Passwort ` +
        `aus der Nachricht (${ziel}).\n\n` +
        `Wirklich zurücksetzen und senden?`;
      if (!window.confirm(warnung)) return;
    } else if (sentBefore) {
      if (
        !window.confirm(
          `Zugang für ${row.vorname} ${row.nachname} erneut verschicken (${ziel})?\n\n` +
            `Es wird ein NEUES Passwort gesetzt. Das bisherige funktioniert danach nicht mehr.`,
        )
      )
        return;
    }

    setSending(row.id);
    const { data, error } = await supabase.functions.invoke("send-invitation", {
      body: {
        profile_id: row.id,
        kanal,
        // Eingetippte Nummer geht direkt mit — kein separater Speichern-Schritt.
        telefon_override: getippt ?? undefined,
        // Nur nach ausdrücklicher Bestätigung — die Function blockt sonst.
        reset_bestaetigt: !row.angelegt_manuell,
      },
    });
    setSending(null);

    if (error || data?.success === false) {
      const msg = data?.error ?? error?.message ?? "Unbekannter Fehler";
      toast({
        variant: "destructive",
        title: "Versand fehlgeschlagen",
        description: msg,
      });
      // Wenn das Passwort schon gesetzt wurde aber SMS scheiterte, zeigen wir
      // den Dialog trotzdem an, damit der Admin die Daten weitergeben kann.
      if (data?.initial_password) {
        setCredentials({
          user_id: row.id,
          telefon: data.telefon ?? nummer,
          email: row.email,
          initial_password: data.initial_password,
          magic_link: data.magic_link ?? null,
          sms_status: "error",
          sms_error: msg,
          twilio_sid: null,
          vorname: row.vorname,
          nachname: row.nachname,
        });
      }
      return;
    }

    // Zeile nachziehen: Nummer ist jetzt hinterlegt, Einladung ist raus.
    patchRow(row.id, {
      telefon: data.telefon ?? nummer,
      letzte_einladung: new Date().toISOString(),
    });
    setPhoneEdits((prev) => {
      const next = { ...prev };
      delete next[row.id];
      return next;
    });

    const alleRaus =
      (!perSms || data.sms_status === "sent") && (!perMail || data.mail_status === "sent");
    const titel =
      data.mail_status === "sent" && data.sms_status === "sent"
        ? "SMS + E-Mail verschickt"
        : data.mail_status === "sent"
          ? "E-Mail verschickt"
          : "SMS verschickt";
    toast({
      title: titel,
      description:
        `Zugang an ${row.vorname} ${row.nachname} gesendet.` +
        (data.hinweis ? ` ${data.hinweis}` : ""),
    });

    // Das Passwort-Fenster nur, wenn etwas NICHT angekommen ist — dann
    // braucht das Büro die Daten zum Weitersagen. Beim glatten Versand
    // steckt alles in der Nachricht; 30 Fenster nacheinander wegklicken
    // wäre reine Schikane.
    if (!alleRaus) {
      setCredentials({
        user_id: data.user_id ?? row.id,
        telefon: data.telefon ?? nummer,
        email: data.email ?? row.email,
        initial_password: data.initial_password,
        magic_link: data.magic_link ?? null,
        sms_status: data.sms_status ?? "skipped",
        sms_error: data.sms_error ?? null,
        mail_status: data.mail_status ?? "skipped",
        mail_error: data.mail_error ?? null,
        twilio_sid: data.twilio_sid ?? null,
        vorname: data.vorname ?? row.vorname,
        nachname: data.nachname ?? row.nachname,
      });
    }
  };

  if (!canSend) {
    return (
      <Card>
        <CardContent className="p-6 text-sm text-muted-foreground">
          Du hast keine Berechtigung, Einladungen zu verschicken.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      <Card>
        <CardContent className="p-3 flex items-start gap-3">
          <Send className="h-5 w-5 text-primary shrink-0 mt-0.5" />
          <div className="text-sm">
            <div className="font-semibold">Zugang verschicken</div>
            <div className="text-muted-foreground">
              Nummer eintippen, „Per SMS senden" — fertig. Der Mitarbeiter bekommt
              eine SMS mit Anleitung und Passwort und meldet sich ab dann mit seiner
              Nummer per SMS-Code an. Jeder Versand setzt ein neues Passwort.
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex rounded-md border overflow-hidden">
          {(
            [
              { wert: "offen" as Filter, label: `Ohne Zugang (${offen.length})` },
              { wert: "alle" as Filter, label: `Alle (${rows.length})` },
            ]
          ).map((f) => (
            <button
              key={f.wert}
              type="button"
              onClick={() => setFilter(f.wert)}
              className={
                "px-3 h-9 text-xs font-medium transition-colors " +
                (filter === f.wert
                  ? "bg-primary text-primary-foreground"
                  : "bg-background hover:bg-muted")
              }
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="relative flex-1 min-w-[180px]">
          <Search className="h-4 w-4 absolute left-2.5 top-2.5 text-muted-foreground" />
          <Input
            value={suche}
            onChange={(e) => setSuche(e.target.value)}
            placeholder="Name oder Nummer suchen"
            className="h-9 pl-8 text-sm"
          />
        </div>
      </div>

      {loading && (
        <Card>
          <CardContent className="p-6 text-center text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 mr-2 inline animate-spin" />
            Lade Mitarbeiter …
          </CardContent>
        </Card>
      )}

      {!loading && sorted.length === 0 && (
        <Card>
          <CardContent className="p-6 text-center text-sm text-muted-foreground">
            {filter === "offen" && !suche
              ? "Alle aktiven Mitarbeiter haben einen Zugang bekommen."
              : "Niemand gefunden."}
          </CardContent>
        </Card>
      )}

      {sorted.map((row) => {
        const hasMail = hatEchteMail(row.email);
        const getippt = getippteNummer(row);
        const rohEingabe = phoneEdits[row.id] ?? "";
        const eingabeUngueltig = !!rohEingabe.trim() && !getippt;
        const nummer = nummerFuer(row);
        const smsMoeglich = !!nummer;
        const kanal = kanalFuer(row);
        const kanalMoeglich =
          (kanal === "sms" && smsMoeglich) ||
          (kanal === "email" && hasMail) ||
          (kanal === "beide" && smsMoeglich && hasMail);
        const sentBefore = !!row.letzte_einladung;
        const busy = sending === row.id;
        const knopf =
          kanal === "beide"
            ? "SMS + E-Mail senden"
            : kanal === "email"
              ? "Per E-Mail senden"
              : "Per SMS senden";
        return (
          <Card key={row.id}>
            <CardContent className="p-3 space-y-2">
              <div className="flex items-start justify-between gap-2 flex-wrap">
                <div className="min-w-0">
                  <div className="font-semibold text-sm">
                    {row.vorname} {row.nachname}
                  </div>
                  {hasMail && (
                    <div className="text-xs text-muted-foreground truncate">
                      {row.email}
                    </div>
                  )}
                </div>
                {/* Selbst registriert = hat schon ein eigenes Passwort.
                    Deutlich kennzeichnen, damit niemand versehentlich
                    jemandem den laufenden Zugang zurücksetzt. */}
                {!row.angelegt_manuell && (
                  <Badge
                    variant="outline"
                    className="bg-orange-50 text-orange-800 border-orange-300 text-[10px]"
                    title="Hat sich selbst registriert und arbeitet mit einem eigenen Passwort. Ein Versand setzt es zurück."
                  >
                    Selbst registriert
                  </Badge>
                )}
                {sentBefore ? (
                  <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200 text-[10px]">
                    <CheckCircle2 className="h-3 w-3 mr-1" />
                    Bereits am {new Date(row.letzte_einladung!).toLocaleDateString("de-AT")}{" "}
                    {new Date(row.letzte_einladung!).toLocaleTimeString("de-AT", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </Badge>
                ) : (
                  <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200 text-[10px]">
                    Noch kein Zugang
                  </Badge>
                )}
              </div>

              {row.telefon ? (
                <div className="flex items-center gap-2 text-sm">
                  <Phone className="h-4 w-4 text-muted-foreground shrink-0" />
                  <span className="font-mono">{row.telefon}</span>
                </div>
              ) : (
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <Phone className="h-4 w-4 text-muted-foreground shrink-0" />
                    <Input
                      placeholder="Handynummer, z.B. 0664 1234567"
                      value={rohEingabe}
                      onChange={(e) =>
                        setPhoneEdits((prev) => ({ ...prev, [row.id]: e.target.value }))
                      }
                      className={"h-10 text-sm" + (eingabeUngueltig ? " border-destructive" : "")}
                      inputMode="tel"
                      autoComplete="off"
                    />
                  </div>
                  <div className="text-[11px] text-muted-foreground pl-6">
                    {eingabeUngueltig
                      ? "Ungültiges Format — 0664 1234567 oder +43 664 1234567"
                      : getippt
                        ? (
                          <>
                            wird als {getippt} hinterlegt ·{" "}
                            <button
                              type="button"
                              className="text-primary hover:underline"
                              disabled={busy}
                              onClick={() => nurSpeichern(row)}
                            >
                              nur speichern, nicht senden
                            </button>
                          </>
                        )
                        : hasMail
                          ? "Ohne Nummer geht nur E-Mail."
                          : "Ohne Nummer kann sich der Mitarbeiter nicht anmelden."}
                  </div>
                </div>
              )}

              <div className="flex items-center justify-between gap-2 pt-1 flex-wrap">
                {/* Versandweg — nur anbieten, was die Kontaktdaten hergeben. */}
                <div className="flex rounded-md border overflow-hidden">
                  {(
                    [
                      { wert: "sms" as Kanal, label: "SMS", moeglich: smsMoeglich },
                      { wert: "email" as Kanal, label: "E-Mail", moeglich: hasMail },
                      { wert: "beide" as Kanal, label: "Beide", moeglich: smsMoeglich && hasMail },
                    ]
                  ).map((k) => (
                    <button
                      key={k.wert}
                      type="button"
                      disabled={!k.moeglich}
                      onClick={() =>
                        setKanalWahl((prev) => ({ ...prev, [row.id]: k.wert }))
                      }
                      className={
                        "px-3 h-9 text-xs font-medium transition-colors " +
                        (kanal === k.wert && k.moeglich
                          ? "bg-primary text-primary-foreground"
                          : k.moeglich
                            ? "bg-background hover:bg-muted"
                            : "bg-muted text-muted-foreground/40 cursor-not-allowed")
                      }
                      title={
                        k.moeglich
                          ? undefined
                          : k.wert === "email"
                            ? "Keine echte E-Mail-Adresse hinterlegt"
                            : "Zuerst oben die Handynummer eintippen"
                      }
                    >
                      {k.label}
                    </button>
                  ))}
                </div>
                <Button
                  onClick={() => sendZugang(row)}
                  disabled={!kanalMoeglich || busy}
                  className="h-10"
                >
                  {busy ? (
                    <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                  ) : kanal === "email" ? (
                    <Mail className="h-4 w-4 mr-1.5" />
                  ) : (
                    <Send className="h-4 w-4 mr-1.5" />
                  )}
                  {sentBefore ? "Erneut senden" : knopf}
                </Button>
              </div>
            </CardContent>
          </Card>
        );
      })}

      <CredentialsResultDialog
        result={credentials}
        onClose={() => setCredentials(null)}
      />
    </div>
  );
}
