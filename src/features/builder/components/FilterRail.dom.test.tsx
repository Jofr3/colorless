// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_FORMAT } from "../cards";
import { DEFAULT_FILTERS, type Filters } from "../poolFilter";
import { FilterRail } from "./FilterRail";

afterEach(cleanup);

function renderRail(filters: Filters = DEFAULT_FILTERS) {
  const onChange = vi.fn();
  const onReset = vi.fn();
  render(
    <FilterRail
      filters={filters}
      onChange={onChange}
      format={DEFAULT_FORMAT}
      onFormatChange={vi.fn()}
      onReset={onReset}
    />,
  );
  return { onChange, onReset };
}

describe("FilterRail", () => {
  it("toggles a rarity through onChange when its chip is clicked", () => {
    const { onChange } = renderRail();
    fireEvent.click(screen.getByRole("button", { name: "Common" }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ rarities: ["Common"] }));
  });

  it("selects an energy type via its pip", () => {
    const { onChange } = renderRail();
    fireEvent.click(screen.getByRole("button", { name: "Fire" }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ types: ["Fire"] }));
  });

  it("shows Reset (wired to onReset) only once a filter is active", () => {
    // Defaults → nothing to reset.
    renderRail();
    expect(screen.queryByRole("button", { name: "Reset filters" })).toBeNull();
    cleanup();

    // A narrowing filter → Reset appears and calls back.
    const { onReset } = renderRail({ ...DEFAULT_FILTERS, query: "char" });
    fireEvent.click(screen.getByRole("button", { name: "Reset filters" }));
    expect(onReset).toHaveBeenCalledTimes(1);
  });
});
