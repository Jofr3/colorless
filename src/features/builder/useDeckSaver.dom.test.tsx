// @vitest-environment jsdom
// Regression: the saver must survive React StrictMode's dev double-mount.
// A render-time ref-cached saver gets dispose()d by the synthetic unmount and
// silently never saves again — the builder shipped with exactly that bug.

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { StrictMode, useEffect, useState } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { useDeckSaver } from "./useDeckSaver";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function Harness({ save }: { save: (snapshot: string) => Promise<unknown> }) {
  const [value, setValue] = useState("initial");
  const schedule = useDeckSaver<string>({ initial: "initial", save });
  // Mirrors DeckBuilder: every state change reschedules the debounced save.
  useEffect(() => {
    schedule(value);
  }, [schedule, value]);
  return (
    <button type="button" onClick={() => setValue("edited")}>
      edit
    </button>
  );
}

test("saves an edit after the StrictMode double-mount", async () => {
  const save = vi.fn().mockResolvedValue(undefined);
  render(
    <StrictMode>
      <Harness save={save} />
    </StrictMode>,
  );

  // Mounting alone (the seeded no-op) never saves.
  await vi.advanceTimersByTimeAsync(1000);
  expect(save).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole("button", { name: "edit" }));
  await vi.advanceTimersByTimeAsync(1000);
  expect(save).toHaveBeenCalledTimes(1);
  expect(save).toHaveBeenCalledWith("edited");
});

test("unmount inside the debounce window flushes the pending save", async () => {
  const save = vi.fn().mockResolvedValue(undefined);
  const { unmount } = render(
    <StrictMode>
      <Harness save={save} />
    </StrictMode>,
  );

  fireEvent.click(screen.getByRole("button", { name: "edit" }));
  unmount();
  expect(save).toHaveBeenCalledTimes(1);
  expect(save).toHaveBeenCalledWith("edited");
});
