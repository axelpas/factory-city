import type { LinkStrategy } from "@factory-city/schema";
import type { CiRun } from "./delivery.js";

/** A commit as the resolver sees it. */
export interface CommitMessage {
  hash: string;
  subject: string;
  body: string;
}

export interface ForgeIssue {
  number: number;
  title: string;
  state: string;
  labels: string[];
  url: string;
  createdAt?: string;
  closedAt?: string;
}

export interface ForgePull {
  number: number;
  title: string;
  body: string;
  branch: string;
  url: string;
  /** Issues the pull request closes, as the forge reports them. */
  closes: number[];
  createdAt?: string;
  mergedAt?: string;
}

/** What the forge knows, when `gh` is available: issues and pull requests by number. */
export interface ForgeData {
  issues: Map<number, ForgeIssue>;
  pulls: Map<number, ForgePull>;
  /** CI runs; absent when the repository has none. */
  runs?: CiRun[];
}

export interface Link {
  issue?: number;
  pullRequest?: number;
  strategy: LinkStrategy;
  /** Branch the work came from, when a merge commit names it. */
  branch?: string;
}
