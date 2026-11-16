import type { AnalysisManifest, TimelineManifest } from "@factory-city/schema";

/** What was analyzed: the project, the branch or revision, and the subfolder when only one was taken. */
export interface ProjectContext {
  name: string;
  /** The branch of a timeline, the revision of a snapshot, or a note on where the files came from. */
  ref: string;
  /** The subfolder analyzed, when the analysis was restricted to one. */
  path?: string;
}

const SHORT = 7;

type Snapshot = Exclude<AnalysisManifest | TimelineManifest, { kind: "timeline" }>;

/** The revision of a snapshot, as it is said: the working tree, a folder, or a revision with its short hash. */
function revisionOf(manifest: Snapshot): string {
  const { source } = manifest;
  const short = source.commit?.slice(0, SHORT);
  if (source.kind === "disk") return manifest.git.available ? "working tree" : "folder, no git";
  if (source.rev && short) return `${source.rev} · ${short}`;
  return short ? `HEAD · ${short}` : (source.rev ?? "HEAD");
}

/** The project and the branch (or revision) shown at the top of the page. */
export function projectContext(
  manifest: AnalysisManifest | TimelineManifest | undefined,
  project: string,
): ProjectContext {
  if (!manifest) return { name: project, ref: "no manifest" };
  if (manifest.kind === "timeline") {
    const { mode, branch } = manifest.source;
    return { name: manifest.project, ref: mode === "diff" ? `${branch} (diff)` : branch };
  }
  const path = manifest.source.path;
  return { name: manifest.project, ref: revisionOf(manifest), ...(path ? { path } : {}) };
}
