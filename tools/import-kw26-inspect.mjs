// Inspect-Skript für KW26-Import.
//
// Liest /tmp/KW26.json (MPXJ-Konvertierung von KW26.mpp) und gibt
// Tag-für-Tag aus, welche Mitarbeiter an welchen Baustellen
// eingeteilt sind. Wenn SUPABASE_SERVICE_ROLE_KEY gesetzt ist,
// werden die Werte zusätzlich gegen profiles + baustellen gematcht
// und mehrdeutige/fehlende Matches als TODO ausgegeben.
//
// Voraussetzung:
//   /tmp/jdk-21.0.4+7/Contents/Home/bin/java \
//     -cp '/tmp/mpxj/mpxj/mpxj.jar:/tmp/mpxj/mpxj/lib/*' \
//     org.mpxj.sample.MpxjConvert ~/Downloads/KW26.mpp /tmp/KW26.json
//
// Aufruf:
//   SUPABASE_SERVICE_ROLE_KEY=… node tools/import-kw26-inspect.mjs

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL } from "./test-config.mjs";

const JSON_PATH = "/tmp/KW26.json";
const KW26_DAYS = [
  "2026-06-22",
  "2026-06-23",
  "2026-06-24",
  "2026-06-25",
  "2026-06-26",
  "2026-06-27",
  "2026-06-28",
];
const WD = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];

function inIso(iso) {
  return iso?.slice(0, 10) ?? null;
}

/** Liest die MPXJ-JSON und gibt eine Liste {datum, ma, kst, parent}
 *  zurück — eine Zeile pro Mitarbeiter pro Tag. */
export function extractEinteilungen() {
  const d = JSON.parse(readFileSync(JSON_PATH, "utf8"));

  // Tasks nach outline_number sortieren (numerisch, mehrteilig)
  const tasks = (d.tasks ?? [])
    .filter((t) => t.outline_number)
    .sort((a, b) => {
      const an = String(a.outline_number).split(".").map(Number);
      const bn = String(b.outline_number).split(".").map(Number);
      for (let i = 0; i < Math.max(an.length, bn.length); i++) {
        const da = an[i] || 0;
        const db = bn[i] || 0;
        if (da !== db) return da - db;
      }
      return 0;
    });

  // Flat-MS-Project: name-Task setzt aktuellen Parent, notes-Tasks
  // erben den Parent als Baustelle/Kategorie.
  let parentLabel = "?";
  const rows = [];
  for (const t of tasks) {
    if (t.name && t.name.trim()) {
      parentLabel = t.name.trim();
      continue;
    }
    if (!t.notes) continue;
    const ma = t.notes.trim();
    const kst = (t.text3 || "").trim();
    for (const split of t.work_splits || []) {
      const sd = inIso(split.start);
      const ed = inIso(split.end);
      if (!sd || !ed) continue;
      for (const day of KW26_DAYS) {
        if (day >= sd && day <= ed) {
          rows.push({ datum: day, ma, kst, parent: parentLabel, taskId: t.id });
        }
      }
    }
  }
  return rows;
}

async function loadSupabaseLookups() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return null;
  const supa = createClient(SUPABASE_URL, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const [profilesRes, baustellenRes] = await Promise.all([
    supa
      .from("profiles")
      .select("id, vorname, nachname, pers_nr, is_active")
      .eq("is_active", true),
    supa.from("baustellen").select("id, bvh_name, kostenstelle, status"),
  ]);
  if (profilesRes.error) throw profilesRes.error;
  if (baustellenRes.error) throw baustellenRes.error;
  return {
    profiles: profilesRes.data ?? [],
    baustellen: baustellenRes.data ?? [],
  };
}

function normalize(s) {
  return (s ?? "")
    .toString()
    .toLowerCase()
    .replace(/ß/g, "ss")
    .replace(/ä/g, "a")
    .replace(/ö/g, "o")
    .replace(/ü/g, "u")
    .trim();
}

/** Matcht einen Nachnamen (eventuell mit Vornamen-Suffix wie „Egger S.")
 *  gegen die profiles-Liste. Gibt {match, candidates} zurück. */
