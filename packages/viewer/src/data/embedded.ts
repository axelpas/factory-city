import type { Loaded } from "./load";

/** Id of the element that holds the data of a standalone file: gzip, then base64. */
export const DATA_ELEMENT = "factory-city-data";

/**
 * Reads the data embedded in a standalone HTML file, when there is some. Nothing is fetched: the file opens
 * offline, by double-click.
 */
export async function readEmbedded(doc: Document = document): Promise<Loaded | undefined> {
  const text = doc.getElementById(DATA_ELEMENT)?.textContent?.trim();
  if (!text) return undefined;
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  return JSON.parse(await new Response(stream).text()) as Loaded;
}
