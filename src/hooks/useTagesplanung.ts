import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Database, TagStatus } from "@/integrations/supabase/types";

type Profile = Database["public"]["Tables"]["profiles"]["Row"];
type Baustelle = Database["public"]["Tables"]["baustellen"]["Row"];
type Fahrzeug = Database["public"]["Tables"]["fahrzeuge"]["Row"];
type Einteilung = Database["public"]["Tables"]["einteilungen"]["Row"];
type EinteilungMa = Database["public"]["Tables"]["einteilung_mitarbeiter"]["Row"];
type EinteilungFz = Database["public"]["Tables"]["einteilung_fahrzeuge"]["Row"];
type Partie = Database["public"]["Tables"]["partien"]["Row"];

export interface EinteilungMitDetails {
  einteilung: Einteilung;
  baustelle: Baustelle | null;
  fahrzeuge: Fahrzeug[];
  mitarbeiter: { ma: EinteilungMa; profil: Profile | null }[];
}

export interface AbwesenheitDetail {
  ma: Profile;
  status: TagStatus | "urlaub_antrag";
  seit?: string;
  bis?: string;
}

export interface TagesPlanData {
  datum: string;
  einteilungen: EinteilungMitDetails[];
  abwesende: AbwesenheitDetail[];
  freigabe: Database["public"]["Tables"]["tagesplanung_freigaben"]["Row"] | null;
  letzteFreigegeben: Database["public"]["Tables"]["tagesplanung_freigaben"]["Row"] | null;
  partien: Partie[];
  alleMa: Profile[];
}

/** Lädt den kompletten Tagesplan inkl. Sonderfälle + Freigabe-Status,
 *  abonniert Realtime auf alle betroffenen Tabellen. */
