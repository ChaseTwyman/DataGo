import Link from "next/link";

export default function DataNotFound() {
  return (
    <main data-theme="dark" className="flex min-h-screen items-center justify-center bg-black px-4 text-white">
      <div className="max-w-md border-l-2 border-primary py-2 pl-6">
        <p className="text-[11px] caps text-white/50">Open data</p>
        <h1 className="mt-3 caps text-2xl font-semibold tracking-[0.08em]">Not found</h1>
        <p className="mt-3 text-sm leading-relaxed text-white/60">That dataset or page doesn&apos;t exist. It may have been renamed.</p>
        <Link href="/data" className="mt-6 inline-block caps text-[11px] text-primary hover:text-white">
          All datasets →
        </Link>
      </div>
    </main>
  );
}
