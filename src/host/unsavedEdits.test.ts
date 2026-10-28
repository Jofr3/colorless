import { describe, expect, it } from "vitest";
import { guardUnsavedEdits, type UnsavedEdits } from "./unsavedEdits";

function page() {
  const document = Object.assign(new EventTarget(), { visibilityState: "visible" });
  return { window: new EventTarget(), document };
}

function edits(unsaved: boolean) {
  const calls: string[] = [];
  const target: UnsavedEdits = {
    hasUnsavedEdits: () => unsaved,
    persistNow: () => calls.push("persist"),
    retrySave: () => calls.push("retry"),
  };
  return { target, calls };
}

describe("guardUnsavedEdits", () => {
  it("sends the edits as the tab is hidden, and not as it comes back", () => {
    const targets = page();
    const { target, calls } = edits(true);
    guardUnsavedEdits(targets, target);
    targets.document.visibilityState = "hidden";
    targets.document.dispatchEvent(new Event("visibilitychange"));
    targets.document.visibilityState = "visible";
    targets.document.dispatchEvent(new Event("visibilitychange"));
    expect(calls).toEqual(["persist"]);
  });

  it("sends the edits and asks before closing only while some are unsaved", () => {
    const targets = page();
    const dirty = edits(true);
    const stop = guardUnsavedEdits(targets, dirty.target);
    const close = new Event("beforeunload", { cancelable: true });
    targets.window.dispatchEvent(close);
    expect(close.defaultPrevented).toBe(true);
    expect(dirty.calls).toEqual(["persist"]);
    stop();

    const clean = edits(false);
    guardUnsavedEdits(targets, clean.target);
    const leave = new Event("beforeunload", { cancelable: true });
    targets.window.dispatchEvent(leave);
    expect(leave.defaultPrevented).toBe(false);
    expect(clean.calls).toEqual([]);
  });

  it("sends the edits on pagehide and retries a failed save when the network returns", () => {
    const targets = page();
    const { target, calls } = edits(true);
    const stop = guardUnsavedEdits(targets, target);
    targets.window.dispatchEvent(new Event("pagehide"));
    targets.window.dispatchEvent(new Event("online"));
    expect(calls).toEqual(["persist", "retry"]);
    stop();
    targets.window.dispatchEvent(new Event("online"));
    targets.window.dispatchEvent(new Event("pagehide"));
    expect(calls).toEqual(["persist", "retry"]);
  });
});
