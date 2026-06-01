/**
 * Stundenerfassung — Block pro Mitarbeiter.
 *
 * Ein Tag besteht aus typisierten Einträgen (Baustelle / Firma / Krank /
 * Urlaub / Schlechtwetter). Mehrere Einträge pro Tag sind möglich (z.B. halb
 * Baustelle, halb Firma). In der Sammelerfassung (Polier/Admin) bekommt jeder
 * Mitarbeiter einen eigenen Block mit eigenen Einträgen.
 *
 * Pausen werden nicht mehr erfasst — der Mitarbeiter gibt reine Netto-Zeit ein.
 */

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import {
  Plus,
  Minus,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Edit,
  Trash2,
  AlertTriangle,
  Loader2,
  Car,
  Copy,
} from "lucide-react";
import type { Database, TagStatus } from "@/integrations/supabase/types";
import { localIso } from "@/lib/dateFmt";
import { MicButton } from "@/components/MicButton";
import { BaustelleCombobox } from "@/components/stunden/BaustelleCombobox";
import { PersonPicker, type Mode } from "@/components/stunden/PersonPicker";
import {
  STATUS_LABELS,
  STATUS_COLORS,
  STATUS_OPTIONS,
  istArbeitArt,
  newKey,
  gruppiereSections,
  type EintragRow,
} from "@/components/stunden/zeiterfassungUi";
import { StatusButtonsLeiste } from "@/components/stunden/StatusButtonsLeiste";
import { ArtSection } from "@/components/stunden/ArtSection";
import {
  berechneTagZeiten,
  pruefArbeitszeitGesetz,
  ueberstundenForTag,
  fmtH,
  fmtHNum,
} from "@/lib/zeiterfassung";
import {
  useTaetigkeitenStamm,
  useZulagenTypen,
  useMitarbeiterZulagen,
  useArbeitszeitLimits,
} from "@/hooks/useStammdatenStunden";
import {
  useStundenTageList,
  useSaveStundenTag,
  useDeleteStundenTag,
  type SaveEintrag,
  type SaveZulage,
  type SaveFahrt,
} from "@/hooks/useStundenTag";
import { useSollHoursForDayBulk } from "@/hooks/useSollHoursForDayBulk";
import { getBaustellenForMaToday } from "@/lib/tagesplanung";
import { berechneTaggeld } from "@/lib/taggeld";

type Baustelle = Database["public"]["Tables"]["baustellen"]["Row"];
type Profile = Database["public"]["Tables"]["profiles"]["Row"];
type Partie = Database["public"]["Tables"]["partien"]["Row"];

const todayIso = () => localIso();

interface ZulageEintrag {
  stundenPerMa: Record<string, number | null>; // null = alle Netto-Stunden des MA
  notiz: string;
  proMaModus: boolean;
}

interface ErfassungForm {
  /** Einträge je Mitarbeiter-ID. */
  maEintraege: Record<string, EintragRow[]>;
  arbeitsbeginn: string | null;
  anmerkung: string;
  zulagenSelected: Map<string, ZulageEintrag>;
  /** Privat gefahrene Kilometer je Mitarbeiter-ID. */
  kmPerMa: Record<string, number>;
  fahrt: SaveFahrt | null;
}

function emptyForm(): ErfassungForm {
  return {
    maEintraege: {},
    arbeitsbeginn: null,
    anmerkung: "",
    zulagenSelected: new Map(),
    kmPerMa: {},
    fahrt: null,
  };
}

