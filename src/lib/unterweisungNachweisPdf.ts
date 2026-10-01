/**
 * Unterweisungsnachweis einer Baustelle — EIN Dokument mit allen
 * Unterschriften, aufgebaut wie die Papiervorlage „Gefahrenevaluierung
 * Baustellen – Zimmerei / Tischlerei" (5.1 Unterweisung, Vorlage von
 * Christian Pließnig; Wunsch N. Gwenger 29.09.: „Wo sehe ich die fertig
 * unterschriebene Unterweisung").
 *
 * Seite 1: Kopf, Angaben zur Baustelle, Hinweis § 4 ASchG, „Schulung und
 *          Unterweisung auf Baustelle" mit Name | Unterschrift | Name |
 *          Unterschrift, darunter „Evaluierung durchgeführt".
 * Seite 2: Gefahrenermittlung / Festlegung von Maßnahmen — der Inhalt der
 *          Unterweisung mit dem Zustand je Punkt (i.O. / nicht i.O. / n.A.).
 *
 * Die Evaluierung Tagesbaustellen (SiGe, Vorlage Wulz) hat ihr eigenes
 * Formular — dafür wird makeTagesbaustellePdf verwendet.
 */

import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { supabase } from "@/integrations/supabase/client";
import { getUnterweisung, unterweisungLabel } from "@/lib/unterweisungen";
import { makeTagesbaustellePdf } from "@/lib/evaluierungTagesbaustellePdf";
import { isoWeekParts } from "@/lib/stundenTime";
import type { EvaluierungTyp } from "@/integrations/supabase/types";

const SCHWARZ: [number, number, number] = [20, 20, 20];
const GRAU: [number, number, number] = [110, 110, 115];
const GRUEN: [number, number, number] = [22, 130, 60];
const ROT: [number, number, number] = [200, 30, 30];
const KOPF_GRAU: [number, number, number] = [232, 232, 234];

let _logo: string | null | undefined;
async function ladeLogo(): Promise<string | null> {
  if (_logo !== undefined) return _logo;
  try {
    const res = await fetch("/willroider-logo.jpg");
    if (!res.ok) return (_logo = null);
    const blob = await res.blob();
    _logo = await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result as string);
      r.onerror = reject;
      r.readAsDataURL(blob);
    });
    return _logo;
  } catch {
    return (_logo = null);
  }
}

/** Die PDF-Grundschrift (Helvetica, WinAnsi) kennt nur Latin-1 plus ein paar
 *  Zeichen — „→" oder „≥" kamen als Buchstabensalat heraus. */
const WIN_ANSI_EXTRA = "€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ";
function pdfText(s: string): string {
  return s
    .replace(/\r/g, "")
    .replace(/\t/g, "  ")
    .replace(/→/g, "->")
    .replace(/←/g, "<-")
    .replace(/≥/g, ">=")
    .replace(/≤/g, "<=")
    .replace(/[✓✔]/g, "x")
    .replace(/[^\u0020-\u00ff\n]/g, (c) => (WIN_ANSI_EXTRA.includes(c) ? c : "?"));
}

const datumAT = (iso: string | null | undefined) =>
  iso ? new Date(iso.length === 10 ? iso + "T00:00:00" : iso).toLocaleDateString("de-AT") : "";

/** „KW 27 (29.06.2026)" — wie in der Vorlage „Arbeitsbeginn: KW 27". */
function kwText(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso + "T00:00:00");
  return `KW ${isoWeekParts(d).kw} (${d.toLocaleDateString("de-AT")})`;
}

const name = (p: { vorname?: string | null; nachname?: string | null } | null | undefined) =>
  p ? `${p.vorname ?? ""} ${p.nachname ?? ""}`.trim() : "";

function zustand(v: string | undefined): { text: string; farbe: [number, number, number] } {
  const s = (v ?? "").toLowerCase();
  if (s === "i.o." || s === "io") return { text: "i.O.", farbe: GRUEN };
  if (s === "nicht i.o." || s === "nio" || s === "n.i.o.") return { text: "nicht i.O.", farbe: ROT };
  if (s === "n.a." || s === "na") return { text: "n.A.", farbe: GRAU };
  return { text: "", farbe: GRAU };
}

type Unterschrift = {
  name: string;
  datum: string;
  bild: string | null;
};

