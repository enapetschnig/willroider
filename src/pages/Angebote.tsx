import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { localIso } from "@/lib/dateFmt";
import {
  Plus,
  Search,
  AlertTriangle,
  Upload as UploadIcon,
  Briefcase,
  Calendar,
  ChevronRight,
  Filter,
} from "lucide-react";
import type { AngebotStatus, Database } from "@/integrations/supabase/types";
import { AngebotExcelImport } from "@/components/AngebotExcelImport";

type Angebot = Database["public"]["Tables"]["angebote"]["Row"];

type DupHit = {
  source: string;
  id: string;
  name: string;
  bauherr_match: string | null;
  adresse_match: string | null;
  status: string;
  score: number;
};

const STATUS_LABEL: Record<AngebotStatus, string> = {
  offen: "Offen",
  in_verhandlung: "In Verhandlung",
  angenommen: "Angenommen",
  abgelehnt: "Abgelehnt",
  zurueckgezogen: "Zurückgezogen",
};

const STATUS_COLOR: Record<AngebotStatus, string> = {
  offen: "bg-sky-100 text-sky-900 border-sky-300",
  in_verhandlung: "bg-amber-100 text-amber-900 border-amber-300",
  angenommen: "bg-emerald-100 text-emerald-900 border-emerald-300",
  abgelehnt: "bg-red-100 text-red-900 border-red-300",
  zurueckgezogen: "bg-muted text-muted-foreground border-border",
};

const fmtEuro = (v: number | null | undefined) =>
  v == null
    ? "—"
    : new Intl.NumberFormat("de-AT", {
        style: "currency",
        currency: "EUR",
        maximumFractionDigits: 0,
      }).format(Number(v));

