"use client";

/**
 * Last-resort boundary (errors in the root layout). Renders its own document without the app's
 * stylesheet, so styles are inline. No error text is shown.
 */
export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif", background: "#000000", color: "#ffffff" }}>
        <title>Something went wrong · GroundTruth</title>
        <main style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }} role="alert">
          <div style={{ maxWidth: 420, borderLeft: "2px solid #FFB020", padding: "8px 0 8px 24px" }}>
            <p style={{ fontSize: 11, letterSpacing: "0.18em", textTransform: "uppercase", color: "#8A8F98", margin: 0 }}>GroundTruth</p>
            <h1 style={{ fontSize: 24, letterSpacing: "0.08em", textTransform: "uppercase", margin: "12px 0 0", fontWeight: 600 }}>Something went wrong</h1>
            <p style={{ fontSize: 14, lineHeight: 1.6, color: "#8A8F98", margin: "12px 0 0" }}>GroundTruth hit a problem loading this page. Please try again.</p>
            <div style={{ marginTop: 24, display: "flex", gap: 8 }}>
              <button
                type="button"
                onClick={() => retry()}
                style={{ height: 36, padding: "0 16px", borderRadius: 2, border: 0, background: "#D6E4FF", color: "#000000", fontWeight: 600, letterSpacing: "0.12em", textTransform: "uppercase", fontSize: 12, cursor: "pointer" }}
              >
                Try again
              </button>
              <a
                href="/data"
                style={{ height: 36, lineHeight: "36px", padding: "0 16px", borderRadius: 2, border: "1px solid #3A3F47", color: "#ffffff", textDecoration: "none", letterSpacing: "0.12em", textTransform: "uppercase", fontSize: 12, fontWeight: 600 }}
              >
                Open data
              </a>
            </div>
            {error.digest ? <p style={{ marginTop: 24, fontFamily: "monospace", fontSize: 11, color: "#8A8F98" }}>Reference {error.digest}</p> : null}
          </div>
        </main>
      </body>
    </html>
  );
}