/** Lädt alles zur Unterweisung und baut das passende PDF. */
export async function erstelleUnterweisungNachweisPdf(
  evaluierungId: string,
): Promise<{ doc: jsPDF; dateiname: string }> {
  const { data: ev, error } = await supabase
    .from("evaluierungen")
    .select("id, baustelle_id, datum, typ, vortragender_id, checkliste, notizen")
    .eq("id", evaluierungId)
    .maybeSingle();
  if (error || !ev) throw new Error("Unterweisung nicht gefunden.");
  const e = ev as any;

  const [{ data: bRow }, { data: sigRows }] = await Promise.all([
    supabase
      .from("baustellen")
      .select("bvh_name, kostenstelle, baustellen_adresse, plz, ort, art_bauarbeiten, start_datum, end_datum, bauleiter_id, partie_id, anzahl_mitarbeiter")
      .eq("id", e.baustelle_id)
      .maybeSingle(),
    supabase
      .from("evaluierung_unterschriften")
      .select(
        "mitarbeiter_id, status, unterschrift_data, unterschrieben_am, profiles!evaluierung_unterschriften_mitarbeiter_id_fkey(vorname, nachname, is_partieleiter, qualifikation)",
      )
      .eq("evaluierung_id", evaluierungId),
  ]);
  const b = (bRow as any) ?? {};
  const sigs = ((sigRows as any[]) ?? []).filter((s) => s.status !== "archiviert");

  // Bauleiter, Partieführer (über die Partie der Baustelle), Vortragender
  const ids = [b.bauleiter_id, e.vortragender_id].filter(Boolean) as string[];
  const [{ data: leute }, { data: partie }] = await Promise.all([
    ids.length
      ? supabase.from("profiles").select("id, vorname, nachname").in("id", ids)
      : Promise.resolve({ data: [] as any[] }),
    b.partie_id
      ? supabase.from("partien").select("partieleiter_id").eq("id", b.partie_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const person = (id: string | null | undefined) =>
    name(((leute as any[]) ?? []).find((p) => p.id === id));
  let partiefuehrer = "";
  const plId = (partie as any)?.partieleiter_id as string | undefined;
  if (plId) {
    const { data: pl } = await supabase.from("profiles").select("vorname, nachname").eq("id", plId).maybeSingle();
    partiefuehrer = name(pl as any);
  }
  if (!partiefuehrer) {
    partiefuehrer = sigs
      .filter((s) => s.profiles?.is_partieleiter)
      .map((s) => name(s.profiles))
      .join(", ");
  }

  const kurz = b.kostenstelle || b.bvh_name || "Baustelle";

  // Tagesbaustelle: eigenes Formular (Vorlage Ingenieurbüro Wulz).
  if (e.typ === "tagesbaustelle") {
    const unterschriften = sigs
      .filter((s) => s.unterschrift_data)
      .sort((x, y) => String(x.unterschrieben_am).localeCompare(String(y.unterschrieben_am)))
      .map((s) => ({
        name: name(s.profiles) || "—",
        funktion: `Holzbau Willroider · ${s.profiles?.is_partieleiter ? "Partieführer" : s.profiles?.qualifikation || "Mitarbeiter"}`,
        datum: s.unterschrieben_am ? datumAT(s.unterschrieben_am) : null,
        unterschriftBase64: s.unterschrift_data as string | null,
      }));
    const doc = await makeTagesbaustellePdf({
      datum: datumAT(e.datum),
      baustelle: b.bvh_name ?? "—",
      kostenstelle: b.kostenstelle ?? "",
      werte: (e.checkliste as Record<string, string>) ?? {},
      vortragender: person(e.vortragender_id),
      notizen: e.notizen ?? "",
      unterschriften,
    });
    return { doc, dateiname: `Unterweisung-${kurz}-${e.datum}.pdf` };
  }

  const unterschrieben: Unterschrift[] = sigs
    .filter((s) => s.unterschrift_data)
    .sort((x, y) => name(x.profiles).localeCompare(name(y.profiles), "de"))
    .map((s) => ({
      name: name(s.profiles) || "—",
      datum: s.unterschrieben_am ? datumAT(s.unterschrieben_am) : "",
      bild: s.unterschrift_data as string,
    }));
  const offen = sigs
    .filter((s) => !s.unterschrift_data && s.status === "offen")
    .map((s) => name(s.profiles))
    .sort((x, y) => x.localeCompare(y, "de"));

  const adresse = [
    (b.baustellen_adresse ?? "").trim(),
    [b.plz, (b.ort ?? "").trim()].filter(Boolean).join(" "),
  ]
    .filter(Boolean)
    .join(", ");

  const doc = await makeUnterweisungNachweisPdf({
    typ: e.typ,
    datum: datumAT(e.datum),
    baustelle: b.bvh_name ?? "—",
    kostenstelle: b.kostenstelle ?? "",
    anschrift: adresse,
    artUmfang: b.art_bauarbeiten ?? "",
    arbeitsbeginn: kwText(b.start_datum),
    arbeitsende: kwText(b.end_datum),
    bauleiter: person(b.bauleiter_id),
    partiefuehrer,
    anzahl: b.anzahl_mitarbeiter ? String(b.anzahl_mitarbeiter) : sigs.length ? String(sigs.length) : "",
    vortragender: person(e.vortragender_id),
    checkliste: (e.checkliste as Record<string, string>) ?? {},
    notizen: e.notizen ?? "",
    unterschriften: unterschrieben,
    offen,
  });
  return { doc, dateiname: `Unterweisung-${kurz}-${e.datum}.pdf` };
}

export interface UnterweisungNachweisInput {
  typ: EvaluierungTyp;
  datum: string;
  baustelle: string;
  kostenstelle: string;
  anschrift: string;
  artUmfang: string;
  arbeitsbeginn: string;
  arbeitsende: string;
  bauleiter: string;
  partiefuehrer: string;
  anzahl: string;
  vortragender: string;
  checkliste: Record<string, string>;
  notizen: string;
  unterschriften: Unterschrift[];
  /** Zugeteilt, aber noch nicht unterschrieben. */
  offen: string[];
}

export async function makeUnterweisungNachweisPdf(input: UnterweisungNachweisInput): Promise<jsPDF> {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth(); // 210
  const pageH = doc.internal.pageSize.getHeight(); // 297
  const m = 14;
  const innen = pageW - 2 * m;
  const logo = await ladeLogo();
  const inhalt = getUnterweisung(input.typ);

  // Seiten, die schon ihren Kopf haben — Tabellen, die umbrechen, ergänzen
  // ihn auf den Folgeseiten selbst.
  const mitKopf = new Set<number>();
  const kopf = () => {
    mitKopf.add(doc.getCurrentPageInfo().pageNumber);
    if (logo) {
      try {
        doc.addImage(logo, "JPEG", m, 10, 24, 12, undefined, "FAST");
      } catch {
        /* ohne Logo */
      }
    }
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(...GRAU);
    doc.text("Holzbau Willroider GmbH", pageW - m, 13, { align: "right" });
    doc.text("A-9500 Villach, Willroiderstraße 13", pageW - m, 16.5, { align: "right" });
    doc.setDrawColor(...SCHWARZ);
    doc.setLineWidth(0.4);
    doc.line(m, 25, pageW - m, 25);
  };
  const fuss = () => {
    const n = doc.getNumberOfPages();
    for (let i = 1; i <= n; i++) {
      doc.setPage(i);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7);
      doc.setTextColor(...GRAU);
      doc.text(`Seite ${i} von ${n}`, m, pageH - 8);
      doc.text(`Unterweisungsnachweis · ${input.baustelle}`, pageW - m, pageH - 8, { align: "right" });
    }
  };

  // ─── Seite 1: Kopf ───────────────────────────────────────────────────
  kopf();
  doc.setTextColor(...SCHWARZ);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.text("GEFAHRENEVALUIERUNG – BAUSTELLEN", pageW / 2, 34, { align: "center" });
  doc.setFontSize(11);
  doc.text("Zimmerei / Tischlerei", pageW / 2, 40, { align: "center" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.text("Ermittlung und Beurteilung von Gefahren · Festlegung von Maßnahmen lt. ASchG", pageW / 2, 45, {
    align: "center",
  });

  doc.setFont("helvetica", "bold");
  doc.setFontSize(9.5);
  doc.text("Sicherheits- und Gesundheitsschutzdokument", m, 54);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(...GRAU);
  doc.text(
    doc.splitTextToSize(
      "gemäß Dok-VO für Arbeitsstätten mit bis zu 10 Arbeitnehmern, in denen bei der Gefahrenermittlung und Beurteilung keine Gefährdungen von Arbeitnehmern festgelegt wurden, für die Schutzmaßnahmen festzulegen sind.",
      innen,
    ),
    m,
    58,
  );

  // ─── Angaben zur Baustelle ───────────────────────────────────────────
  let y = 68;
  const zeile = (label: string, wert: string, x = m, breite = innen) => {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(...SCHWARZ);
    doc.text(label, x, y);
    const lw = doc.getTextWidth(label) + 2;
    doc.setFont("helvetica", "bold");
    const zeilen = doc.splitTextToSize(pdfText(wert || ""), breite - lw);
    doc.text(zeilen.length ? zeilen : [""], x + lw, y);
    // gepunktete Linie wie im Formular
    doc.setDrawColor(150, 150, 155);
    doc.setLineWidth(0.15);
    (doc as any).setLineDashPattern?.([0.6, 0.8], 0);
    doc.line(x + lw, y + 1.2, x + breite, y + 1.2);
    (doc as any).setLineDashPattern?.([], 0);
    return Math.max(1, zeilen.length);
  };
  zeile("Baustelle:", [input.baustelle, input.kostenstelle].filter(Boolean).join(" · "));
  y += 6.5;
  zeile("Anschrift:", input.anschrift);
  y += 6.5;
  const n = zeile("Art und Umfang der Zimmermannsarbeiten:", input.artUmfang);
  y += 6.5 + (n - 1) * 4;
  const halb = innen / 2 - 3;
  zeile("Arbeitsbeginn:", input.arbeitsbeginn, m, halb);
  zeile("Voraussichtl. Arbeitsende:", input.arbeitsende, m + innen / 2 + 3, halb);
  y += 6.5;
  zeile("Bauleiter:", input.bauleiter, m, halb);
  zeile("Partieführer:", input.partiefuehrer, m + innen / 2 + 3, halb);
  y += 6.5;
  zeile("Voraussichtl. Anzahl der Arbeitnehmer:", input.anzahl, m, halb);
  zeile("Unterweisung:", inhalt?.title ?? unterweisungLabel(input.typ), m + innen / 2 + 3, halb);
  y += 7;

  // ─── Hinweis § 4 ASchG (umrahmt) ─────────────────────────────────────
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  const hinweis = doc.splitTextToSize(
    "Bei der Gefahrenermittlung und -beurteilung (§ 4 ASchG) wurden die in der nachfolgenden Liste beschriebenen Gefährdungen von Arbeitnehmern festgestellt, für die Schutzmaßnahmen festgelegt wurden.",
    innen - 6,
  );
  const hh = hinweis.length * 3.8 + 4;
  doc.setDrawColor(...SCHWARZ);
  doc.setLineWidth(0.3);
  doc.rect(m, y, innen, hh);
  doc.text(hinweis, pageW / 2, y + 5, { align: "center" });
  y += hh + 8;

  // ─── Schulung und Unterweisung auf Baustelle ─────────────────────────
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text("SCHULUNG UND UNTERWEISUNG AUF BAUSTELLE", m, y);
  y += 6;
  doc.setFontSize(9);
  zeile("Datum der Schulung:", input.datum, m, halb);
  zeile("Vortragender:", input.vortragender, m + innen / 2 + 3, halb);
  y += 5;

  // Name | Unterschrift | Name | Unterschrift — zwei Personen je Zeile.
  const paare: [Unterschrift | null, Unterschrift | null][] = [];
  const liste = [...input.unterschriften];
  // Leere Zeilen auffüllen, damit vor Ort noch händisch ergänzt werden kann.
  while (liste.length < 8) liste.push({ name: "", datum: "", bild: null });
  if (liste.length % 2) liste.push({ name: "", datum: "", bild: null });
  for (let i = 0; i < liste.length; i += 2) paare.push([liste[i], liste[i + 1]]);

  const zelle = (u: Unterschrift | null) => (u?.name ? pdfText(`${u.name}\n${u.datum}`) : "");
  autoTable(doc, {
    startY: y,
    head: [["NAME", "Unterschrift", "NAME", "Unterschrift"]],
    body: paare.map(([a, b2]) => [zelle(a), "", zelle(b2), ""]),
    theme: "grid",
    styles: {
      font: "helvetica",
      fontSize: 8.5,
      cellPadding: 1.5,
      textColor: SCHWARZ,
      lineColor: [80, 80, 85],
      lineWidth: 0.2,
      minCellHeight: 14,
      valign: "middle",
    },
    headStyles: { fillColor: KOPF_GRAU, textColor: SCHWARZ, fontStyle: "bold", halign: "center", minCellHeight: 6 },
    columnStyles: {
      0: { cellWidth: innen * 0.22 },
      1: { cellWidth: innen * 0.28 },
      2: { cellWidth: innen * 0.22 },
      3: { cellWidth: innen * 0.28 },
    },
    didDrawCell: (data) => {
      if (data.section !== "body" || (data.column.index !== 1 && data.column.index !== 3)) return;
      const paar = paare[data.row.index];
      const u = data.column.index === 1 ? paar?.[0] : paar?.[1];
      if (!u?.bild) return;
      try {
        const url = u.bild.startsWith("data:") ? u.bild : `data:image/png;base64,${u.bild}`;
        const h = data.cell.height - 2;
        const w = Math.min(data.cell.width - 2, h * 2.8);
        doc.addImage(url, "PNG", data.cell.x + 1, data.cell.y + 1, w, h, undefined, "FAST");
      } catch {
        /* ohne Bild */
      }
    },
    margin: { left: m, right: m, top: 30 },
    didDrawPage: () => {
      if (!mitKopf.has(doc.getCurrentPageInfo().pageNumber)) kopf();
    },
  });
  y = (doc as any).lastAutoTable.finalY + 4;

  if (input.offen.length > 0) {
    doc.setFont("helvetica", "italic");
    doc.setFontSize(7.5);
    doc.setTextColor(...GRAU);
    const t = doc.splitTextToSize(pdfText(`Noch nicht unterschrieben: ${input.offen.join(", ")}`), innen);
    doc.text(t, m, y + 2);
    y += t.length * 3.4 + 2;
  }

  // ─── Evaluierung durchgeführt ────────────────────────────────────────
  if (y > pageH - 40) {
    doc.addPage();
    kopf();
    y = 36;
  }
  y += 8;
  doc.setTextColor(...SCHWARZ);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9.5);
  doc.text("Evaluierung durchgeführt:", m, y);
  y += 8;
  doc.setFontSize(9);
  zeile("Datum:", input.datum, m, halb);
  doc.setDrawColor(...SCHWARZ);
  doc.setLineWidth(0.3);
  doc.line(m + innen / 2 + 3, y + 1.2, pageW - m, y + 1.2);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.setTextColor(...GRAU);
  doc.text(
    `Unterschrift${input.vortragender ? ` (${input.vortragender})` : ""}`,
    m + innen / 2 + 3,
    y + 4.5,
  );

  // ─── Seite 2: Gefahrenermittlung / Festlegung von Maßnahmen ──────────
  doc.addPage();
  kopf();
  doc.setTextColor(...SCHWARZ);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text("GEFAHRENERMITTLUNG / FESTLEGUNG VON MASSNAHMEN", m, 34);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(...GRAU);
  doc.text(
    pdfText([inhalt?.title, inhalt?.subtitle, inhalt?.rechtsgrundlage].filter(Boolean).join(" · ")),
    m,
    39,
    { maxWidth: innen },
  );

  type Zeile = { kopf?: string; punkt?: string; zustand?: string; farbe?: [number, number, number]; massnahme?: string };
  const zeilen: Zeile[] = [];
  for (const sec of inhalt?.sections ?? []) {
    if (sec.kind === "arbeitsmittel" || sec.kind === "checklist") {
      zeilen.push({ kopf: pdfText(sec.heading) });
      for (const it of sec.items) {
        const z = zustand(input.checkliste[it.key]);
        zeilen.push({ punkt: pdfText(it.label), zustand: z.text, farbe: z.farbe });
      }
    } else if (sec.kind === "text") {
      zeilen.push({
        punkt: pdfText(sec.heading ?? ""),
        massnahme: pdfText(sec.lines.map((l) => `• ${l}`).join("\n")),
      });
    }
  }
  if (input.notizen.trim()) {
    zeilen.push({ punkt: "Hinweise / Notizen vom Bauleiter", massnahme: pdfText(input.notizen.trim()) });
  }

  autoTable(doc, {
    startY: 44,
    head: [["Arbeitsmittel / Punkt", "Zustand", "durchzuführende Schutzmaßnahmen / Hinweise"]],
    body: zeilen.map((z) =>
      z.kopf
        ? [{ content: z.kopf, colSpan: 3, styles: { fontStyle: "bold", fillColor: [244, 244, 246] } } as any]
        : [z.punkt ?? "", z.zustand ?? "", z.massnahme ?? ""],
    ),
    theme: "grid",
    styles: {
      font: "helvetica",
      fontSize: 8,
      cellPadding: 1.4,
      textColor: SCHWARZ,
      lineColor: [150, 150, 155],
      lineWidth: 0.15,
      valign: "top",
    },
    headStyles: { fillColor: KOPF_GRAU, textColor: SCHWARZ, fontStyle: "bold" },
    columnStyles: {
      0: { cellWidth: 72 },
      1: { cellWidth: 20, halign: "center", fontStyle: "bold" },
      2: { cellWidth: "auto" },
    },
    didParseCell: (data) => {
      if (data.section !== "body" || data.column.index !== 1) return;
      const z = zeilen[data.row.index];
      if (z?.farbe && z.zustand) data.cell.styles.textColor = z.farbe;
    },
    margin: { left: m, right: m, top: 30 },
    didDrawPage: () => {
      if (!mitKopf.has(doc.getCurrentPageInfo().pageNumber)) kopf();
    },
  });

  fuss();
  return doc;
}
