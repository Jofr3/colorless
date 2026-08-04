import type { RefObject } from "react";
import { GLASS_GHOST_BUTTON } from "../../lib/glass";
import type { Folder } from "./data";
import type { NestTarget } from "./useKeyboardMove";

// Compact pills for the keyboard move-mode banner (Drop / Cancel / nest targets).
const MOVE_ACTION_CLASS = `inline-flex cursor-pointer items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${GLASS_GHOST_BUTTON}`;
const MOVE_PRIMARY_CLASS =
  "inline-flex cursor-pointer items-center gap-1 rounded-full bg-accent/80 px-2.5 py-1 text-xs font-semibold text-zinc-950 ring-1 ring-inset ring-white backdrop-blur-md transition-all motion-reduce:transition-none hover:bg-accent/90 active:scale-95 focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/50";

/** The keyboard move-mode toolbar: names the tile being moved, hints the reorder
    keys, and offers Drop / Cancel plus nest targets (up a level + each valid
    in-view folder). Rendered only while a move is in progress. */
export function MoveBanner({
  movingName,
  upTarget,
  nestFolders,
  dropButtonRef,
  onDrop,
  onCancel,
  onNest,
}: {
  movingName: string;
  upTarget: NestTarget | null;
  nestFolders: Folder[];
  dropButtonRef: RefObject<HTMLButtonElement | null>;
  onDrop: () => void;
  onCancel: () => void;
  onNest: (folderId: string | null, label: string) => void;
}) {
  return (
    <div className="mt-3 flex shrink-0 flex-wrap items-center gap-2 rounded-xl bg-accent/10 px-3 py-2 text-sm ring-1 ring-inset ring-accent/40">
      <span className="text-white/80">
        Moving <span className="font-semibold text-white">{movingName}</span>
      </span>
      <span aria-hidden className="text-white/45">
        · ← → reorder
      </span>
      <div className="ml-auto flex flex-wrap items-center gap-1.5">
        <button ref={dropButtonRef} type="button" onClick={onDrop} className={MOVE_PRIMARY_CLASS}>
          Drop here
        </button>
        <button type="button" onClick={onCancel} className={MOVE_ACTION_CLASS}>
          Cancel
        </button>
        {upTarget && (
          <button
            type="button"
            onClick={() => onNest(upTarget.folderId, upTarget.label)}
            className={MOVE_ACTION_CLASS}
          >
            Move to {upTarget.label}
          </button>
        )}
        {nestFolders.map((folder) => (
          <button
            key={folder.id}
            type="button"
            onClick={() => onNest(folder.id, folder.name)}
            className={MOVE_ACTION_CLASS}
          >
            Into {folder.name}
          </button>
        ))}
      </div>
    </div>
  );
}
