/** What a person who cannot see the city is told about it: the question asked and what is on screen. */
export interface CityDescription {
  project: string;
  preset: string;
  question?: string;
  files: number;
  /** Top-level folders. */
  districts: number;
  /** Position of the frame shown, for a timeline. */
  frame?: { index: number; count: number; label: string };
}

export function describeCity(d: CityDescription, integer: (n: number) => string): string {
  const parts = [
    `${d.preset}${d.question ? `: ${d.question}` : ""}`,
    `${integer(d.files)} ${d.files === 1 ? "file" : "files"} in ${integer(d.districts)} ${d.districts === 1 ? "district" : "districts"}.`,
  ];
  if (d.frame)
    parts.push(`Frame ${integer(d.frame.index + 1)} of ${integer(d.frame.count)}: ${d.frame.label}.`);
  parts.push("Use the file finder to explore it with the keyboard.");
  return parts.join(" ");
}
