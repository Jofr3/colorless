import { Link } from "react-router-dom";
import { HomeIcon } from "./icons";

// Round home button anchored to the top-right of the viewport. A mirror of the
// bottom-right SettingsButton — same size, glass styling, and inset — so the
// two read as a matched pair of opposite-corner controls.
export function HomeButton() {
  return (
    <Link
      to="/"
      aria-label="Home"
      className="fixed right-3 top-3 z-50 flex h-10 w-10 cursor-pointer items-center justify-center rounded-full bg-white/[0.045] text-white/70 shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_4px_18px_rgba(0,0,0,0.32)] ring-1 ring-inset ring-white/9 backdrop-blur-md transition-all hover:bg-white/[0.06] hover:text-white/85 active:scale-95 focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300"
    >
      <HomeIcon className="h-[18px] w-[18px]" />
    </Link>
  );
}
