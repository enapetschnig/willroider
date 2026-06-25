/**
 * Importiert die 44 MA aus `~/Downloads/Liste Zimmerei.xlsx` in die App.
 *
 * Pro MA wird angelegt:
 *  - auth.users (mit Surrogate-Email pers-<nr>@willroider.invalid)
 *  - profiles (Adresse, Geburtsdatum, Pers.Nr, Qualifikation, is_active)
 *  - profiles_sensitive (SV-Nr „------xxxx" als Marker)
 *  - profile_konten_settings (Defaults für ZA + Urlaub)
 *  - user_roles (GE → bauleiter, LO+LE → mitarbeiter)
 *  - urlaubs_buchungen art='initial' (Urlaubs-Saldo aus Excel)
 *  - za_buchungen art='initial' (ZA-Saldo aus Excel, skip wenn NULL/GE)
 *
 * Idempotent: erkennt bestehende User per Pers.Nr und macht UPDATE
 * statt INSERT. Backup-Passwort wird in
 * `~/Downloads/willroider-import-credentials-<ts>.json` (Mode 600)
 * gespeichert — der Admin kann die später für SMS-Einladungen nutzen.
 *
 * Aufruf:
 *   SUPABASE_SERVICE_ROLE_KEY=... node tools/import-personal.mjs           # Dry-Run
 *   SUPABASE_SERVICE_ROLE_KEY=... node tools/import-personal.mjs --apply   # Real
 */

import { readFileSync, writeFileSync, chmodSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import XLSX from "xlsx";
import { SUPABASE_URL } from "./test-config.mjs";
import { parseAddress } from "./lib/addressParser.mjs";

const APPLY = process.argv.includes("--apply");
const SOURCE_FILE = join(homedir(), "Downloads", "Liste Zimmerei.xlsx");
const TODAY = "2026-06-25";
const IMPORT_SOURCE_TAG = "Liste Zimmerei.xlsx";

function requireKey() {
  const k = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!k) {
    console.error("FEHLER: SUPABASE_SERVICE_ROLE_KEY-Env-Var fehlt.");
    process.exit(1);
  }
  return k;
}

function excelDateToIso(v) {
  if (v == null || v === "") return null;
  if (typeof v === "number") {
    const d = XLSX.SSF.parse_date_code(v);
    if (!d) return null;
    return `${String(d.y).padStart(4, "0")}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}`;
  }
  return null;
}

/** Liste Zimmerei.xlsx → 44 Mitarbeiter-Objekte */
function readListe() {
  const wb = XLSX.read(readFileSync(SOURCE_FILE));
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: "" });
  // Row 0 ist Header. Datenzeilen ab Row 1.
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r[0] || !r[1]) continue;
    const pers_nr = String(r[0]).trim();
    const fullname = String(r[1]).trim();
    // Name hat Format "Nachname Vorname [Zweitname …]"
    const parts = fullname.split(/\s+/);
    const nachname = parts[0];
    const vorname = parts.slice(1).join(" ");
    const svLastFour = String(r[2] ?? "").trim();
    const geburtsdatum = excelDateToIso(r[3]);
    const adresse = String(r[4] ?? "").trim();
    const code = String(r[5] ?? "").trim().toUpperCase(); // GE/LO/LE/PK
    const zaRaw = r[6];
    const za = (zaRaw === "" || zaRaw == null) ? null : Number(zaRaw);
    const urlaubRaw = r[7];
    const urlaub = (urlaubRaw === "" || urlaubRaw == null) ? 0 : Number(urlaubRaw);
    out.push({
      pers_nr,
      vorname,
      nachname,
      svLastFour,
      geburtsdatum,
      adresse,
      code,
      za,
      urlaub,
    });
  }
  return out;
}

const QUAL_LABEL = {
  GE: "Gehalt (GE)",
  LO: "Lohn (LO)",
  LE: "Lehrling (LE)",
  PK: "Pauschalkraft (PK)",
};

function rolleFromCode(code) {
  // User-Entscheidung: konservativ. GE = bauleiter, alle anderen = mitarbeiter.
  return code === "GE" ? "bauleiter" : "mitarbeiter";
}

function surrogateEmail(pers_nr) {
  return `pers-${pers_nr}@willroider.invalid`;
}

