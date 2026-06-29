import { useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Send, Phone, Loader2, AlertCircle, CheckCircle2 } from "lucide-react";
import { normalizeAtPhone, isValidAtPhone } from "@/lib/phone";
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
};

export function AdminZugangVerschicken() {
  const { toast } = useToast();
  const { hasPermission } = useAuth();
  const canSend = hasPermission("mitarbeiter.einladung_resend");

  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [phoneEdits, setPhoneEdits] = useState<Record<string, string>>({});
  const [savingPhone, setSavingPhone] = useState<string | null>(null);
  const [sending, setSending] = useState<string | null>(null);
  const [credentials, setCredentials] = useState<CredentialsResult | null>(null);

  const load = async () => {
    setLoading(true);
    // Profile + letzte gesendete Einladung. Zwei Queries, weil
    // wir das letzte gesendete Datum pro Profil brauchen.
    const { data: profileRows } = await supabase
      .from("profiles")
      .select("id, vorname, nachname, telefon, email")
      .eq("angelegt_manuell", true)
      .eq("is_active", true)
      .order("nachname");

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
    }));

    setRows(list);
    setLoading(false);
  };

  useEffect(() => {
    void load();
  }, []);

  /** Sortierung: noch nie verschickt zuerst, dann nach Datum aufsteigend
   *  (älteste Einladung oben), dann Alphabet. */
  const sorted = useMemo(() => {
    return [...rows].sort((a, b) => {
      if (!a.letzte_einladung && b.letzte_einladung) return -1;
      if (a.letzte_einladung && !b.letzte_einladung) return 1;
      if (a.letzte_einladung && b.letzte_einladung) {
        return a.letzte_einladung.localeCompare(b.letzte_einladung);
      }
      return (a.nachname ?? "").localeCompare(b.nachname ?? "");
    });
  }, [rows]);

  const savePhone = async (row: Row) => {
    const raw = phoneEdits[row.id] ?? "";
    const normalized = normalizeAtPhone(raw);
    if (!normalized) {
      toast({
        variant: "destructive",
        title: "Ungültige Telefonnummer",
        description: "Bitte im Format 0664 1234567 oder +43 664 1234567 eingeben.",
      });
      return;
    }
    setSavingPhone(row.id);
    const { error } = await supabase
      .from("profiles")
      .update({ telefon: normalized })
      .eq("id", row.id);
    setSavingPhone(null);
    if (error) {
      toast({
        variant: "destructive",
        title: "Speichern fehlgeschlagen",
        description: error.message,
      });
      return;
    }
    setPhoneEdits((prev) => {
      const next = { ...prev };
      delete next[row.id];
      return next;
    });
    await load();
    toast({ title: "Telefonnummer gespeichert", description: normalized });
  };

  const sendZugang = async (row: Row) => {
    if (!row.telefon) return;
    if (
      !window.confirm(
        `SMS an ${row.vorname} ${row.nachname} (${row.telefon}) verschicken?\n\n` +
          `Es wird ein NEUES Initial-Passwort generiert. Frühere Passwörter funktionieren danach nicht mehr.`,
      )
    ) {
      return;
    }
    setSending(row.id);
    const { data, error } = await supabase.functions.invoke("send-invitation", {
      body: { profile_id: row.id },
    });
    setSending(null);

    if (error || data?.success === false) {
      const msg = data?.error ?? error?.message ?? "Unbekannter Fehler";
      toast({
        variant: "destructive",
        title: "SMS-Versand fehlgeschlagen",
        description: msg,
      });
      // Wenn das Passwort schon gesetzt wurde aber SMS scheiterte, zeigen wir
      // den Dialog trotzdem an, damit der Admin die Daten weitergeben kann.
      if (data?.initial_password) {
        setCredentials({
          user_id: row.id,
          telefon: row.telefon,
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

    setCredentials({
      user_id: data.user_id ?? row.id,
      telefon: data.telefon ?? row.telefon,
      email: data.email ?? row.email,
      initial_password: data.initial_password,
      magic_link: data.magic_link ?? null,
      sms_status: data.sms_status ?? "sent",
      sms_error: data.sms_error ?? null,
      twilio_sid: data.twilio_sid ?? null,
      vorname: data.vorname ?? row.vorname,
      nachname: data.nachname ?? row.nachname,
    });

    toast({
      title: "SMS verschickt",
      description: `Zugang an ${row.vorname} ${row.nachname} gesendet.`,
    });
    void load();
  };

  if (!canSend) {
    return (
      <Card>
        <CardContent className="p-6 text-sm text-muted-foreground">
          Du hast keine Berechtigung, SMS-Einladungen zu verschicken.
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
            <div className="font-semibold">Zugang per SMS verschicken</div>
            <div className="text-muted-foreground">
              Nur manuell angelegte Mitarbeiter. Pro Klick wird ein neues Initial-Passwort
              gesetzt und per SMS verschickt. Bestehende Logins funktionieren danach nicht
              mehr — selbst-registrierte Mitarbeiter werden absichtlich nicht angezeigt.
            </div>
          </div>
        </CardContent>
      </Card>

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
            Keine manuell angelegten Mitarbeiter gefunden.
          </CardContent>
        </Card>
      )}

      {sorted.map((row) => {
        const hasPhone = !!row.telefon;
        const edit = phoneEdits[row.id];
        const editIsValid = edit ? isValidAtPhone(edit) : false;
        const sentBefore = !!row.letzte_einladung;
        return (
          <Card key={row.id}>
            <CardContent className="p-3 space-y-2">
              <div className="flex items-start justify-between gap-2 flex-wrap">
                <div className="min-w-0">
                  <div className="font-semibold text-sm">
                    {row.vorname} {row.nachname}
                  </div>
                  {row.email && (
                    <div className="text-xs text-muted-foreground truncate">
                      {row.email}
                    </div>
                  )}
                </div>
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
                    Noch nie verschickt
                  </Badge>
                )}
              </div>

              {hasPhone ? (
                <div className="flex items-center gap-2 text-sm">
                  <Phone className="h-4 w-4 text-muted-foreground shrink-0" />
                  <span className="font-mono">{row.telefon}</span>
                </div>
              ) : (
                <div className="space-y-1.5">
                  <div className="flex items-center gap-1.5 text-xs text-amber-700">
                    <AlertCircle className="h-3.5 w-3.5" />
                    Telefonnummer fehlt
                  </div>
                  <div className="flex gap-2">
                    <Input
                      placeholder="+43 664 1234567"
                      value={edit ?? ""}
                      onChange={(e) =>
                        setPhoneEdits((prev) => ({ ...prev, [row.id]: e.target.value }))
                      }
                      className="h-10 text-sm"
                      inputMode="tel"
                    />
                    <Button
                      onClick={() => savePhone(row)}
                      disabled={!editIsValid || savingPhone === row.id}
                      size="sm"
                      variant="outline"
                      className="h-10"
                    >
                      {savingPhone === row.id && (
                        <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                      )}
                      Speichern
                    </Button>
                  </div>
                </div>
              )}

              <div className="flex justify-end pt-1">
                <Button
                  onClick={() => sendZugang(row)}
                  disabled={!hasPhone || sending === row.id}
                  className="h-10"
                >
                  {sending === row.id ? (
                    <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4 mr-1.5" />
                  )}
                  {sentBefore ? "Erneut senden" : "Zugang senden"}
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
