import Link from "next/link";

export default function DataNotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-black px-4 text-white">
      <div className="max-w-md border-l-2 border-sky-400 py-2 pl-6">
        <p className="text-[11px] tracking-[0.18em] text-white/50 uppercase">Open data</p>
        <h1 className="mt-3 text-2xl font-semibold tracking-[0.08em] uppercase">Not found</h1>
        <p className="mt-3 text-sm leading-relaxed text-white/60">That dataset or page doesn&apos;t exist. It may have been renamed.</p>
        <Link href="/data" className="mt-6 inline-block text-[11px] tracking-[0.18em] text-sky-300 uppercase hover:text-white">
          All datasets →
        </Link>
      </div>
    </main>
  );
}
