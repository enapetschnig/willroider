export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type AppRole =
  | 'geschaeftsfuehrung'
  | 'bauleiter'
  | 'zimmermeister'
  | 'buero'
  | 'mitarbeiter';

export type BaustellenStatus = 'geplant' | 'aktiv' | 'abgeschlossen' | 'pausiert';
export type StundenStatus = 'offen' | 'zm_freigabe' | 'buero_freigabe' | 'exportiert' | 'abgelehnt';
export type Wochentyp = 'L' | 'K' | 'F' | 'U' | 'BU' | 'BV';
export type ArbeitszeitModell = 'zimmerei_sommer' | 'fix_40h' | 'individuell';
export type FahrzeugKategorie = 'anlage' | 'baustelle' | 'bauleiter';
export type EvaluierungTyp = 'werkstatt' | 'baustelle' | 'fertigteilmontage' | 'kurz' | 'lang';
export type AngebotStatus = 'offen' | 'in_verhandlung' | 'angenommen' | 'abgelehnt' | 'zurueckgezogen';
export type AngebotOrdnerEnum = 'ausschreibungsunterlagen' | 'plaene' | 'subunternehmer' | 'angebotsunterlagen';

export type UrlaubsBuchungArt =
  | 'initial' | 'jahresgutschrift' | 'monatsgutschrift'
  | 'urlaub_genommen' | 'korrektur' | 'verfall';
export type ZaBuchungArt =
  | 'initial' | 'monatsabschluss' | 'zeitausgleich_genommen'
  | 'korrektur' | 'auszahlung';

// Zeiterfassung-Redesign (Phase A)
export type TagStatus = 'baustelle' | 'firma' | 'krank' | 'urlaub' | 'schlechtwetter' | 'feiertag';
export type BuchungStatus =
  | 'erfasst'
  | 'ma_bestaetigt'
  | 'zm_freigabe'
  | 'buero_freigabe'
  | 'exportiert'
  | 'abgelehnt';

// Berichte
export type BerichtTyp = 'bautagesbericht' | 'regiebericht';
export type BerichtStatus = 'entwurf' | 'eingereicht' | 'freigegeben' | 'archiviert';
export type StundenBerichtStatus = 'offen' | 'unterschrieben' | 'bestaetigt' | 'versendet';
export type UrlaubModell = 'fix_datum' | 'eintrittsdatum' | 'monatlich';
export type UrlaubsantragStatus = 'offen' | 'genehmigt' | 'abgelehnt' | 'storniert';

