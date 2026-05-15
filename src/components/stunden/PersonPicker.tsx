import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Check, Users, UserPlus } from "lucide-react";
import type { Database } from "@/integrations/supabase/types";

type Profile = Database["public"]["Tables"]["profiles"]["Row"];
type Partie = Database["public"]["Tables"]["partien"]["Row"];

export type Mode = "self" | "polier" | "admin";

const initials = (p: { vorname: string; nachname: string }) =>
  `${p.vorname[0] ?? ""}${p.nachname[0] ?? ""}`.toUpperCase();

export function PersonPicker({
  mode,
  partie,
  partien,
  members,
  selectedIds,
  onToggle,
  onSetSelection,
  ownUserId,
  ownProfile,
  statusForDate,
  search,
  onSearchChange,
}: {
  mode: Mode;
  partie: Partie | null;
  partien: Partie[];
  members: Profile[];
  selectedIds: Set<string>;
  onToggle: (id: string) => void;
  onSetSelection: (s: Set<string>) => void;
  ownUserId: string;
  ownProfile: Profile | null;
  statusForDate: Map<string, { hours: number }>;
  search: string;
  onSearchChange: (s: string) => void;
  date: string;
}) {
  const isAdmin = mode === "admin";
  const [open, setOpen] = useState(false);

  const filteredMembers = members.filter((m) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      m.vorname.toLowerCase().includes(q) ||
      m.nachname.toLowerCase().includes(q) ||
      (m.pers_nr ?? "").toLowerCase().includes(q)
    );
  });

  const grouped = useMemo(() => {
    if (!isAdmin) return null;
    const map = new Map<string | "ohne", { partie: Partie | null; rows: Profile[] }>();
    filteredMembers.forEach((m) => {
      const key = m.partie_id ?? "ohne";
      if (!map.has(key)) {
        map.set(key, {
          partie: m.partie_id ? partien.find((p) => p.id === m.partie_id) ?? null : null,
          rows: [],
        });
      }
      map.get(key)!.rows.push(m);
    });
    return [...map.values()].sort((a, b) =>
      (a.partie?.name ?? "ZZ").localeCompare(b.partie?.name ?? "ZZ")
    );
  }, [isAdmin, filteredMembers, partien]);

  const selectedList = Array.from(selectedIds);
  const selectedProfiles = selectedList
    .map((id) =>
      id === ownUserId && ownProfile ? ownProfile : members.find((m) => m.id === id)
    )
    .filter(Boolean) as Profile[];
  const visibleAvatars = selectedProfiles.slice(0, 3);
  const extraCount = Math.max(0, selectedProfiles.length - visibleAvatars.length);

  const focusedLabel =
    selectedIds.size === 0
      ? "Niemand"
      : selectedIds.size === 1
      ? selectedIds.has(ownUserId)
        ? "Mich"
        : (() => {
            const m = selectedProfiles[0];
            return m ? `${m.vorname} ${m.nachname[0] ?? ""}.` : "1 Person";
          })()
      : `${selectedIds.size} Mitarbeiter`;

  const selectOnlyMe = () => onSetSelection(new Set([ownUserId]));
  const selectAllPartie = () => {
    const ids = new Set([ownUserId]);
    members.forEach((m) => {
      if (!partie?.id || m.partie_id === partie.id) ids.add(m.id);
    });
    onSetSelection(ids);
  };
  const selectAll = () => {
    const ids = new Set([ownUserId]);
    members.forEach((m) => ids.add(m.id));
    onSetSelection(ids);
  };

  const partieColor = (m: Profile) => {
    if (!isAdmin) return partie?.farbcode ?? "#999";
    return partien.find((p) => p.id === m.partie_id)?.farbcode ?? "#999";
  };

  const renderRow = (m: Profile) => {
    const s = statusForDate.get(m.id);
    const active = selectedIds.has(m.id);
    const color = partieColor(m);
    return (
      <button
        key={m.id}
        type="button"
        onClick={() => onToggle(m.id)}
        className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-md text-sm border transition ${
          active
            ? "bg-primary/10 border-primary"
            : "bg-background border-border hover:bg-muted"
        }`}
      >
        <span
          className="h-7 w-7 rounded-full flex items-center justify-center text-[10px] font-bold text-white shrink-0"
          style={{ background: color }}
        >
          {initials(m)}
        </span>
        <span className="flex-1 text-left truncate">
          {m.vorname} {m.nachname}
        </span>
        {s && s.hours > 0 && (
          <span className="text-[10px] font-semibold text-emerald-600 tabular-nums shrink-0">
            {s.hours.toFixed(1)} h
          </span>
        )}
        {active && <Check className="h-4 w-4 text-primary shrink-0" />}
      </button>
    );
  };

  const onlyMe = selectedIds.size <= 1 && selectedIds.has(ownUserId);
  const multi = selectedIds.size > 1;

  return (
    <>
      <Card className="border-primary/30">
        <CardContent className="p-3 space-y-2">
          {onlyMe ? (
            <>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Users className="h-4 w-4 text-primary" />
                <span>
                  Buchung für <strong className="text-foreground">dich</strong>
                </span>
              </div>
              <Button
                onClick={() => setOpen(true)}
                variant="outline"
                className="w-full h-11 justify-center border-dashed border-primary/50 hover:bg-primary/5 text-primary font-semibold"
              >
                <UserPlus className="h-4 w-4 mr-2" />
                + Weitere Mitarbeiter
              </Button>
              <p className="text-[11px] text-muted-foreground text-center leading-tight">
                Tipp: Tippe hier, wenn du für andere oder mehrere Mitarbeiter
                gleichzeitig Stunden eintragen willst.
              </p>
            </>
          ) : (
            <>
              <div className="flex items-center gap-2">
                <Users className="h-4 w-4 text-primary shrink-0" />
                <div className="flex -space-x-1.5">
                  {visibleAvatars.map((m) => (
                    <span
                      key={m.id}
                      className="h-7 w-7 rounded-full flex items-center justify-center text-[10px] font-bold text-white border-2 border-background"
                      style={{ background: partieColor(m) }}
                      title={`${m.vorname} ${m.nachname}`}
                    >
                      {initials(m)}
                    </span>
                  ))}
                  {extraCount > 0 && (
                    <span className="h-7 w-7 rounded-full flex items-center justify-center text-[10px] font-bold bg-muted-foreground text-background border-2 border-background">
                      +{extraCount}
                    </span>
                  )}
                </div>
                <span className="text-sm font-semibold ml-1 truncate flex-1">
                  {focusedLabel}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-9 shrink-0"
                  onClick={() => setOpen(true)}
                >
                  Bearbeiten
                </Button>
              </div>
              {multi && (
                <p className="text-[11px] text-muted-foreground">
                  Du buchst für <strong>{selectedIds.size} Mitarbeiter</strong>{" "}
                  gleichzeitig — tippen zum Ändern.
                </p>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md max-h-[85vh] flex flex-col p-0 gap-0">
          <DialogHeader className="px-4 pt-4 pb-2">
            <DialogTitle className="text-base">
              {isAdmin ? "Mitarbeiter auswählen" : `Partie · ${partie?.name ?? ""}`}
            </DialogTitle>
          </DialogHeader>

          <div className="px-4 pb-2 space-y-2">
            <Input
              autoFocus
              placeholder="Name oder Pers.-Nr. suchen…"
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
              className="h-9"
            />
            <div className="flex flex-wrap gap-1.5">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                onClick={selectOnlyMe}
              >
                Nur mich
              </Button>
              {!isAdmin && partie && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={selectAllPartie}
                >
                  Ganze Partie
                </Button>
              )}
              {isAdmin && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={selectAll}
                >
                  Alle
                </Button>
              )}
              <span className="ml-auto text-[11px] text-muted-foreground self-center tabular-nums">
                {selectedIds.size} ausgewählt
              </span>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-4 pb-2 space-y-3">
            <div className="space-y-1">
              <div className="text-[10px] uppercase tracking-wide font-semibold text-muted-foreground">
                Mich
              </div>
              <button
                type="button"
                onClick={() => onToggle(ownUserId)}
                className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-md text-sm border transition ${
                  selectedIds.has(ownUserId)
                    ? "bg-primary/10 border-primary"
                    : "bg-background border-border hover:bg-muted"
                }`}
              >
                <span className="h-7 w-7 rounded-full flex items-center justify-center text-[10px] font-bold text-white bg-primary shrink-0">
                  {ownProfile ? initials(ownProfile) : "ME"}
                </span>
                <span className="flex-1 text-left">
                  {ownProfile
                    ? `${ownProfile.vorname} ${ownProfile.nachname}`
                    : "Mich"}
                </span>
                {(() => {
                  const s = statusForDate.get(ownUserId);
                  if (!s || s.hours <= 0) return null;
                  return (
                    <span className="text-[10px] font-semibold text-emerald-600 tabular-nums shrink-0">
                      {s.hours.toFixed(1)} h
                    </span>
                  );
                })()}
                {selectedIds.has(ownUserId) && (
                  <Check className="h-4 w-4 text-primary shrink-0" />
                )}
              </button>
            </div>

            {!isAdmin && (
              <div className="space-y-1">
                <div className="text-[10px] uppercase tracking-wide font-semibold text-muted-foreground">
                  Partie ({filteredMembers.filter((m) => m.id !== ownUserId).length})
                </div>
                <div className="space-y-1">
                  {filteredMembers
                    .filter((m) => m.id !== ownUserId)
                    .map((m) => renderRow(m))}
                  {filteredMembers.filter((m) => m.id !== ownUserId).length === 0 && (
                    <div className="text-xs text-muted-foreground italic py-2">
                      {search ? "Niemand passt zur Suche." : "Keine weiteren Mitarbeiter."}
                    </div>
                  )}
                </div>
              </div>
            )}

            {isAdmin && grouped && (
              <>
                {grouped.map((g) => {
                  const rows = g.rows.filter((m) => m.id !== ownUserId);
                  if (rows.length === 0) return null;
                  const color = g.partie?.farbcode ?? "#999";
                  return (
                    <div key={g.partie?.id ?? "ohne"} className="space-y-1">
                      <div
                        className="text-[10px] uppercase tracking-wide font-semibold flex items-center gap-1.5"
                        style={{ color }}
                      >
                        <span
                          className="h-2 w-2 rounded-full"
                          style={{ background: color }}
                        />
                        {g.partie?.name ?? "Ohne Partie"}
                        <span className="opacity-60 font-normal">({rows.length})</span>
                      </div>
                      <div className="space-y-1">{rows.map((m) => renderRow(m))}</div>
                    </div>
                  );
                })}
                {grouped.every(
                  (g) => g.rows.filter((m) => m.id !== ownUserId).length === 0
                ) && (
                  <div className="text-xs text-muted-foreground italic py-2">
                    {search ? "Niemand passt zur Suche." : "Keine weiteren Mitarbeiter."}
                  </div>
                )}
              </>
            )}
          </div>

          <DialogFooter className="px-4 py-3 border-t">
            <Button type="button" onClick={() => setOpen(false)} className="w-full">
              Fertig ({selectedIds.size})
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
