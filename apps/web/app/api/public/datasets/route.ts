import { OPEN_DATA_LICENSE, type PublicDatasetListResponse } from "@groundtruth/shared";
import { json, originOf, route } from "@/lib/api/http";
import { getDb } from "@/lib/db";
import { datasetSummary, loadPublishedProtocol, PUBLIC_CACHE_HEADERS, publishedSlugs } from "@/lib/openData";

/** Open data, no login: one dataset per published protocol (PRD §13 — structured data only, no images). */
export const GET = route(async (req) => {
  const db = await getDb();
  const origin = originOf(req);
  const datasets = [];
  for (const slug of await publishedSlugs(db)) {
    const protocol = await loadPublishedProtocol(db, slug);
    if (protocol) datasets.push(await datasetSummary(db, protocol, origin));
  }
  const body: PublicDatasetListResponse = {
    generated_at: new Date().toISOString(),
    license: { ...OPEN_DATA_LICENSE },
    datasets,
  };
  return json(body, { headers: PUBLIC_CACHE_HEADERS });
});
