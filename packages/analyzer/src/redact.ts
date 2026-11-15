import type { CcJson, Frame, Report, TimelineManifest } from "@factory-city/schema";
import { bodyChecksum } from "@factory-city/schema";
import type { Bundle } from "./bundle.js";

/** Frame metrics that come from the facts file: agent, model, outcome, effort and spend. */
const FACT_METRICS = [
  "agent",
  "model",
  "outcome",
  "attempts",
  "succeeded_attempts",
  "review_blockers",
  "review_majors",
  "rework_rounds",
  "agent_minutes",
  "cost",
  "currency",
  "human_interventions",
  "tags",
] as const;

/** File metrics that carry an author or a cost. */
const PRIVATE_FILE_METRICS = ["cost_share", "main_agent", "main_agent_share"];

function redactFrame(frame: Frame, mode: TimelineManifest["source"]["mode"]): Frame {
  const metrics = { ...frame.metrics } as Record<string, unknown>;
  for (const key of FACT_METRICS) delete metrics[key];
  const issue = frame.issue ? { number: frame.issue.number } : undefined;
  const label = frame.unlinked
    ? `unlinked ${frame.date.slice(0, 10)}`
    : issue
      ? `#${issue.number}`
      : mode === "day"
        ? frame.date.slice(0, 10)
        : frame.commit.slice(0, 7);
  const { issue: _issue, ...rest } = frame;
  return { ...rest, label, subject: "", metrics: metrics as Frame["metrics"], ...(issue ? { issue } : {}) };
}

function redactSnapshot(cc: CcJson): CcJson {
  const lens = cc.lenses.metrics;
  const attributes: Record<string, Record<string, number>> = {};
  for (const [id, values] of Object.entries(lens.attributes)) {
    attributes[id] = Object.fromEntries(
      Object.entries(values).filter(([key]) => !PRIVATE_FILE_METRICS.includes(key)),
    );
  }
  const keep = <T>(map: Record<string, T>) =>
    Object.fromEntries(Object.entries(map).filter(([key]) => !PRIVATE_FILE_METRICS.includes(key)));
  const lenses = {
    ...cc.lenses,
    metrics: {
      attributes,
      attributeDescriptors: keep(lens.attributeDescriptors),
      attributeTypes: keep(lens.attributeTypes),
    },
  };
  return { meta: { ...cc.meta, checksum: bodyChecksum(cc.files, lenses) }, files: cc.files, lenses };
}

function redactReport(report: Report): Report {
  return {
    ...report,
    hotspots: report.hotspots.map((h) => ({
      ...h,
      // cohesion groups are named by their declarations: keep the advice, drop the names
      actions: h.actions.map((a) =>
        a.type === "split-file" ? { type: a.type, text: "Split the file along its cohesion groups." } : a,
      ),
    })),
  };
}

/**
 * What `--redact` removes before a file leaves the machine: commit subjects, issue titles, author and agent
 * labels, facts and cost, and declaration names. Paths, code metrics and dates stay.
 */
export function redactBundle(bundle: Bundle): Bundle {
  const manifest = bundle.manifest;
  const categories = Object.fromEntries(
    Object.entries(manifest.categories).filter(([key]) => key !== "main_agent"),
  );
  const metrics = manifest.metrics.filter((m) => !PRIVATE_FILE_METRICS.includes(m));
  const redacted =
    manifest.kind === "timeline"
      ? {
          ...manifest,
          categories,
          metrics,
          // facts are gone: the data level falls back to what git and the forge gave
          dataLevel: Math.min(manifest.dataLevel, 2) as TimelineManifest["dataLevel"],
          frames: manifest.frames.map((f) => redactFrame(f, manifest.source.mode)),
        }
      : { ...manifest, categories, metrics };
  return {
    manifest: redacted,
    snapshots: bundle.snapshots.map(redactSnapshot),
    ...(bundle.report ? { report: redactReport(bundle.report) } : {}),
    // factory.json groups by agent and model and sums costs: it is dropped whole
  };
}
