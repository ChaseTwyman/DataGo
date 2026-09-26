import { ExportQuerySchema, Uuid } from "@groundtruth/shared";
import { loadManagedBounty } from "@/lib/api/bountyAccess";
import { json, parseQuery, route, type IdParams } from "@/lib/api/http";
import { requireUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { dataDictionary, exportRows, toCsv, toGeoJson } from "@/lib/export";

/** Accepted observations as CSV / GeoJSON, or the data dictionary (JSON). Bounty owner or admin. */
export const GET = route<IdParams>(async (req, { params }) => {
  const id = Uuid.parse((await params).id);
  const { format } = parseQuery(req, ExportQuerySchema);
  const user = await requireUser(req);
  const db = await getDb();
  const { bounty, protocol } = await loadManagedBounty(db, user, id);
  const dict = dataDictionary(protocol.definition);
  const base = `groundtruth-${protocol.slug}-${bounty.id.slice(0, 8)}`;
  if (format === "dictionary") {
    return json({
      protocol: { slug: protocol.slug, version: protocol.version, name: protocol.name },
      bounty: { id: bounty.id, title: bounty.title },
      license: "Proposed open tier: CC BY 4.0, attribution \"GroundTruth contributors\" (final terms pending).",
      notes: [
        "Only accepted observations are exported. Images are not included.",
        "Extracted values are model estimates; see confidence and protocol_score.",
      ],
      columns: dict,
    });
  }
  const rows = await exportRows(db, bounty.id, protocol.definition);
  if (format === "geojson") {
    return new Response(JSON.stringify(toGeoJson(rows)), {
      headers: { "content-type": "application/geo+json", "content-disposition": `attachment; filename="${base}.geojson"` },
    });
  }
  return new Response(toCsv(dict.map((c) => c.name), rows), {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${base}.csv"` },
  });
});
