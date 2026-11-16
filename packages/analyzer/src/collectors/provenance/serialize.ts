/** Run-length encoding of the origins of a file: `[origin, count, origin, count, ...]`. */
export function encodeRuns(origins: readonly number[]): number[] {
  const runs: number[] = [];
  for (const o of origins) {
    if (runs.length > 0 && runs[runs.length - 2] === o) (runs[runs.length - 1] as number)++;
    else runs.push(o, 1);
  }
  return runs;
}

export function decodeRuns(runs: readonly number[]): number[] {
  const origins: number[] = [];
  for (let i = 0; i < runs.length; i += 2) {
    const origin = runs[i] as number;
    for (let k = 0; k < (runs[i + 1] as number); k++) origins.push(origin);
  }
  return origins;
}
