"use client";

import { useState } from "react";

export function EmbedSnippet({
  username,
  slug,
}: {
  username: string;
  slug: string;
}) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
  const src = `${appUrl}/embed/${username}/${slug}`;
  const code = `<iframe src="${src}" width="100%" height="700" frameborder="0" style="border:0;border-radius:12px;max-width:900px;" title="Book a meeting"></iframe>`;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100"
      >
        Embed
      </button>
      {open && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-slate-900/50 p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-base font-semibold text-slate-900">
              Embed on your website
            </h3>
            <p className="mt-1 text-sm text-slate-500">
              Paste this snippet anywhere on your site to let visitors book
              without leaving the page.
            </p>
            <pre className="mt-4 max-h-40 overflow-auto rounded-xl bg-slate-900 p-4 text-xs leading-5 text-slate-100">
              {code}
            </pre>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
              >
                Close
              </button>
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard.writeText(code);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                }}
                className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
              >
                {copied ? "Copied ✓" : "Copy code"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