export function useTagesplanung(datum: string) {
  const qc = useQueryClient();

  const q = useQuery<TagesPlanData>({
    queryKey: ["tagesplan", datum],
    queryFn: async () => {
      const [
        { data: einteilungenRaw },
        { data: emRaw },
        { data: efRaw },
        { data: bsRaw },
        { data: fzRaw },
        { data: pRaw },
        { data: maRaw },
        { data: tageRaw },
        { data: antragRaw },
        { data: freiRaw },
        { data: letzteFreiRaw },
        { data: polierRaw },
      ] = await Promise.all([
        supabase.from("einteilungen").select("*").eq("datum", datum),
        supabase
          .from("einteilung_mitarbeiter")
          .select("*, einteilung:einteilungen!inner(datum)")
          .eq("einteilung.datum", datum),
        supabase
          .from("einteilung_fahrzeuge")
          .select("*, einteilung:einteilungen!inner(datum)")
          .eq("einteilung.datum", datum),
        supabase.from("baustellen").select("*"),
        supabase.from("fahrzeuge").select("*"),
        supabase.from("partien").select("*").order("name"),
        supabase.from("profiles").select("*").eq("is_active", true).order("nachname"),
        supabase
          .from("stunden_tage")
          .select("mitarbeiter_id, tag_status, datum")
          .eq("datum", datum)
          .in("tag_status", ["urlaub", "krank", "schlechtwetter"]),
        // Neue Tabellen — defensiv, falls Migration noch nicht durchgelaufen
        supabase
          .from("urlaubsantraege")
          .select("mitarbeiter_id, von, bis, status")
          .eq("status", "genehmigt")
          .lte("von", datum)
          .gte("bis", datum)
          .then(
            (r) => r,
            () => ({ data: null, error: null } as any),
          ),
        supabase
          .from("tagesplanung_freigaben")
          .select("*")
          .eq("datum", datum)
          .maybeSingle()
          .then(
            (r) => r,
            () => ({ data: null, error: null } as any),
          ),
        supabase
          .from("tagesplanung_freigaben")
          .select("*")
          .lte("datum", datum)
          // Notiz-only-Zeilen (freigegeben_am NULL) zählen nicht als
          // "zuletzt freigegebener Plan".
          .not("freigegeben_am", "is", null)
          .order("datum", { ascending: false })
          .limit(1)
          .maybeSingle()
          .then(
            (r) => r,
            () => ({ data: null, error: null } as any),
          ),
        // Poliereinsatz des Tages → Reihenfolge der Baustellen wie im
        // MS-Project-Ausdruck (Partie-sort_order).
        supabase
          .from("poliereinsatz_zeitraeume" as any)
          .select("partie_id, baustelle_id")
          .lte("von_datum", datum)
          .gte("bis_datum", datum)
          .then(
            (r) => r,
            () => ({ data: null, error: null } as any),
          ),
      ]);

      const baustellen = new Map((bsRaw ?? []).map((b: any) => [b.id, b as Baustelle]));
      const fahrzeuge = new Map((fzRaw ?? []).map((f: any) => [f.id, f as Fahrzeug]));
      const mitarbeiter = new Map((maRaw ?? []).map((m: any) => [m.id, m as Profile]));

      const efByEinteilung = new Map<string, Fahrzeug[]>();
      (efRaw ?? []).forEach((e: any) => {
        const arr = efByEinteilung.get(e.einteilung_id) ?? [];
        const fz = fahrzeuge.get(e.fahrzeug_id);
        if (fz) arr.push(fz);
        efByEinteilung.set(e.einteilung_id, arr);
      });

      const emByEinteilung = new Map<string, { ma: EinteilungMa; profil: Profile | null }[]>();
      (emRaw ?? []).forEach((e: any) => {
        const arr = emByEinteilung.get(e.einteilung_id) ?? [];
        arr.push({ ma: e as EinteilungMa, profil: mitarbeiter.get(e.mitarbeiter_id) ?? null });
        emByEinteilung.set(e.einteilung_id, arr);
      });

      // Reihenfolge wie die Polier-Vorlage: Baustelle → sort_order der
      // Partie, die laut Poliereinsatz heute dort ist. Baustellen ohne
      // Polier-Zuordnung kommen dahinter (alphabetisch).
      const partieSort = new Map(
        ((pRaw as Partie[]) ?? []).map((p: any) => [p.id, p.sort_order ?? 9999]),
      );
      const bstSort = new Map<string, number>();
      ((polierRaw as any[]) ?? []).forEach((z: any) => {
        const so = partieSort.get(z.partie_id) ?? 9999;
        const cur = bstSort.get(z.baustelle_id);
        if (cur === undefined || so < cur) bstSort.set(z.baustelle_id, so);
      });

      const einteilungen: EinteilungMitDetails[] = (einteilungenRaw ?? [])
        .map((e: any) => ({
          einteilung: e as Einteilung,
          baustelle: baustellen.get(e.baustelle_id) ?? null,
          fahrzeuge: efByEinteilung.get(e.id) ?? [],
          mitarbeiter: (emByEinteilung.get(e.id) ?? []).sort((a, b) => {
            const an = a.profil?.nachname ?? "";
            const bn = b.profil?.nachname ?? "";
            return an.localeCompare(bn);
          }),
        }))
        .sort((a, b) => {
          const sa = bstSort.get(a.einteilung.baustelle_id ?? "") ?? 99999;
          const sb = bstSort.get(b.einteilung.baustelle_id ?? "") ?? 99999;
          if (sa !== sb) return sa - sb;
          return (a.baustelle?.bvh_name ?? "").localeCompare(b.baustelle?.bvh_name ?? "");
        });

      // Abwesende: stunden_tage + genehmigte urlaubsantraege (deduped)
      const abwesendIds = new Set<string>();
      const abwesende: AbwesenheitDetail[] = [];
      (tageRaw ?? []).forEach((t: any) => {
        if (abwesendIds.has(t.mitarbeiter_id)) return;
        const ma = mitarbeiter.get(t.mitarbeiter_id);
        if (!ma) return;
        abwesendIds.add(t.mitarbeiter_id);
        abwesende.push({ ma, status: t.tag_status as TagStatus });
      });
      (antragRaw ?? []).forEach((a: any) => {
        if (abwesendIds.has(a.mitarbeiter_id)) return;
        const ma = mitarbeiter.get(a.mitarbeiter_id);
        if (!ma) return;
        abwesendIds.add(a.mitarbeiter_id);
        abwesende.push({ ma, status: "urlaub", seit: a.von, bis: a.bis });
      });

      return {
        datum,
        einteilungen,
        abwesende,
        freigabe: freiRaw ?? null,
        letzteFreigegeben: letzteFreiRaw ?? null,
        partien: (pRaw as Partie[]) ?? [],
        alleMa: (maRaw as Profile[]) ?? [],
      };
    },
    enabled: !!datum,
  });

  // Realtime-Subscription
  useEffect(() => {
    if (!datum) return;
    const channel = supabase
      .channel(`tagesplan-${datum}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "einteilungen", filter: `datum=eq.${datum}` },
        () => qc.invalidateQueries({ queryKey: ["tagesplan", datum] }),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "einteilung_mitarbeiter" },
        () => qc.invalidateQueries({ queryKey: ["tagesplan", datum] }),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "einteilung_fahrzeuge" },
        () => qc.invalidateQueries({ queryKey: ["tagesplan", datum] }),
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "tagesplanung_freigaben",
          filter: `datum=eq.${datum}`,
        },
        () => qc.invalidateQueries({ queryKey: ["tagesplan", datum] }),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "stunden_tage", filter: `datum=eq.${datum}` },
        () => qc.invalidateQueries({ queryKey: ["tagesplan", datum] }),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "urlaubsantraege" },
        () => qc.invalidateQueries({ queryKey: ["tagesplan", datum] }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [datum, qc]);

  return q;
}