export default function Stunden() {
  const { user, profile, isAdmin } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [date, setDate] = useState<string>(todayIso);
  const [tageOffenMobile, setTageOffenMobile] = useState(false);
  const [polierPartie, setPolierPartie] = useState<Partie | null>(null);
  const [allPartien, setAllPartien] = useState<Partie[]>([]);
  const [allMembers, setAllMembers] = useState<Profile[]>([]);
  const [baustellen, setBaustellen] = useState<Baustelle[]>([]);
  const [forUserIds, setForUserIds] = useState<Set<string>>(new Set());
  const [memberSearch, setMemberSearch] = useState<string>("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [rollenGeladen, setRollenGeladen] = useState(false);

  const [searchParams] = useSearchParams();
  const baustelleParam = searchParams.get("baustelle");

  // Vorarbeiter-/Admin-Vorausfüllung: Kollegen der heutigen Einteilung
  // werden mitselektiert. Läuft einmal pro (user, date, baustelle)-Kontext.
  const prefilledKeyRef = useRef<string>("");
  useEffect(() => {
    if (!user || !date || !rollenGeladen) return;
    const key = `${user.id}|${date}|${baustelleParam ?? ""}`;
    if (prefilledKeyRef.current === key) return;
    let cancelled = false;
    (async () => {
      const initial = new Set<string>([user.id]);
      if (isAdmin || polierPartie) {
        const eint = await getBaustellenForMaToday(user.id, date);
        const ziel = baustelleParam
          ? eint.find((e) => e.baustelle_id === baustelleParam) ?? eint[0]
          : eint[0];
        if (ziel) {
          const { data: ems } = await supabase
            .from("einteilung_mitarbeiter")
            .select("mitarbeiter_id")
            .eq("einteilung_id", ziel.einteilung_id);
          (ems ?? []).forEach((e: any) => initial.add(e.mitarbeiter_id));
        }
      }
      if (cancelled) return;
      prefilledKeyRef.current = key;
      setForUserIds(initial);
    })();
    return () => {
      cancelled = true;
    };
  }, [user, date, polierPartie, isAdmin, baustelleParam, rollenGeladen]);

  // Polier-Partie / Members
  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data: p } = await supabase
        .from("partien")
        .select("*")
        .eq("partieleiter_id", user.id)
        .maybeSingle();
      setPolierPartie((p as Partie) ?? null);

      if (isAdmin) {
        const [{ data: members }, { data: partien }] = await Promise.all([
          supabase.from("profiles").select("*").eq("is_active", true).order("nachname"),
          supabase.from("partien").select("*").order("name"),
        ]);
        setAllMembers((members as Profile[]) ?? []);
        setAllPartien((partien as Partie[]) ?? []);
      } else if (p) {
        const { data: members } = await supabase
          .from("profiles")
          .select("*")
          .eq("partie_id", (p as Partie).id)
          .eq("is_active", true)
          .order("nachname");
        setAllMembers((members as Profile[]) ?? []);
        setAllPartien([p as Partie]);
      }
      setRollenGeladen(true);
    })();
  }, [user, isAdmin]);

  // Baustellen
  useEffect(() => {
    (async () => {
      const partieFilter = polierPartie?.id ?? (profile as any)?.partie_id ?? null;
      let q = supabase
        .from("baustellen")
        .select("*")
        .in("status", ["aktiv", "geplant"])
        .order("bvh_name");
      if (!isAdmin && partieFilter) q = q.eq("partie_id", partieFilter);
      const { data } = await q;
      setBaustellen((data as Baustelle[]) ?? []);
    })();
  }, [polierPartie, profile, isAdmin]);

  const mode: Mode = isAdmin ? "admin" : polierPartie ? "polier" : "self";
  const hasPicker = mode !== "self";
  const istPolier = !!polierPartie;
  const primaryUserId = user?.id ?? "";

  const { data: taetigkeitenStamm = [] } = useTaetigkeitenStamm();
  const { data: zulagenTypen = [] } = useZulagenTypen();
  const { data: erlaubteZulagenIds = [] } = useMitarbeiterZulagen(primaryUserId);

  const { data: erlaubteZulagenUnion = [] } = useQuery({
    queryKey: ["mitarbeiter_zulagen_union", Array.from(forUserIds)],
    queryFn: async () => {
      const ids = Array.from(forUserIds);
      if (ids.length === 0) return [];
      const { data } = await supabase
        .from("mitarbeiter_zulagen")
        .select("zulagen_typ_id")
        .in("mitarbeiter_id", ids);
      return Array.from(new Set((data ?? []).map((r: any) => r.zulagen_typ_id)));
    },
    enabled: forUserIds.size > 0,
  });
  const verfuegbareZulagenIds =
    forUserIds.size > 1 ? erlaubteZulagenUnion : erlaubteZulagenIds;
  const { data: limits } = useArbeitszeitLimits();
  const { sollPerMa } = useSollHoursForDayBulk(Array.from(forUserIds), date);

  // Tagesplanung-Daten pro selektiertem MA (Baustelle + Tätigkeit)
  const [tagesplanungPerMa, setTagesplanungPerMa] = useState<
    Map<string, { baustelle_id: string; taetigkeit: string | null }>
  >(new Map());
  useEffect(() => {
    if (forUserIds.size === 0 || !date) {
      setTagesplanungPerMa(new Map());
      return;
    }
    let cancelled = false;
    (async () => {
      const m = new Map<string, { baustelle_id: string; taetigkeit: string | null }>();
      for (const uid of forUserIds) {
        const eint = await getBaustellenForMaToday(uid, date);
        const ziel =
          uid === primaryUserId && baustelleParam
            ? eint.find((e) => e.baustelle_id === baustelleParam) ?? eint[0]
            : eint[0];
        if (ziel) {
          m.set(uid, { baustelle_id: ziel.baustelle_id, taetigkeit: ziel.taetigkeit });
        }
      }
      if (!cancelled) setTagesplanungPerMa(m);
    })();
    return () => {
      cancelled = true;
    };
  }, [forUserIds, date, baustelleParam, primaryUserId]);

  // Status-Map fürs Picker-UI (zeigt pro MA „4,5h" wenn schon was gebucht)
  const memberIds = useMemo(
    () =>
      Array.from(
        new Set([user?.id, ...allMembers.map((m) => m.id)].filter(Boolean) as string[]),
      ),
    [user, allMembers],
  );
  const { data: statusForDateMap = new Map<string, { hours: number }>() } = useQuery({
    queryKey: ["stunden_status_for_date", date, memberIds],
    queryFn: async () => {
      if (memberIds.length === 0) return new Map<string, { hours: number }>();
      const { data } = await supabase
        .from("stunden_tage")
        .select("mitarbeiter_id, netto_stunden")
        .eq("datum", date)
        .in("mitarbeiter_id", memberIds);
      const map = new Map<string, { hours: number }>();
      (data ?? []).forEach((r: any) => {
        const cur = map.get(r.mitarbeiter_id) ?? { hours: 0 };
        cur.hours += Number(r.netto_stunden ?? 0);
        map.set(r.mitarbeiter_id, cur);
      });
      return map;
    },
    enabled: !!date && memberIds.length > 0,
  });

  // Eigene Tage-Liste oben
  const fromDate = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return localIso(d);
  }, []);
  const { data: tageList = [], refetch: refetchTage } = useStundenTageList({
    fromDate,
    mitarbeiterIds: primaryUserId ? [primaryUserId] : [],
    enabled: !!primaryUserId,
  });
  const aktuellerEigenerTag = useMemo(
    () => tageList.find((t) => t.tag.datum === date),
    [tageList, date],
  );

  // ─── Form-State ─────────────────────────────────────────────────────
  const [form, setForm] = useState<ErfassungForm>(() => emptyForm());

  // Bei Datums-/User-Wechsel: bestehenden Eintrag des primaryUsers laden.
  useEffect(() => {
    const uids = Array.from(forUserIds);
    if (!aktuellerEigenerTag) {
      setForm({
        ...emptyForm(),
        maEintraege: Object.fromEntries(uids.map((u) => [u, [] as EintragRow[]])),
      });
      return;
    }
    const t = aktuellerEigenerTag;
    setForm({
      ...emptyForm(),
      maEintraege: {
        ...Object.fromEntries(uids.map((u) => [u, [] as EintragRow[]])),
        [primaryUserId]: t.taetigkeiten.map((tt) => ({
          key: newKey(),
          art: tt.art,
          baustelle_id: tt.baustelle_id,
          taetigkeit_id: tt.taetigkeit_id,
          taetigkeit_freitext: tt.taetigkeit_freitext ?? "",
          stunden: Number(tt.stunden),
          notiz: tt.notiz ?? "",
        })),
      },
      arbeitsbeginn: t.tag.arbeitsbeginn?.slice(0, 5) ?? null,
      anmerkung: t.tag.anmerkung ?? "",
      zulagenSelected: new Map(
        t.zulagen.map((z) => [
          z.zulagen_typ_id,
          {
            stundenPerMa: Object.fromEntries(uids.map((u) => [u, z.stunden ?? null])),
            notiz: z.notiz ?? "",
            proMaModus: false,
          },
        ]),
      ),
      kmPerMa: { [primaryUserId]: Number(t.fahrt?.km_gefahren ?? 0) },
      fahrt: t.fahrt
        ? {
            fahrtgeld_eur: Number(t.fahrt.fahrtgeld_eur),
            privat_pkw: t.fahrt.privat_pkw,
            km_gefahren:
              t.fahrt.km_gefahren !== null ? Number(t.fahrt.km_gefahren) : null,
            taggeld_kurz: t.fahrt.taggeld_kurz,
            taggeld_lang: t.fahrt.taggeld_lang,
            taggeld_manuell: t.fahrt.taggeld_manuell,
          }
        : null,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aktuellerEigenerTag?.tag.id, primaryUserId, date]);

  // forUserIds-Wechsel: für jeden selektierten MA ein Eintrags-Array sichern,
  // Zulagen-stundenPerMa abgleichen.
  useEffect(() => {
    setForm((f) => {
      const uids = Array.from(forUserIds);
      const maEintraege: Record<string, EintragRow[]> = {};
      const kmPerMa: Record<string, number> = {};
      for (const uid of uids) {
        maEintraege[uid] = f.maEintraege[uid] ?? [];
        kmPerMa[uid] = f.kmPerMa[uid] ?? 0;
      }
      const zulagenSelected = new Map(
        Array.from(f.zulagenSelected.entries()).map(([typId, z]) => {
          const standardWert =
            uids.find((id) => z.stundenPerMa[id] !== undefined) !== undefined
              ? z.stundenPerMa[uids.find((id) => z.stundenPerMa[id] !== undefined)!]
              : null;
          const next: Record<string, number | null> = {};
          for (const uid of uids) {
            next[uid] =
              z.stundenPerMa[uid] !== undefined
                ? z.stundenPerMa[uid]
                : z.proMaModus
                ? 0
                : standardWert;
          }
          return [typId, { ...z, stundenPerMa: next }];
        }),
      );
      return { ...f, maEintraege, zulagenSelected, kmPerMa };
    });
  }, [forUserIds]);

  // Vorausfüllung leerer MA-Blöcke: neue MA erben „auf Verdacht" die aktiven
  // Arten der anderen ausgewählten MA (jeder Art ein Default-Eintrag). Hat
  // noch niemand etwas → Fallback auf einen Baustellen-Eintrag aus der
  // Tagesplanung + Soll-Stunden.
  useEffect(() => {
    setForm((f) => {
      // Aktive Arten aus den bestehenden MA-Einträgen ableiten
      const aktive = new Set<TagStatus>();
      for (const uid of forUserIds) {
        for (const r of f.maEintraege[uid] ?? []) aktive.add(r.art);
      }

      let changed = false;
      const maEintraege = { ...f.maEintraege };
      for (const uid of forUserIds) {
        if ((maEintraege[uid] ?? []).length > 0) continue;
        const tp = tagesplanungPerMa.get(uid);
        const soll = sollPerMa.get(uid) ?? 0;
        if (aktive.size > 0) {
          // Aktive Arten der anderen MA übernehmen
          const newRows: EintragRow[] = [];
          for (const art of aktive) {
            newRows.push({
              key: newKey(),
              art,
              baustelle_id:
                art === "baustelle" ? tp?.baustelle_id ?? null : null,
              taetigkeit_id: null,
              taetigkeit_freitext:
                art === "baustelle" ? tp?.taetigkeit ?? "" : "",
              stunden: newRows.length === 0 ? soll : 0,
              notiz: "",
            });
          }
          maEintraege[uid] = newRows;
          changed = true;
        } else if (tp || soll > 0) {
          // Fallback: nur ein Baustellen-Eintrag
          maEintraege[uid] = [
            {
              key: newKey(),
              art: "baustelle",
              baustelle_id: tp?.baustelle_id ?? null,
              taetigkeit_id: null,
              taetigkeit_freitext: tp?.taetigkeit ?? "",
              stunden: soll,
              notiz: "",
            },
          ];
          changed = true;
        }
      }
      return changed ? { ...f, maEintraege } : f;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tagesplanungPerMa, sollPerMa, forUserIds]);

  /** Summe der Netto-Stunden eines MA aus seinen Einträgen. */
  const summenProMa = useMemo(() => {
    const m = new Map<string, number>();
    for (const uid of forUserIds) {
      const rows = form.maEintraege[uid] ?? [];
      m.set(
        uid,
        Math.round(rows.reduce((s, r) => s + Number(r.stunden || 0), 0) * 100) / 100,
      );
    }
    return m;
  }, [form.maEintraege, forUserIds]);

  /** Summe der Arbeits-Einträge (Baustelle/Firma) eines MA — für Zulagen-Prefill. */
  const taetSummeFuer = (uid: string): number =>
    (form.maEintraege[uid] ?? [])
      .filter((r) => istArbeitArt(r.art))
      .reduce((s, r) => s + Number(r.stunden || 0), 0);

  const selectedMaList = useMemo(() => {
    const ids = Array.from(forUserIds);
    return ids
      .map((id) =>
        id === user?.id
          ? (profile as any as Profile)
          : allMembers.find((m) => m.id === id),
      )
      .filter(Boolean) as Profile[];
  }, [forUserIds, allMembers, profile, user]);

  // MA mit bereits gebuchten Stunden an diesem Tag (Konflikt-Banner)
  const konflikte = useMemo(() => {
    return selectedMaList
      .map((m) => ({ ma: m, h: statusForDateMap.get(m.id)?.hours ?? 0 }))
      .filter((x) => x.h > 0);
  }, [selectedMaList, statusForDateMap]);

  const arbeitsbeginnEffective =
    form.arbeitsbeginn || limits?.arbeitsbeginn_default?.slice(0, 5) || "07:00";

  const tagZeitenForMa = (uid: string) =>
    berechneTagZeiten({
      nettoStunden: summenProMa.get(uid) ?? 0,
      arbeitsbeginn: arbeitsbeginnEffective,
    });

  const saveMut = useSaveStundenTag();
  const deleteMut = useDeleteStundenTag();
  const [busy, setBusy] = useState(false);

  // ─── Eintrags-Mutationen pro MA ─────────────────────────────────────
  const setEintraege = (uid: string, rows: EintragRow[]) =>
    setForm((f) => ({ ...f, maEintraege: { ...f.maEintraege, [uid]: rows } }));

  const uebernehmeFuerAlle = (srcUid: string) => {
    const src = form.maEintraege[srcUid] ?? [];
    setForm((f) => {
      const maEintraege = { ...f.maEintraege };
      for (const uid of forUserIds) {
        if (uid === srcUid) continue;
        maEintraege[uid] = src.map((r) => ({ ...r, key: newKey() }));
      }
      return { ...f, maEintraege };
    });
    toast({ title: "Einträge übernommen", description: "Für alle Mitarbeiter kopiert." });
  };

  /** Aktive Arten = Arten, die mindestens einer der ausgewählten MA bereits
   *  als Eintrag hat. Daraus leitet sich der „aktiv/inaktiv"-Zustand der
   *  Top-Toggles ab. */
  const aktiveArten = useMemo(() => {
    const set = new Set<TagStatus>();
    for (const uid of forUserIds) {
      for (const r of form.maEintraege[uid] ?? []) set.add(r.art);
    }
    return set;
  }, [form.maEintraege, forUserIds]);

  /** Legt für einen Mitarbeiter einen Default-Eintrag dieser Art an. */
  const defaultEintragFuer = (uid: string, art: TagStatus): EintragRow => {
    const list = form.maEintraege[uid] ?? [];
    const tp = tagesplanungPerMa.get(uid);
    const soll = sollPerMa.get(uid) ?? 0;
    const letzteBaustelle =
      [...list].reverse().find((r) => r.art === "baustelle")?.baustelle_id ?? null;
    return {
      key: newKey(),
      art,
      baustelle_id:
        art === "baustelle" ? tp?.baustelle_id ?? letzteBaustelle ?? null : null,
      taetigkeit_id: null,
      taetigkeit_freitext: art === "baustelle" ? tp?.taetigkeit ?? "" : "",
      stunden: list.length === 0 ? soll : 0,
      notiz: "",
    };
  };

  /** Top-Toggle: aktiv → alle Einträge dieser Art für alle ausgewählten MA
   *  entfernen; inaktiv → bei jedem MA ohne Eintrag dieser Art einen
   *  Default-Eintrag anlegen. */
  const toggleArtFuerAlle = (art: TagStatus) => {
    const istAktiv = aktiveArten.has(art);
    setForm((f) => {
      const maEintraege = { ...f.maEintraege };
      for (const uid of forUserIds) {
        const list = maEintraege[uid] ?? [];
        if (istAktiv) {
          maEintraege[uid] = list.filter((r) => r.art !== art);
        } else if (!list.some((r) => r.art === art)) {
          maEintraege[uid] = [...list, defaultEintragFuer(uid, art)];
        }
      }
      return { ...f, maEintraege };
    });
  };

  // ─── Submit ──────────────────────────────────────────────────────────
  const submit = async () => {
    if (forUserIds.size === 0) {
      toast({ variant: "destructive", title: "Niemand ausgewählt" });
      return;
    }

    // AZG-Check pro MA
    if (limits) {
      const violations: string[] = [];
      for (const ma of selectedMaList) {
        const z = tagZeitenForMa(ma.id);
        const ok = pruefArbeitszeitGesetz(z, {
          maxNettoProTag: limits.max_netto_pro_tag,
          maxBruttoProTag: limits.max_brutto_pro_tag,
          arbeitsbeginnDefault: limits.arbeitsbeginn_default,
        });
        if (!ok.ok) violations.push(`${ma.vorname} ${ma.nachname}: ${ok.meldung}`);
      }
      if (violations.length > 0) {
        if (
          !window.confirm(
            `Arbeitszeit-Grenze überschritten:\n${violations.join("\n")}\n\nTrotzdem speichern?`,
          )
        )
          return;
      }
    }

    setBusy(true);
    let savedCount = 0;
    let skippedCount = 0;
    let taggeldKurzCount = 0;
    let taggeldLangCount = 0;
    const errors: string[] = [];

    try {
      const { data: existing } = await supabase
        .from("stunden_tage")
        .select(
          `id, mitarbeiter_id, status,
           stunden_taetigkeiten(id, art, baustelle_id, taetigkeit_id, taetigkeit_freitext, stunden, notiz, position)`,
        )
        .eq("datum", date)
        .in("mitarbeiter_id", Array.from(forUserIds));
      const existingMap = new Map<
        string,
        {
          id: string;
          status: string;
          taetigkeiten: Array<{
            art: TagStatus;
            baustelle_id: string | null;
            taetigkeit_id: string | null;
            taetigkeit_freitext: string | null;
            stunden: number;
            notiz: string | null;
          }>;
        }
      >();
      (existing ?? []).forEach((r: any) =>
        existingMap.set(r.mitarbeiter_id, {
          id: r.id,
          status: r.status,
          taetigkeiten: r.stunden_taetigkeiten ?? [],
        }),
      );

      // Maschinen-IDs für „Halle-Einträge erhalten"-Merge — direkt aus der DB,
      // damit der Merge nicht versehentlich Halle-Daten löscht, falls die
      // baustellen-Liste im Cache noch nicht (komplett) geladen ist.
      const { data: maschinenRows } = await supabase
        .from("baustellen")
        .select("id")
        .eq("kategorie", "maschine");
      const maschinenIds = new Set(
        (maschinenRows ?? []).map((m: { id: string }) => m.id),
      );

      for (const uid of forUserIds) {
        const ma = selectedMaList.find((m) => m.id === uid);
        const maName = ma ? `${ma.vorname} ${ma.nachname}` : "MA";
        const rows = (form.maEintraege[uid] ?? []).filter(
          (r) => Number(r.stunden) > 0,
        );
        if (rows.length === 0) {
          skippedCount++;
          continue;
        }
        const existingEntry = existingMap.get(uid);
        if (existingEntry && existingEntry.status !== "erfasst") {
          toast({
            title: `${maName} übersprungen`,
            description: `Tag bereits ${existingEntry.status}`,
          });
          skippedCount++;
          continue;
        }

        // Maschinen-Einträge (Halle) des Tages erhalten — /stunden verwaltet
        // nur Kunden-Baustellen + Firma + Abwesenheiten.
        const erhaltMaschinen = (existingEntry?.taetigkeiten ?? []).filter(
          (t) =>
            t.art === "baustelle" &&
            !!t.baustelle_id &&
            maschinenIds.has(t.baustelle_id),
        );

        const formEintraege: SaveEintrag[] = rows.map((r) => {
          const arbeit = istArbeitArt(r.art);
          return {
            position: 0,
            art: r.art,
            taetigkeit_id: arbeit ? r.taetigkeit_id : null,
            taetigkeit_freitext:
              arbeit && !r.taetigkeit_id ? r.taetigkeit_freitext.trim() || null : null,
            baustelle_id: r.art === "baustelle" ? r.baustelle_id : null,
            stunden: Number(r.stunden),
            notiz: r.notiz.trim() || null,
          };
        });

        const eintraege: SaveEintrag[] = [
          ...erhaltMaschinen.map((t) => ({
            position: 0,
            art: t.art,
            taetigkeit_id: t.taetigkeit_id,
            taetigkeit_freitext: t.taetigkeit_freitext,
            baustelle_id: t.baustelle_id,
            stunden: Number(t.stunden),
            notiz: t.notiz,
          })),
          ...formEintraege,
        ].map((e, idx) => ({ ...e, position: idx + 1 }));

        // Zulagen: nur die, die der MA erhalten darf
        let erlaubteZulagenForUid: Set<string>;
        if (uid === primaryUserId) {
          erlaubteZulagenForUid = new Set(erlaubteZulagenIds);
        } else {
          const { data: zRows } = await supabase
            .from("mitarbeiter_zulagen")
            .select("zulagen_typ_id")
            .eq("mitarbeiter_id", uid);
          erlaubteZulagenForUid = new Set(
            (zRows ?? []).map((r: any) => r.zulagen_typ_id),
          );
        }
        const zulagen: SaveZulage[] = Array.from(form.zulagenSelected.entries())
          .filter(([typId]) => erlaubteZulagenForUid.has(typId))
          .filter(([, val]) => val.stundenPerMa[uid] !== 0)
          .map(([typId, val]) => ({
            zulagen_typ_id: typId,
            stunden: val.stundenPerMa[uid] ?? null,
            notiz: val.notiz.trim() || null,
          }));

        // Auto-Taggeld aus den Baustellen-Stunden + Kilometergeld-Fahrt
        const baustelleStd = rows
          .filter((r) => r.art === "baustelle")
          .reduce((s, r) => s + Number(r.stunden), 0);
        const isPolierSelf = uid === primaryUserId && istPolier;
        const polierFahrt = isPolierSelf ? form.fahrt : null;
        const km = Math.max(0, Number(form.kmPerMa[uid] ?? 0));
        const auto = berechneTaggeld(baustelleStd, "baustelle");
        let fahrtToSave: SaveFahrt | null = null;
        if (polierFahrt?.taggeld_manuell) {
          fahrtToSave = {
            ...polierFahrt,
            privat_pkw: km > 0,
            km_gefahren: km > 0 ? km : null,
          };
        } else if (auto.kurz > 0 || auto.lang > 0 || polierFahrt || km > 0) {
          fahrtToSave = {
            fahrtgeld_eur: polierFahrt?.fahrtgeld_eur ?? 0,
            privat_pkw: km > 0,
            km_gefahren: km > 0 ? km : null,
            taggeld_kurz: auto.kurz,
            taggeld_lang: auto.lang,
            taggeld_manuell: false,
          };
        }

        try {
          await saveMut.mutateAsync({
            id: existingEntry?.id,
            mitarbeiter_id: uid,
            datum: date,
            arbeitsbeginn: form.arbeitsbeginn,
            anmerkung: form.anmerkung.trim() || null,
            taetigkeiten: eintraege,
            zulagen,
            fahrt: fahrtToSave,
          });
          savedCount++;
          if (fahrtToSave) {
            taggeldKurzCount += fahrtToSave.taggeld_kurz;
            taggeldLangCount += fahrtToSave.taggeld_lang;
          }
        } catch (e) {
          errors.push(`${maName}: ${(e as Error).message}`);
        }
      }

      const total = savedCount + skippedCount + errors.length;
      const taggeldParts: string[] = [];
      if (taggeldKurzCount > 0) taggeldParts.push(`${taggeldKurzCount}× Taggeld kurz`);
      if (taggeldLangCount > 0) taggeldParts.push(`${taggeldLangCount}× Taggeld lang`);
      const taggeldInfo =
        taggeldParts.length > 0 ? ` · ${taggeldParts.join(" · ")}` : "";
      toast({
        title:
          errors.length > 0
            ? `${savedCount} von ${total} gespeichert`
            : skippedCount > 0
            ? `${savedCount} gespeichert · ${skippedCount} übersprungen${taggeldInfo}`
            : `${savedCount} ${savedCount === 1 ? "Eintrag" : "Einträge"} gespeichert${taggeldInfo}`,
        description: errors.length > 0 ? errors.join(", ") : undefined,
        variant: errors.length > 0 ? "destructive" : undefined,
      });

      refetchTage();
      queryClient.invalidateQueries({ queryKey: ["stunden_status_for_date"] });
      if (!aktuellerEigenerTag) {
        setForm({
          ...emptyForm(),
          maEintraege: Object.fromEntries(
            Array.from(forUserIds).map((uid) => [uid, [] as EintragRow[]]),
          ),
        });
        const next = new Date(date);
        next.setDate(next.getDate() + 1);
        setDate(localIso(next));
      }
    } finally {
      setBusy(false);
    }
  };

  const onDeleteTag = async (t: (typeof tageList)[number]) => {
    const datumFmt = new Date(t.tag.datum + "T00:00:00").toLocaleDateString("de-AT", {
      weekday: "long",
      day: "2-digit",
      month: "long",
      year: "numeric",
    });
    const stundenSumme = Number(t.tag.netto_stunden ?? 0);
    const uebermittelt = t.tag.status && t.tag.status !== "erfasst";
    const zusatz = uebermittelt
      ? "\n\nDieser Tag wurde bereits an das Büro übermittelt und wird mitgelöscht."
      : "";
    const msg = `Tag vom ${datumFmt} mit ${fmtH(stundenSumme)} wirklich löschen? Das kann nicht rückgängig gemacht werden.${zusatz}`;
    if (!window.confirm(msg)) return;
    try {
      await deleteMut.mutateAsync(t.tag.id);
      toast({ title: "Tag gelöscht" });
    } catch (e) {
      toast({ variant: "destructive", title: "Fehler", description: (e as Error).message });
    }
  };

  const moveDate = (d: number) => {
    const nd = new Date(date);
    nd.setDate(nd.getDate() + d);
    setDate(localIso(nd));
  };

  const togglePerson = (uid: string) => {
    setForUserIds((prev) => {
      const next = new Set(prev);
      if (next.has(uid)) next.delete(uid);
      else next.add(uid);
      return next;
    });
  };
  const toggleCollapsed = (uid: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(uid)) next.delete(uid);
      else next.add(uid);
      return next;
    });

  const submitLabel =
    forUserIds.size === 0
      ? "Niemand ausgewählt"
      : forUserIds.size > 1
      ? `Für ${forUserIds.size} Mitarbeiter speichern`
      : aktuellerEigenerTag
      ? "Änderungen speichern"
      : "Tag speichern";

  return (
    <div className="space-y-4 max-w-3xl mx-auto pb-24 lg:pb-0">
      <PageHeader title="Stundenerfassung" />

      {/* Personen-Picker — nur für Polier/Admin */}
      {hasPicker && user && (
        <PersonPicker
          mode={mode}
          partie={polierPartie}
          partien={allPartien}
          members={allMembers}
          selectedIds={forUserIds}
          onToggle={togglePerson}
          onSetSelection={setForUserIds}
          ownUserId={user.id}
          ownProfile={profile as any}
          statusForDate={statusForDateMap}
          search={memberSearch}
          onSearchChange={setMemberSearch}
          date={date}
        />
      )}

      {/* Konflikt-Banner */}
      {konflikte.length > 0 && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 space-y-1.5">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-700 shrink-0" />
            <span className="text-sm font-semibold text-amber-900">
              {konflikte.length === 1
                ? "1 Mitarbeiter hat an diesem Tag bereits Stunden"
                : `${konflikte.length} Mitarbeiter haben an diesem Tag bereits Stunden`}
            </span>
          </div>
          <ul className="text-xs text-amber-900 pl-6 space-y-0.5">
            {konflikte.map(({ ma, h }) => (
              <li key={ma.id} className="tabular-nums">
                <span className="font-medium">
                  {ma.vorname} {ma.nachname}:
                </span>{" "}
                {fmtH(h)}
              </li>
            ))}
          </ul>
          <div className="text-[11px] text-amber-800 pl-6">
            Beim Speichern werden offene Einträge überschrieben — bereits bestätigte
            oder freigegebene Tage werden übersprungen.
          </div>
        </div>
      )}

      {/* Datum */}
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="icon"
              className="h-11 w-11 shrink-0"
              onClick={() => moveDate(-1)}
            >
              <ChevronLeft className="h-5 w-5" />
            </Button>
            <Input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="text-center font-medium h-11"
            />
            <Button
              variant="outline"
              size="icon"
              className="h-11 w-11 shrink-0"
              onClick={() => moveDate(1)}
            >
              <ChevronRight className="h-5 w-5" />
            </Button>
          </div>
          <div className="flex gap-1.5">
            <Button
              size="sm"
              variant={date === todayIso() ? "default" : "outline"}
              className="flex-1"
              onClick={() => setDate(todayIso())}
            >
              Heute
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="flex-1"
              onClick={() => {
                const d = new Date();
                d.setDate(d.getDate() - 1);
                setDate(localIso(d));
              }}
            >
              Gestern
            </Button>
          </div>
          <div className="text-xs text-muted-foreground text-center">
            {new Date(date).toLocaleDateString("de-AT", {
              weekday: "long",
              day: "2-digit",
              month: "long",
              year: "numeric",
            })}
          </div>
        </CardContent>
      </Card>

      {/* Eigene Tage-Liste */}
      {tageList.length > 0 && (
        <Card>
          <CardContent className="p-3 space-y-1.5">
            <button
              type="button"
              onClick={() => setTageOffenMobile((v) => !v)}
              className="w-full flex items-center justify-between text-xs font-semibold uppercase text-muted-foreground lg:cursor-default"
            >
              <span>Meine letzten Tage ({tageList.length})</span>
              <span className="lg:hidden">
                {tageOffenMobile ? (
                  <ChevronUp className="h-4 w-4" />
                ) : (
                  <ChevronDown className="h-4 w-4" />
                )}
              </span>
            </button>
            <div
              className={tageOffenMobile ? "space-y-1.5" : "space-y-1.5 hidden lg:block"}
            >
              <div className="text-[11px] text-muted-foreground leading-snug rounded bg-muted/30 px-2 py-1.5">
                <span className="inline-flex items-center gap-1 mr-2">
                  <span className="inline-block h-2 w-2 rounded-full bg-amber-500" />
                  offen (änderbar)
                </span>
                <span className="inline-flex items-center gap-1 mr-2">
                  <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" />
                  vom Büro freigegeben – nicht mehr änderbar
                </span>
              </div>
              {tageList.slice(0, 5).map((t) => {
                const buchungStatus = t.tag.status;
                const istFreigegeben =
                  buchungStatus === "buero_freigabe" ||
                  buchungStatus === "exportiert";
                const istBestaetigt =
                  buchungStatus === "ma_bestaetigt" ||
                  buchungStatus === "zm_freigabe";
                const istOffen = buchungStatus === "erfasst";
                const istAbgelehnt = buchungStatus === "abgelehnt";
                const dotClass = istFreigegeben
                  ? "bg-emerald-500"
                  : istBestaetigt
                  ? "bg-sky-500"
                  : istAbgelehnt
                  ? "bg-red-500"
                  : istOffen
                  ? "bg-amber-500"
                  : "bg-muted-foreground/40";
                const statusLabel = istFreigegeben
                  ? "freigegeben"
                  : istBestaetigt
                  ? "bestätigt"
                  : istAbgelehnt
                  ? "abgelehnt"
                  : istOffen
                  ? "offen"
                  : (buchungStatus ?? "");
                return (
                  <div
                    key={t.tag.id}
                    className="flex items-center gap-2 text-xs rounded px-2 py-1.5 bg-muted/40"
                  >
                    <span
                      className={`inline-block h-2 w-2 rounded-full shrink-0 ${dotClass}`}
                      aria-hidden
                    />
                    <span className="font-bold tabular-nums shrink-0">
                      {fmtH(Number(t.tag.netto_stunden))}
                    </span>
                    <span className="text-muted-foreground tabular-nums shrink-0">
                      {new Date(t.tag.datum).toLocaleDateString("de-AT", {
                        weekday: "short",
                        day: "2-digit",
                        month: "2-digit",
                      })}
                    </span>
                    <Badge variant="outline" className="text-[10px]">
                      {STATUS_LABELS[t.tag.tag_status]}
                    </Badge>
                    <Badge
                      variant="outline"
                      className={`text-[10px] ${
                        istFreigegeben
                          ? "border-emerald-400 text-emerald-800 bg-emerald-50"
                          : istBestaetigt
                          ? "border-sky-300 text-sky-800 bg-sky-50"
                          : istAbgelehnt
                          ? "border-red-300 text-red-800 bg-red-50"
                          : istOffen
                          ? "border-amber-300 text-amber-800 bg-amber-50"
                          : ""
                      }`}
                    >
                      {statusLabel}
                    </Badge>
                    <span className="flex-1" />
                    {istOffen && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 w-7 p-0 text-destructive"
                        onClick={() => onDeleteTag(t)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Eingabe-Form */}
      <Card>
        <CardContent className="p-4 space-y-4">
          <h3 className="text-base font-bold flex items-center gap-2">
            {aktuellerEigenerTag ? (
              <>
                <Edit className="h-4 w-4 text-primary" />
                Tag bearbeiten
              </>
            ) : (
              <>
                <Plus className="h-4 w-4 text-primary" />
                Tag erfassen
              </>
            )}
            {forUserIds.size > 1 && (
              <Badge variant="outline" className="ml-auto">
                {forUserIds.size} Mitarbeiter
              </Badge>
            )}
          </h3>

          {selectedMaList.length === 0 && (
            <div className="text-sm text-muted-foreground italic">
              Bitte oben Mitarbeiter auswählen.
            </div>
          )}

          {/* Status-Buttons: Toggle pro Art für alle ausgewählten Mitarbeiter */}
          {selectedMaList.length > 0 && (
            <StatusButtonsLeiste
              fuerAnzahl={selectedMaList.length}
              aktiveArten={aktiveArten}
              onToggle={toggleArtFuerAlle}
            />
          )}

          {/* Block pro Mitarbeiter */}
          {selectedMaList.map((ma) => (
            <MaBlock
              key={ma.id}
              ma={ma}
              single={selectedMaList.length === 1}
              eintraege={form.maEintraege[ma.id] ?? []}
              onChange={(rows) => setEintraege(ma.id, rows)}
              baustellen={baustellen}
              taetigkeitenStamm={taetigkeitenStamm}
              soll={sollPerMa.get(ma.id) ?? 0}
              collapsed={collapsed.has(ma.id)}
              onToggleCollapse={() => toggleCollapsed(ma.id)}
              canCopyToAll={selectedMaList.length > 1}
              onCopyToAll={() => uebernehmeFuerAlle(ma.id)}
            />
          ))}

          {/* Zulagen (global, pro MA-Stunden) */}
          {selectedMaList.length > 0 && verfuegbareZulagenIds.length > 0 && (
            <div className="space-y-2 border-t pt-3">
              <Label className="text-sm font-semibold">Zulagen</Label>
              <div className="flex flex-wrap gap-1.5">
                {zulagenTypen
                  .filter((z) => verfuegbareZulagenIds.includes(z.id))
                  .map((z) => {
                    const sel = form.zulagenSelected.get(z.id);
                    const active = !!sel;
                    const primaryVal = sel?.stundenPerMa[primaryUserId];
                    return (
                      <button
                        key={z.id}
                        type="button"
                        onClick={() =>
                          setForm((f) => {
                            const next = new Map(f.zulagenSelected);
                            if (next.has(z.id)) next.delete(z.id);
                            else
                              next.set(z.id, {
                                stundenPerMa: Object.fromEntries(
                                  Array.from(forUserIds).map((uid) => [
                                    uid,
                                    z.ermoeglicht_stunden_split
                                      ? taetSummeFuer(uid)
                                      : null,
                                  ]),
                                ),
                                notiz: "",
                                proMaModus: forUserIds.size > 1,
                              });
                            return { ...f, zulagenSelected: next };
                          })
                        }
                        className={`text-xs px-2.5 py-1.5 rounded-full border transition ${
                          active
                            ? "bg-primary/10 border-primary text-primary font-semibold"
                            : "bg-background border-border text-muted-foreground hover:bg-muted"
                        }`}
                      >
                        {z.bezeichnung}
                        {active && primaryVal != null && (
                          <span className="ml-1">· {primaryVal}h</span>
                        )}
                      </button>
                    );
                  })}
              </div>
              {Array.from(form.zulagenSelected.entries()).map(([typId, val]) => {
                const z = zulagenTypen.find((x) => x.id === typId);
                if (!z?.ermoeglicht_stunden_split) return null;
                return (
                  <ZulageEditor
                    key={typId}
                    bezeichnung={z.bezeichnung}
                    eintrag={val}
                    selectedMa={selectedMaList}
                    primaryUserId={primaryUserId}
                    onChange={(updated) =>
                      setForm((f) => {
                        const next = new Map(f.zulagenSelected);
                        next.set(typId, updated);
                        return { ...f, zulagenSelected: next };
                      })
                    }
                  />
                );
              })}
            </div>
          )}

          {/* Kilometergeld — privat gefahrene km, für alle Mitarbeiter */}
          {selectedMaList.length > 0 && (
            <KilometergeldSection
              selectedMa={selectedMaList}
              kmPerMa={form.kmPerMa}
              satz={limits?.kilometergeld_satz_eur ?? 0.5}
              onChange={(uid, km) =>
                setForm((f) => ({
                  ...f,
                  kmPerMa: { ...f.kmPerMa, [uid]: km },
                }))
              }
            />
          )}

          {/* Fahrt — nur Polier-Self */}
          {istPolier && forUserIds.has(primaryUserId) && (
            <FahrtSection
              fahrt={form.fahrt}
              setFahrt={(fahrt) => setForm((f) => ({ ...f, fahrt }))}
              baustelle={
                baustellen.find(
                  (b) =>
                    b.id ===
                    (form.maEintraege[primaryUserId] ?? []).find(
                      (r) => r.art === "baustelle" && r.baustelle_id,
                    )?.baustelle_id,
                ) ?? null
              }
            />
          )}

          {/* Anmerkung */}
          <div className="space-y-1 border-t pt-3">
            <Label className="text-sm">Anmerkung (optional)</Label>
            <div className="flex items-start gap-1.5">
              <Textarea
                value={form.anmerkung}
                onChange={(e) => setForm((f) => ({ ...f, anmerkung: e.target.value }))}
                rows={2}
                className="flex-1"
              />
              <MicButton
                onText={(text) =>
                  setForm((f) => ({
                    ...f,
                    anmerkung: f.anmerkung ? `${f.anmerkung} ${text}` : text,
                  }))
                }
                className="h-9 w-9"
              />
            </div>
          </div>

          {/* Zusammenfassung */}
          {selectedMaList.length > 0 && (
            <ZusammenfassungCard
              selectedMa={selectedMaList}
              summenProMa={summenProMa}
              sollPerMa={sollPerMa}
              arbeitsbeginn={arbeitsbeginnEffective}
              limits={limits}
            />
          )}

          {/* Submit — Desktop */}
          <Button
            onClick={submit}
            disabled={busy || forUserIds.size === 0}
            className="w-full h-12 text-base hidden lg:flex"
          >
            {busy && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {submitLabel}
          </Button>
        </CardContent>
      </Card>

      {/* Mobile Sticky Submit-Bar */}
      <div
        className="lg:hidden fixed left-0 right-0 z-20 px-3 py-2 bg-card border-t shadow-lg"
        style={{ bottom: "calc(env(safe-area-inset-bottom, 0px) + 56px)" }}
      >
        <Button
          onClick={submit}
          disabled={busy || forUserIds.size === 0}
          className="w-full h-12 text-base"
        >
          {busy && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
          {submitLabel}
        </Button>
      </div>
    </div>
  );
}

// ─── Block pro Mitarbeiter ──────────────────────────────────────────────

function MaBlock({
  ma,
  single,
  eintraege,
  onChange,
  baustellen,
  taetigkeitenStamm,
  soll,
  collapsed,
  onToggleCollapse,
  canCopyToAll,
  onCopyToAll,
}: {
  ma: Profile;
  single: boolean;
  eintraege: EintragRow[];
  onChange: (rows: EintragRow[]) => void;
  baustellen: Baustelle[];
  taetigkeitenStamm: Database["public"]["Tables"]["taetigkeiten_stamm"]["Row"][];
  soll: number;
  collapsed: boolean;
  onToggleCollapse: () => void;
  canCopyToAll: boolean;
  onCopyToAll: () => void;
}) {
  const total = eintraege.reduce((s, r) => s + Number(r.stunden || 0), 0);
  const offen = single || !collapsed;

  const sections = useMemo(() => gruppiereSections(eintraege), [eintraege]);
  const lastBaustelleIdx = sections.reduce(
    (last, s, idx) => (s.art === "baustelle" ? idx : last),
    -1,
  );

  const updateEintrag = (key: string, patch: Partial<EintragRow>) =>
    onChange(eintraege.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const removeEintrag = (key: string) =>
    onChange(eintraege.filter((r) => r.key !== key));
  const addTaetigkeit = (art: TagStatus, baustelle_id: string | null) =>
    onChange([
      ...eintraege,
      {
        key: newKey(),
        art,
        baustelle_id: art === "baustelle" ? baustelle_id : null,
        taetigkeit_id: null,
        taetigkeit_freitext: "",
        stunden: 0,
        notiz: "",
      },
    ]);
  /** Aktualisiert die Baustelle nur für die übergebenen Zeilen (eine Section). */
  const setSectionBaustelle = (rowKeys: string[], baustelle_id: string | null) => {
    const set = new Set(rowKeys);
    onChange(
      eintraege.map((r) => (set.has(r.key) ? { ...r, baustelle_id } : r)),
    );
  };
  const addWeitereBaustelle = () =>
    onChange([
      ...eintraege,
      {
        key: newKey(),
        art: "baustelle",
        baustelle_id: null,
        taetigkeit_id: null,
        taetigkeit_freitext: "",
        stunden: 0,
        notiz: "",
      },
    ]);

  return (
    <div className="rounded-lg border bg-card">
      {/* Kopf */}
      <button
        type="button"
        onClick={single ? undefined : onToggleCollapse}
        className={`w-full flex items-center gap-2 px-3 py-2.5 text-left ${
          single ? "cursor-default" : "hover:bg-muted/40"
        }`}
      >
        {!single &&
          (offen ? (
            <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
          ))}
        <span className="font-semibold truncate">
          {ma.vorname} {ma.nachname}
        </span>
        <span className="ml-auto text-sm tabular-nums font-bold">{fmtH(total)}</span>
        {soll > 0 && (
          <span className="text-[11px] text-muted-foreground tabular-nums">
            / Soll {fmtHNum(soll)}
          </span>
        )}
      </button>

      {offen && (
        <div className="px-3 pb-3 space-y-2">
          {sections.length === 0 && (
            <div className="text-xs text-muted-foreground italic py-1">
              Noch keine Einträge — oben eine Art anschalten.
            </div>
          )}
          {sections.map((s, idx) => (
            <Fragment key={s.key}>
              <ArtSection
                art={s.art}
                rows={s.rows}
                baustellen={baustellen}
                taetigkeitenStamm={taetigkeitenStamm}
                onUpdate={updateEintrag}
                onRemove={removeEintrag}
                onAddSplit={() =>
                  addTaetigkeit(
                    s.art,
                    s.rows[s.rows.length - 1]?.baustelle_id ?? null,
                  )
                }
                onSectionBaustelle={(b) =>
                  setSectionBaustelle(
                    s.rows.map((r) => r.key),
                    b,
                  )
                }
              />
              {idx === lastBaustelleIdx && (
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full h-11"
                  onClick={addWeitereBaustelle}
                >
                  <Plus className="h-4 w-4 mr-1.5" />
                  weitere Baustelle
                </Button>
              )}
            </Fragment>
          ))}

          {canCopyToAll && eintraege.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              className="w-full mt-1 h-10"
              onClick={onCopyToAll}
            >
              <Copy className="h-3.5 w-3.5 mr-1.5" />
              Diese Einträge für alle übernehmen
            </Button>
          )}
        </div>
      )}
    </div>
  );
}


// ─── ZulageEditor (alle gleich / pro MA) ────────────────────────────────

function ZulageEditor({
  bezeichnung,
  eintrag,
  selectedMa,
  primaryUserId,
  onChange,
}: {
  bezeichnung: string;
  eintrag: ZulageEintrag;
  selectedMa: Profile[];
  primaryUserId: string;
  onChange: (next: ZulageEintrag) => void;
}) {
  const isMulti = selectedMa.length > 1;
  const userIds = selectedMa.map((m) => m.id);
  const primaryVal = eintrag.stundenPerMa[primaryUserId] ?? null;

  const setStundenAlle = (v: number | null) => {
    const sper: Record<string, number | null> = {};
    for (const uid of userIds) sper[uid] = v;
    onChange({ ...eintrag, stundenPerMa: sper });
  };
  const setStundenPerMa = (uid: string, v: number | null) => {
    onChange({ ...eintrag, stundenPerMa: { ...eintrag.stundenPerMa, [uid]: v } });
  };
  const enableProMa = () => onChange({ ...eintrag, proMaModus: true });
  const disableProMa = () => {
    const numVals = userIds
      .map((uid) => eintrag.stundenPerMa[uid])
      .filter((x): x is number => typeof x === "number");
    const newVal: number | null = numVals.length > 0 ? Math.max(...numVals) : null;
    const sper: Record<string, number | null> = {};
    for (const uid of userIds) sper[uid] = newVal;
    onChange({ ...eintrag, stundenPerMa: sper, proMaModus: false });
  };

  return (
    <div className="rounded-md border p-2.5 bg-muted/20 space-y-2">
      <div className="text-sm font-semibold">{bezeichnung}</div>
      {!isMulti && (
        <ZulagenStundenInput
          value={primaryVal}
          onChange={(v) => setStundenPerMa(primaryUserId, v)}
        />
      )}
      {isMulti && !eintrag.proMaModus && (
        <div className="space-y-1.5">
          <ZulagenStundenInput value={primaryVal} onChange={setStundenAlle} />
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-muted-foreground">
              ↳ für alle {userIds.length} Mitarbeiter (leer = alle Std)
            </span>
            <button
              type="button"
              onClick={enableProMa}
              className="text-primary hover:underline font-medium"
            >
              Pro MA unterschiedlich →
            </button>
          </div>
        </div>
      )}
      {isMulti && eintrag.proMaModus && (
        <div className="space-y-1.5">
          {selectedMa.map((m) => (
            <div
              key={m.id}
              className="flex items-center gap-2 bg-background border rounded-md p-2"
            >
              <span className="text-sm font-medium truncate w-20 sm:w-24 shrink-0">
                {m.vorname}
              </span>
              <div className="flex-1 flex items-center justify-end">
                <ZulagenStundenInput
                  value={eintrag.stundenPerMa[m.id] ?? null}
                  onChange={(v) => setStundenPerMa(m.id, v)}
                />
              </div>
            </div>
          ))}
          <div className="flex items-center justify-end text-[11px]">
            <button
              type="button"
              onClick={disableProMa}
              className="text-primary hover:underline font-medium"
            >
              ← Alle gleich machen
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function ZulagenStundenInput({
  value,
  onChange,
}: {
  value: number | null;
  onChange: (v: number | null) => void;
}) {
  return (
    <div className="flex items-center gap-1">
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="h-9 w-9 shrink-0"
        onClick={() => {
          const cur = value ?? 0;
          onChange(Math.max(0, +(cur - 0.25).toFixed(2)));
        }}
      >
        <Minus className="h-4 w-4" />
      </Button>
      <Input
        type="number"
        step={0.25}
        min={0}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
        placeholder="alle"
        className="h-9 w-20 text-center text-sm font-semibold tabular-nums"
      />
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="h-9 w-9 shrink-0"
        onClick={() => {
          const cur = value ?? 0;
          onChange(+(cur + 0.25).toFixed(2));
        }}
      >
        <Plus className="h-4 w-4" />
      </Button>
      <span className="text-xs text-muted-foreground ml-1">h</span>
    </div>
  );
}

// ─── KilometergeldSection (privat gefahrene km, für alle) ──────────────

function KilometergeldSection({
  selectedMa,
  kmPerMa,
  satz,
  onChange,
}: {
  selectedMa: Profile[];
  kmPerMa: Record<string, number>;
  satz: number;
  onChange: (uid: string, km: number) => void;
}) {
  const single = selectedMa.length === 1;
  const hasKm = selectedMa.some((m) => Number(kmPerMa[m.id] ?? 0) > 0);
  const [open, setOpen] = useState(hasKm);
  // Wenn von außen km-Werte gesetzt werden (z. B. beim Laden eines Tages),
  // einmalig öffnen.
  useEffect(() => {
    if (hasKm) setOpen(true);
  }, [hasKm]);

  const summe = selectedMa.reduce(
    (s, m) => s + Math.max(0, Number(kmPerMa[m.id] ?? 0)),
    0,
  );

  return (
    <div className="border-t pt-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full h-11 flex items-center gap-2 text-left"
      >
        <Car className="h-4 w-4 text-primary shrink-0" />
        <span className="text-sm font-semibold">Kilometergeld</span>
        <span className="ml-auto text-xs text-muted-foreground tabular-nums">
          {summe > 0
            ? `${summe} km · ${(Math.round(summe * satz * 100) / 100)
                .toFixed(2)
                .replace(".", ",")} €`
            : "Privat gefahren?"}
        </span>
        {open ? (
          <ChevronUp className="h-4 w-4 text-muted-foreground shrink-0" />
        ) : (
          <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
        )}
      </button>

      {open && (
        <div className="space-y-2 pt-2">
          <div className="text-[11px] text-muted-foreground">
            Privat gefahrene Kilometer — {satz.toFixed(2).replace(".", ",")} €/km
          </div>
          <div className="space-y-1.5">
            {selectedMa.map((m) => {
              const km = Math.max(0, Number(kmPerMa[m.id] ?? 0));
              const geld = Math.round(km * satz * 100) / 100;
              return (
                <div key={m.id} className="flex items-center gap-2 flex-wrap">
                  {!single && (
                    <span className="text-sm font-medium truncate w-24 shrink-0">
                      {m.vorname} {m.nachname?.[0] ?? ""}.
                    </span>
                  )}
                  <div className="flex items-center gap-1">
                    <Input
                      type="number"
                      min={0}
                      step={1}
                      inputMode="numeric"
                      value={km || ""}
                      onChange={(e) =>
                        onChange(m.id, Math.max(0, Number(e.target.value) || 0))
                      }
                      placeholder="0"
                      className="h-10 w-24 text-center tabular-nums"
                    />
                    <span className="text-xs text-muted-foreground">km</span>
                  </div>
                  <span className="text-sm tabular-nums font-semibold text-primary">
                    = {geld.toFixed(2).replace(".", ",")} €
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── FahrtSection (Polier-Self) ────────────────────────────────────────

function FahrtSection({
  fahrt,
  setFahrt,
  baustelle,
}: {
  fahrt: SaveFahrt | null;
  setFahrt: (f: SaveFahrt | null) => void;
  baustelle: Baustelle | null;
}) {
  const enabled = !!fahrt;
  const toggle = () => {
    if (enabled) setFahrt(null);
    else
      setFahrt({
        fahrtgeld_eur: Number(baustelle?.fahrtgeld_pauschale_eur ?? 0),
        privat_pkw: false,
        km_gefahren: null,
        taggeld_kurz: 0,
        taggeld_lang: 0,
        taggeld_manuell: false,
      });
  };
  return (
    <div className="space-y-2 border-t pt-3">
      <div className="flex items-center gap-2">
        <Switch checked={enabled} onCheckedChange={toggle} />
        <Label className="text-sm font-semibold flex items-center gap-1.5 cursor-pointer">
          <Car className="h-4 w-4 text-primary" />
          Fahrtgeld &amp; Taggeld (Polier)
        </Label>
      </div>
      {enabled && fahrt && (
        <div className="space-y-2 pl-1">
          <div className="space-y-1">
            <Label className="text-xs">Fahrtgeld (€)</Label>
            <Input
              type="number"
              step={0.5}
              min={0}
              value={fahrt.fahrtgeld_eur}
              onChange={(e) =>
                setFahrt({ ...fahrt, fahrtgeld_eur: Number(e.target.value) || 0 })
              }
              className="h-9"
            />
            {baustelle && Number(baustelle.fahrtgeld_pauschale_eur) > 0 && (
              <div className="text-[10px] text-muted-foreground">
                Default aus Baustelle: € {baustelle.fahrtgeld_pauschale_eur}
              </div>
            )}
          </div>
          <div className="space-y-2 border-t pt-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-semibold">Taggeld</Label>
              <label className="flex items-center gap-2 text-xs cursor-pointer">
                <Switch
                  checked={fahrt.taggeld_manuell}
                  onCheckedChange={(v) => setFahrt({ ...fahrt, taggeld_manuell: v })}
                />
                <span>Manuell überschreiben</span>
              </label>
            </div>
            {fahrt.taggeld_manuell ? (
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="text-xs">Taggeld kurz</Label>
                  <Input
                    type="number"
                    step={1}
                    min={0}
                    value={fahrt.taggeld_kurz}
                    onChange={(e) =>
                      setFahrt({ ...fahrt, taggeld_kurz: Number(e.target.value) || 0 })
                    }
                    className="h-9"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Taggeld lang</Label>
                  <Input
                    type="number"
                    step={1}
                    min={0}
                    value={fahrt.taggeld_lang}
                    onChange={(e) =>
                      setFahrt({ ...fahrt, taggeld_lang: Number(e.target.value) || 0 })
                    }
                    className="h-9"
                  />
                </div>
              </div>
            ) : (
              <div className="text-xs text-muted-foreground italic">
                Wird automatisch aus den Baustellen-Stunden berechnet (kurz &lt; 9 h,
                lang ≥ 9 h).
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── ZusammenfassungCard ────────────────────────────────────────────────

function ZusammenfassungCard({
  selectedMa,
  summenProMa,
  sollPerMa,
  arbeitsbeginn,
  limits,
}: {
  selectedMa: Profile[];
  summenProMa: Map<string, number>;
  sollPerMa: Map<string, number>;
  arbeitsbeginn: string;
  limits:
    | { max_netto_pro_tag: number; max_brutto_pro_tag: number; arbeitsbeginn_default: string }
    | undefined;
}) {
  return (
    <div className="rounded-lg border bg-primary/5 border-primary/20 p-3 space-y-1.5">
      <div className="text-[11px] font-semibold uppercase text-primary">
        Zusammenfassung
      </div>
      {selectedMa.map((m) => {
        const netto = summenProMa.get(m.id) ?? 0;
        const z = berechneTagZeiten({ nettoStunden: netto, arbeitsbeginn });
        const soll = sollPerMa.get(m.id) ?? 0;
        const ueber = ueberstundenForTag(z, soll);
        const azg = limits
          ? pruefArbeitszeitGesetz(z, {
              maxNettoProTag: limits.max_netto_pro_tag,
              maxBruttoProTag: limits.max_brutto_pro_tag,
              arbeitsbeginnDefault: limits.arbeitsbeginn_default,
            })
          : { ok: true as const };
        return (
          <div
            key={m.id}
            className="flex items-center gap-2 flex-wrap text-xs border-t border-primary/10 pt-1.5 first:border-0 first:pt-0"
          >
            <span className="font-semibold w-28 truncate">
              {m.vorname} {m.nachname[0] ?? ""}.
            </span>
            <span className="tabular-nums font-bold">{fmtH(netto)}</span>
            {netto > 0 && (
              <span className="text-muted-foreground tabular-nums">
                {z.von}–{z.bis}
              </span>
            )}
            {soll > 0 && (
              <span
                className={
                  ueber.diff > 0
                    ? "text-emerald-700 tabular-nums"
                    : ueber.diff < 0
                    ? "text-amber-700 tabular-nums"
                    : "text-muted-foreground tabular-nums"
                }
              >
                Soll {fmtH(soll)}
                {ueber.diff !== 0 && (
                  <>
                    {" "}
                    ({ueber.diff > 0 ? "+" : "−"}
                    {fmtHNum(Math.abs(ueber.diff))})
                  </>
                )}
              </span>
            )}
            {!azg.ok && (
              <Badge
                variant="outline"
                className="text-[10px] bg-destructive/10 border-destructive text-destructive"
              >
                <AlertTriangle className="h-3 w-3 mr-1" /> {azg.meldung}
              </Badge>
            )}
          </div>
        );
      })}
    </div>
  );
}
