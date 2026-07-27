import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Database, TagStatus } from "@/integrations/supabase/types";
import { getPoliereinsatzFuerTag, vergleichePartien } from "@/lib/tagesplanung";

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
  mitarbeiter: { ma: EinteilungMa; profil: Profile | null; istLeiter: boolean }[];
  /** Die Partie, der diese Einteilung zugerechnet wird — bestimmt die
   *  Reihenfolge im Tagesplan (wie im Poliereinsatz). */
  partie: Partie | null;
  /** TRUE, wenn die Einteilung ursprünglich Leute hatte, aber ALLE davon
   *  `in_tagesplanung = false` sind (Büro). Solche Zeilen sind Altlasten und
   *  werden im Ausdruck weggelassen — anders als eine frisch angelegte
   *  Baustelle, die noch niemanden hat und sichtbar bleiben muss. */
  nurAusgeblendete: boolean;
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
        // MS-Project-Ausdruck (Partie-sort_order). Gemeinsamer Helfer, damit
        // hier und in der Vorbelegung dieselbe Partie→Baustelle-Paarung gilt.
        getPoliereinsatzFuerTag(datum).then(
          (m) => ({
            data: Array.from(m.entries()).map(([partie_id, baustelle_id]) => ({
              partie_id,
              baustelle_id,
            })),
          }),
          () => ({ data: null } as any),
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

      // Wer gehört überhaupt in die Tagesplanung? Das Büro (10 Personen) ist
      // per profiles.in_tagesplanung = false ausgenommen. In Einteilungen von
      // vor dieser Umstellung stehen die Leute aber noch drin und würden
      // mitgedruckt — deshalb hier an der Quelle aussortieren.
      const gehoertInPlanung = (id: string) =>
        (mitarbeiter.get(id) as any)?.in_tagesplanung !== false;

      const emByEinteilung = new Map<string, { ma: EinteilungMa; profil: Profile | null }[]>();
      /** Einteilungen, die NUR ausgeblendete Personen hatten (reine Büro-Zeilen). */
      const hatteRohzeilen = new Set<string>();
      (emRaw ?? []).forEach((e: any) => {
        hatteRohzeilen.add(e.einteilung_id);
        if (!gehoertInPlanung(e.mitarbeiter_id)) return;
        // Kein auflösbares Profil = ausgetretener Mitarbeiter (profiles wird
        // mit is_active = true geladen), der noch in alten Einteilungen steht.
        // Anzeigbar ist er nicht; früher belegte er dort stumm einen Platz und
        // brachte im PDF die Fettschrift des Poliers aus dem Takt, weil er
        // ohne Nachnamen an erster Stelle sortierte.
        const profil = mitarbeiter.get(e.mitarbeiter_id) ?? null;
        if (!profil) return;
        const arr = emByEinteilung.get(e.einteilung_id) ?? [];
        arr.push({ ma: e as EinteilungMa, profil });
        emByEinteilung.set(e.einteilung_id, arr);
      });

      const partienById = new Map(((pRaw as Partie[]) ?? []).map((p: any) => [p.id, p as Partie]));

      // Wer ist WIRKLICH Vorarbeiter/Polier? Live aus der Partie-Verwaltung
      // (partien.partieleiter_id) — nicht aus dem is_partieleiter-Flag, das
      // bei Leiter-Wechseln veralten kann.
      const leiterIds = new Set(
        ((pRaw as Partie[]) ?? [])
          .map((p: any) => p.partieleiter_id)
          .filter(Boolean),
      );
      /** Partieleiter → seine Partie. */
      const partieVonLeiter = new Map(
        ((pRaw as Partie[]) ?? [])
          .filter((p: any) => p.partieleiter_id)
          .map((p: any) => [p.partieleiter_id as string, p.id as string]),
      );
      /** Poliereinsatz des Tages: Baustelle → Partie (Rückfall ohne Mannschaft). */
      const partieVonBaustelle = new Map<string, string>();
      ((polierRaw as any[]) ?? []).forEach((z: any) => {
        if (!z.baustelle_id || !z.partie_id) return;
        const bisher = partieVonBaustelle.get(z.baustelle_id);
        if (
          bisher === undefined ||
          vergleichePartien(partienById.get(z.partie_id), partienById.get(bisher)) < 0
        ) {
          partieVonBaustelle.set(z.baustelle_id, z.partie_id);
        }
      });

      /**
       * Welcher Partie gehört diese Einteilung?
       *
       * Vorher hing der Sortierschlüssel an der BAUSTELLE. Arbeiten dort zwei
       * Partien (z.B. HMH Skrube: Gruber montiert, die Werkstatt fertigt vor),
       * bekamen beide Zeilen denselben Schlüssel und klebten aneinander — die
       * Werkstatt rutschte von Platz 8 auf Platz 3.
       */
      const partieDerEinteilung = (
        e: any,
        mas: { profil: Profile | null }[],
      ): Partie | null => {
        // 1. Der Partieleiter in der Mannschaft entscheidet.
        for (const m of mas) {
          const pid = m.profil ? partieVonLeiter.get(m.profil.id) : undefined;
          if (pid) return partienById.get(pid) ?? null;
        }
        // 2. Sonst die häufigste Partie der Mitarbeiter; bei Gleichstand die
        //    in der Polierplanung vordere.
        const zaehler = new Map<string, number>();
        for (const m of mas) {
          const pid = (m.profil as any)?.partie_id;
          if (pid) zaehler.set(pid, (zaehler.get(pid) ?? 0) + 1);
        }
        let best: string | null = null;
        let bestN = 0;
        for (const [pid, n] of zaehler) {
          const gewinnt =
            best === null ||
            n > bestN ||
            (n === bestN &&
              vergleichePartien(partienById.get(pid), partienById.get(best)) < 0);
          if (gewinnt) {
            best = pid;
            bestN = n;
          }
        }
        if (best) return partienById.get(best) ?? null;
        // 3. Ohne Mannschaft: der Poliereinsatz der Baustelle (altes Verhalten).
        const viaBaustelle = e.baustelle_id
          ? partieVonBaustelle.get(e.baustelle_id)
          : undefined;
        return viaBaustelle ? partienById.get(viaBaustelle) ?? null : null;
      };

      const einteilungen: EinteilungMitDetails[] = (einteilungenRaw ?? [])
        .map((e: any) => {
          const mas = (emByEinteilung.get(e.id) ?? [])
            .map((m) => ({ ...m, istLeiter: !!m.profil && leiterIds.has(m.profil.id) }))
            .sort((a, b) => {
              // Polier/Partieleiter immer ganz oben, danach alphabetisch.
              const al = a.istLeiter ? 0 : 1;
              const bl = b.istLeiter ? 0 : 1;
              if (al !== bl) return al - bl;
              const an = a.profil?.nachname ?? "";
              const bn = b.profil?.nachname ?? "";
              return an.localeCompare(bn);
            });
          return {
            einteilung: e as Einteilung,
            baustelle: baustellen.get(e.baustelle_id) ?? null,
            fahrzeuge: efByEinteilung.get(e.id) ?? [],
            mitarbeiter: mas,
            partie: partieDerEinteilung(e, mas),
            nurAusgeblendete: mas.length === 0 && hatteRohzeilen.has(e.id),
          };
        })
        // Reihenfolge wie die Polierplanung, dann BVH-Name als Stichentscheid.
        .sort((a, b) => {
          const p = vergleichePartien(a.partie, b.partie);
          if (p !== 0) return p;
          return (a.baustelle?.bvh_name ?? "").localeCompare(b.baustelle?.bvh_name ?? "");
        });

      // Abwesende: stunden_tage + genehmigte urlaubsantraege (deduped).
      // Personen außerhalb der Tagesplanung (Büro/Bauleitung, in_tagesplanung
      // = false) werden hier nicht gelistet — sie sind nie eingeteilt.
      const inPlanung = gehoertInPlanung;
      const abwesendIds = new Set<string>();
      const abwesende: AbwesenheitDetail[] = [];
      (tageRaw ?? []).forEach((t: any) => {
        if (abwesendIds.has(t.mitarbeiter_id)) return;
        const ma = mitarbeiter.get(t.mitarbeiter_id);
        if (!ma || !inPlanung(t.mitarbeiter_id)) return;
        abwesendIds.add(t.mitarbeiter_id);
        abwesende.push({ ma, status: t.tag_status as TagStatus });
      });
      (antragRaw ?? []).forEach((a: any) => {
        if (abwesendIds.has(a.mitarbeiter_id)) return;
        const ma = mitarbeiter.get(a.mitarbeiter_id);
        if (!ma || !inPlanung(a.mitarbeiter_id)) return;
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
        // Auswahl-Liste: nur in der Tagesplanung einteilbare Mitarbeiter
        alleMa: (((maRaw as Profile[]) ?? []) as any[]).filter(
          (m) => m.in_tagesplanung !== false,
        ) as Profile[],
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
