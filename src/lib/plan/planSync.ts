/**
 * Offline Entstandenes nachschieben: Anmerkungen und wartende Kopien werden
 * beim App-Start und sobald wieder Netz da ist hochgeladen.
 */
import { useEffect } from "react";
import { ausstehendeAnmerkungenHochladen } from "./anmerkungen";
import { wartendeKopienHochladen } from "./kopieAblegen";
import { toast } from "@/hooks/use-toast";

export async function planDatenNachschieben(): Promise<void> {
  if (!navigator.onLine) return;
  await ausstehendeAnmerkungenHochladen().catch(() => 0);
  const n = await wartendeKopienHochladen().catch(() => 0);
  if (n > 0) {
    toast({
      title: n === 1 ? "Offline gespeicherte Kopie hochgeladen" : `${n} offline gespeicherte Kopien hochgeladen`,
      description: "Sie sind jetzt im Dokumente-Reiter und gehen gleich nach SharePoint.",
    });
  }
}

export function usePlanSync(aktiv: boolean) {
  useEffect(() => {
    if (!aktiv || typeof indexedDB === "undefined") return;
    const t = window.setTimeout(() => void planDatenNachschieben(), 3000);
    const online = () => void planDatenNachschieben();
    window.addEventListener("online", online);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("online", online);
    };
  }, [aktiv]);
}
