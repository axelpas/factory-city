/** What a key does on the page: one entry per action, named for what it does. */
export interface KeyActions {
  togglePlay(): void;
  step(delta: number): void;
  resetCamera(): void;
  topView(): void;
  nextTheme(): void;
  nextPreset(): void;
  exportPicture(): void;
  toggleHealth(): void;
  toggleFactory(): void;
  openFinder(): void;
  toggleHelp(): void;
  /** Closes what is open, the most recent first. */
  escape(): void;
}

/** The keys, with whether the browser's own action is cancelled. Upper and lower case do the same. */
function table(a: KeyActions): Record<string, { run: () => void; prevent?: boolean }> {
  const keys: Record<string, { run: () => void; prevent?: boolean }> = {
    " ": { run: () => a.togglePlay(), prevent: true },
    ArrowLeft: { run: () => a.step(-1) },
    ArrowRight: { run: () => a.step(1) },
    r: { run: () => a.resetCamera() },
    v: { run: () => a.topView() },
    t: { run: () => a.nextTheme() },
    p: { run: () => a.nextPreset() },
    e: { run: () => a.exportPicture() },
    h: { run: () => a.toggleHealth() },
    f: { run: () => a.toggleFactory() },
    "/": { run: () => a.openFinder(), prevent: true },
    "?": { run: () => a.toggleHelp() },
    Escape: { run: () => a.escape() },
  };
  return keys;
}

/** A key typed in a field belongs to the field, except Escape; with a modifier it belongs to the browser. */
function isForPage(e: KeyboardEvent): boolean {
  const target = e.target as HTMLElement | null;
  if (target && /^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName) && e.key !== "Escape") return false;
  return !(e.metaKey || e.ctrlKey || e.altKey);
}

/** Runs the action of a key, if it has one. */
export function handleKey(e: KeyboardEvent, actions: KeyActions): void {
  if (!isForPage(e)) return;
  const key = table(actions)[e.key.length === 1 ? e.key.toLowerCase() : e.key];
  if (!key) return;
  if (key.prevent) e.preventDefault();
  key.run();
}
