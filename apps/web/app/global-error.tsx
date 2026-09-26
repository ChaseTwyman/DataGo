"use client";

/**
 * Last-resort boundary (errors in the root layout). Renders its own document without the app's
 * stylesheet, so styles are inline. No error text is shown.
 */
export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif", background: "#f8f9fb", color: "#27272a" }}>
        <title>Something went wrong · GroundTruth</title>
        <main style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }} role="alert">
          <div style={{ maxWidth: 420, background: "#fff", border: "1px solid #e4e4e7", borderRadius: 12, padding: 24, textAlign: "center" }}>
            <h1 style={{ fontSize: 18, margin: "0 0 6px" }}>Something went wrong</h1>
            <p style={{ fontSize: 14, color: "#71717a", margin: 0 }}>GroundTruth hit a problem loading this page. Please try again.</p>
            <div style={{ marginTop: 20, display: "flex", gap: 8, justifyContent: "center" }}>
              <button
                type="button"
                onClick={() => retry()}
                style={{ height: 36, padding: "0 16px", borderRadius: 8, border: 0, background: "#2f5ea8", color: "#fff", fontWeight: 500, cursor: "pointer" }}
              >
                Try again
              </button>
              <a href="/data" style={{ height: 36, lineHeight: "36px", padding: "0 16px", borderRadius: 8, border: "1px solid #e4e4e7", color: "#27272a", textDecoration: "none" }}>
                Open data
              </a>
            </div>
            {error.digest ? <p style={{ marginTop: 16, fontFamily: "monospace", fontSize: 11, color: "#a1a1aa" }}>Reference {error.digest}</p> : null}
          </div>
        </main>
      </body>
    </html>
  );
}