export function matchMitarbeiter(maRaw, profiles) {
  const ma = maRaw.replace(/\s+[A-ZÄÖÜ]\.?$/, "").trim(); // „Egger S." → „Egger"
  const vorbuchstabeMatch = maRaw.match(/\s+([A-ZÄÖÜ])\.?$/);
  const vorBuchstabe = vorbuchstabeMatch ? vorbuchstabeMatch[1] : null;
  const norm = normalize(ma);
  const candidates = profiles.filter(
    (p) => normalize(p.nachname) === norm,
  );
  if (candidates.length === 0) return { match: null, candidates };
  if (candidates.length === 1) return { match: candidates[0], candidates };
  if (vorBuchstabe) {
    const filtered = candidates.filter(
      (p) =>
        (p.vorname ?? "").toUpperCase().startsWith(vorBuchstabe.toUpperCase()),
    );
    if (filtered.length === 1)
      return { match: filtered[0], candidates: filtered };
  }
  return { match: null, candidates };
}

/** Matcht eine Kostenstelle gegen die baustellen-Liste. */
export function matchBaustelleByKst(kst, baustellen) {
  if (!kst) return { match: null, candidates: [] };
  const candidates = baustellen.filter(
    (b) => String(b.kostenstelle ?? "").trim() === String(kst).trim(),
  );
  if (candidates.length === 1) return { match: candidates[0], candidates };
  return { match: null, candidates };
}

async function main() {
  const rows = extractEinteilungen();
  const lookups = await loadSupabaseLookups();

  console.log(
    `\nGesamt-Zeilen (MA × Tag) im KW26-Bereich: ${rows.length}\n`,
  );

  // Tagesüberblick
  for (const day of KW26_DAYS) {
    const today = rows.filter((r) => r.datum === day);
    const wd = WD[new Date(day + "T12:00:00").getDay()];
    console.log(`=== ${wd} ${day} (${today.length} Zeilen) ===`);
    for (const r of today) {
      let info = "";
      if (lookups) {
        const mMa = matchMitarbeiter(r.ma, lookups.profiles);
        const mBs = matchBaustelleByKst(r.kst, lookups.baustellen);
        const tagMa = mMa.match
          ? `→ ${mMa.match.vorname ?? ""} ${mMa.match.nachname} ✓`
          : mMa.candidates.length > 1
            ? `❓ ${mMa.candidates.length} Kandidaten`
            : "❌ kein Match";
        const tagBs = mBs.match
          ? `→ ${mBs.match.bvh_name} ✓`
          : r.kst
            ? "❌ kein Match"
            : "(keine Kst.)";
        info = `   ${tagMa}  |  ${tagBs}`;
      }
      console.log(
        `  ${r.ma.padEnd(12)} | kst ${String(r.kst).padEnd(6)} | ${r.parent.padEnd(18)}${info}`,
      );
    }
    console.log();
  }

  if (!lookups) {
    console.log(
      "\nℹ Für DB-Matching: SUPABASE_SERVICE_ROLE_KEY=… node tools/import-kw26-inspect.mjs",
    );
    return;
  }

  // Sammelübersicht: Mitarbeiter ohne Match, Baustellen ohne Match
  const seenMa = new Map();
  const seenKst = new Map();
  for (const r of rows) {
    if (!seenMa.has(r.ma)) {
      const m = matchMitarbeiter(r.ma, lookups.profiles);
      seenMa.set(r.ma, m);
    }
    if (r.kst && !seenKst.has(r.kst)) {
      const m = matchBaustelleByKst(r.kst, lookups.baustellen);
      seenKst.set(r.kst, m);
    }
  }
  console.log("=== Mitarbeiter-Matches ===");
  for (const [ma, m] of seenMa.entries()) {
    if (m.match) {
      console.log(
        `  ${ma.padEnd(15)} → ${m.match.vorname ?? ""} ${m.match.nachname} (${m.match.id})`,
      );
    } else if (m.candidates.length > 1) {
      console.log(
        `  ${ma.padEnd(15)} → MEHRDEUTIG (${m.candidates.length}): ${m.candidates.map((c) => c.vorname + " " + c.nachname).join(", ")}`,
      );
    } else {
      console.log(`  ${ma.padEnd(15)} → KEIN MATCH`);
    }
  }
  console.log();
  console.log("=== Baustellen-Matches (per Kostenstelle) ===");
  for (const [kst, m] of seenKst.entries()) {
    if (m.match) {
      console.log(
        `  kst ${kst.padEnd(6)} → ${m.match.bvh_name} (${m.match.id}, ${m.match.status})`,
      );
    } else {
      console.log(`  kst ${kst.padEnd(6)} → KEIN MATCH`);
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
