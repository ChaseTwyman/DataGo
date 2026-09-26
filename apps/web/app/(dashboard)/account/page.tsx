"use client";
import { Download, KeyRound, LoaderCircle, Trash2, UserRound } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { formatCents, PasswordSchema } from "@groundtruth/shared";
import { BecomeResearcher } from "@/components/account/BecomeResearcher";
import { ErrorBox, Loading, PageHeader, Stat } from "@/components/page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/form";
import { api, errorMessage, fieldErrors } from "@/lib/client/api";
import { signOut } from "@/lib/client/auth";
import { useMe } from "@/lib/client/me";

export default function AccountPage() {
  const { me, setMe } = useMe();
  if (!me) return <Loading />;
  return (
    <>
      <PageHeader title="Account" description="Your profile, password, researcher access, and your data." />
      <div className="grid max-w-5xl gap-4 p-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <UserRound className="size-4" aria-hidden /> Profile
            </CardTitle>
            <CardDescription>{me.email ?? "No email on file"}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-1.5">
              <Badge tone="info">Contributor</Badge>
              {me.is_researcher ? <Badge tone="success">Researcher</Badge> : null}
              {me.is_admin ? <Badge tone="warning">Admin</Badge> : null}
            </div>
            <div className="grid grid-cols-3 gap-4">
              <Stat label="Name" value={me.display_name ?? "—"} />
              <Stat label="Balance" value={formatCents(me.balance_cents)} />
              <Stat label="Trust" value={me.trust_score.toFixed(2)} />
            </div>
            <p className="text-xs text-muted-foreground">Member since {new Date(me.created_at).toLocaleDateString()}.</p>
          </CardContent>
        </Card>

        <ChangePassword />

        {me.is_researcher ? (
          <ResearcherStatus />
        ) : (
          <BecomeResearcher me={me} onDone={setMe} embedded />
        )}

        <YourData />
      </div>
    </>
  );
}

function ChangePassword() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setDone(false);
    const p = PasswordSchema.safeParse(next);
    if (!p.success) return setError("Use at least 8 characters for the new password.");
    if (next !== confirm) return setError("The new passwords don't match.");
    setBusy(true);
    try {
      await api.changePassword({ current_password: current, new_password: next });
      setDone(true);
      setCurrent("");
      setNext("");
      setConfirm("");
    } catch (err) {
      const fe = fieldErrors(err);
      setError(fe.new_password ? `New password: ${fe.new_password}` : errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <KeyRound className="size-4" aria-hidden /> Change password
        </CardTitle>
        <CardDescription>If an admin gave you a temporary password, set your own here.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-3">
          <Field label="Current password" htmlFor="cur">
            <Input id="cur" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
          </Field>
          <Field label="New password" htmlFor="new" hint="At least 8 characters.">
            <Input id="new" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} required />
          </Field>
          <Field label="Repeat new password" htmlFor="new2">
            <Input id="new2" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
          </Field>
          <ErrorBox message={error} />
          {done ? <p className="text-sm text-emerald-700">Password changed.</p> : null}
          <Button type="submit" disabled={busy}>
            {busy ? <LoaderCircle className="animate-spin" aria-hidden /> : null}
            Change password
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function ResearcherStatus() {
  const { me, setMe } = useMe();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!me) return null;
  const off = async () => {
    if (!window.confirm("Turn off researcher access? Your bounties keep running; you can turn it back on later.")) return;
    setBusy(true);
    setError(null);
    try {
      setMe(await api.stopResearcher());
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Researcher access</CardTitle>
        <CardDescription>On. You can post bounties, draft protocols, review and export.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {me.researcher_profile ? (
          <dl className="space-y-1">
            <div>
              <dt className="text-xs text-muted-foreground">Organization</dt>
              <dd>{me.researcher_profile.organization}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Purpose</dt>
              <dd className="whitespace-pre-wrap">{me.researcher_profile.purpose}</dd>
            </div>
          </dl>
        ) : null}
        <ErrorBox message={error} />
        <Button variant="outline" disabled={busy} onClick={() => void off()}>
          {busy ? <LoaderCircle className="animate-spin" aria-hidden /> : null}
          Turn off researcher access
        </Button>
      </CardContent>
    </Card>
  );
}

function YourData() {
  const router = useRouter();
  const [busy, setBusy] = useState<"export" | "delete" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [typed, setTyped] = useState("");

  const download = async () => {
    setBusy("export");
    setError(null);
    try {
      await api.downloadMyData();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const del = async () => {
    setBusy("delete");
    setError(null);
    try {
      await api.deleteAccount();
      await signOut();
      router.replace("/login?deleted=1");
    } catch (err) {
      setError(errorMessage(err));
      setBusy(null);
    }
  };

  return (
    <Card className="lg:col-span-2">
      <CardHeader>
        <CardTitle className="text-base">Your data</CardTitle>
        <CardDescription>Download everything we hold about you, or delete your account.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-6 md:grid-cols-2">
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">
            A JSON file with your profile, capture sessions, submissions (with verification checks and photo links that expire after 15
            minutes) and your wallet ledger.
          </p>
          <Button variant="outline" disabled={busy !== null} onClick={() => void download()}>
            {busy === "export" ? <LoaderCircle className="animate-spin" aria-hidden /> : <Download aria-hidden />}
            Download my data
          </Button>
        </div>
        <div className="space-y-2 rounded-lg border border-red-200 p-3">
          <p className="text-sm">
            <span className="font-medium text-red-800">Delete my account.</span>{" "}
            <span className="text-muted-foreground">
              Your photos, profile, wallet and sessions are deleted. Accepted observations already released as open data stay in the public
              dataset without your name or id. This can&apos;t be undone.
            </span>
          </p>
          <Field label='Type "DELETE" to confirm' htmlFor="confirm-delete">
            <Input id="confirm-delete" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
          </Field>
          <Button variant="destructive" disabled={typed !== "DELETE" || busy !== null} onClick={() => void del()}>
            {busy === "delete" ? <LoaderCircle className="animate-spin" aria-hidden /> : <Trash2 aria-hidden />}
            Delete my account
          </Button>
        </div>
        <ErrorBox className="md:col-span-2" message={error} />
      </CardContent>
    </Card>
  );
}
