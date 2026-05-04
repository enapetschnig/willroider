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
export type Wochentyp = 'L' | 'K' | 'F' | 'U';
export type EvaluierungTyp = 'werkstatt' | 'baustelle' | 'fertigteilmontage' | 'kurz' | 'lang';

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
          // Personalanlage
          geburtsdatum: string | null;
          geburtsort: string | null;
          sv_nr: string | null;
          staatsangehoerigkeit: string | null;
          religion: string | null;
          familienstand: string | null;
          wohn_strasse: string | null;
          wohn_plz: string | null;
          wohn_ort: string | null;
          wohn_land: string | null;
          erlernter_beruf: string | null;
          letzter_arbeitgeber: string | null;
          vorbeschaeftigung_von: string | null;
          vorbeschaeftigung_bis: string | null;
          sonstige_pruefungen: string | null;
          bewerbung_als: string | null;
          bank_name: string | null;
          bank_bic: string | null;
          bank_iban: string | null;
          vorstellungsdatum: string | null;
          stundenlohn: number | null;
          zulagen: string | null;
          personal_vermerke: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database['public']['Tables']['profiles']['Row']> & { id: string };
        Update: Partial<Database['public']['Tables']['profiles']['Row']>;
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
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database['public']['Tables']['partien']['Row']> & { name: string };
        Update: Partial<Database['public']['Tables']['partien']['Row']>;
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
        };
        Insert: Partial<Database['public']['Tables']['einteilung_mitarbeiter']['Row']> & {
          einteilung_id: string;
          mitarbeiter_id: string;
        };
        Update: Partial<Database['public']['Tables']['einteilung_mitarbeiter']['Row']>;
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
        };
        Insert: Partial<Database['public']['Tables']['evaluierung_unterschriften']['Row']> & {
          evaluierung_id: string;
          mitarbeiter_id: string;
        };
        Update: Partial<Database['public']['Tables']['evaluierung_unterschriften']['Row']>;
        Relationships: [];
      };
      dokumente: {
        Row: {
          id: string;
          baustelle_id: string | null;
          mitarbeiter_id: string | null;
          ordner: string | null;
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
    };
    Views: { [_ in never]: never };
    Functions: { [_ in never]: never };
    Enums: {
      app_role: AppRole;
      baustellen_status: BaustellenStatus;
      stunden_status: StundenStatus;
      wochentyp: Wochentyp;
      evaluierung_typ: EvaluierungTyp;
    };
    CompositeTypes: { [_ in never]: never };
  };
};
