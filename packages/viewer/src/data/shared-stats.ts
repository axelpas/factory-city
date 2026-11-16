import type { MetricDefinition } from "@factory-city/schema/registry";
import type { MetricStats, Model } from "./model";
import { statsOf } from "./stats";

/** A map whose values are computed the first time they are asked for. */
class LazyMap<V> extends Map<string, V> {
  constructor(
    private readonly keysKnown: ReadonlySet<string>,
    private readonly compute: (key: string) => V,
  ) {
    super();
  }
  override has(key: string): boolean {
    return this.keysKnown.has(key);
  }
  override get(key: string): V | undefined {
    if (!this.keysKnown.has(key)) return undefined;
    if (!super.has(key)) super.set(key, this.compute(key));
    return super.get(key);
  }
}

/** Statistics over all frames at once, computed when asked, so that scales stay fixed while the timeline plays. */
export function shareStatistics(models: Model[], metrics: Map<string, MetricDefinition>): void {
  const fileIds = new Set(models.flatMap((m) => [...m.stats.keys()]));
  const folderIds = new Set(models.flatMap((m) => [...m.folderStats.keys()]));
  const stats = new LazyMap<MetricStats>(fileIds, (id) =>
    statsOf(models.flatMap((m) => m.files.map((f) => f.values[id]).filter((v) => v !== undefined))),
  );
  const folderStats = new LazyMap<MetricStats>(folderIds, (id) =>
    statsOf(
      models.flatMap((m) =>
        [...m.folders.values()]
          .filter((f) => f.depth > 0 && f.values[id] !== undefined)
          .map((f) => f.values[id] as number),
      ),
    ),
  );
  for (const m of models) {
    m.stats = stats;
    m.folderStats = folderStats;
    m.metrics = metrics;
  }
}
