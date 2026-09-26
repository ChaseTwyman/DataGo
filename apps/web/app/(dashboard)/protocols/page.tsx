"use client";
import { LoaderCircle, ShieldAlert, Sparkles } from "lucide-react";
import { useState } from "react";
import { Empty, ErrorBox, Loading, PageHeader } from "@/components/page";
import { SyntheticImage } from "@/components/SyntheticImage";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { api, errorMessage } from "@/lib/client/api";
import { useApi } from "@/lib/client/useApi";

export default function ProtocolsPage() {
  const protocols = useApi(() => api.protocols(), "protocols");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [generated, setGenerated] = useState<Record<string, string>>({});

  const generate = async (id: string) => {
    setBusy(id);
    setError(null);
    try {
      const r = await api.exampleImage(id);
      setGenerated((g) => ({ ...g, [id]: r.url }));
      void protocols.refresh();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <PageHeader title="Protocols" description="The capture standard behind every bounty. Example images are generated with Grok Imagine and always labeled." />
      <div className="space-y-4 p-6">
        <ErrorBox message={protocols.error ?? error} />
        {protocols.loading && !protocols.data ? <Loading /> : null}
        {protocols.data && protocols.data.protocols.length === 0 ? (
          <Empty title="No protocols yet">Published protocols appear here. They define what contributors capture for a bounty.</Empty>
        ) : null}
        {protocols.data?.protocols.map((p) => {
          const d = p.definition;
          const img = generated[p.id] ?? p.example_image_url;
          return (
            <Card key={p.id}>
              <div className="grid gap-4 md:grid-cols-[1fr_320px]">
                <div>
                  <CardHeader>
                    <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                      {d.name}
                      <Badge tone={p.status === "published" ? "success" : "muted"}>{p.status}</Badge>
                      <Badge tone="muted" className="font-mono">
                        {p.slug} v{p.version}
                      </Badge>
                      <Badge tone={d.safety.level === "high" || d.safety.level === "elevated" ? "warning" : "info"}>
                        <ShieldAlert aria-hidden /> safety: {d.safety.level}
                      </Badge>
                    </CardTitle>
                    <CardDescription>{d.why_it_matters}</CardDescription>
                  </CardHeader>
                  <CardContent className="grid gap-4 text-sm sm:grid-cols-2">
                    <div>
                      <h4 className="caps mb-2 text-[10px] text-muted-foreground">Required in frame</h4>
                      <ul className="space-y-1">
                        {d.capture.required_elements.map((e) => (
                          <li key={e.id}>
                            <span className="font-medium">{e.label}</span>{" "}
                            <span className="text-muted-foreground">— {e.description}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                    <div>
                      <h4 className="caps mb-2 text-[10px] text-muted-foreground">Capture</h4>
                      <p>
                        {d.capture.mode === "burst" ? `${d.capture.frames}-frame burst, ${d.capture.frame_interval_ms} ms apart` : "single photo"} ·{" "}
                        {d.capture.orientation} · tilt ≤ {d.capture.max_tilt_deg}°
                      </p>
                      <h4 className="caps mt-4 mb-2 text-[10px] text-muted-foreground">Challenges</h4>
                      <ul className="list-disc pl-4 text-muted-foreground">
                        {d.capture.challenges.map((c) => (
                          <li key={c.id}>{c.instruction}</li>
                        ))}
                      </ul>
                      <h4 className="caps mt-4 mb-2 text-[10px] text-muted-foreground">Extracted fields</h4>
                      <p className="font-mono text-xs">{Object.keys(d.extraction_schema.properties).join(", ")}</p>
                    </div>
                  </CardContent>
                </div>
                <div className="space-y-2 p-5 md:border-l">
                  <SyntheticImage src={img} label="Example — AI-generated" alt={`${d.name} example image`} className="aspect-[4/3]" />
                  <Button variant="outline" className="w-full" disabled={busy !== null} onClick={() => void generate(p.id)}>
                    {busy === p.id ? <LoaderCircle className="animate-spin" aria-hidden /> : <Sparkles aria-hidden />}
                    {img ? "Regenerate example image" : "Generate example image"}
                  </Button>
                  <p className="text-[11px] text-muted-foreground">
                    Shown to contributors in the briefing. Stored in the synthetic bucket; never enters datasets.
                  </p>
                </div>
              </div>
            </Card>
          );
        })}
      </div>
    </>
  );
}
