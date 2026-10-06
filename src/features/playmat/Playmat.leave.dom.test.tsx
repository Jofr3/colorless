// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { StrictMode } from "react";
import { Link, MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { driveSetup } from "../../../packages/engine/src/testFixtures";
import { installDomShims } from "../../test/domShims";
import { json, stubFetch } from "../../test/fetchStub";
import { AuthProvider } from "../auth/AuthProvider";
import { GamePage as Playmat } from "../game/GamePage";
import { loadSimulatorSave, saveSimulator } from "./simulatorSave";

// Keep the real board shell, confirmation dialog, game and router; omit WebGL.
vi.mock("./components/AnimatedCardsLayer", () => ({ AnimatedCardsLayer: () => null }));

beforeAll(installDomShims);
afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
});

function renderPage() {
  return render(
    <StrictMode>
      <MemoryRouter initialEntries={["/play"]}>
        <AuthProvider>
          <Routes>
            <Route path="/play" element={<Playmat />} />
            <Route path="/" element={<Link to="/play">Open sandbox</Link>} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>
    </StrictMode>,
  );
}

it("keeps the save on Cancel, clears it on Leave, and opens a fresh sandbox on return", async () => {
  stubFetch({ "GET /auth/me": () => json({ error: "unauthorized" }, 401) });
  saveSimulator({
    state: driveSetup(7),
    events: [],
    names: { p1: "Player 1", p2: "Player 2" },
    startedAt: 1000,
    resume: { log: [], viewerSeat: "p1" },
  });
  const page = renderPage();
  const saved = loadSimulatorSave();
  expect(saved).not.toBeNull();

  fireEvent.click(screen.getByRole("button", { name: "Back" }));
  expect(screen.getByRole("dialog", { name: "Leave the game?" })).toBeTruthy();
  expect(
    screen.getByText("This will reset the current game and return to the main menu."),
  ).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(loadSimulatorSave()).toEqual(saved);
  expect(screen.getByRole("region", { name: "Turn actions" })).toBeTruthy();

  fireEvent.click(screen.getByRole("button", { name: "Back" }));
  fireEvent.click(screen.getByRole("button", { name: "Leave" }));
  expect(loadSimulatorSave()).toBeNull();
  fireEvent.click(screen.getByRole("link", { name: "Open sandbox" }));
  expect(await screen.findByRole("heading", { name: "Play" })).toBeTruthy();
  expect(screen.queryByRole("region", { name: "Trading card game playmat" })).toBeNull();
  expect(loadSimulatorSave()).toBeNull();

  page.unmount();
  renderPage();
  expect(screen.getByRole("heading", { name: "Play" })).toBeTruthy();
  expect(loadSimulatorSave()).toBeNull();
});
