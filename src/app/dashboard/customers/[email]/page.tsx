import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

async function addNote(formData: FormData) {
  "use server";
  const email = String(formData.get("email") ?? "").toLowerCase();
  const note = String(formData.get("note") ?? "").trim();
  if (!email || !note) return;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  // Verify this email belongs to the owner's customers before writing.
  const { data: own } = await supabase
    .from("bookings")
    .select("id")
    .eq("booker_email", email)
    .limit(1);
  if (!own?.length) throw new Error("Unknown customer.");
  const { error } = await supabase.from("customer_notes").insert({
    owner_profile_id: user.id,
    booker_email: email,
    note: note.slice(0, 2000),
    created_by: user.id,
  });
  if (error) throw new Error("Could not save the note.");
  revalidatePath(`/dashboard/customers/${encodeURIComponent(email)}`);
}

async function deleteNote(formData: FormData) {
  "use server";
  const id = String(formData.get("id") ?? "");
  const email = String(formData.get("email") ?? "");
  if (!id) return;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  await supabase
    .from("customer_notes")
    .delete()
    .eq("id", id)
    .eq("owner_profile_id", user.id);
  revalidatePath(`/dashboard/customers/${encodeURIComponent(email)}`);
}

function formatWhen(iso: string): string {
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(iso));
}

export default async function CustomerDetailPage({
  params,
}: {
  params: Promise<{ email: string }>;
}) {
  const { email } = await params;
  const decoded = decodeURIComponent(email).toLowerCase();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: bookings } = await supabase
    .from("bookings")
    .select(
      "id, starts_at, status, booker_name, booker_phone, event_types!inner(title)"
    )
    .eq("booker_email", decoded)
    .order("starts_at", { ascending: false })
    .limit(100);

  if (!bookings?.length) {
    return (
      <div className="mx-auto max-w-3xl">
        <Link
          href="/dashboard/customers"
          className="text-sm font-medium text-indigo-600 hover:text-indigo-800"
        >
          ← Customers
        </Link>
        <p className="mt-6 text-sm text-slate-500">Customer not found.</p>
      </div>
    );
  }

  const first = bookings[0];
  const name = first.booker_name as string;
  const phone = (first.booker_phone as string | null) ?? null;

  const { data: notes } = await supabase
    .from("customer_notes")
    .select("id, note, created_at")
    .eq("owner_profile_id", user.id)
    .eq("booker_email", decoded)
    .order("created_at", { ascending: false });

  return (
    <div className="mx-auto max-w-3xl">
      <Link
        href="/dashboard/customers"
        className="text-sm font-medium text-indigo-600 hover:text-indigo-800"
      >
        ← Customers
      </Link>
      <div className="mt-2 flex items-center gap-4">
        <div className="grid h-14 w-14 place-items-center rounded-full bg-indigo-100 text-xl font-bold text-indigo-700">
          {name.charAt(0).toUpperCase()}
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            {name}
          </h1>
          <p className="text-sm text-slate-500">
            {decoded}
            {phone ? ` · ${phone}` : ""} · {bookings.length} booking
            {bookings.length === 1 ? "" : "s"}
          </p>
        </div>
      </div>

      <h2 className="mt-10 font-semibold text-slate-900">Booking history</h2>
      <div className="mt-3 overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <ul className="divide-y divide-slate-100">
          {bookings.map((b) => {
            const et = b.event_types as unknown as { title: string };
            return (
              <li
                key={b.id as string}
                className="flex items-center justify-between gap-3 p-4"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-slate-900">
                    {et.title}
                  </p>
                  <p className="text-xs text-slate-500">
                    {formatWhen(b.starts_at as string)}
                  </p>
                </div>
                <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                  {(b.status as string).replace("_", " ")}
                </span>
              </li>
            );
          })}
        </ul>
      </div>

      <h2 className="mt-10 font-semibold text-slate-900">
        Private notes{" "}
        <span className="text-xs font-normal text-slate-400">
          — only you can see these
        </span>
      </h2>
      <form action={addNote} className="mt-3">
        <input type="hidden" name="email" value={decoded} />
        <textarea
          name="note"
          required
          rows={2}
          maxLength={2000}
          placeholder="Add an internal note about this customer…"
          className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm outline-none placeholder:text-slate-400 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
        />
        <button
          type="submit"
          className="mt-2 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
        >
          Add note
        </button>
      </form>
      <ul className="mt-4 space-y-3">
        {(notes ?? []).map((n) => (
          <li
            key={n.id as string}
            className="flex items-start justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4"
          >
            <div>
              <p className="text-sm text-slate-800">{n.note as string}</p>
              <p className="mt-1 text-xs text-slate-400">
                {formatWhen(n.created_at as string)}
              </p>
            </div>
            <form action={deleteNote}>
              <input type="hidden" name="id" value={n.id as string} />
              <input type="hidden" name="email" value={decoded} />
              <button
                type="submit"
                className="text-xs font-medium text-red-500 hover:text-red-700"
              >
                Delete
              </button>
            </form>
          </li>
        ))}
      </ul>
    </div>
  );
}
