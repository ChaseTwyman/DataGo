"use client";
import { FlaskConical, LoaderCircle } from "lucide-react";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { BecomeResearcherRequestSchema, type Me } from "@groundtruth/shared";
import { ErrorBox } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input, Textarea } from "@/components/ui/form";
import { api, errorMessage, fieldErrors } from "@/lib/client/api";

/**
 * Self-serve researcher access: organization + purpose + terms. Shown instead of the dashboard to a
 * signed-in account that isn't a researcher yet.
 */
export function BecomeResearcher({ me, onDone, embedded = false }: { me: Me; onDone: (m: Me) => void; embedded?: boolean }) {
  const [organization, setOrganization] = useState(me.researcher_profile?.organization ?? "");
  const [purpose, setPurpose] = useState(me.researcher_profile?.purpose ?? "");
  const [terms, setTerms] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setFields({});
    if (!terms) return setError("Please accept the researcher terms.");
    const parsed = BecomeResearcherRequestSchema.safeParse({ organization, purpose, accept_terms: true });
    if (!parsed.success) {
      setFields(fieldErrors(parsed.error));
      return;
    }
    setBusy(true);
    try {
      onDone(await api.becomeResearcher(parsed.data));
    } catch (err) {
      setFields(fieldErrors(err));
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={embedded ? "" : "flex flex-1 items-start justify-center p-6 sm:pt-16"}>
      <Card className={embedded ? "w-full" : "w-full max-w-lg"}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <FlaskConical className="size-4 text-sky-600" aria-hidden /> Become a researcher
          </CardTitle>
          <CardDescription>
            Researchers post bounties, design capture protocols, review observations and export datasets. Tell us who you are
            and what the data is for. You can keep contributing from the phone app either way.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-4">
            <Field label="Organization" htmlFor="org" error={fields.organization} hint="University, agency, company, or your own name.">
              <Input id="org" value={organization} onChange={(e) => setOrganization(e.target.value)} maxLength={120} required />
            </Field>
            <Field label="What will you use GroundTruth data for?" htmlFor="purpose" error={fields.purpose} hint="A sentence or two is enough.">
              <Textarea id="purpose" value={purpose} onChange={(e) => setPurpose(e.target.value)} maxLength={1000} rows={4} required />
            </Field>
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-0.5 size-4" checked={terms} onChange={(e) => setTerms(e.target.checked)} />
              <span>
                I will pay contributors the posted bounties, never ask anyone to approach a hazard, and follow the open-data license
                (CC BY 4.0) for what I publish. Admins may turn off researcher access for misuse.
              </span>
            </label>
            <ErrorBox message={error} />
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Link href="/account" className="text-sm text-muted-foreground underline underline-offset-4">
                Account settings
              </Link>
              <Button type="submit" disabled={busy}>
                {busy ? <LoaderCircle className="animate-spin" aria-hidden /> : null}
                Turn on researcher access
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
