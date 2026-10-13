"use client";

import { useState } from "react";

export function CopyLinkButton({ token }: { token: string }) {
  const [copied, setCopied] = useState(false);
  const url = `${process.env.NEXT_PUBLIC_APP_URL}/b/cancel/${token}`;
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard.writeText(url);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
      title="Copy the guest's self-cancel link"
      className="rounded-lg px-3 py-1.5 text-xs font-medium text-indigo-600 transition hover:bg-indigo-50"
    >
      {copied ? "Copied ✓" : "Copy guest link"}
    </button>
  );
}
