import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { FileText, ArrowRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

/**
 * Dashboard-Hint für den Mitarbeiter: zeigt einen Banner wenn er ungelesene
 * Lohnzettel hat. Klick führt zu /mein-tag zur LohnzettelCard.
 */
export function NeuerLohnzettelHintCard() {
  const { user } = useAuth();
  const [count, setCount] = useState<number>(0);

  const load = async () => {
    if (!user?.id) return;
    const { count: c } = await supabase
      .from("lohnzettel")
      .select("id", { count: "exact", head: true })
      .eq("mitarbeiter_id", user.id)
      .is("gelesen_am", null);
    setCount(c ?? 0);
  };

  useEffect(() => {
    if (!user?.id) return;
    load();
    const ch = supabase
      .channel(`lohn-hint-${user.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "lohnzettel",
          filter: `mitarbeiter_id=eq.${user.id}`,
        },
        load,
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  if (count === 0) return null;

  return (
    <Card className="border-2 border-primary/40 bg-primary/5">
      <CardContent className="p-3 flex items-center gap-3 flex-wrap">
        <FileText className="h-5 w-5 text-primary shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold">
            {count === 1
              ? "Neuer Lohnzettel verfügbar"
              : `${count} neue Lohnzettel verfügbar`}
          </div>
          <div className="text-xs text-muted-foreground">
            Tap, um anzusehen
          </div>
        </div>
        <Link
          to="/mein-tag"
          className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
        >
          Ansehen <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </CardContent>
    </Card>
  );
}
