// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FACETS, SERIES, SETS } from "../../../test/fixtures";
import { DEFAULT_FORMAT, type Format, formatById } from "../cards";
import type { CatalogOptions } from "../catalogOptions";
import { DEFAULT_FILTERS, type Filters } from "../poolFilter";
import { FilterRail } from "./FilterRail";

afterEach(cleanup);

/** A ready options bundle (the session vocabularies the rail feeds on). */
const READY: CatalogOptions = {
  status: "ready",
  facets: FACETS,
  sets: SETS,
  series: SERIES,
  retry: () => {},
};

function renderRail(
  filters: Filters = DEFAULT_FILTERS,
  options: CatalogOptions = READY,
  format: Format = DEFAULT_FORMAT,
) {
  const onChange = vi.fn();
  const onReset = vi.fn();
  render(
    <FilterRail
      filters={filters}
      onChange={onChange}
      format={format}
      onFormatChange={vi.fn()}
      onReset={onReset}
      options={options}
    />,
  );
  return { onChange, onReset };
}

describe("FilterRail", () => {
  it("toggles a facet-fed rarity through onChange when its chip is clicked", () => {
    const { onChange } = renderRail();
    fireEvent.click(screen.getByRole("button", { name: "Common" }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ rarities: ["Common"] }));
  });

  it("selects an energy type via its pip", () => {
    const { onChange } = renderRail();
    fireEvent.click(screen.getByRole("button", { name: "Fire" }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ types: ["Fire"] }));
  });

  it("offers only the energy types the facets contain", () => {
    renderRail();
    // FACETS.types has Fire/Grass/Lightning/Water — no Psychic pip.
    expect(screen.queryByRole("button", { name: "Psychic" })).toBeNull();
  });

  it("offers facet-fed kind chips per supertype — every one of them server-filtered", () => {
    const { onChange } = renderRail({ ...DEFAULT_FILTERS, supertype: "Pokémon" });
    fireEvent.click(screen.getByRole("button", { name: "Stage 1" }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ subtypes: ["Stage 1"] }));
    // The hardcoded EX/Mega name-regex chips are gone (D198) — rule-box
    // markers are their own facet-fed section now.
    expect(screen.queryByRole("button", { name: "EX" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Mega" })).toBeNull();
  });

  it("toggles a rule-box marker through its own dimension, not the kind chips", () => {
    const { onChange } = renderRail({ ...DEFAULT_FILTERS, supertype: "Pokémon" });
    expect(screen.getByText("Rule box")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "ex" }));
    // `subtypes` untouched: the two dimensions AND server-side.
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ suffixes: ["ex"], subtypes: [] }),
    );
  });

  it("⚠️ RENDERS NO RULE-BOX SECTION FOR AN EMPTY VOCABULARY — the live state", () => {
    // `cards.suffix` is NULL on every production row until an ingest fills it,
    // so /facets serves `suffixes: []`. The section must vanish entirely: with
    // no chip there is no way to send `?suffix=`, and therefore no way to land
    // on an unexplained empty grid. This is the guard that let the filter ship
    // against an unpopulated column at all (D197 refused it without one).
    renderRail(DEFAULT_FILTERS, { ...READY, facets: { ...FACETS, suffixes: [] } });
    expect(screen.queryByText("Rule box")).toBeNull();
    expect(screen.queryByRole("button", { name: "ex" })).toBeNull();
    // Everything else keeps working — one dead vocabulary costs one section.
    expect(screen.getByRole("button", { name: "Common" })).toBeTruthy();
    expect(screen.getByLabelText("Minimum HP")).toBeTruthy();
  });

  it("hides the rule-box section off-Pokémon and clears a selection on the switch", () => {
    // Ingest writes `suffix` from the Pokémon payload only, so under Trainer
    // every marker matches nothing. Hiding the chips is not enough — a
    // selection made under Pokémon must also come off the wire, or the grid
    // empties with nothing on screen to explain it.
    const { onChange } = renderRail({
      ...DEFAULT_FILTERS,
      supertype: "Pokémon",
      suffixes: ["ex"],
    });
    fireEvent.click(screen.getByRole("button", { name: "Trainer" }));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ supertype: "Trainer", suffixes: [] }),
    );
    cleanup();

    renderRail({ ...DEFAULT_FILTERS, supertype: "Trainer" });
    expect(screen.queryByText("Rule box")).toBeNull();
  });

  it("offers the legal-only switch for every flagged format, wired to legalOnly", () => {
    // Expanded has a server legality flag too (P2 task 13) — the switch is no
    // longer Standard-only.
    const { onChange } = renderRail(DEFAULT_FILTERS, READY, formatById("expanded"));
    const toggle = screen.getByRole("switch", { name: "Expanded-legal only" });
    fireEvent.click(toggle);
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ legalOnly: false }));
  });

  it("single-selects a regulation mark", () => {
    const { onChange } = renderRail();
    fireEvent.click(screen.getByRole("button", { name: "H" }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ regulationMark: "H" }));
  });

  it("edits the HP bounds and the ability/attack text", () => {
    const { onChange } = renderRail();
    fireEvent.change(screen.getByLabelText("Minimum HP"), { target: { value: "120" } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ hpMin: "120" }));
    fireEvent.change(screen.getByLabelText("Ability/attack text"), {
      target: { value: "discard" },
    });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ text: "discard" }));
  });

  it("picks a set and an illustrator from the selects", () => {
    const { onChange } = renderRail();
    fireEvent.change(screen.getByLabelText("Set"), { target: { value: "sv06" } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ setId: "sv06" }));
    fireEvent.change(screen.getByLabelText("Illustrator"), {
      target: { value: "5ban Graphics" },
    });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ illustrator: "5ban Graphics" }),
    );
  });

  it("narrowing to a serie drops a set pick outside it and filters the set options", () => {
    // swsh01 belongs to the swsh serie; choosing the sv serie must clear it.
    const { onChange } = renderRail({ ...DEFAULT_FILTERS, setId: "swsh01" });
    fireEvent.change(screen.getByLabelText("Serie"), { target: { value: "sv" } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ serieId: "sv", setId: "" }));
    cleanup();

    // With the serie active, the set select offers only that serie's sets.
    renderRail({ ...DEFAULT_FILTERS, serieId: "sv" });
    const setSelect = screen.getByLabelText<HTMLSelectElement>("Set");
    const values = [...setSelect.options].map((o) => o.value);
    expect(values).toEqual(["", "sv06"]);
  });

  it("shows a spinner while the options load, hiding the option-fed sections", () => {
    renderRail(DEFAULT_FILTERS, {
      ...READY,
      status: "loading",
      facets: null,
      sets: [],
      series: [],
    });
    expect(screen.getByLabelText("Loading filter options")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Common" })).toBeNull();
    expect(screen.queryByText("Rule box")).toBeNull();
    expect(screen.queryByLabelText("Set")).toBeNull();
    // Vocabulary-free dimensions keep working.
    expect(screen.getByLabelText("Minimum HP")).toBeTruthy();
    expect(screen.getByLabelText("Ability/attack text")).toBeTruthy();
  });

  it("offers a retry hint when the options failed to load", () => {
    const retry = vi.fn();
    renderRail(DEFAULT_FILTERS, {
      status: "error",
      facets: null,
      sets: [],
      series: [],
      retry,
    });
    expect(screen.getByText("Some filter options couldn't load.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("degrades per dimension when only SOME options failed", () => {
    // The catalog vocabularies load per resource (catalogOptions.ts), so a
    // dead /sets + /series leaves the facet-fed sections fully usable — only
    // the set/serie selects go, alongside the one retry notice.
    renderRail(DEFAULT_FILTERS, { ...READY, status: "error", sets: [], series: [] });
    expect(screen.getByText("Some filter options couldn't load.")).toBeTruthy();
    expect(screen.queryByLabelText("Set")).toBeNull();
    expect(screen.queryByLabelText("Serie")).toBeNull();
    expect(screen.getByRole("button", { name: "Common" })).toBeTruthy();
    expect(screen.getByLabelText("Illustrator")).toBeTruthy();
  });

  it("hides a dimension whose facet list is empty", () => {
    renderRail(DEFAULT_FILTERS, { ...READY, facets: { ...FACETS, illustrators: [] } });
    expect(screen.queryByLabelText("Illustrator")).toBeNull();
    // The others stay.
    expect(screen.getByRole("button", { name: "Common" })).toBeTruthy();
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
