/** Names of the languages, by the id stored in the data. An unknown id is shown capitalized. */
const LANGUAGES: Record<string, string> = {
  typescript: "TypeScript",
  tsx: "TSX",
  javascript: "JavaScript",
  python: "Python",
  go: "Go",
  java: "Java",
  csharp: "C#",
  c: "C",
  cpp: "C++",
  "c-header": "C/C++ header",
  rust: "Rust",
  php: "PHP",
  ruby: "Ruby",
  kotlin: "Kotlin",
  swift: "Swift",
};

export function languageLabel(id: string): string {
  return LANGUAGES[id] ?? (id ? id.charAt(0).toUpperCase() + id.slice(1) : id);
}
