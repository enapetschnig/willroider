/**
 * Bausatz-Kalkulator — native React-Page, 4 Tabs.
 *
 * Wenn URL ?anfrage=<id> trägt, lädt der Hook die gespeicherte Anfrage
 * komplett in den State (Projekt + Mengen + Overrides + Stützenlänge).
 * Speichern in SummeTab updated dann den bestehenden Datensatz statt
 * neu anzulegen. So bleibt jede Anfrage jederzeit weiter bearbeitbar.
 */

import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { PageHeader } from "@/components/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/contexts/AuthContext";
import { useKalkulator } from "@/hooks/useKalkulator";
import ProjektTab from "@/components/kalkulator/ProjektTab";
import PositionenTab from "@/components/kalkulator/PositionenTab";
import SummeTab from "@/components/kalkulator/SummeTab";
import AdminTab from "@/components/kalkulator/AdminTab";
import { Plus } from "lucide-react";

export default function Kalkulator() {
  const { role } = useAuth();
  const canWriteK3 = role === "geschaeftsfuehrung" || role === "buero";
  const kalk = useKalkulator(canWriteK3);
  const [params, setParams] = useSearchParams();

  // Bei ?anfrage=<id> einmalig laden und Query-Param entfernen, damit der
  // User durch Browser-Back nicht in einer Endlos-Lade-Schleife landet.
  useEffect(() => {
    const id = params.get("anfrage");
    if (!id) return;
    kalk.loadAnfrage(id);
    setParams({}, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const neueAnfrage = () => {
    kalk.reset();
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Bausatz-Kalkulator"
        description="Holzbau Willroider — Zimmermeisterarbeiten · K3/K7-Preisermittlung nach ÖNORM B2061"
        actions={
          kalk.state.anfrageId ? (
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant="outline">Anfrage bearbeiten</Badge>
              <Button size="sm" variant="outline" onClick={neueAnfrage}>
                <Plus className="h-3.5 w-3.5 mr-1" /> Neue Anfrage
              </Button>
            </div>
          ) : undefined
        }
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
          <SummeTab {...kalk} setAnfrageId={kalk.setAnfrageId} />
        </TabsContent>
        <TabsContent value="admin">
          <AdminTab {...kalk} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
