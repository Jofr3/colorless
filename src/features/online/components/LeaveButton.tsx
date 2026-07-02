import { ArrowLeftIcon } from "../../../components/icons";
import { GLASS_HUD_BUTTON } from "../../../lib/glass";

// Corner "leave the lobby" control anchored to the top-left of the viewport —
// the mirror of the top-right HomeButton, so the two read as a matched pair (and
// it echoes the playmat's back button). A pill rather than a round icon since it
// carries a text label.
export function LeaveButton({ label = "Leave", onClick }: { label?: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`fixed left-3 top-3 z-50 flex h-10 cursor-pointer items-center gap-1.5 rounded-full pl-3 pr-4 text-sm font-medium ${GLASS_HUD_BUTTON}`}
    >
      <ArrowLeftIcon className="h-4 w-4" />
      {label}
    </button>
  );
}
