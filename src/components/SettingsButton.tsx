import { Link } from "react-router-dom";
import { GLASS_HUD_BUTTON } from "../lib/glass";
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
      className={`fixed bottom-3 right-3 z-50 flex h-10 w-10 cursor-pointer items-center justify-center rounded-full ${GLASS_HUD_BUTTON}`}
    >
      <SettingsIcon className="h-[18px] w-[18px]" />
    </Link>
  );
}
