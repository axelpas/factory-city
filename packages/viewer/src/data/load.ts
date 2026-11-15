import type {
  AnalysisManifest,
  CcJson,
  Factory,
  Report,
  TimelineManifest,
  TimelineMode,
} from "@factory-city/schema";

export interface ProjectList {
  current?: string;
  projects: Array<{ slug: string; name: string }>;
}

export type SourceKey = "snapshot" | TimelineMode;

export interface Loaded {
  snapshots: CcJson[];
  manifest?: AnalysisManifest | TimelineManifest;
  /** Code-health report of the snapshot, or of the timeline's latest frame. */
  report?: Report;
  /** Factory KPIs: written with a per-issue timeline. */
  factory?: Factory;
}

/** What a project's data folder holds: a single snapshot and/or timelines, by mode. */
export type Available = Partial<Record<SourceKey, AnalysisManifest | TimelineManifest>>;

const MODES: TimelineMode[] = ["commit", "day", "issue", "revs", "diff"];
const PARALLEL = 6;

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status} ${res.statusText}`);
  return (await res.json()) as T;
}

async function tryJson<T>(url: string): Promise<T | undefined> {
  try {
    return await getJson<T>(url);
  } catch {
    return undefined;
  }
}

export async function loadProjects(): Promise<ProjectList> {
  return (await tryJson<ProjectList>("projects.json")) ?? { projects: [] };
}

function base(slug: string): string {
  return `data/${encodeURIComponent(slug)}/`;
}

export async function loadAvailable(slug: string): Promise<Available> {
  const out: Available = {};
  // the local server lists what exists; without that list, try each known name
  const listed = (await tryJson<{ files: string[] }>(`${base(slug)}sources.json`))?.files;
  const has = (name: string) => listed === undefined || listed.includes(name);
  const snapshot = has("analysis.json")
    ? await tryJson<AnalysisManifest>(`${base(slug)}analysis.json`)
    : undefined;
  if (snapshot) out.snapshot = snapshot;
  for (const mode of MODES) {
    if (!has(`timeline.${mode}.json`)) continue;
    const timeline = await tryJson<TimelineManifest>(`${base(slug)}timeline.${mode}.json`);
    if (timeline) out[mode] = timeline;
  }
  return out;
}

/** The most recently written source: what the user analyzed last. */
export function latestSource(available: Available): SourceKey | undefined {
  const entries = Object.entries(available) as Array<[SourceKey, AnalysisManifest | TimelineManifest]>;
  return entries.sort((a, b) => (a[1].createdAt < b[1].createdAt ? 1 : -1))[0]?.[0];
}

export async function loadSource(
  slug: string,
  manifest: AnalysisManifest | TimelineManifest,
  onProgress?: (done: number, total: number) => void,
): Promise<Loaded> {
  const files = manifest.kind === "timeline" ? manifest.frames.map((f) => f.snapshot) : [manifest.snapshot];
  const snapshots = new Array<CcJson>(files.length);
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < files.length) {
      const i = next++;
      snapshots[i] = await getJson<CcJson>(`${base(slug)}${files[i]}`);
      onProgress?.(++done, files.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(PARALLEL, files.length) }, worker));
  const reportFile = manifest.kind === "timeline" ? `report.${manifest.source.mode}.json` : "report.json";
  const report = await tryJson<Report>(`${base(slug)}${reportFile}`);
  const perIssue = manifest.kind === "timeline" && manifest.source.mode === "issue";
  const factory = perIssue ? await tryJson<Factory>(`${base(slug)}factory.json`) : undefined;
  return { snapshots, manifest, report, factory };
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
  return { snapshots: [cc], manifest };
}