export type Database = {
  __InternalSupabase: { PostgrestVersion: '13.0.5' };
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          vorname: string;
          nachname: string;
          pers_nr: string | null;
          email: string | null;
          telefon: string | null;
          qualifikation: string | null;
          fuehrerschein: string | null;
          kran_berechtigung: boolean | null;
          partie_id: string | null;
          is_active: boolean | null;
          is_partieleiter: boolean | null;
          // Personalanlage — nicht-sensitive Felder
          geburtsdatum: string | null;
          geburtsort: string | null;
          staatsangehoerigkeit: string | null;
          wohn_strasse: string | null;
          wohn_plz: string | null;
          wohn_ort: string | null;
          wohn_land: string | null;
          erlernter_beruf: string | null;
          sonstige_pruefungen: string | null;
          bewerbung_als: string | null;
          /** Balkenfarbe in der Poliereinsatz-Ansicht (Hex) — nur Bauleiter. */
          planungsfarbe: string | null;
          /** True, sobald jemals freigeschaltet — steuert das "Neue Anmeldung"-Banner. */
          je_freigeschaltet: boolean | null;
          /** True = Bauleiter (wählbar im Baustellen-Formular). */
          ist_bauleiter: boolean | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database['public']['Tables']['profiles']['Row']> & { id: string };
        Update: Partial<Database['public']['Tables']['profiles']['Row']>;
        Relationships: [];
      };
      profiles_sensitive: {
        Row: {
          profile_id: string;
          sv_nr: string | null;
          religion: string | null;
          familienstand: string | null;
          bank_name: string | null;
          bank_bic: string | null;
          bank_iban: string | null;
          stundenlohn: number | null;
          zulagen: string | null;
          letzter_arbeitgeber: string | null;
          vorbeschaeftigung_von: string | null;
          vorbeschaeftigung_bis: string | null;
          personal_vermerke: string | null;
          vorstellungsdatum: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database['public']['Tables']['profiles_sensitive']['Row']> & {
          profile_id: string;
        };
        Update: Partial<Database['public']['Tables']['profiles_sensitive']['Row']>;
        Relationships: [];
      };
      user_roles: {
        Row: {
          id: string;
          user_id: string;
          role: AppRole;
          created_at: string;
        };
        Insert: { id?: string; user_id: string; role?: AppRole; created_at?: string };
        Update: Partial<Database['public']['Tables']['user_roles']['Row']>;
        Relationships: [];
      };
      partien: {
        Row: {
          id: string;
          name: string;
          farbcode: string;
          partieleiter_id: string | null;
          beschreibung: string | null;
          /** Reihenfolge in der Poliereinsatz-Ansicht (klein = oben). */
          sort_order: number | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database['public']['Tables']['partien']['Row']> & { name: string };
        Update: Partial<Database['public']['Tables']['partien']['Row']>;
        Relationships: [];
      };
      poliereinsatz_zeitraeume: {
        Row: {
          id: string;
          partie_id: string;
          baustelle_id: string;
          von_datum: string;
          bis_datum: string;
          /** false ⇒ Starttermin noch nicht fix → Balken gestrichelt. */
          start_fix: boolean;
          notiz: string | null;
          erstellt_von: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database['public']['Tables']['poliereinsatz_zeitraeume']['Row']> & {
          partie_id: string;
          baustelle_id: string;
          von_datum: string;
          bis_datum: string;
        };
        Update: Partial<Database['public']['Tables']['poliereinsatz_zeitraeume']['Row']>;
        Relationships: [];
      };
      fahrzeuge: {
        Row: {
          id: string;
          kennzeichen: string;
          typ: string | null;
          bezeichnung: string | null;
          kapazitaet: number | null;
          hat_anhaenger: boolean | null;
          notizen: string | null;
          aktiv: boolean | null;
          inventar_nr: string | null;
          kategorie: FahrzeugKategorie;
          standard_fahrer_id: string | null;
          standard_fahrer_notiz: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database['public']['Tables']['fahrzeuge']['Row']> & { kennzeichen: string };
        Update: Partial<Database['public']['Tables']['fahrzeuge']['Row']>;
        Relationships: [];
      };
      baustellen: {
        Row: {
          id: string;
          bvh_name: string;
          kostenstelle: string | null;
          bauherr: string | null;
          bauherr_adresse: string | null;
          baustellen_adresse: string | null;
          plz: string | null;
          ort: string | null;
          koordinaten_lat: number | null;
          koordinaten_lng: number | null;
          start_datum: string | null;
          end_datum: string | null;
          status: BaustellenStatus;
          auftragssumme: number | null;
          bauleiter_id: string | null;
          partie_id: string | null;
          anzahl_mitarbeiter: number | null;
          art_bauarbeiten: string | null;
          dacheindeckung: string | null;
          farben_grundierung: string | null;
          notizen: string | null;
          bautraeger: boolean | null;
          pflicht_evaluierung_id: string | null;
          besonderes_augenmerk: string | null;
          fahrtgeld_pauschale_eur: number;
          entfernung_km: number | null;
          kategorie: 'baustelle' | 'maschine';
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database['public']['Tables']['baustellen']['Row']> & { bvh_name: string };
        Update: Partial<Database['public']['Tables']['baustellen']['Row']>;
        Relationships: [];
      };
      baustellen_termine: {
        Row: {
          id: string;
          baustelle_id: string;
          termin_datum: string;
          typ: string;
          bezeichnung: string | null;
          notizen: string | null;
          created_at: string;
        };
        Insert: Partial<Database['public']['Tables']['baustellen_termine']['Row']> & {
          baustelle_id: string;
          termin_datum: string;
        };
        Update: Partial<Database['public']['Tables']['baustellen_termine']['Row']>;
        Relationships: [];
      };
      einteilungen: {
        Row: {
          id: string;
          datum: string;
          baustelle_id: string | null;
          fahrzeug_id: string | null;
          abfahrtszeit: string | null;
          treffpunkt: string | null;
          material_hinweise: string | null;
          sonderaufgaben: string | null;
          hat_anhaenger: boolean | null;
          kranfahrer_id: string | null;
          notizen: string | null;
          taetigkeit: string | null;
          versendet_am: string | null;
          created_by: string | null;
          created_at: string;
          updated_at: string;
          manuell_geaendert: boolean;
        };
        Insert: Partial<Database['public']['Tables']['einteilungen']['Row']> & { datum: string };
        Update: Partial<Database['public']['Tables']['einteilungen']['Row']>;
        Relationships: [];
      };
      einteilung_fahrzeuge: {
        Row: {
          id: string;
          einteilung_id: string;
          fahrzeug_id: string;
          created_at: string;
        };
        Insert: Partial<Database['public']['Tables']['einteilung_fahrzeuge']['Row']> & {
          einteilung_id: string;
          fahrzeug_id: string;
        };
        Update: Partial<Database['public']['Tables']['einteilung_fahrzeuge']['Row']>;
        Relationships: [];
      };
      einteilung_mitarbeiter: {
        Row: {
          id: string;
          einteilung_id: string;
          mitarbeiter_id: string;
          rolle: string | null;
          gelesen_am: string | null;
          bestaetigt_am: string | null;
          abwesend: boolean | null;
          abwesenheitsgrund: string | null;
          created_at: string;
          manuell_geaendert: boolean;
        };
        Insert: Partial<Database['public']['Tables']['einteilung_mitarbeiter']['Row']> & {
          einteilung_id: string;
          mitarbeiter_id: string;
        };
        Update: Partial<Database['public']['Tables']['einteilung_mitarbeiter']['Row']>;
        Relationships: [];
      };
      jahresplan_einteilungen: {
        Row: {
          id: string;
          datum: string;
          baustelle_id: string | null;
          taetigkeit: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database['public']['Tables']['jahresplan_einteilungen']['Row']> & {
          datum: string;
        };
        Update: Partial<Database['public']['Tables']['jahresplan_einteilungen']['Row']>;
        Relationships: [];
      };
      jahresplan_mitarbeiter: {
        Row: {
          id: string;
          einteilung_id: string;
          mitarbeiter_id: string;
          created_at: string;
        };
        Insert: Partial<Database['public']['Tables']['jahresplan_mitarbeiter']['Row']> & {
          einteilung_id: string;
          mitarbeiter_id: string;
        };
        Update: Partial<Database['public']['Tables']['jahresplan_mitarbeiter']['Row']>;
        Relationships: [];
      };
      jahresplan_fahrzeuge: {
        Row: {
          id: string;
          einteilung_id: string;
          fahrzeug_id: string;
          created_at: string;
        };
        Insert: Partial<Database['public']['Tables']['jahresplan_fahrzeuge']['Row']> & {
          einteilung_id: string;
          fahrzeug_id: string;
        };
        Update: Partial<Database['public']['Tables']['jahresplan_fahrzeuge']['Row']>;
        Relationships: [];
      };
      stundenbuchungen: {
        Row: {
          id: string;
          mitarbeiter_id: string;
          baustelle_id: string | null;
          datum: string;
          arbeitsstunden: number | null;
          fahrstunden: number | null;
          taggeld_kurz: number | null;
          taggeld_lang: number | null;
          km_gefahren: number | null;
          start_zeit: string | null;
          end_zeit: string | null;
          pause_von: string | null;
          pause_bis: string | null;
          pause_vm_von: string | null;
          pause_vm_bis: string | null;
          fehlzeit_typ: string | null;
          fehlzeit_stunden: number | null;
          taetigkeit: string | null;
          notizen: string | null;
          in_firma: boolean;
          zulage_typ: string | null;
          zulage_stunden: number;
          zulage_notiz: string | null;
          status: StundenStatus;
          freigegeben_zm_id: string | null;
          freigegeben_zm_am: string | null;
          freigegeben_buero_id: string | null;
          freigegeben_buero_am: string | null;
          abgelehnt_grund: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database['public']['Tables']['stundenbuchungen']['Row']> & {
          mitarbeiter_id: string;
          datum: string;
        };
        Update: Partial<Database['public']['Tables']['stundenbuchungen']['Row']>;
        Relationships: [];
      };
      arbeitszeitkalender: {
        Row: {
          id: string;
          jahr: number;
          kw: number;
          wochentyp: Wochentyp;
          soll_stunden: number;
          soll_mo: number | null;
          soll_di: number | null;
          soll_mi: number | null;
          soll_do: number | null;
          soll_fr: number | null;
          soll_sa: number | null;
          soll_so: number | null;
          feiertage: string | null;
          bu_tage: number | null;
          notizen: string | null;
          created_at: string;
        };
        Insert: Partial<Database['public']['Tables']['arbeitszeitkalender']['Row']> & {
          jahr: number;
          kw: number;
        };
        Update: Partial<Database['public']['Tables']['arbeitszeitkalender']['Row']>;
        Relationships: [];
      };
      evaluierungen: {
        Row: {
          id: string;
          baustelle_id: string;
          datum: string;
          typ: EvaluierungTyp;
          vortragender_id: string | null;
          checkliste: Json;
          abgeschlossen: boolean | null;
          notizen: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database['public']['Tables']['evaluierungen']['Row']> & {
          baustelle_id: string;
          datum: string;
        };
        Update: Partial<Database['public']['Tables']['evaluierungen']['Row']>;
        Relationships: [];
      };
      evaluierung_unterschriften: {
        Row: {
          id: string;
          evaluierung_id: string;
          mitarbeiter_id: string;
          unterschrift_data: string | null;
          unterschrieben_am: string;
          status: 'offen' | 'unterschrieben' | 'archiviert';
          archiviert_grund: string | null;
          archiviert_am: string | null;
          reminder_geschickt_am: string | null;
        };
        Insert: Partial<Database['public']['Tables']['evaluierung_unterschriften']['Row']> & {
          evaluierung_id: string;
          mitarbeiter_id: string;
        };
        Update: Partial<Database['public']['Tables']['evaluierung_unterschriften']['Row']>;
        Relationships: [];
      };
      evaluierung_vorlagen: {
        Row: {
          id: string;
          name: string;
          typ: EvaluierungTyp;
          checkliste: any;
          quell_dokument_id: string | null;
          notizen: string | null;
          aktiv: boolean;
          erstellt_von: string | null;
          erstellt_am: string;
          updated_at: string;
        };
        Insert: Partial<Database['public']['Tables']['evaluierung_vorlagen']['Row']> & {
          name: string;
        };
        Update: Partial<Database['public']['Tables']['evaluierung_vorlagen']['Row']>;
        Relationships: [];
      };
      dokumente: {
        Row: {
          id: string;
          baustelle_id: string | null;
          mitarbeiter_id: string | null;
          ordner: string | null;
          subpath: string | null;
          typ: string | null;
          dateiname: string;
          storage_path: string;
          groesse: number | null;
          mimetype: string | null;
          hochgeladen_von: string | null;
          notizen: string | null;
          created_at: string;
        };
        Insert: Partial<Database['public']['Tables']['dokumente']['Row']> & {
          dateiname: string;
          storage_path: string;
        };
        Update: Partial<Database['public']['Tables']['dokumente']['Row']>;
        Relationships: [];
      };
      dokument_ordner: {
        Row: {
          id: string;
          baustelle_id: string;
          ordner: string;
          subpath: string;
          created_by: string | null;
          created_at: string;
        };
        Insert: Partial<Database['public']['Tables']['dokument_ordner']['Row']> & {
          baustelle_id: string;
          ordner: string;
          subpath: string;
        };
        Update: Partial<Database['public']['Tables']['dokument_ordner']['Row']>;
        Relationships: [];
      };
      kostenbuchungen: {
        Row: {
          id: string;
          baustelle_id: string;
          datum: string;
          kostenart: string;
          betrag: number;
          beschreibung: string | null;
          beleg_dokument_id: string | null;
          erfasst_von: string | null;
          created_at: string;
        };
        Insert: Partial<Database['public']['Tables']['kostenbuchungen']['Row']> & {
          baustelle_id: string;
          datum: string;
          kostenart: string;
          betrag: number;
        };
        Update: Partial<Database['public']['Tables']['kostenbuchungen']['Row']>;
        Relationships: [];
      };
      bautagebuch: {
        Row: {
          id: string;
          baustelle_id: string;
          datum: string;
          wetter: string | null;
          temperatur: number | null;
          taetigkeit: string | null;
          besonderheiten: string | null;
          erstellt_von: string | null;
          created_at: string;
        };
        Insert: Partial<Database['public']['Tables']['bautagebuch']['Row']> & {
          baustelle_id: string;
          datum: string;
        };
        Update: Partial<Database['public']['Tables']['bautagebuch']['Row']>;
        Relationships: [];
      };
      angebote: {
        Row: {
          id: string;
          angebots_nr: string | null;
          datum_angebot: string | null;
          bvh_name: string;
          bauherr: string | null;
          bauherr_adresse: string | null;
          baustellen_adresse: string | null;
          plz: string | null;
          ort: string | null;
          kontakt_telefon: string | null;
          kontakt_email: string | null;
          wert_euro: number | null;
          status: AngebotStatus;
          bearbeiter_id: string | null;
          naechste_nachfrage: string | null;
          notizen: string | null;
          baustelle_id: string | null;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database['public']['Tables']['angebote']['Row']> & {
          bvh_name: string;
        };
        Update: Partial<Database['public']['Tables']['angebote']['Row']>;
        Relationships: [];
      };
      angebot_dokumente: {
        Row: {
          id: string;
          angebot_id: string;
          ordner: AngebotOrdnerEnum;
          subpath: string | null;
          dateiname: string;
          storage_path: string;
          mimetype: string | null;
          groesse: number | null;
          hochgeladen_von: string | null;
          created_at: string;
        };
        Insert: Partial<Database['public']['Tables']['angebot_dokumente']['Row']> & {
          angebot_id: string;
          ordner: AngebotOrdnerEnum;
          dateiname: string;
          storage_path: string;
        };
        Update: Partial<Database['public']['Tables']['angebot_dokumente']['Row']>;
        Relationships: [];
      };
      angebot_ordner_unterordner: {
        Row: {
          id: string;
          angebot_id: string;
          ordner: AngebotOrdnerEnum;
          subpath: string;
          created_by: string | null;
          created_at: string;
        };
        Insert: Partial<Database['public']['Tables']['angebot_ordner_unterordner']['Row']> & {
          angebot_id: string;
          ordner: AngebotOrdnerEnum;
          subpath: string;
        };
        Update: Partial<Database['public']['Tables']['angebot_ordner_unterordner']['Row']>;
        Relationships: [];
      };
      profile_konten_settings: {
        Row: {
          profile_id: string;
          eintrittsdatum: string | null;
          beschaeftigungsgrad: number;
          tagesnorm_stunden: number;
          urlaub_jahresanspruch_tage: number;
          urlaub_modell: UrlaubModell;
          urlaub_stichtag_tag: number | null;
          urlaub_stichtag_monat: number | null;
          za_faktor: number;
          arbeitszeitmodell: ArbeitszeitModell;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database['public']['Tables']['profile_konten_settings']['Row']> & {
          profile_id: string;
        };
        Update: Partial<Database['public']['Tables']['profile_konten_settings']['Row']>;
        Relationships: [];
      };
      urlaubs_buchungen: {
        Row: {
          id: string;
          mitarbeiter_id: string;
          art: UrlaubsBuchungArt;
          tage: number;
          wirksam_am: string;
          notiz: string | null;
          stundenbuchung_id: string | null;
          erstellt_von: string | null;
          created_at: string;
        };
        Insert: Partial<Database['public']['Tables']['urlaubs_buchungen']['Row']> & {
          mitarbeiter_id: string;
          art: UrlaubsBuchungArt;
          tage: number;
          wirksam_am: string;
        };
        Update: Partial<Database['public']['Tables']['urlaubs_buchungen']['Row']>;
        Relationships: [];
      };
      za_buchungen: {
        Row: {
          id: string;
          mitarbeiter_id: string;
          art: ZaBuchungArt;
          stunden: number;
          wirksam_am: string;
          monat: string | null;
          notiz: string | null;
          stundenbuchung_id: string | null;
          erstellt_von: string | null;
          created_at: string;
        };
        Insert: Partial<Database['public']['Tables']['za_buchungen']['Row']> & {
          mitarbeiter_id: string;
          art: ZaBuchungArt;
          stunden: number;
          wirksam_am: string;
        };
        Update: Partial<Database['public']['Tables']['za_buchungen']['Row']>;
        Relationships: [];
      };
      monatsabschluss: {
        Row: {
          id: string;
          mitarbeiter_id: string;
          monat: string;
          von_datum: string;
          bis_datum: string;
          soll_stunden: number;
          ist_stunden: number;
          differenz_stunden: number;
          za_buchung_id: string | null;
          abgeschlossen_von: string | null;
          abgeschlossen_am: string;
        };
        Insert: Partial<Database['public']['Tables']['monatsabschluss']['Row']> & {
          mitarbeiter_id: string;
          monat: string;
          soll_stunden: number;
          ist_stunden: number;
          differenz_stunden: number;
        };
        Update: Partial<Database['public']['Tables']['monatsabschluss']['Row']>;
        Relationships: [];
      };
      taetigkeiten_stamm: {
        Row: {
          id: string;
          bezeichnung: string;
          sort_order: number;
          is_active: boolean;
          bereich: 'baustelle' | 'halle' | 'beide';
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database['public']['Tables']['taetigkeiten_stamm']['Row']> & {
          bezeichnung: string;
        };
        Update: Partial<Database['public']['Tables']['taetigkeiten_stamm']['Row']>;
        Relationships: [];
      };
      zulagen_typen: {
        Row: {
          id: string;
          bezeichnung: string;
          sort_order: number;
          is_active: boolean;
          ermoeglicht_stunden_split: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database['public']['Tables']['zulagen_typen']['Row']> & {
          bezeichnung: string;
        };
        Update: Partial<Database['public']['Tables']['zulagen_typen']['Row']>;
        Relationships: [];
      };
      mitarbeiter_zulagen: {
        Row: {
          mitarbeiter_id: string;
          zulagen_typ_id: string;
          created_at: string;
        };
        Insert: {
          mitarbeiter_id: string;
          zulagen_typ_id: string;
        };
        Update: Partial<Database['public']['Tables']['mitarbeiter_zulagen']['Row']>;
        Relationships: [];
      };
      pausen_config: {
        Row: {
          typ: 'vormittag' | 'mittag';
          dauer_minuten: number;
          default_aktiv: boolean;
          updated_at: string;
        };
        Insert: Partial<Database['public']['Tables']['pausen_config']['Row']> & {
          typ: 'vormittag' | 'mittag';
          dauer_minuten: number;
        };
        Update: Partial<Database['public']['Tables']['pausen_config']['Row']>;
        Relationships: [];
      };
      arbeitszeit_limits: {
        Row: {
          id: number;
          max_netto_pro_tag: number;
          max_brutto_pro_tag: number;
          arbeitsbeginn_default: string;
          kilometergeld_satz_eur: number;
          updated_at: string;
        };
        Insert: Partial<Database['public']['Tables']['arbeitszeit_limits']['Row']>;
        Update: Partial<Database['public']['Tables']['arbeitszeit_limits']['Row']>;
        Relationships: [];
      };
      stunden_tage: {
        Row: {
          id: string;
          mitarbeiter_id: string;
          datum: string;
          tag_status: TagStatus;
          netto_stunden: number;
          vm_pause: boolean;
          mittag_pause: boolean;
          arbeitsbeginn: string | null;
          anmerkung: string | null;
          status: BuchungStatus;
          erfasst_von: string | null;
          bestaetigt_am: string | null;
          freigegeben_zm_id: string | null;
          freigegeben_zm_am: string | null;
          freigegeben_buero_id: string | null;
          freigegeben_buero_am: string | null;
          abgelehnt_grund: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database['public']['Tables']['stunden_tage']['Row']> & {
          mitarbeiter_id: string;
          datum: string;
          tag_status: TagStatus;
        };
        Update: Partial<Database['public']['Tables']['stunden_tage']['Row']>;
        Relationships: [];
      };
      stunden_taetigkeiten: {
        Row: {
          id: string;
          stunden_tag_id: string;
          position: number;
          art: TagStatus;
          taetigkeit_id: string | null;
          taetigkeit_freitext: string | null;
          baustelle_id: string | null;
          stunden: number;
          notiz: string | null;
          created_at: string;
        };
        Insert: Partial<Database['public']['Tables']['stunden_taetigkeiten']['Row']> & {
          stunden_tag_id: string;
          stunden: number;
        };
        Update: Partial<Database['public']['Tables']['stunden_taetigkeiten']['Row']>;
        Relationships: [];
      };
      app_einstellungen: {
        Row: {
          schluessel: string;
          wert: string | null;
          updated_at: string;
        };
        Insert: Partial<Database['public']['Tables']['app_einstellungen']['Row']> & {
          schluessel: string;
        };
        Update: Partial<Database['public']['Tables']['app_einstellungen']['Row']>;
        Relationships: [];
      };
      kalkulator_k3_saetze: {
        Row: {
          gruppe: 'dach' | 'decken' | 'waende' | 'regie' | 'clt';
          grundlohn: number;
          lnk: number;
          unprod: number;
          ggk: number;
          bauzinsen: number;
          wagnis: number;
          gewinn: number;
          updated_at: string;
          updated_by: string | null;
        };
        Insert: Partial<Database['public']['Tables']['kalkulator_k3_saetze']['Row']> & {
          gruppe: 'dach' | 'decken' | 'waende' | 'regie' | 'clt';
        };
        Update: Partial<Database['public']['Tables']['kalkulator_k3_saetze']['Row']>;
        Relationships: [];
      };
      kalkulator_anfragen: {
        Row: {
          id: string;
          erstellt_am: string;
          kunde_name: string;
          kunde_rolle: string | null;
          kunde_code: string | null;
          summe_netto: number | null;
          positionen_anzahl: number | null;
          eigene_anzahl: number | null;
          bedarf_text: string | null;
          raw_anfrage: any;
          versendet_an_mail: string | null;
          versendet_am: string | null;
          status: 'eingegangen' | 'in_bearbeitung' | 'angeboten' | 'abgeschlossen' | 'storniert';
          bearbeitet_von: string | null;
          notiz_intern: string | null;
        };
        Insert: Partial<Database['public']['Tables']['kalkulator_anfragen']['Row']> & {
          kunde_name: string;
        };
        Update: Partial<Database['public']['Tables']['kalkulator_anfragen']['Row']>;
        Relationships: [];
      };
      stunden_berichte: {
        Row: {
          id: string;
          mitarbeiter_id: string;
          jahr: number;
          monat: number;
          teil: number;
          von_datum: string;
          bis_datum: string;
          status: StundenBerichtStatus;
          snapshot: Record<string, unknown>;
          erstellt_am: string;
          unterschrift_data: string | null;
          unterschrieben_am: string | null;
          bestaetigt_von: string | null;
          bestaetigt_am: string | null;
          versendet_am: string | null;
          versendet_an_mail: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database['public']['Tables']['stunden_berichte']['Row']> & {
          mitarbeiter_id: string;
          jahr: number;
          monat: number;
          teil: number;
          von_datum: string;
          bis_datum: string;
        };
        Update: Partial<Database['public']['Tables']['stunden_berichte']['Row']>;
        Relationships: [];
      };
      stunden_bericht_aenderungen: {
        Row: {
          id: string;
          stunden_bericht_id: string;
          autor_id: string | null;
          zeitpunkt: string;
          art: string;
          details: string | null;
        };
        Insert: Partial<Database['public']['Tables']['stunden_bericht_aenderungen']['Row']> & {
          stunden_bericht_id: string;
          art: string;
        };
        Update: Partial<Database['public']['Tables']['stunden_bericht_aenderungen']['Row']>;
        Relationships: [];
      };
      stunden_zulagen: {
        Row: {
          id: string;
          stunden_tag_id: string;
          zulagen_typ_id: string;
          stunden: number | null;
          notiz: string | null;
          created_at: string;
        };
        Insert: Partial<Database['public']['Tables']['stunden_zulagen']['Row']> & {
          stunden_tag_id: string;
          zulagen_typ_id: string;
        };
        Update: Partial<Database['public']['Tables']['stunden_zulagen']['Row']>;
        Relationships: [];
      };
      stunden_fahrt: {
        Row: {
          stunden_tag_id: string;
          fahrtgeld_eur: number;
          privat_pkw: boolean;
          km_gefahren: number | null;
          taggeld_kurz: number;
          taggeld_lang: number;
          taggeld_manuell: boolean;
          updated_at: string;
        };
        Insert: Partial<Database['public']['Tables']['stunden_fahrt']['Row']> & {
          stunden_tag_id: string;
        };
        Update: Partial<Database['public']['Tables']['stunden_fahrt']['Row']>;
        Relationships: [];
      };
      berichte: {
        Row: {
          id: string;
          baustelle_id: string;
          datum: string;
          typ: BerichtTyp;
          status: BerichtStatus;
          erfasst_von: string | null;
          eingereicht_am: string | null;
          freigegeben_von: string | null;
          freigegeben_am: string | null;
          archiviert_am: string | null;
          wetter_beschreibung: string | null;
          temperatur_min: number | null;
          temperatur_max: number | null;
          niederschlag_mm: number | null;
          wetter_quelle: string | null;
          freitext_besonderheiten: string | null;
          zeiterfassung_quelle_am: string | null;
          pdf_dokument_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database['public']['Tables']['berichte']['Row']> & {
          baustelle_id: string;
          datum: string;
          typ: BerichtTyp;
        };
        Update: Partial<Database['public']['Tables']['berichte']['Row']>;
        Relationships: [];
      };
      bericht_mitarbeiter: {
        Row: {
          id: string;
          bericht_id: string;
          mitarbeiter_id: string;
          position: number;
          stunden_netto: number;
          taetigkeit_notiz: string | null;
          aus_zeiterfassung: boolean;
        };
        Insert: Partial<Database['public']['Tables']['bericht_mitarbeiter']['Row']> & {
          bericht_id: string;
          mitarbeiter_id: string;
        };
        Update: Partial<Database['public']['Tables']['bericht_mitarbeiter']['Row']>;
        Relationships: [];
      };
      bericht_taetigkeiten: {
        Row: {
          id: string;
          bericht_id: string;
          position: number;
          taetigkeit_id: string | null;
          bezeichnung: string;
          summe_stunden: number;
          notiz: string | null;
          aus_zeiterfassung: boolean;
        };
        Insert: Partial<Database['public']['Tables']['bericht_taetigkeiten']['Row']> & {
          bericht_id: string;
          bezeichnung: string;
        };
        Update: Partial<Database['public']['Tables']['bericht_taetigkeiten']['Row']>;
        Relationships: [];
      };
      bericht_aufmass: {
        Row: {
          id: string;
          bericht_id: string;
          position: number;
          beschreibung: string;
          menge: number | null;
          einheit: string | null;
          notiz: string | null;
        };
        Insert: Partial<Database['public']['Tables']['bericht_aufmass']['Row']> & {
          bericht_id: string;
          beschreibung: string;
        };
        Update: Partial<Database['public']['Tables']['bericht_aufmass']['Row']>;
        Relationships: [];
      };
      bericht_fotos: {
        Row: {
          id: string;
          bericht_id: string;
          dokument_id: string;
          aufmass_position_id: string | null;
          position: number;
          bildunterschrift: string | null;
          geo_lat: number | null;
          geo_lng: number | null;
          aufgenommen_am: string | null;
          created_at: string;
        };
        Insert: Partial<Database['public']['Tables']['bericht_fotos']['Row']> & {
          bericht_id: string;
          dokument_id: string;
        };
        Update: Partial<Database['public']['Tables']['bericht_fotos']['Row']>;
        Relationships: [];
      };
      bericht_aenderungen: {
        Row: {
          id: string;
          bericht_id: string;
          autor_id: string | null;
          zeitpunkt: string;
          art: string;
          details: string | null;
        };
        Insert: Partial<Database['public']['Tables']['bericht_aenderungen']['Row']> & {
          bericht_id: string;
          art: string;
        };
        Update: Partial<Database['public']['Tables']['bericht_aenderungen']['Row']>;
        Relationships: [];
      };
      tagesplanung_freigaben: {
        Row: {
          datum: string;
          // Nullable: NULL = Zeile existiert (z. B. nur Notiz), aber Plan NICHT freigegeben
          freigegeben_am: string | null;
          freigegeben_von: string | null;
          notiz: string | null;
        };
        Insert: Partial<Database['public']['Tables']['tagesplanung_freigaben']['Row']> & {
          datum: string;
        };
        Update: Partial<Database['public']['Tables']['tagesplanung_freigaben']['Row']>;
        Relationships: [];
      };
      urlaubsantraege: {
        Row: {
          id: string;
          mitarbeiter_id: string;
          von: string;
          bis: string;
          arbeitstage: number | null;
          kommentar: string | null;
          status: UrlaubsantragStatus;
          eingereicht_am: string;
          entschieden_von: string | null;
          entschieden_am: string | null;
        };
        Insert: Partial<Database['public']['Tables']['urlaubsantraege']['Row']> & {
          mitarbeiter_id: string;
          von: string;
          bis: string;
        };
        Update: Partial<Database['public']['Tables']['urlaubsantraege']['Row']>;
        Relationships: [];
      };
      krankmeldungen: {
        Row: {
          id: string;
          mitarbeiter_id: string;
          von: string;
          bis: string;
          dokument_id: string | null;
          notiz: string | null;
          eingereicht_am: string;
        };
        Insert: Partial<Database['public']['Tables']['krankmeldungen']['Row']> & {
          mitarbeiter_id: string;
          von: string;
          bis: string;
        };
        Update: Partial<Database['public']['Tables']['krankmeldungen']['Row']>;
        Relationships: [];
      };
      lohnzettel: {
        Row: {
          id: string;
          mitarbeiter_id: string;
          dokument_id: string;
          monat: number | null;
          jahr: number | null;
          titel: string | null;
          hochgeladen_von: string | null;
          hochgeladen_am: string;
          gelesen_am: string | null;
        };
        Insert: Partial<Database['public']['Tables']['lohnzettel']['Row']> & {
          mitarbeiter_id: string;
          dokument_id: string;
        };
        Update: Partial<Database['public']['Tables']['lohnzettel']['Row']>;
        Relationships: [];
      };
    };
    Views: { [_ in never]: never };
    Functions: { [_ in never]: never };
    Enums: {
      app_role: AppRole;
      baustellen_status: BaustellenStatus;
      stunden_status: StundenStatus;
      wochentyp: Wochentyp;
      evaluierung_typ: EvaluierungTyp;
      angebot_status: AngebotStatus;
      angebot_ordner: AngebotOrdnerEnum;
      tag_status: TagStatus;
      buchung_status: BuchungStatus;
      bericht_typ: BerichtTyp;
      bericht_status: BerichtStatus;
      stunden_bericht_status: StundenBerichtStatus;
    };
    CompositeTypes: { [_ in never]: never };
  };
};
