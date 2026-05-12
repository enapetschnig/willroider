import * as XLSX from "xlsx";
import type { Database } from "@/integrations/supabase/types";
import { ZULAGEN } from "@/lib/zulagen";
import { werktageImMonat } from "@/lib/konten";

type Stunde = Database["public"]["Tables"]["stundenbuchungen"]["Row"];
type Profile = Database["public"]["Tables"]["profiles"]["Row"];
type Baustelle = Database["public"]["Tables"]["baustellen"]["Row"];
type Partie = Database["public"]["Tables"]["partien"]["Row"];
type PKS = Database["public"]["Tables"]["profile_konten_settings"]["Row"];

export type ExportInput = {
  monat: string; // 'yyyy-mm'
  rows: Stunde[];
  members: Profile[];
  baustellen: Baustelle[];
  partien: Partie[];
  pks: PKS[]; // pro MA Konto-Einstellungen
  zaSalden: Record<string, number>;
  urlaubSalden: Record<string, number>;
};

const WT = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
const fmtTime = (t: string | null) => (t ? t.slice(0, 5) : "");
const fmtNum = (n: number) => Number(n.toFixed(2));

function pauseMin(s: Stunde): number {
  if (!s.pause_von || !s.pause_bis) return 0;
  const [vh, vm] = s.pause_von.slice(0, 5).split(":").map(Number);
  const [bh, bm] = s.pause_bis.slice(0, 5).split(":").map(Number);
  return bh * 60 + bm - (vh * 60 + vm);
}

