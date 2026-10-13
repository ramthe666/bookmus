"use client";

import { useState } from "react";

export function QuestionAnswers({
  answers,
  questions,
}: {
  answers: Record<string, string>;
  questions: { id: string; label: string }[];
}) {
  const [open, setOpen] = useState(false);
  const entries = questions
    .map((q) => ({ label: q.label, value: answers[q.id] }))
    .filter((e) => e.value);
  if (entries.length === 0) return null;
  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="text-xs font-medium text-indigo-600 hover:text-indigo-800"
      >
        {open ? "Hide answers ▴" : `View ${entries.length} answer${entries.length > 1 ? "s" : ""} ▾`}
      </button>
      {open && (
        <dl className="mt-2 space-y-1.5 rounded-lg bg-slate-50 p-3">
          {entries.map((e, i) => (
            <div key={i} className="text-xs">
              <dt className="font-medium text-slate-500">{e.label}</dt>
              <dd className="mt-0.5 text-slate-800">{e.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}
