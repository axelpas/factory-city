import { describe, expect, it, vi } from "vitest";
import { handleKey, type KeyActions } from "../src/ui/keyboard";

function actions(): { [K in keyof KeyActions]: ReturnType<typeof vi.fn> } {
  return {
    togglePlay: vi.fn(),
    step: vi.fn(),
    resetCamera: vi.fn(),
    topView: vi.fn(),
    nextTheme: vi.fn(),
    nextPreset: vi.fn(),
    exportPicture: vi.fn(),
    toggleHealth: vi.fn(),
    toggleFactory: vi.fn(),
    openFinder: vi.fn(),
    toggleHelp: vi.fn(),
    escape: vi.fn(),
  };
}

function key(k: string, extra: Partial<KeyboardEvent> = {}, tag = "BODY"): KeyboardEvent {
  return { key: k, target: { tagName: tag }, preventDefault: vi.fn(), ...extra } as unknown as KeyboardEvent;
}

describe("keyboard shortcuts", () => {
  it("runs the action of a key, in upper or lower case", () => {
    const a = actions();
    handleKey(key("t"), a);
    handleKey(key("T"), a);
    handleKey(key("ArrowLeft"), a);
    handleKey(key("ArrowRight"), a);
    expect(a.nextTheme).toHaveBeenCalledTimes(2);
    expect(a.step.mock.calls).toEqual([[-1], [1]]);
  });

  it("cancels the browser's own action for Space and the slash only", () => {
    const a = actions();
    const space = key(" ");
    const slash = key("/");
    const letter = key("p");
    for (const e of [space, slash, letter]) handleKey(e, a);
    expect(space.preventDefault).toHaveBeenCalled();
    expect(slash.preventDefault).toHaveBeenCalled();
    expect(letter.preventDefault).not.toHaveBeenCalled();
    expect(a.togglePlay).toHaveBeenCalled();
    expect(a.openFinder).toHaveBeenCalled();
  });

  it("leaves the keys typed in a field to the field, except Escape", () => {
    const a = actions();
    handleKey(key("p", {}, "INPUT"), a);
    handleKey(key("Escape", {}, "INPUT"), a);
    expect(a.nextPreset).not.toHaveBeenCalled();
    expect(a.escape).toHaveBeenCalledTimes(1);
  });

  it("leaves a key pressed with a modifier to the browser, and ignores unknown keys", () => {
    const a = actions();
    handleKey(key("r", { metaKey: true }), a);
    handleKey(key("r", { ctrlKey: true }), a);
    handleKey(key("z"), a);
    expect(a.resetCamera).not.toHaveBeenCalled();
    handleKey(key("r"), a);
    expect(a.resetCamera).toHaveBeenCalledTimes(1);
  });
});
