/**
 * Route-handler plumbing: JSON errors shaped as ApiErrorSchema, zod parsing with the shared
 * contracts, and a wrapper that turns thrown HttpErrors / ZodErrors into responses.
 */
import { MOCK_VARIANT_HEADER, MockVariantSchema, type ApiError, type MockVariant } from "@groundtruth/shared";
import { ZodError, type z } from "zod";

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (message: string, details?: unknown) => new HttpError(400, "BAD_REQUEST", message, details);
export const unauthorized = (message = "Missing or invalid bearer token") => new HttpError(401, "UNAUTHORIZED", message);
export const forbidden = (message = "Not allowed") => new HttpError(403, "FORBIDDEN", message);
export const notFound = (what = "Not found") => new HttpError(404, "NOT_FOUND", what);
export const conflict = (code: string, message: string) => new HttpError(409, code, message);

export function jsonError(status: number, code: string, message: string, details?: unknown): Response {
  const body: ApiError = { error: { code, message, ...(details === undefined ? {} : { details }) } };
  return Response.json(body, { status });
}

export function json<T>(body: T, init?: ResponseInit): Response {
  return Response.json(body, init);
}

export async function parseBody<S extends z.ZodType>(req: Request, schema: S): Promise<z.infer<S>> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw badRequest("Body must be JSON");
  }
  return schema.parse(raw);
}

export function parseQuery<S extends z.ZodType>(req: Request, schema: S): z.infer<S> {
  const params = Object.fromEntries(new URL(req.url).searchParams.entries());
  return schema.parse(params);
}

export function mockVariantOf(req: Request): MockVariant | undefined {
  const v = req.headers.get(MOCK_VARIANT_HEADER);
  if (!v) return undefined;
  const p = MockVariantSchema.safeParse(v);
  return p.success ? p.data : undefined;
}

/** Public origin of this server as the caller sees it (the phone reaches us by LAN IP). */
export function originOf(req: Request): string {
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  const proto = req.headers.get("x-forwarded-proto") ?? new URL(req.url).protocol.replace(":", "");
  return host ? `${proto}://${host}` : new URL(req.url).origin;
}

type Handler<C> = (req: Request, ctx: C) => Promise<Response>;

/** Wraps a route handler: HttpError → its status, ZodError → 400, anything else → 500 (logged). */
export function route<C = unknown>(fn: Handler<C>): Handler<C> {
  return async (req, ctx) => {
    try {
      return await fn(req, ctx);
    } catch (err) {
      return errorResponse(err);
    }
  };
}

export function errorResponse(err: unknown): Response {
  if (err instanceof HttpError) return jsonError(err.status, err.code, err.message, err.details);
  if (err instanceof ZodError) return jsonError(400, "VALIDATION_FAILED", "Request failed validation", err.issues);
  console.error("[api] unhandled error", err);
  return jsonError(500, "INTERNAL", err instanceof Error ? err.message : "Internal error");
}

export type IdParams = { params: Promise<{ id: string }> };
