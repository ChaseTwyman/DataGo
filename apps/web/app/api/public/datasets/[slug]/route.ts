import { OPEN_DATA_LICENSE, PublicDatasetQuerySchema, type PublicDatasetJsonResponse } from "@groundtruth/shared";
import { json, notFound, originOf, parseQuery, route } from "@/lib/api/http";
import { getDb } from "@/lib/db";
import { toCsv, toGeoJson } from "@/lib/export";
import { datasetBounties, dictionaryBody, loadPublishedProtocol, PUBLIC_CACHE_HEADERS, publicColumns, publicRows } from "@/lib/openData";

type SlugParams = { params: Promise<{ slug: string }> };

/**
 * One open dataset (all bounties of a published protocol), coarsened for public release.
 * ?format=csv|geojson|json|dictionary, optional &bounty_id=, &limit= (json only). No auth.
 */
export const GET = route<SlugParams>(async (req, { params }) => {
  const { slug } = await params;
  const q = parseQuery(req, PublicDatasetQuerySchema);
  const db = await getDb();
  const protocol = /^[a-z0-9-]{1,80}$/.test(slug) ? await loadPublishedProtocol(db, slug) : null;
  if (!protocol) throw notFound("Dataset not found");
  if (q.format === "dictionary") return json(dictionaryBody(protocol, originOf(req)), { headers: PUBLIC_CACHE_HEADERS });

  if (q.bounty_id && !(await datasetBounties(db, slug)).some((b) => b.id === q.bounty_id)) {
    throw notFound("Bounty not in this dataset");
  }
  const rows = await publicRows(db, protocol, { bountyId: q.bounty_id });
  const columns = publicColumns(protocol.definition).map((c) => c.name);
  const base = `groundtruth-${protocol.slug}${q.bounty_id ? `-${q.bounty_id.slice(0, 8)}` : ""}`;

  if (q.format === "json") {
    const body: PublicDatasetJsonResponse = {
      dataset: { slug: protocol.slug, name: protocol.name, version: protocol.version },
      license: { ...OPEN_DATA_LICENSE },
      bounty_id: q.bounty_id ?? null,
      total_rows: rows.length,
      columns,
      rows: q.limit ? rows.slice(0, q.limit) : rows,
    };
    return json(body, { headers: PUBLIC_CACHE_HEADERS });
  }
  if (q.format === "geojson") {
    return new Response(JSON.stringify(toGeoJson(rows)), {
      headers: {
        ...PUBLIC_CACHE_HEADERS,
        "content-type": "application/geo+json",
        "content-disposition": `attachment; filename="${base}.geojson"`,
      },
    });
  }
  return new Response(toCsv(columns, rows), {
    headers: {
      ...PUBLIC_CACHE_HEADERS,
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${base}.csv"`,
    },
  });
});
