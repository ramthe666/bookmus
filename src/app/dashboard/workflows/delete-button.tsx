"use client";

import { useTransition } from "react";
import { deleteWorkflow } from "./actions";

export function DeleteWorkflowButton({ id }: { id: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        if (confirm("Delete this workflow?")) {
          startTransition(async () => {
            await deleteWorkflow(id);
          });
        }
      }}
      className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
    >
      {pending ? "Deleting…" : "Delete"}
    </button>
  );
}