export default function Angebote() {
  const { toast } = useToast();
  const { isAdmin } = useAuth();
  const [rows, setRows] = useState<Angebot[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<AngebotStatus | "alle" | "faellig">(
    "alle"
  );
  const [createOpen, setCreateOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("angebote")
      .select("*")
      .order("datum_angebot", { ascending: false });
    if (error) {
      toast({ variant: "destructive", title: "Fehler", description: error.message });
      setLoading(false);
      return;
    }
    setRows((data as Angebot[]) ?? []);
    setLoading(false);
  };

  useEffect(() => {
    if (!isAdmin) return;
    load();
  }, [isAdmin]);

  const today = localIso();

  const stats = useMemo(() => {
    return {
      offen: rows.filter((r) => r.status === "offen").length,
      in_verhandlung: rows.filter((r) => r.status === "in_verhandlung").length,
      faellig: rows.filter(
        (r) =>
          (r.status === "offen" || r.status === "in_verhandlung") &&
          r.naechste_nachfrage &&
          r.naechste_nachfrage <= today
      ).length,
      angenommen: rows.filter((r) => r.status === "angenommen").length,
    };
  }, [rows, today]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (statusFilter === "faellig") {
        if (!(r.status === "offen" || r.status === "in_verhandlung")) return false;
        if (!r.naechste_nachfrage || r.naechste_nachfrage > today) return false;
      } else if (statusFilter !== "alle") {
        if (r.status !== statusFilter) return false;
      }
      if (!q) return true;
      const hay = [
        r.bvh_name,
        r.bauherr ?? "",
        r.baustellen_adresse ?? "",
        r.bauherr_adresse ?? "",
        r.angebots_nr ?? "",
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [rows, search, statusFilter, today]);

  if (!isAdmin) {
    return (
      <div className="space-y-4">
        <PageHeader title="Angebote" />
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            Du hast keine Berechtigung für die Angebote-Übersicht.
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Angebote"
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setImportOpen(true)}>
              <UploadIcon className="h-4 w-4 mr-2" />
              Excel importieren
            </Button>
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Neues Angebot
            </Button>
          </div>
        }
      />

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <StatCard
          label="Offen"
          value={stats.offen}
          tone="sky"
          onClick={() => setStatusFilter("offen")}
        />
        <StatCard
          label="In Verhandlung"
          value={stats.in_verhandlung}
          tone="amber"
          onClick={() => setStatusFilter("in_verhandlung")}
        />
        <StatCard
          label="Nachfrage fällig"
          value={stats.faellig}
          tone={stats.faellig > 0 ? "red" : "muted"}
          onClick={() => setStatusFilter("faellig")}
        />
        <StatCard
          label="Angenommen"
          value={stats.angenommen}
          tone="emerald"
          onClick={() => setStatusFilter("angenommen")}
        />
      </div>

      {/* Filter */}
      <Card>
        <CardContent className="p-3 flex items-center gap-2 flex-wrap">
          <Search className="h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="BV, Bauherr, Adresse suchen…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1 h-9 min-w-[200px]"
          />
          <Filter className="h-4 w-4 text-muted-foreground ml-2" />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as any)}
            className="h-9 rounded-md border bg-background px-2 text-sm"
          >
            <option value="alle">Alle</option>
            <option value="offen">Offen</option>
            <option value="in_verhandlung">In Verhandlung</option>
            <option value="faellig">Nachfrage fällig</option>
            <option value="angenommen">Angenommen</option>
            <option value="abgelehnt">Abgelehnt</option>
            <option value="zurueckgezogen">Zurückgezogen</option>
          </select>
        </CardContent>
      </Card>

      {/* Liste */}
      {loading ? (
        <Card>
          <CardContent className="p-6 text-center text-sm text-muted-foreground">
            Lädt…
          </CardContent>
        </Card>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center space-y-2">
            <Briefcase className="h-8 w-8 mx-auto text-muted-foreground opacity-50" />
            <div className="text-sm text-muted-foreground">
              {rows.length === 0
                ? "Noch keine Angebote — erstes anlegen oder Excel importieren."
                : "Keine Angebote passen zum Filter."}
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <ul className="divide-y">
              {filtered.map((r) => (
                <AngebotRow key={r.id} a={r} today={today} />
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <NewAngebotDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={() => {
          setCreateOpen(false);
          load();
        }}
      />

      <AngebotExcelImport
        open={importOpen}
        onOpenChange={setImportOpen}
        onImported={() => {
          setImportOpen(false);
          load();
        }}
      />
    </div>
  );
}

function StatCard({
  label,
  value,
  tone,
  onClick,
}: {
  label: string;
  value: number;
  tone: "sky" | "amber" | "red" | "emerald" | "muted";
  onClick: () => void;
}) {
  const toneClasses: Record<typeof tone, string> = {
    sky: "border-sky-200 bg-sky-50 text-sky-900",
    amber: "border-amber-200 bg-amber-50 text-amber-900",
    red: "border-red-200 bg-red-50 text-red-900",
    emerald: "border-emerald-200 bg-emerald-50 text-emerald-900",
    muted: "border-border bg-muted/40 text-muted-foreground",
  };
  return (
    <button
      onClick={onClick}
      className={`text-left rounded-md border p-3 hover:shadow-sm transition ${toneClasses[tone]}`}
    >
      <div className="text-[10px] uppercase tracking-wide opacity-70 font-semibold">
        {label}
      </div>
      <div className="text-2xl font-bold tabular-nums">{value}</div>
    </button>
  );
}

function AngebotRow({ a, today }: { a: Angebot; today: string }) {
  const fae =
    (a.status === "offen" || a.status === "in_verhandlung") &&
    a.naechste_nachfrage &&
    a.naechste_nachfrage <= today;
  const daysOverdue =
    fae && a.naechste_nachfrage
      ? Math.floor(
          (new Date(today).getTime() - new Date(a.naechste_nachfrage).getTime()) /
            (1000 * 60 * 60 * 24)
        )
      : 0;
  return (
    <li>
      <Link
        to={`/angebote/${a.id}`}
        className="flex items-center gap-3 px-3 sm:px-4 py-3 hover:bg-muted/50 transition"
      >
        <span
          className={`text-[10px] uppercase tracking-wide font-semibold px-2 py-0.5 rounded border shrink-0 ${
            STATUS_COLOR[a.status]
          }`}
        >
          {STATUS_LABEL[a.status]}
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2">
            <span className="font-semibold text-sm truncate">{a.bvh_name}</span>
            {a.angebots_nr && (
              <span className="text-[10px] text-muted-foreground tabular-nums shrink-0">
                Nr. {a.angebots_nr}
              </span>
            )}
          </div>
          <div className="text-xs text-muted-foreground truncate">
            {a.bauherr ?? "—"}
            {a.baustellen_adresse ? ` · ${a.baustellen_adresse}` : ""}
            {a.ort ? `, ${a.ort}` : ""}
          </div>
          <div className="text-[11px] text-muted-foreground flex items-center gap-2 flex-wrap mt-0.5">
            {a.datum_angebot && (
              <span>
                Angebot vom {new Date(a.datum_angebot).toLocaleDateString("de-AT")}
              </span>
            )}
            {a.naechste_nachfrage && (
              <span className={fae ? "text-red-700 font-semibold" : ""}>
                <Calendar className="h-3 w-3 inline mr-0.5" />
                Nachfrage{" "}
                {new Date(a.naechste_nachfrage).toLocaleDateString("de-AT")}
                {fae && daysOverdue > 0 && ` (${daysOverdue} Tage überfällig)`}
              </span>
            )}
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-sm font-semibold tabular-nums">{fmtEuro(a.wert_euro)}</div>
        </div>
        <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
      </Link>
    </li>
  );
}

function NewAngebotDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (b: boolean) => void;
  onCreated: () => void;
}) {
  const { toast } = useToast();
  const { user } = useAuth();
  const [angebots_nr, setAngebotsNr] = useState("");
  const [bvh_name, setBvhName] = useState("");
  const [bauherr, setBauherr] = useState("");
  const [bauherr_adresse, setBauherrAdresse] = useState("");
  const [baustellen_adresse, setBaustellenAdresse] = useState("");
  const [plz, setPlz] = useState("");
  const [ort, setOrt] = useState("");
  const [kontakt_telefon, setKontaktTelefon] = useState("");
  const [kontakt_email, setKontaktEmail] = useState("");
  const [wert_euro, setWertEuro] = useState<string>("");
  const [datum_angebot, setDatumAngebot] = useState<string>(localIso());
  const [naechste_nachfrage, setNaechsteNachfrage] = useState<string>("");
  const [notizen, setNotizen] = useState("");
  const [dups, setDups] = useState<DupHit[]>([]);
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) {
      setAngebotsNr("");
      setBvhName("");
      setBauherr("");
      setBauherrAdresse("");
      setBaustellenAdresse("");
      setPlz("");
      setOrt("");
      setKontaktTelefon("");
      setKontaktEmail("");
      setWertEuro("");
      setDatumAngebot(localIso());
      setNaechsteNachfrage("");
      setNotizen("");
      setDups([]);
    }
  }, [open]);

  // Debounced Duplikat-Check
  useEffect(() => {
    if (!open) return;
    const b = bauherr.trim();
    const a = baustellen_adresse.trim() || bauherr_adresse.trim();
    if (b.length < 3 && a.length < 5) {
      setDups([]);
      return;
    }
    const handle = setTimeout(async () => {
      setChecking(true);
      const { data, error } = await supabase.rpc("angebot_duplicate_check" as any, {
        p_bauherr: b,
        p_adresse: a,
        p_threshold: 0.4,
      });
      setChecking(false);
      if (error) return;
      setDups((data as DupHit[]) ?? []);
    }, 400);
    return () => clearTimeout(handle);
  }, [open, bauherr, baustellen_adresse, bauherr_adresse]);

  const save = async () => {
    if (!bvh_name.trim()) {
      toast({ variant: "destructive", title: "BV-Name fehlt" });
      return;
    }
    setSaving(true);
    const { data, error } = await supabase
      .from("angebote")
      .insert({
        angebots_nr: angebots_nr.trim() || null,
        datum_angebot: datum_angebot || null,
        bvh_name: bvh_name.trim(),
        bauherr: bauherr.trim() || null,
        bauherr_adresse: bauherr_adresse.trim() || null,
        baustellen_adresse: baustellen_adresse.trim() || null,
        plz: plz.trim() || null,
        ort: ort.trim() || null,
        kontakt_telefon: kontakt_telefon.trim() || null,
        kontakt_email: kontakt_email.trim() || null,
        wert_euro: wert_euro ? Number(wert_euro.replace(",", ".")) : null,
        naechste_nachfrage: naechste_nachfrage || null,
        notizen: notizen.trim() || null,
        created_by: user?.id ?? null,
      } as any)
      .select()
      .single();
    setSaving(false);
    if (error || !data) {
      toast({ variant: "destructive", title: "Fehler", description: error?.message });
      return;
    }
    toast({ title: "Angebot angelegt" });
    onCreated();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Neues Angebot</DialogTitle>
        </DialogHeader>

        {/* Duplikat-Hinweis */}
        {dups.length > 0 && (
          <div className="rounded-md border border-amber-300 bg-amber-50 p-3 space-y-1.5">
            <div className="flex items-center gap-2 text-amber-900 text-sm font-semibold">
              <AlertTriangle className="h-4 w-4" />
              {dups.length} ähnliche{" "}
              {dups.length === 1 ? "Eintrag" : "Einträge"} gefunden
            </div>
            <ul className="text-xs space-y-1">
              {dups.slice(0, 5).map((d) => (
                <li key={`${d.source}-${d.id}`} className="flex items-start gap-2">
                  <span className="text-[10px] uppercase tracking-wide font-bold mt-0.5 px-1 py-0.5 rounded bg-amber-200 text-amber-900 shrink-0">
                    {d.source === "angebot" ? "Angebot" : "Baustelle"}
                  </span>
                  <span className="flex-1">
                    „{d.name}" · {d.bauherr_match ?? "—"}
                    {d.adresse_match ? ` · ${d.adresse_match}` : ""} ·{" "}
                    <span className="text-amber-700">{d.status}</span>
                    <span className="text-amber-600 ml-1 tabular-nums">
                      ({Math.round(d.score * 100)}%)
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="grid grid-cols-2 gap-2">
          <div className="col-span-2">
            <Label className="text-xs">
              BV-Name <span className="text-red-500">*</span>
            </Label>
            <Input value={bvh_name} onChange={(e) => setBvhName(e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Angebots-Nr.</Label>
            <Input
              value={angebots_nr}
              onChange={(e) => setAngebotsNr(e.target.value)}
              placeholder="z.B. 2026-042"
            />
          </div>
          <div>
            <Label className="text-xs">Datum Angebot</Label>
            <Input
              type="date"
              value={datum_angebot}
              onChange={(e) => setDatumAngebot(e.target.value)}
            />
          </div>

          <div className="col-span-2 mt-1 text-[10px] uppercase tracking-wide font-semibold text-muted-foreground">
            Kunde / Bauherr
          </div>
          <div className="col-span-2">
            <Label className="text-xs">Bauherr</Label>
            <Input value={bauherr} onChange={(e) => setBauherr(e.target.value)} />
          </div>
          <div className="col-span-2">
            <Label className="text-xs">Bauherr-Adresse</Label>
            <Input
              value={bauherr_adresse}
              onChange={(e) => setBauherrAdresse(e.target.value)}
            />
          </div>
          <div>
            <Label className="text-xs">Telefon</Label>
            <Input
              value={kontakt_telefon}
              onChange={(e) => setKontaktTelefon(e.target.value)}
            />
          </div>
          <div>
            <Label className="text-xs">E-Mail</Label>
            <Input
              type="email"
              value={kontakt_email}
              onChange={(e) => setKontaktEmail(e.target.value)}
            />
          </div>

          <div className="col-span-2 mt-1 text-[10px] uppercase tracking-wide font-semibold text-muted-foreground">
            Baustelle
          </div>
          <div className="col-span-2">
            <Label className="text-xs">Baustellen-Adresse</Label>
            <Input
              value={baustellen_adresse}
              onChange={(e) => setBaustellenAdresse(e.target.value)}
            />
          </div>
          <div>
            <Label className="text-xs">PLZ</Label>
            <Input value={plz} onChange={(e) => setPlz(e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Ort</Label>
            <Input value={ort} onChange={(e) => setOrt(e.target.value)} />
          </div>

          <div className="col-span-2 mt-1 text-[10px] uppercase tracking-wide font-semibold text-muted-foreground">
            Sonstiges
          </div>
          <div>
            <Label className="text-xs">Wert (€)</Label>
            <Input
              inputMode="decimal"
              value={wert_euro}
              onChange={(e) => setWertEuro(e.target.value)}
              placeholder="z.B. 12500"
            />
          </div>
          <div>
            <Label className="text-xs">Nächste Nachfrage</Label>
            <Input
              type="date"
              value={naechste_nachfrage}
              onChange={(e) => setNaechsteNachfrage(e.target.value)}
            />
          </div>
          <div className="col-span-2">
            <Label className="text-xs">Notizen</Label>
            <Textarea
              value={notizen}
              onChange={(e) => setNotizen(e.target.value)}
              rows={3}
            />
          </div>
        </div>

        <DialogFooter className="flex-row gap-2 sm:gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} className="flex-1">
            Abbrechen
          </Button>
          <Button onClick={save} disabled={saving || !bvh_name.trim()} className="flex-1">
            {saving ? "Speichere…" : "Anlegen"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