function genPassword() {
  // 16-stelliges druckbares Passwort, Buchstaben + Ziffern.
  return randomBytes(12).toString("base64").replace(/[+/=]/g, "x").slice(0, 16);
}

async function findAuthUserByEmail(admin, email) {
  // listUsers ist paginiert (max 1000); für 44 reichts eine Page.
  const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) throw error;
  return data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase()) ?? null;
}

async function main() {
  const key = requireKey();
  const admin = createClient(SUPABASE_URL, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Sanity-Echo gegen Mis-Apply
  console.log(`[1/5] Quelldatei:  ${SOURCE_FILE}`);
  console.log(`[1/5] Supabase:    ${SUPABASE_URL}`);
  console.log(`[1/5] Mode:        ${APPLY ? "APPLY (DB-Writes!)" : "DRY-RUN (read-only)"}`);
  console.log();

  // 1) Liste lesen
  const liste = readListe();
  console.log(`[1/5] Personalliste enthält ${liste.length} MA`);
  if (liste.length === 0) {
    console.error("Excel ist leer — Abbruch.");
    process.exit(1);
  }

  // 2) Bestehende Profile holen
  const { data: profiles, error: pErr } = await admin
    .from("profiles")
    .select("id, vorname, nachname, pers_nr, is_active");
  if (pErr) {
    console.error("Profile-Read-Fehler:", pErr.message);
    process.exit(1);
  }
  console.log(`[1/5] DB hat aktuell ${profiles.length} Profile`);

  // 3) Match-Strategie: pers_nr (primär), fallback nachname+vorname
  const normalize = (s) =>
    (s ?? "")
      .toString()
      .toLowerCase()
      .replace(/ß/g, "ss")
      .replace(/ä/g, "a")
      .replace(/ö/g, "o")
      .replace(/ü/g, "u")
      .trim();
  const matchProfile = (m) => {
    const byPers = profiles.find((p) => String(p.pers_nr).trim() === m.pers_nr);
    if (byPers) return byPers;
    return profiles.find(
      (p) =>
        normalize(p.nachname) === normalize(m.nachname) &&
        normalize(p.vorname).startsWith(normalize(m.vorname.split(" ")[0])),
    ) ?? null;
  };

  // 4) Adress-Parser-Probe: alle 44 Adressen parsen, Fehler → Abbruch
  const parsedRows = liste.map((m) => {
    const adr = parseAddress(m.adresse);
    return { ...m, _adr: adr };
  });
  const parseFails = parsedRows.filter((r) => r._adr?._error);
  if (parseFails.length > 0) {
    console.error("FEHLER: Adress-Parser-Fehler in folgenden Zeilen:");
    parseFails.forEach((r) =>
      console.error(`  ${r.pers_nr} ${r.vorname} ${r.nachname}: ${r._adr._error}`),
    );
    process.exit(1);
  }
  console.log(`[1/5] Adress-Parser: alle ${parsedRows.length} Zeilen ok`);

  // 5) Plan-Anzeige
  const planNew = [], planUpdate = [];
  parsedRows.forEach((m) => {
    const existing = matchProfile(m);
    if (existing) planUpdate.push({ m, existing });
    else planNew.push(m);
  });
  console.log();
  console.log(`[1/5] PLAN: ${planNew.length} NEU anzulegen, ${planUpdate.length} UPDATE`);
  console.log();
  console.log("--- NEU ANZULEGEN ---");
  planNew.forEach((m) =>
    console.log(
      `  ${m.pers_nr.padEnd(8)} ${m.vorname.padEnd(20)} ${m.nachname.padEnd(20)} (${m.code}) ZA=${m.za ?? "-"} Url=${m.urlaub} Geb=${m.geburtsdatum} ${m._adr.plz} ${m._adr.ort}`,
    ),
  );
  console.log();
  console.log("--- UPDATE (bestehend) ---");
  planUpdate.forEach(({ m, existing }) =>
    console.log(
      `  ${m.pers_nr.padEnd(8)} ${m.vorname.padEnd(20)} ${m.nachname.padEnd(20)} → profile-id ${existing.id.slice(0, 8)}…`,
    ),
  );

  if (!APPLY) {
    console.log();
    console.log("[1/5] DRY-RUN beendet. Mit --apply real anwenden.");
    return;
  }

  // 6) Final-Bestätigung gegen Prod
  console.log();
  console.log(`!! ACHTUNG: gleich werden DB-Writes ausgeführt gegen ${SUPABASE_URL}`);
  console.log("!! Drücke Strg+C in den nächsten 5 Sekunden um abzubrechen.");
  await new Promise((r) => setTimeout(r, 5000));
  console.log("[1/5] Los geht's …");

  const credentials = [];
  let countNeu = 0,
    countUpd = 0,
    countErr = 0;

  // Bestehende Profile FRISCH holen (das vorherige hat sich evtl. verändert)
  const { data: profilesFresh } = await admin
    .from("profiles")
    .select("id, vorname, nachname, pers_nr, email");
  const profilesNow = profilesFresh ?? [];
  const matchProfileFresh = (m) => {
    const byPers = profilesNow.find(
      (p) => String(p.pers_nr ?? "").trim() === m.pers_nr,
    );
    if (byPers) return byPers;
    return (
      profilesNow.find(
        (p) =>
          normalize(p.nachname) === normalize(m.nachname) &&
          normalize(p.vorname).startsWith(normalize(m.vorname.split(" ")[0])),
      ) ?? null
    );
  };

  for (const m of parsedRows) {
    const surrogate = surrogateEmail(m.pers_nr);
    let userId = null;
    let didCreateAuth = false;
    let initialPassword = null;

    try {
      // 6a) Profil-Match: gibt's bereits einen MA → wir nutzen dessen
      //     Auth-Account, KEIN neues createUser. Sonst Surrogate-Email.
      const existingProfile = matchProfileFresh(m);
      if (existingProfile) {
        userId = existingProfile.id;
        countUpd++;
      } else {
        // Pre-Check: gibt's einen Surrogate-Auth-Account von einem
        // früheren Re-Run? Dann wiederverwenden, nicht neu anlegen.
        const existingAuth = await findAuthUserByEmail(admin, surrogate);
        initialPassword = genPassword();
        if (existingAuth) {
          userId = existingAuth.id;
          await admin.auth.admin.updateUserById(userId, { password: initialPassword });
        } else {
          const { data: created, error: cErr } = await admin.auth.admin.createUser({
            email: surrogate,
            password: initialPassword,
            email_confirm: true,
            user_metadata: {
              vorname: m.vorname,
              nachname: m.nachname,
              admin_created: true,
              bulk_import_source: IMPORT_SOURCE_TAG,
              bulk_import_at: TODAY,
              needs_real_phone: true,
            },
          });
          if (cErr) throw cErr;
          userId = created.user.id;
          didCreateAuth = true;
        }
        countNeu++;
      }

      // 6b) profiles UPDATE (Stub kommt vom Trigger)
      const adr = m._adr;
      const profileFields = {
        vorname: m.vorname,
        nachname: m.nachname,
        pers_nr: m.pers_nr,
        geburtsdatum: m.geburtsdatum,
        wohn_strasse: adr.strasse,
        wohn_plz: adr.plz,
        wohn_ort: adr.ort,
        wohn_land: adr.land,
        qualifikation: QUAL_LABEL[m.code] ?? null,
        is_active: true,
        updated_at: new Date().toISOString(),
      };
      const { error: profErr } = await admin
        .from("profiles")
        .update(profileFields)
        .eq("id", userId);
      if (profErr) throw new Error(`profiles UPDATE: ${profErr.message}`);

      // 6c) profiles_sensitive UPSERT (sv_nr-Marker)
      const svFull = m.svLastFour ? `------${m.svLastFour}` : null;
      if (svFull) {
        const { error: ssErr } = await admin
          .from("profiles_sensitive")
          .upsert({ profile_id: userId, sv_nr: svFull }, { onConflict: "profile_id" });
        if (ssErr) throw new Error(`profiles_sensitive UPSERT: ${ssErr.message}`);
      }

      // 6d) profile_konten_settings UPSERT
      const kontenFields = {
        profile_id: userId,
        eintrittsdatum: TODAY,
        beschaeftigungsgrad: 1.0,
        tagesnorm_stunden: 8.0,
        urlaub_jahresanspruch_tage: 25,
        urlaub_modell: "fix_datum",
        urlaub_stichtag_tag: 1,
        urlaub_stichtag_monat: 4,
        za_faktor: m.code === "GE" ? 0.0 : 1.0,
        arbeitszeitmodell: "zimmerei_sommer",
      };
      const { error: kErr } = await admin
        .from("profile_konten_settings")
        .upsert(kontenFields, { onConflict: "profile_id" });
      if (kErr) throw new Error(`profile_konten_settings UPSERT: ${kErr.message}`);

      // 6e) user_roles: DELETE + INSERT (idempotent)
      const role = rolleFromCode(m.code);
      const { error: delRoleErr } = await admin
        .from("user_roles")
        .delete()
        .eq("user_id", userId);
      if (delRoleErr) throw new Error(`user_roles DELETE: ${delRoleErr.message}`);
      const { error: insRoleErr } = await admin
        .from("user_roles")
        .insert({ user_id: userId, role });
      if (insRoleErr) throw new Error(`user_roles INSERT: ${insRoleErr.message}`);

      // 6f) urlaubs_buchungen art='initial' (DELETE + INSERT)
      await admin
        .from("urlaubs_buchungen")
        .delete()
        .eq("mitarbeiter_id", userId)
        .eq("art", "initial");
      const { error: urlErr } = await admin.from("urlaubs_buchungen").insert({
        mitarbeiter_id: userId,
        art: "initial",
        tage: m.urlaub,
        wirksam_am: TODAY,
        notiz: `Initial-Saldo aus ${IMPORT_SOURCE_TAG} vom ${TODAY}`,
      });
      if (urlErr) throw new Error(`urlaubs_buchungen INSERT: ${urlErr.message}`);

      // 6g) za_buchungen art='initial' (DELETE + INSERT) — skip wenn NULL
      await admin
        .from("za_buchungen")
        .delete()
        .eq("mitarbeiter_id", userId)
        .eq("art", "initial");
      if (m.za != null) {
        const { error: zaErr } = await admin.from("za_buchungen").insert({
          mitarbeiter_id: userId,
          art: "initial",
          stunden: m.za,
          wirksam_am: TODAY,
          monat: TODAY.slice(0, 7),
          notiz: `Initial-Saldo aus ${IMPORT_SOURCE_TAG} vom ${TODAY}`,
        });
        if (zaErr) throw new Error(`za_buchungen INSERT: ${zaErr.message}`);
      }

      // Credentials nur für frisch erstellte Surrogate-Accounts
      if (initialPassword) {
        credentials.push({
          pers_nr: m.pers_nr,
          vorname: m.vorname,
          nachname: m.nachname,
          supabase_user_id: userId,
          surrogate_email: surrogate,
          initial_password: initialPassword,
          notes: "Telefonnummer noch erfassen, dann SMS-Einladung neu senden.",
        });
      }

      const tag = initialPassword ? (didCreateAuth ? "NEU" : "REC") : "UPD";
      console.log(
        `  [${tag}] ${m.pers_nr.padEnd(8)} ${m.vorname.padEnd(20)} ${m.nachname.padEnd(20)} (${m.code}) ok`,
      );
    } catch (e) {
      countErr++;
      console.error(
        `  [ERR] ${m.pers_nr.padEnd(8)} ${m.vorname.padEnd(20)} ${m.nachname.padEnd(20)}: ${e.message}`,
      );
      // Nur frisch angelegte Auth-Accounts wieder löschen
      if (userId && didCreateAuth) {
        await admin.auth.admin.deleteUser(userId).catch(() => {});
      }
    }
  }

  // 7) Credentials sichern
  const ts = TODAY.replace(/-/g, "");
  const credPath1 = join(homedir(), "Downloads", `willroider-import-credentials-${ts}.json`);
  const credPath2 = `/tmp/willroider-import-credentials-${ts}.json`;
  writeFileSync(credPath1, JSON.stringify(credentials, null, 2));
  writeFileSync(credPath2, JSON.stringify(credentials, null, 2));
  try {
    chmodSync(credPath1, 0o600);
    chmodSync(credPath2, 0o600);
  } catch {}

  console.log();
  console.log(`[1/5] FERTIG: ${countNeu} neu, ${countUpd} aktualisiert, ${countErr} Fehler`);
  console.log(`[1/5] Credentials gespeichert: ${credPath1}`);
  console.log(`[1/5] Credentials gespeichert: ${credPath2}`);
  console.log();
  console.log("Nächster Schritt: tools/import-kw26-baustellen.mjs");
  if (countErr > 0) process.exit(1);
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
