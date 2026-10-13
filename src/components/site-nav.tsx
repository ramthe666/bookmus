import Link from "next/link";

export function Logo({ dark = false }: { dark?: boolean }) {
  return (
    <Link href="/" className="flex items-center gap-2.5">
      <span className="grid h-9 w-9 place-items-center rounded-xl bg-indigo-600 shadow-sm shadow-indigo-600/30">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          className="h-5 w-5 text-white"
          stroke="currentColor"
          strokeWidth={2}
        >
          <rect x="3" y="4.5" width="18" height="16" rx="3" />
          <path d="M3 9.5h18M8 2.5v4M16 2.5v4" strokeLinecap="round" />
          <circle cx="12" cy="14.5" r="2.2" fill="currentColor" stroke="none" />
        </svg>
      </span>
      <span
        className={`text-lg font-semibold tracking-tight ${
          dark ? "text-white" : "text-slate-900"
        }`}
      >
        BookMus
      </span>
    </Link>
  );
}

const links = [
  { href: "#features", label: "Features" },
  { href: "#how", label: "How it works" },
  { href: "#pricing", label: "Pricing" },
];

export function SiteNav() {
  return (
    <header className="sticky top-0 z-50 border-b border-slate-200/70 bg-white/80 backdrop-blur-xl">
      <nav className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <Logo />
        <div className="hidden items-center gap-8 md:flex">
          {links.map((l) => (
            <a
              key={l.href}
              href={l.href}
              className="text-sm font-medium text-slate-600 transition hover:text-slate-900"
            >
              {l.label}
            </a>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/login"
            className="hidden rounded-lg px-3.5 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100 sm:block"
          >
            Sign in
          </Link>
          <Link
            href="/signup"
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm shadow-indigo-600/30 transition hover:bg-indigo-700"
          >
            Get started free
          </Link>
        </div>
      </nav>
    </header>
  );
}
