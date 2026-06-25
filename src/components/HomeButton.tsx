import { Link } from "react-router-dom";
import { GLASS_HUD_BUTTON } from "../lib/glass";
import { HomeIcon } from "./icons";

// Round home button anchored to the top-right of the viewport. A mirror of the
// bottom-right SettingsButton — same size, glass styling, and inset — so the
// two read as a matched pair of opposite-corner controls.
export function HomeButton() {
  return (
    <Link
      to="/"
      aria-label="Home"
      className={`fixed right-3 top-3 z-50 flex h-10 w-10 cursor-pointer items-center justify-center rounded-full ${GLASS_HUD_BUTTON}`}
    >
      <HomeIcon className="h-[18px] w-[18px]" />
    </Link>
  );
}
