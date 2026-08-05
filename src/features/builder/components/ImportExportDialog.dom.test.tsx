// @vitest-environment jsdom
// Regression: the dialog must not be dismissible mid-import. Every dismiss
// path (Close buttons, backdrop click, native Escape via the cancel event)
// is gated on the importing state — otherwise the deck is still replaced
// behind a closed dialog and the reopen-effect wipes the unmatched report.

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { installDomShims } from "../../../test/domShims";
import type { UnmatchedLine } from "../decklistText";
import { ImportExportDialog } from "./ImportExportDialog";

// jsdom's <dialog> lacks showModal/close; the shared shims polyfill it.
beforeAll(installDomShims);

afterEach(cleanup);

function deferred() {
  let resolve!: (lines: UnmatchedLine[]) => void;
  const promise = new Promise<UnmatchedLine[]>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe("ImportExportDialog", () => {
  it("blocks Close, backdrop clicks and Escape while an import is in flight", async () => {
    const importCall = deferred();
    const onImport = vi.fn(() => importCall.promise);
    const onClose = vi.fn();
    render(<ImportExportDialog open deckText="" onImport={onImport} onClose={onClose} />);

    fireEvent.click(screen.getByRole("button", { name: "Import" }));
    expect(onImport).toHaveBeenCalledTimes(1);

    // Both Close buttons (the header X and the footer one) are disabled…
    const closeButtons = screen.getAllByRole("button", { name: "Close" });
    expect(closeButtons).toHaveLength(2);
    for (const button of closeButtons) {
      expect((button as HTMLButtonElement).disabled).toBe(true);
      fireEvent.click(button);
    }
    // …a backdrop click (target === the dialog element) is ignored…
    const dialog = document.querySelector("dialog");
    if (!dialog) throw new Error("dialog not rendered");
    fireEvent.click(dialog);
    // …and the native Escape path (the cancel event) is prevented.
    const cancel = new Event("cancel", { cancelable: true });
    fireEvent(dialog, cancel);
    expect(cancel.defaultPrevented).toBe(true);
    expect(onClose).not.toHaveBeenCalled();

    // Once the import settles, dismissal works again.
    importCall.resolve([]);
    await waitFor(() => expect(screen.getByText(/Imported — every card was found/)).toBeTruthy());
    fireEvent.click(screen.getAllByRole("button", { name: "Close" })[1] as HTMLElement);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
