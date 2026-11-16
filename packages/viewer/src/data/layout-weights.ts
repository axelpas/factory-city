import type { TimelineData } from "./timeline";

/** Weight of each union file for the layout: its largest value of the ground-area metric over time. */
export function layoutWeights(
  data: TimelineData,
  areaMetric: string,
): Array<{ path: string; weight: number }> {
  const max = new Float64Array(data.paths.length).fill(1);
  for (const frame of data.frames) {
    frame.model.files.forEach((file, i) => {
      const v = file.values[areaMetric];
      const u = frame.unionIndex[i] as number;
      if (v !== undefined && v > (max[u] as number)) max[u] = v;
    });
  }
  return data.paths.map((path, i) => ({ path, weight: max[i] as number }));
}
