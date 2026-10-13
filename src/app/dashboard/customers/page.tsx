import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

/**
 * Customer directory (spec §8.3, CRM basics). Aggregated from the owner's
 * bookings — no separate CRM provider yet. Internal-only data.
 */
export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const params = await searchParams;
  const q = (params.q ?? "").trim().toLowerCase();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: bookings } = await supabase
    .from("bookings")
    .select("booker_name, booker_email, booker_phone, status, starts_at")
    .order("starts_at", { ascending: false })
    .limit(3000);

  interface Customer {
    email: string;
    name: string;
    phone: string | null;
    bookings: number;
    lastAt: string;
  }
  const map = new Map<string, Customer>();
  for (const b of bookings ?? []) {
    const email = (b.booker_email as string).toLowerCase();
    const cur = map.get(email);
    if (cur) {
      cur.bookings++;
    } else {
      map.set(email, {
        email,
        name: b.booker_name as string,
        phone: (b.booker_phone as string | null) ?? null,
        bookings: 1,
        lastAt: b.starts_at as string,
      });
    }
  }
  let customers = [...map.values()].sort((a, b) => b.bookings - a.bookings);
  if (q) {
    customers = customers.filter(
      (c) => c.name.toLowerCase().includes(q) || c.email.includes(q)
    );
  }

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="text-2xl font-bold tracking-tight text-slate-900">
        Customers
      </h1>
      <p className="mt-1 text-sm text-slate-500">
        Everyone who has booked with you. Internal only — never shared.
      </p>

      <form method="get" className="mt-6 max-w-md">
        <input
          name="q"
          defaultValue={params.q ?? ""}
          placeholder="Search name or email…"
          className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm outline-none placeholder:text-slate-400 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
        />
      </form>

      <div className="mt-6 overflow-hidden rounded-2xl border border-slate-200 bg-white">
        {customers.length === 0 ? (
          <p className="p-12 text-center text-sm text-slate-500">
            No customers yet.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {customers.map((c) => (
              <li key={c.email}>
                <Link
                  href={`/dashboard/customers/${encodeURIComponent(c.email)}`}
                  className="flex items-center gap-4 p-5 transition hover:bg-slate-50"
                >
                  <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-indigo-100 text-sm font-bold text-indigo-700">
                    {c.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-slate-900">
                      {c.name}
                    </p>
                    <p className="truncate text-xs text-slate-500">{c.email}</p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-sm font-semibold text-slate-900">
                      {c.bookings} booking{c.bookings === 1 ? "" : "s"}
                    </p>
                    <p className="text-xs text-slate-400">
                      last{" "}
                      {new Date(c.lastAt).toLocaleDateString("en-IN", {
                        day: "numeric",
                        month: "short",
                      })}
                    </p>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
