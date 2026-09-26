"use client";
import { Check, Copy, KeyRound, LoaderCircle, Search } from "lucide-react";
import { useEffect, useState } from "react";
import type { AdminUser } from "@groundtruth/shared";
import { Empty, ErrorBox, Loading, PageHeader } from "@/components/page";
import { toast } from "@/components/Toaster";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/form";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { api, errorMessage } from "@/lib/client/api";
import { useMe } from "@/lib/client/me";
import { useApi } from "@/lib/client/useApi";

type Flag = "is_researcher" | "is_admin" | "suspended";

export default function AdminUsersPage() {
  const { me } = useMe();
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setQuery(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);
  const users = useApi(me?.is_admin ? () => api.adminUsers({ q: query || undefined, limit: 100 }) : null, `users:${query}`);
  const [rows, setRows] = useState<AdminUser[] | null>(null);
  useEffect(() => setRows(users.data?.users ?? null), [users.data]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [temp, setTemp] = useState<{ user: AdminUser; password: string } | null>(null);
  const [copied, setCopied] = useState(false);

  if (me && !me.is_admin) return <ErrorBox className="m-6" message="Only administrators can manage users." />;

  const toggle = async (u: AdminUser, flag: Flag) => {
    const next = !u[flag];
    if (flag === "suspended" && next && !window.confirm(`Suspend ${u.email ?? u.id}? They lose access immediately.`)) return;
    if (flag === "is_admin" && next && !window.confirm(`Make ${u.email ?? u.id} an admin? Admins can manage every account.`)) return;
    setBusy(`${u.id}:${flag}`);
    setError(null);
    try {
      const updated = await api.adminPatchUser(u.id, { [flag]: next });
      setRows((rs) => rs?.map((r) => (r.id === u.id ? updated : r)) ?? null);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const reset = async (u: AdminUser) => {
    if (!window.confirm(`Reset the password of ${u.email ?? u.id}? Their current password stops working.`)) return;
    setBusy(`${u.id}:reset`);
    setError(null);
    setCopied(false);
    try {
      const r = await api.adminResetPassword(u.id);
      setTemp({ user: u, password: r.temporary_password });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const copy = async () => {
    if (!temp) return;
    try {
      await navigator.clipboard.writeText(temp.password);
      setCopied(true);
    } catch {
      toast("Couldn't copy. Select the password and copy it by hand.");
    }
  };

  return (
    <>
      <PageHeader title="Users" description="Accounts, roles and access. Changes apply immediately." />
      <div className="space-y-4 p-6">
        <div className="relative max-w-sm">
          <Search className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-muted-foreground" aria-hidden />
          <Input
            aria-label="Search users"
            placeholder="Search email, name, organization, or id"
            className="pl-8"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>

        {temp ? (
          <div role="status" className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
            <p>
              Temporary password for <span className="font-medium">{temp.user.email ?? temp.user.id}</span>. It is shown only once: hand
              it over now and ask them to change it under Account.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <code className="rounded border border-amber-300 bg-white px-2 py-1 font-mono text-base select-all">{temp.password}</code>
              <Button size="sm" variant="outline" onClick={() => void copy()}>
                {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
                {copied ? "Copied" : "Copy"}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setTemp(null)}>
                Done
              </Button>
            </div>
          </div>
        ) : null}

        <ErrorBox message={error ?? users.error} onRetry={users.error ? () => void users.refresh() : undefined} />
        {users.loading && !rows ? <Loading /> : null}
        {rows && rows.length === 0 ? <Empty title="No accounts match">Try part of an email address or an organization.</Empty> : null}
        {rows && rows.length > 0 ? (
          <div className="rounded-lg border bg-card">
            <Table>
              <THead>
                <TR>
                  <TH>Account</TH>
                  <TH>Organization</TH>
                  <TH className="text-right">Submissions</TH>
                  <TH className="text-right">Trust</TH>
                  <TH>Joined</TH>
                  <TH>Researcher</TH>
                  <TH>Admin</TH>
                  <TH>Suspended</TH>
                  <TH />
                </TR>
              </THead>
              <TBody>
                {rows.map((u) => {
                  const self = u.id === me?.id;
                  return (
                    <TR key={u.id}>
                      <TD className="max-w-64">
                        <div className="truncate font-medium">{u.email ?? "—"}</div>
                        <div className="truncate text-xs text-muted-foreground">
                          {u.display_name ?? "No name"} {self ? <Badge tone="info">you</Badge> : null}
                        </div>
                      </TD>
                      <TD className="max-w-48 truncate text-muted-foreground" title={u.researcher_profile?.purpose}>
                        {u.researcher_profile?.organization ?? "—"}
                      </TD>
                      <TD className="text-right tabular-nums">{u.submissions}</TD>
                      <TD className="text-right tabular-nums">{u.trust_score.toFixed(2)}</TD>
                      <TD className="whitespace-nowrap text-muted-foreground">{new Date(u.created_at).toLocaleDateString()}</TD>
                      {(["is_researcher", "is_admin", "suspended"] as const).map((flag) => (
                        <TD key={flag}>
                          <FlagSwitch
                            label={`${flag.replace("is_", "")} for ${u.email ?? u.id}`}
                            on={u[flag]}
                            danger={flag === "suspended"}
                            busy={busy === `${u.id}:${flag}`}
                            disabled={busy !== null || (self && (flag === "is_admin" || flag === "suspended"))}
                            onClick={() => void toggle(u, flag)}
                          />
                        </TD>
                      ))}
                      <TD>
                        <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void reset(u)}>
                          {busy === `${u.id}:reset` ? <LoaderCircle className="animate-spin" aria-hidden /> : <KeyRound aria-hidden />}
                          Reset password
                        </Button>
                      </TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          </div>
        ) : null}
      </div>
    </>
  );
}

function FlagSwitch(p: { label: string; on: boolean; danger?: boolean; busy: boolean; disabled: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={p.on}
      aria-label={p.label}
      disabled={p.disabled}
      onClick={p.onClick}
      className={`relative inline-flex h-5 w-9 cursor-pointer items-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
        p.on ? (p.danger ? "bg-red-600" : "bg-sky-600") : "bg-zinc-300"
      }`}
    >
      <span className={`inline-block size-4 rounded-full bg-white shadow transition-transform ${p.on ? "translate-x-4.5" : "translate-x-0.5"}`} />
      {p.busy ? <LoaderCircle className="absolute -right-5 size-3.5 animate-spin text-muted-foreground" aria-hidden /> : null}
    </button>
  );
}
