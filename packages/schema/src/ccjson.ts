import { createHash } from "node:crypto";

/** A node of the file tree. Files have no children; metrics live in `lenses.metrics`. */
export interface FileNode {
  id: string;
  name: string;
  type: "File" | "Folder";
  children?: FileNode[];
  contentHash?: string;
}

export interface MetricsLens {
  attributes: Record<string, Record<string, number>>;
  attributeDescriptors: Record<string, AttributeDescriptor>;
  attributeTypes: Record<string, "absolute" | "relative">;
}

export interface AttributeDescriptor {
  title?: string;
  description?: string;
  hintLowValue?: string;
  hintHighValue?: string;
  direction?: number;
  analyzers?: string[];
}

export interface Lenses {
  metrics: MetricsLens;
  [lens: string]: unknown;
}

export interface CcJsonMeta {
  projectName: string;
  apiVersion: string;
  checksum: string;
  commitHash?: string;
}

export interface CcJson {
  meta: CcJsonMeta;
  files: FileNode[];
  lenses: Lenses;
}

export const CC_API_VERSION = "2.0";

/** Stable node id: first 16 hex of sha-256 of the canonical tree path (e.g. `/root/src/a.ts`). */
export function nodeId(canonicalPath: string): string {
  return createHash("sha256").update(canonicalPath, "utf8").digest("hex").slice(0, 16);
}

/** MD5 over the compact JSON body `{"files":...,"lenses":...}` (CodeCharta 2.0 format). */
export function bodyChecksum(files: FileNode[], lenses: Lenses): string {
  return createHash("md5").update(JSON.stringify({ files, lenses }), "utf8").digest("hex");
}

export interface BuildCcJsonInput {
  projectName: string;
  commitHash?: string;
  files: FileNode[];
  attributes: Record<string, Record<string, number>>;
  attributeDescriptors?: Record<string, AttributeDescriptor>;
  attributeTypes?: Record<string, "absolute" | "relative">;
}

export function buildCcJson(input: BuildCcJsonInput): CcJson {
  const lenses: Lenses = {
    metrics: {
      attributes: input.attributes,
      attributeDescriptors: input.attributeDescriptors ?? {},
      attributeTypes: input.attributeTypes ?? {},
    },
  };
  const meta: CcJsonMeta = {
    projectName: input.projectName,
    apiVersion: CC_API_VERSION,
    checksum: bodyChecksum(input.files, lenses),
  };
  if (input.commitHash) meta.commitHash = input.commitHash;
  return { meta, files: input.files, lenses };
}
