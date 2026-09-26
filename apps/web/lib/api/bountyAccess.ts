import { canManageBounty, isResearcherRole, type AuthUser } from "../auth";
import type { Db } from "../db";
import { getBounty, type BountyRow } from "../db/repos/bounties";
import { getProtocol, type ProtocolRow } from "../db/repos/protocols";
import { forbidden, notFound } from "./http";

/** Loads a bounty + protocol the caller may see: contributors only active bounties; researchers own; admins all. */
export async function loadVisibleBounty(db: Db, user: AuthUser, id: string): Promise<{ bounty: BountyRow; protocol: ProtocolRow }> {
  const bounty = await getBounty(db, id);
  if (!bounty) throw notFound("Bounty not found");
  const visible = bounty.status === "active" || canManageBounty(user, bounty.created_by);
  if (!visible) throw notFound("Bounty not found");
  const protocol = await getProtocol(db, bounty.protocol_id);
  if (!protocol) throw notFound("Protocol not found");
  return { bounty, protocol };
}

/** Researcher that owns the bounty (or admin). */
export async function loadManagedBounty(db: Db, user: AuthUser, id: string): Promise<{ bounty: BountyRow; protocol: ProtocolRow }> {
  if (!isResearcherRole(user.role)) throw forbidden("Researcher or admin role required");
  const bounty = await getBounty(db, id);
  if (!bounty) throw notFound("Bounty not found");
  if (!canManageBounty(user, bounty.created_by)) throw forbidden("Not your bounty");
  const protocol = await getProtocol(db, bounty.protocol_id);
  if (!protocol) throw notFound("Protocol not found");
  return { bounty, protocol };
}
