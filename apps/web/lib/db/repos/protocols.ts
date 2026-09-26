import { ProtocolSchema, type Protocol } from "@groundtruth/shared";
import { json, toIso, type Db } from "../types";

export interface ProtocolRow {
  id: string;
  slug: string;
  version: number;
  name: string;
  status: "draft" | "published";
  definition: Protocol;
  example_image_path: string | null;
  created_by: string | null;
  created_at: string;
}

type Raw = Omit<ProtocolRow, "definition" | "created_at"> & { definition: unknown; created_at: unknown };

const COLS = "id, slug, version, name, status::text as status, definition, example_image_path, created_by, created_at";

function map(r: Raw): ProtocolRow {
  return { ...r, definition: ProtocolSchema.parse(r.definition), created_at: toIso(r.created_at) };
}

export async function getProtocol(db: Db, id: string): Promise<ProtocolRow | null> {
  const rows = await db.query<Raw>(`select ${COLS} from public.protocols where id = $1`, [id]);
  return rows[0] ? map(rows[0]) : null;
}

export async function getProtocolBySlug(db: Db, slug: string): Promise<ProtocolRow | null> {
  const rows = await db.query<Raw>(
    `select ${COLS} from public.protocols where slug = $1 and status = 'published' order by version desc limit 1`,
    [slug],
  );
  return rows[0] ? map(rows[0]) : null;
}

/** Published protocols plus the caller's own drafts (admins see all). */
export async function listProtocols(db: Db, userId: string, isAdmin: boolean): Promise<ProtocolRow[]> {
  const rows = await db.query<Raw>(
    `select ${COLS} from public.protocols
      where status = 'published' or created_by = $1 or $2::boolean
      order by slug, version desc`,
    [userId, isAdmin],
  );
  return rows.map(map);
}

export async function setExampleImagePath(db: Db, id: string, path: string): Promise<void> {
  await db.query("update public.protocols set example_image_path = $2 where id = $1", [id, path]);
}

export async function insertProtocol(db: Db, p: Protocol, createdBy: string, status: "draft" | "published" = "draft"): Promise<string> {
  const rows = await db.query<{ id: string }>(
    `insert into public.protocols (slug, version, name, definition, status, created_by)
     values ($1, $2, $3, $4::jsonb, $5::public.protocol_status, $6) returning id`,
    [p.slug, p.version, p.name, json(p), status, createdBy],
  );
  return rows[0]!.id;
}

export async function updateProtocolDefinition(db: Db, id: string, p: Protocol, status: "draft" | "published"): Promise<void> {
  await db.query(
    `update public.protocols set definition = $2::jsonb, name = $3, slug = $4, version = $5, status = $6::public.protocol_status where id = $1`,
    [id, json(p), p.name, p.slug, p.version, status],
  );
}
