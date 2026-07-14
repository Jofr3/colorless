import { Link } from "react-router-dom";
import { CORNER_CONTROL_SHAPE, CORNER_SETTINGS_POSITION, GLASS_HUD_BUTTON } from "../lib/glass";
import { SettingsIcon } from "./icons";

// Round settings button anchored to the bottom-right of the viewport. Rendered
// once by RootLayout so it appears on every page in the same spot. Size, inset,
// and styling mirror the simulator's GameLog toggle (bottom-left) so the two
// read as a matched pair of corner controls.
export function SettingsButton() {
  return (
    <Link
      to="/settings"
      aria-label="Settings"
      className={`${CORNER_SETTINGS_POSITION} ${CORNER_CONTROL_SHAPE} ${GLASS_HUD_BUTTON}`}
    >
      <SettingsIcon className="h-[18px] w-[18px]" />
    </Link>
  );
}
