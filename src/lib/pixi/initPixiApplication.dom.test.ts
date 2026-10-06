// @vitest-environment jsdom
import { Application, Container } from "pixi.js";
import { afterEach, expect, it, vi } from "vitest";
import { initPixiApplication } from "./initPixiApplication";

afterEach(() => vi.restoreAllMocks());

it("preserves renderer initialization errors without running uninitialized plugin cleanup", async () => {
  const failure = new Error("WebGL unavailable");
  vi.spyOn(Application.prototype, "init").mockRejectedValue(failure);
  const destroyApp = vi.spyOn(Application.prototype, "destroy");
  const destroyStage = vi.spyOn(Container.prototype, "destroy");

  await expect(initPixiApplication({})).rejects.toBe(failure);

  expect(destroyApp).not.toHaveBeenCalled();
  expect(destroyStage).toHaveBeenCalledWith({ children: true });
});
