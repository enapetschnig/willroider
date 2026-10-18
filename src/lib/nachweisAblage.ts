/**
 * Unterschriebene Evaluierung automatisch als PDF ablegen (Wunsch
 * S. Egger, 16.10.2026) — nur bei Baustellen mit neuer SharePoint-Struktur
 * (baustellen.sharepoint_struktur = 'bvh-neu').
 *
 * Wann: sobald ALLE zugeteilten Mitarbeiter unterschrieben haben. Wird nach
 * Abschluss noch jemand zugeteilt und unterschreibt, entsteht eine weitere
 * Fassung daneben („… Fassung 2.pdf") — ersetzt wird nichts.
 *
 * Wo: als App-Dokument (Ordner „evaluierung"); der SharePoint-Abgleich legt
 * es direkt in „00-Baustelle" als „<Kostenstelle> Evaluierung <Art> <Datum>.pdf".
 *
 * Aufgerufen nach jeder Unterschrift (Handy und Tablet). Unterschriften und
 * Evaluierungen darf jeder lesen, Dokumente in „evaluierung" jeder anlegen —
 * es klappt also auch, wenn ein Mitarbeiter als Letzter unterschreibt.
 */
import { supabase } from "@/integrations/supabase/client";
import { unterweisungLabel } from "@/lib/unterweisungen";

export async function nachweisAblegenWennFertig(evaluierungId: string): Promise<boolean> {
  const { data: ev } = await supabase
    .from("evaluierungen")
    .select("id, baustelle_id, typ, datum")
    .eq("id", evaluierungId)
    .maybeSingle();
  const e = ev as { id: string; baustelle_id: string; typ: string; datum: string } | null;
  if (!e?.baustelle_id) return false;

  // sharepoint_struktur fehlt noch in den generierten Typen.
  const { data: bst } = await (supabase as any)
    .from("baustellen")
    .select("kostenstelle, bvh_name, sharepoint_struktur")
    .eq("id", e.baustelle_id)
    .maybeSingle();
  const b = bst as { kostenstelle: string | null; bvh_name: string | null; sharepoint_struktur?: string | null } | null;
  if (b?.sharepoint_struktur !== "bvh-neu") return false;

  const { data: sigs } = await supabase
    .from("evaluierung_unterschriften")
    .select("status, unterschrift_data")
    .eq("evaluierung_id", evaluierungId);
  const aktiv = ((sigs as { status: string; unterschrift_data: string | null }[]) ?? []).filter(
    (s) => s.status !== "archiviert",
  );
  if (aktiv.length === 0 || aktiv.some((s) => !s.unterschrift_data)) return false;

  // Je Stand (Anzahl Unterschriften) genau ein PDF.
  const pfadBasis = `${e.baustelle_id}/evaluierung/nachweise/${evaluierungId}`;
  const pfad = `${pfadBasis}_${aktiv.length}.pdf`;
  const { data: schonDa } = await supabase.from("dokumente").select("id").eq("storage_path", pfad).maybeSingle();
  if (schonDa) return false;
  const { count: fruehere } = await supabase
    .from("dokumente")
    .select("id", { count: "exact", head: true })
    .like("storage_path", `${pfadBasis}_%`);

  const { erstelleUnterweisungNachweisPdf } = await import("@/lib/unterweisungNachweisPdf");
  const { doc } = await erstelleUnterweisungNachweisPdf(evaluierungId);
  const blob = doc.output("blob");

  const { error: upErr } = await supabase.storage
    .from("baustellen")
    .upload(pfad, blob, { contentType: "application/pdf", upsert: false });
  // Gleichzeitig von einem anderen Gerät abgelegt → nichts zu tun.
  if (upErr) return false;

  const art = unterweisungLabel(e.typ as any) || "Unterweisung";
  const fassung = (fruehere ?? 0) > 0 ? ` Fassung ${(fruehere ?? 0) + 1}` : "";
  const dateiname = `${[(b.kostenstelle ?? "").trim(), "Evaluierung", art, e.datum].filter(Boolean).join(" ")}${fassung}.pdf`
    .replace(/[<>:"/\\|?*]/g, "-");
  const { data: u } = await supabase.auth.getUser();
  await supabase.from("dokumente").insert({
    baustelle_id: e.baustelle_id,
    ordner: "evaluierung",
    subpath: "nachweise",
    dateiname,
    storage_path: pfad,
    groesse: blob.size,
    mimetype: "application/pdf",
    hochgeladen_von: u.user?.id ?? null,
  } as any);

  // Gleich nach SharePoint (klappt mit Prüferrechten; sonst nimmt es der
  // Zeitplan in spätestens 10 Minuten mit).
  void supabase.functions
    .invoke("sharepoint-schreiben", { body: { modus: "hochladen", baustelle_id: e.baustelle_id } })
    .catch(() => undefined);
  return true;
}
