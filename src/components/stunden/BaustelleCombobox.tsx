import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Building2, Check, ChevronDown, Wrench } from "lucide-react";
import type { Database } from "@/integrations/supabase/types";

type Baustelle = Database["public"]["Tables"]["baustellen"]["Row"];

export function BaustelleCombobox({
  baustellen,
  value,
  onChange,
  allowClear = false,
  kategorie,
}: {
  baustellen: Baustelle[];
  value: string;
  onChange: (id: string) => void;
  allowClear?: boolean;
  /** Filtert + ändert Label/Icon: 'maschine' für die Halle-Erfassung,
   *  'baustelle' für die normale Erfassung. Ohne Wert: alle. */
  kategorie?: "baustelle" | "maschine";
}) {
  const [open, setOpen] = useState(false);
  const liste = kategorie
    ? baustellen.filter((b) => (b.kategorie ?? "baustelle") === kategorie)
    : baustellen;
  const selected = liste.find((b) => b.id === value);
  const istMaschine = kategorie === "maschine";
  const Icon = istMaschine ? Wrench : Building2;
  const placeholderText = istMaschine ? "Maschine wählen…" : "Baustelle wählen…";
  const searchPlaceholder = istMaschine
    ? "Maschine suchen…"
    : "Baustelle suchen…";
  const emptyText = istMaschine
    ? "Keine Maschine gefunden."
    : "Keine Baustelle gefunden.";

  if (liste.length === 0) {
    return (
      <div className="text-xs text-muted-foreground p-3 bg-muted/40 rounded">
        {istMaschine
          ? "Aktuell keine Maschinen angelegt."
          : "Aktuell keine aktiven Baustellen für deine Partie."}
      </div>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between h-12 text-left font-normal"
        >
          {selected ? (
            <span className="flex items-center gap-2 min-w-0 flex-1">
              <Icon className="h-4 w-4 text-primary shrink-0" />
              <span className="min-w-0 flex-1 truncate">
                <span className="font-medium">{selected.bvh_name}</span>
                {selected.kostenstelle && (
                  <span className="text-xs text-muted-foreground ml-1.5">
                    · {selected.kostenstelle}
                  </span>
                )}
              </span>
            </span>
          ) : (
            <span className="flex items-center gap-2 text-muted-foreground">
              <Icon className="h-4 w-4 shrink-0" />
              {placeholderText}
            </span>
          )}
          <ChevronDown className="h-4 w-4 opacity-50 shrink-0" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="p-0 w-[var(--radix-popover-trigger-width)] max-h-[60vh]"
        align="start"
      >
        <Command>
          <CommandInput placeholder={searchPlaceholder} className="h-11" />
          <CommandList>
            <CommandEmpty>{emptyText}</CommandEmpty>
            <CommandGroup>
              {allowClear && !istMaschine && (
                <CommandItem
                  value="--keine--"
                  onSelect={() => {
                    onChange("");
                    setOpen(false);
                  }}
                  className="cursor-pointer text-muted-foreground italic"
                >
                  <Check className={`mr-2 h-4 w-4 ${!value ? "opacity-100" : "opacity-0"}`} />
                  Keine Baustelle (allgemein in Firma)
                </CommandItem>
              )}
              {liste.map((b) => {
                const isSel = b.id === value;
                return (
                  <CommandItem
                    key={b.id}
                    value={`${b.bvh_name} ${b.kostenstelle ?? ""} ${b.bauherr ?? ""} ${b.ort ?? ""}`}
                    onSelect={() => {
                      onChange(b.id);
                      setOpen(false);
                    }}
                    className="cursor-pointer"
                  >
                    <Check
                      className={`mr-2 h-4 w-4 ${isSel ? "opacity-100" : "opacity-0"}`}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-sm truncate">{b.bvh_name}</div>
                      <div className="text-[11px] text-muted-foreground truncate">
                        {[b.kostenstelle, b.ort, b.bauherr].filter(Boolean).join(" · ")}
                      </div>
                    </div>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