export function exportStundenauswertung(input: ExportInput) {
  const { monat, rows, members, baustellen, partien, pks, zaSalden, urlaubSalden } = input;

  const baustelleById = new Map(baustellen.map((b) => [b.id, b]));
  const partieById = new Map(partien.map((p) => [p.id, p]));
  const memberById = new Map(members.map((m) => [m.id, m]));
  const pksById = new Map(pks.map((p) => [p.profile_id, p]));

  const [year, month] = monat.split("-").map(Number);
  const werktage = werktageImMonat(year, month);

  const wb = XLSX.utils.book_new();

  // Sheet 1: Übersicht — eine Zeile pro MA
  const uebersichtRows: any[] = [];
  members.forEach((m) => {
    const set = pksById.get(m.id);
    const tagesnorm = Number(set?.tagesnorm_stunden ?? 8);
    const grad = Number(set?.beschaeftigungsgrad ?? 1);
    const soll = werktage * tagesnorm * grad;
    const myRows = rows.filter((r) => r.mitarbeiter_id === m.id);
    let arbeit = 0,
      firma = 0,
      fahrt = 0,
      fehlU = 0,
      fehlK = 0,
      fehlF = 0,
      fehlSW = 0;
    let tgK = 0,
      tgL = 0,
      km = 0;
    const zulMap: Record<string, number> = {};
    ZULAGEN.forEach((z) => (zulMap[z.key] = 0));
    myRows.forEach((r) => {
      if (r.fehlzeit_typ) {
        const fh = Number(r.fehlzeit_stunden ?? 0);
        if (r.fehlzeit_typ === "U") fehlU += fh;
        else if (r.fehlzeit_typ === "K") fehlK += fh;
        else if (r.fehlzeit_typ === "F") fehlF += fh;
        else if (r.fehlzeit_typ === "SW") fehlSW += fh;
      } else {
        const ah = Number(r.arbeitsstunden ?? 0);
        if (r.in_firma) firma += ah;
        else arbeit += ah;
      }
      fahrt += Number(r.fahrstunden ?? 0);
      tgK += Number(r.taggeld_kurz ?? 0);
      tgL += Number(r.taggeld_lang ?? 0);
      km += Number(r.km_gefahren ?? 0);
      if (r.zulage_typ && r.zulage_stunden) {
        zulMap[r.zulage_typ] = (zulMap[r.zulage_typ] ?? 0) + Number(r.zulage_stunden);
      }
    });
    const ist = arbeit + firma + fahrt + fehlU + fehlK + fehlF + fehlSW;
    uebersichtRows.push({
      "Pers.Nr.": m.pers_nr ?? "",
      Name: `${m.nachname}, ${m.vorname}`,
      Partie: partieById.get(m.partie_id ?? "")?.name ?? "",
      "Arbeit (h)": fmtNum(arbeit),
      "Firma (h)": fmtNum(firma),
      "Fahrt (h)": fmtNum(fahrt),
      "Urlaub (h)": fmtNum(fehlU),
      "Krank (h)": fmtNum(fehlK),
      "Feiertag (h)": fmtNum(fehlF),
      "Schlechtwetter (h)": fmtNum(fehlSW),
      "TG kurz (Tg)": tgK,
      "TG lang (Tg)": tgL,
      "KM": km,
      "Aufsicht (h)": fmtNum(zulMap["aufsicht"] ?? 0),
      "Schmutz (h)": fmtNum(zulMap["schmutz"] ?? 0),
      "Höhe (h)": fmtNum(zulMap["hoehe"] ?? 0),
      "Andere Zulage (h)": fmtNum(zulMap["andere"] ?? 0),
      "Soll (h)": fmtNum(soll),
      "Ist (h)": fmtNum(ist),
      "Differenz (h)": fmtNum(ist - soll),
      "ZA-Saldo (h)": fmtNum(zaSalden[m.id] ?? 0),
      "Urlaubs-Saldo (Tg)": fmtNum(urlaubSalden[m.id] ?? 0),
    });
  });
  const ws1 = XLSX.utils.json_to_sheet(uebersichtRows);
  autoWidth(ws1, uebersichtRows);
  XLSX.utils.book_append_sheet(wb, ws1, "Übersicht");

  // Sheet 2: Buchungen Detail — flach, eine Zeile pro Buchung
  const detailRows: any[] = [];
  const sorted = [...rows].sort((a, b) => {
    if (a.datum !== b.datum) return a.datum.localeCompare(b.datum);
    return (a.start_zeit ?? "").localeCompare(b.start_zeit ?? "");
  });
  sorted.forEach((r) => {
    const m = memberById.get(r.mitarbeiter_id);
    const b = baustelleById.get(r.baustelle_id ?? "");
    const d = new Date(r.datum);
    detailRows.push({
      Datum: r.datum,
      Wt: WT[d.getDay()],
      "Pers.Nr.": m?.pers_nr ?? "",
      Mitarbeiter: m ? `${m.nachname}, ${m.vorname}` : "",
      BVH: b?.bvh_name ?? "",
      Kostenstelle: b?.kostenstelle ?? "",
      Tätigkeit: r.taetigkeit ?? "",
      Start: fmtTime(r.start_zeit),
      Ende: fmtTime(r.end_zeit),
      "Pause von": fmtTime(r.pause_von),
      "Pause bis": fmtTime(r.pause_bis),
      "Pause (min)": pauseMin(r),
      Arbeit: fmtNum(Number(r.arbeitsstunden ?? 0)),
      Fahrt: fmtNum(Number(r.fahrstunden ?? 0)),
      "in Firma": r.in_firma ? "ja" : "",
      "TG kurz": Number(r.taggeld_kurz ?? 0),
      "TG lang": Number(r.taggeld_lang ?? 0),
      KM: Number(r.km_gefahren ?? 0),
      "Zulage-Typ": r.zulage_typ ?? "",
      "Zulage-Stunden": fmtNum(Number(r.zulage_stunden ?? 0)),
      "Zulage-Notiz": r.zulage_notiz ?? "",
      Fehlzeit: r.fehlzeit_typ ?? "",
      "Fehlzeit-Stunden": fmtNum(Number(r.fehlzeit_stunden ?? 0)),
      Status: r.status,
      Notizen: r.notizen ?? "",
    });
  });
  const ws2 = XLSX.utils.json_to_sheet(detailRows);
  autoWidth(ws2, detailRows);
  XLSX.utils.book_append_sheet(wb, ws2, "Buchungen Detail");

  // Sheet 3: Baustellen Σ
  const bMap = new Map<
    string,
    {
      bvh: string;
      kst: string;
      status: string;
      h: number;
      fahrt: number;
      tgK: number;
      tgL: number;
      km: number;
      zul: number;
      maSet: Set<string>;
    }
  >();
  rows.forEach((r) => {
    if (r.fehlzeit_typ) return; // Fehlzeit kommt nicht in Baustellen-Summe
    const bid = r.baustelle_id ?? "_firma_";
    const b = baustelleById.get(r.baustelle_id ?? "");
    if (!bMap.has(bid)) {
      bMap.set(bid, {
        bvh: b?.bvh_name ?? (r.in_firma ? "(Firma)" : "(ohne BVH)"),
        kst: b?.kostenstelle ?? "",
        status: b?.status ?? "",
        h: 0,
        fahrt: 0,
        tgK: 0,
        tgL: 0,
        km: 0,
        zul: 0,
        maSet: new Set(),
      });
    }
    const x = bMap.get(bid)!;
    x.h += Number(r.arbeitsstunden ?? 0);
    x.fahrt += Number(r.fahrstunden ?? 0);
    x.tgK += Number(r.taggeld_kurz ?? 0);
    x.tgL += Number(r.taggeld_lang ?? 0);
    x.km += Number(r.km_gefahren ?? 0);
    x.zul += Number(r.zulage_stunden ?? 0);
    x.maSet.add(r.mitarbeiter_id);
  });
  const baustellenRows = Array.from(bMap.values()).map((x) => ({
    BVH: x.bvh,
    Kostenstelle: x.kst,
    Status: x.status,
    "Σ Stunden": fmtNum(x.h),
    "Σ Fahrt": fmtNum(x.fahrt),
    "TG kurz": x.tgK,
    "TG lang": x.tgL,
    KM: x.km,
    "Σ Zulagen (h)": fmtNum(x.zul),
    "Anzahl MA": x.maSet.size,
  }));
  const ws3 = XLSX.utils.json_to_sheet(baustellenRows);
  autoWidth(ws3, baustellenRows);
  XLSX.utils.book_append_sheet(wb, ws3, "Baustellen Σ");

  // Sheet 4..N: Stundenzettel pro MA
  members.forEach((m) => {
    const myRows = sorted.filter((r) => r.mitarbeiter_id === m.id);
    if (myRows.length === 0) return;
    const set = pksById.get(m.id);
    const tagesnorm = Number(set?.tagesnorm_stunden ?? 8);
    const grad = Number(set?.beschaeftigungsgrad ?? 1);
    const soll = werktage * tagesnorm * grad;
    let sumA = 0,
      sumFa = 0,
      sumFe = 0,
      sumTgK = 0,
      sumTgL = 0,
      sumKm = 0;
    const data: any[] = [
      [`HOLZBAU WILLROIDER · Stundenzettel ${monat}`],
      [
        `Mitarbeiter: ${m.vorname} ${m.nachname}`,
        `Pers.Nr.: ${m.pers_nr ?? "—"}`,
        `Partie: ${partieById.get(m.partie_id ?? "")?.name ?? "—"}`,
      ],
      [],
      [
        "Datum",
        "Wt",
        "BVH / Tätigkeit",
        "Start",
        "Ende",
        "Pause",
        "Arbeit",
        "Fahrt",
        "Diät K",
        "Diät L",
        "KM",
        "Zulage",
        "Fehlzeit",
        "Notiz",
      ],
    ];
    myRows.forEach((r) => {
      const d = new Date(r.datum);
      const b = baustelleById.get(r.baustelle_id ?? "");
      const pause =
        r.pause_von && r.pause_bis
          ? `${fmtTime(r.pause_von)}-${fmtTime(r.pause_bis)}`
          : "";
      sumA += Number(r.arbeitsstunden ?? 0);
      sumFa += Number(r.fahrstunden ?? 0);
      sumFe += Number(r.fehlzeit_stunden ?? 0);
      sumTgK += Number(r.taggeld_kurz ?? 0);
      sumTgL += Number(r.taggeld_lang ?? 0);
      sumKm += Number(r.km_gefahren ?? 0);
      data.push([
        new Date(r.datum).toLocaleDateString("de-AT"),
        WT[d.getDay()],
        [b?.bvh_name, r.taetigkeit].filter(Boolean).join(" · ") ||
          (r.in_firma ? "Firma" : ""),
        fmtTime(r.start_zeit),
        fmtTime(r.end_zeit),
        pause,
        Number(r.arbeitsstunden ?? 0),
        Number(r.fahrstunden ?? 0),
        Number(r.taggeld_kurz ?? 0) || "",
        Number(r.taggeld_lang ?? 0) || "",
        Number(r.km_gefahren ?? 0) || "",
        r.zulage_typ
          ? `${r.zulage_typ}${r.zulage_stunden ? ` ${r.zulage_stunden}h` : ""}`
          : "",
        r.fehlzeit_typ
          ? `${r.fehlzeit_typ} ${Number(r.fehlzeit_stunden ?? 0)}h`
          : "",
        r.notizen ?? "",
      ]);
    });
    data.push([]);
    const ist = sumA + sumFa + sumFe;
    data.push([
      "Σ",
      "",
      "",
      "",
      "",
      "",
      fmtNum(sumA),
      fmtNum(sumFa),
      sumTgK,
      sumTgL,
      sumKm,
      "",
      fmtNum(sumFe),
      "",
    ]);
    data.push([
      `Soll: ${fmtNum(soll)} h · Ist: ${fmtNum(ist)} h · Differenz: ${fmtNum(
        ist - soll
      )} h`,
    ]);
    data.push([]);
    data.push(["Unterschrift Mitarbeiter:", "", "", "", "Datum:", ""]);
    data.push(["Unterschrift Arbeitgeber:", "", "", "", "Datum:", ""]);
    const ws = XLSX.utils.aoa_to_sheet(data);
    ws["!cols"] = [
      { wch: 11 },
      { wch: 4 },
      { wch: 30 },
      { wch: 7 },
      { wch: 7 },
      { wch: 12 },
      { wch: 7 },
      { wch: 6 },
      { wch: 7 },
      { wch: 7 },
      { wch: 6 },
      { wch: 15 },
      { wch: 12 },
      { wch: 25 },
    ];
    const sheetName = `${m.nachname}_${m.vorname}`.slice(0, 31).replace(/[\\/?*[\]:]/g, "_");
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
  });

  XLSX.writeFile(wb, `Stundenauswertung_${monat}.xlsx`);
}

function autoWidth(ws: XLSX.WorkSheet, rows: any[]) {
  if (rows.length === 0) return;
  const keys = Object.keys(rows[0]);
  ws["!cols"] = keys.map((k) => {
    const max = Math.max(
      k.length,
      ...rows.map((r) => String(r[k] ?? "").length)
    );
    return { wch: Math.min(40, Math.max(8, max + 2)) };
  });
}
