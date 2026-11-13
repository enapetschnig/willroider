/**
 * Antwort der Verwaltung auf einen Änderungswunsch (feedback.admin_notiz).
 *
 * Dort schreibt der Roboter bzw. das Büro hinein, was umgesetzt wurde und
 * wo man es in der App findet. Lesen darf sie jeder, der den Wunsch sieht
 * (RLS feedback_select: eigener Wunsch, Admin oder feedback.view_alle).
 */

import { CheckCircle2, MessageSquareReply } from "lucide-react";

export function WunschAntwort({
  notiz,
  status,
  className = "",
}: {
  notiz: string | null | undefined;
  status: string;
  className?: string;
}) {
  const text = notiz?.trim();
  if (!text) return null;
  const erledigt = status === "umgesetzt";
  const Icon = erledigt ? CheckCircle2 : MessageSquareReply;
  return (
    <div
      data-testid="wunsch-antwort"
      className={`flex items-start gap-2 rounded-md border px-2.5 py-2 text-sm ${
        erledigt
          ? "border-green-300 bg-green-50 text-green-950"
          : "border-slate-200 bg-slate-50 text-slate-900"
      } ${className}`}
    >
      <Icon
        className={`h-4 w-4 mt-0.5 shrink-0 ${erledigt ? "text-green-600" : "text-slate-500"}`}
      />
      <div className="min-w-0 whitespace-pre-wrap break-words">
        <span className={`font-semibold ${erledigt ? "text-green-800" : "text-slate-700"}`}>
          Antwort:{" "}
        </span>
        {text}
      </div>
    </div>
  );
}
