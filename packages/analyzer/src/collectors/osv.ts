import type { Advisory, AdvisorySeverity } from "@factory-city/schema";
import type { LockedPackage } from "./lockfile.js";

/** The one host that is asked: the open vulnerability database of Google. */
export const OSV_URL = "https://api.osv.dev";
const BATCH = 1000;
const TIMEOUT_MS = 30_000;

type Fetch = typeof fetch;

async function post(fetcher: Fetch, path: string, body: unknown): Promise<unknown> {
  const res = await fetcher(`${OSV_URL}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`api.osv.dev answered ${res.status} to ${path}`);
  return res.json();
}

async function get(fetcher: Fetch, path: string): Promise<unknown> {
  const res = await fetcher(`${OSV_URL}${path}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`api.osv.dev answered ${res.status} to ${path}`);
  return res.json();
}

/** The severity word of an advisory, as its database gives it; `unknown` when it gives none. */
export function severityOf(advisory: unknown): AdvisorySeverity {
  const raw = (advisory as { database_specific?: { severity?: unknown } } | null)?.database_specific
    ?.severity;
  const word = typeof raw === "string" ? raw.toLowerCase() : "";
  if (word === "critical" || word === "high" || word === "low") return word;
  if (word === "moderate" || word === "medium") return "moderate";
  return "unknown";
}

/**
 * Asks OSV which advisories touch each package version. Only the package name, the ecosystem and the version
 * are sent in the batch, then the ids of the advisories that matched, to read their severity. Returns the
 * advisories by `name@version`; a version with none is absent.
 */
export async function queryOsv(
  packages: readonly LockedPackage[],
  fetcher: Fetch = fetch,
): Promise<Map<string, Advisory[]>> {
  const ids = new Map<string, string[]>();
  for (let from = 0; from < packages.length; from += BATCH) {
    const chunk = packages.slice(from, from + BATCH);
    const answer = (await post(fetcher, "/v1/querybatch", {
      queries: chunk.map((p) => ({ package: { name: p.name, ecosystem: "npm" }, version: p.version })),
    })) as { results?: Array<{ vulns?: Array<{ id?: string }> }> };
    // an answer that does not cover every query must not be read as "no vulnerability"
    if ((answer.results?.length ?? 0) !== chunk.length)
      throw new Error("api.osv.dev answered fewer results than queries");
    chunk.forEach((p, i) => {
      const found = (answer.results?.[i]?.vulns ?? []).map((v) => v.id).filter((id): id is string => !!id);
      if (found.length > 0) ids.set(`${p.name}@${p.version}`, found);
    });
  }
  const severities = new Map<string, AdvisorySeverity>();
  for (const id of new Set([...ids.values()].flat()))
    severities.set(id, severityOf(await get(fetcher, `/v1/vulns/${encodeURIComponent(id)}`)));
  const out = new Map<string, Advisory[]>();
  for (const [spec, list] of ids)
    out.set(
      spec,
      [...new Set(list)].sort().map((id) => ({ id, severity: severities.get(id) ?? "unknown" })),
    );
  return out;
}
