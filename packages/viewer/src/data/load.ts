import type { AnalysisManifest, CcJson } from "@factory-city/schema";

export interface ProjectList {
  current?: string;
  projects: Array<{ slug: string; name: string }>;
}

export interface Loaded {
  cc: CcJson;
  manifest?: AnalysisManifest;
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status} ${res.statusText}`);
  return (await res.json()) as T;
}

export async function loadProjects(): Promise<ProjectList> {
  try {
    return await getJson<ProjectList>("projects.json");
  } catch {
    return { projects: [] };
  }
}

export async function loadProject(slug: string): Promise<Loaded> {
  const manifest = await getJson<AnalysisManifest>(`data/${encodeURIComponent(slug)}/analysis.json`);
  const cc = await getJson<CcJson>(`data/${encodeURIComponent(slug)}/${manifest.snapshot}`);
  return { cc, manifest };
}

function isCcJson(value: unknown): value is CcJson {
  const v = value as Partial<CcJson> | null;
  return !!v && typeof v === "object" && !!v.meta && Array.isArray(v.files) && !!v.lenses;
}

function isManifest(value: unknown): value is AnalysisManifest {
  const v = value as Partial<AnalysisManifest> | null;
  return !!v && typeof v === "object" && v.kind === "snapshot" && typeof v.project === "string";
}

/** Reads dropped files: a cc.json snapshot, and optionally its analysis.json. */
export async function readDropped(files: readonly File[]): Promise<Loaded> {
  let cc: CcJson | undefined;
  let manifest: AnalysisManifest | undefined;
  for (const file of files) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(await file.text());
    } catch {
      throw new Error(`${file.name} is not valid JSON.`);
    }
    if (isCcJson(parsed)) cc = parsed;
    else if (isManifest(parsed)) manifest = parsed;
  }
  if (!cc) throw new Error("Drop a snapshot.cc.json file (and its analysis.json) to open a city.");
  return { cc, manifest };
}
