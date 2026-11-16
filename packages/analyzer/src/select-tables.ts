export const DEPENDENCY_FOLDERS = new Set([
  "node_modules",
  "vendor",
  "dist",
  "build",
  "out",
  ".next",
  ".nuxt",
  ".svelte-kit",
  ".turbo",
  ".cache",
  "coverage",
  "bower_components",
  "venv",
  ".venv",
  "env",
  "__pycache__",
  ".tox",
  "target",
  ".gradle",
  ".idea",
  ".vscode",
  ".git",
  "pods",
]);

export const NON_ENGINEERING_FOLDERS = new Set([
  "public",
  "static",
  "assets",
  "media",
  "images",
  "img",
  "fonts",
  "uploads",
  "docs",
]);

export const LOCKFILES = new Set([
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "bun.lockb",
  "bun.lock",
  "composer.lock",
  "gemfile.lock",
  "poetry.lock",
  "cargo.lock",
  "go.sum",
  "pipfile.lock",
]);

/** Files this small share of source files in a folder (with at least this many files) make it non-engineering. */
export const MIN_FILES_FOR_SHARE_RULE = 20;

export const MAX_NON_SOURCE_SHARE = 0.05;
