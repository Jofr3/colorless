import { Link } from "react-router-dom";
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
      className="fixed bottom-3 right-3 z-50 flex h-10 w-10 cursor-pointer items-center justify-center rounded-full bg-white/[0.045] text-white/70 shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_4px_18px_rgba(0,0,0,0.32)] ring-1 ring-inset ring-white/9 backdrop-blur-md transition-all hover:bg-white/[0.06] hover:text-white/85 active:scale-95 focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/50"
    >
      <SettingsIcon className="h-[18px] w-[18px]" />
    </Link>
  );
}
