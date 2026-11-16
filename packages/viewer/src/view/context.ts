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

/** The project and the branch (or revision) shown at the top of the page. */
export function projectContext(
  manifest: AnalysisManifest | TimelineManifest | undefined,
  project: string,
): ProjectContext {
  if (!manifest) return { name: project, ref: "no manifest" };
  if (manifest.kind === "timeline") {
    const mode = manifest.source.mode;
    return {
      name: manifest.project,
      ref: mode === "diff" ? `${manifest.source.branch} (diff)` : manifest.source.branch,
    };
  }
  const { source } = manifest;
  const short = source.commit?.slice(0, SHORT);
  let ref: string;
  if (source.kind === "disk") ref = manifest.git.available ? "working tree" : "folder, no git";
  else if (source.rev && short) ref = `${source.rev} · ${short}`;
  else ref = short ? `HEAD · ${short}` : (source.rev ?? "HEAD");
  return { name: manifest.project, ref, ...(source.path ? { path: source.path } : {}) };
}
