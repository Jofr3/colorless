import { Application, type ApplicationOptions } from "pixi.js";
// Use Pixi's interpreted shader/uniform handlers under production's strict CSP.
import "pixi.js/unsafe-eval";

export async function initPixiApplication(options: Partial<ApplicationOptions>) {
  const app = new Application();
  try {
    await app.init(options);
  } catch (error) {
    // Renderer creation can fail before application plugins are initialized.
    // Application.destroy() would then call uninitialized plugin cleanup hooks.
    app.stage.destroy({ children: true });
    throw error;
  }
  return app;
}
