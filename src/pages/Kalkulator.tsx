/**
 * Bausatz-Kalkulator — vollständig native React-Page (kein iframe mehr).
 * 4 Tabs: Projektdaten/BGK, Positionen (Dach/Decken/Wände/Regie),
 * Zusammenfassung + Versand, Admin (K3-Sätze).
 *
 * Sichtbar/zugänglich nur für Geschäftsführung (route-protected via
 * RequireRole role="gf" in App.tsx).
 *
 * State + DB-Sync: useKalkulator (Mengen/Overrides lokal,
 * K3-Sätze persistent in Supabase, Anfragen via Edge-Function).
 */

import { PageHeader } from "@/components/PageHeader";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/contexts/AuthContext";
import { useKalkulator } from "@/hooks/useKalkulator";
import ProjektTab from "@/components/kalkulator/ProjektTab";
import PositionenTab from "@/components/kalkulator/PositionenTab";
import SummeTab from "@/components/kalkulator/SummeTab";
import AdminTab from "@/components/kalkulator/AdminTab";

export default function Kalkulator() {
  const { role } = useAuth();
  const canWriteK3 = role === "geschaeftsfuehrung" || role === "buero";

  const kalk = useKalkulator(canWriteK3);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Bausatz-Kalkulator"
        description="Holzbau Willroider — Zimmermeisterarbeiten · K3/K7-Preisermittlung nach ÖNORM B2061"
      />
      <Tabs defaultValue="projekt" className="space-y-3">
        <TabsList className="flex-wrap h-auto justify-start">
          <TabsTrigger value="projekt" className="min-h-[44px]">
            Projektdaten
          </TabsTrigger>
          <TabsTrigger value="positionen" className="min-h-[44px]">
            Positionen
          </TabsTrigger>
          <TabsTrigger value="summe" className="min-h-[44px]">
            Zusammenfassung
          </TabsTrigger>
          <TabsTrigger value="admin" className="min-h-[44px]">
            K3-Sätze
          </TabsTrigger>
        </TabsList>

        <TabsContent value="projekt">
          <ProjektTab {...kalk} />
        </TabsContent>
        <TabsContent value="positionen">
          <PositionenTab {...kalk} canCalc={canWriteK3} />
        </TabsContent>
        <TabsContent value="summe">
          <SummeTab {...kalk} />
        </TabsContent>
        <TabsContent value="admin">
          <AdminTab {...kalk} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
