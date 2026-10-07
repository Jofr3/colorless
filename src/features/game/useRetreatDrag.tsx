import { useEffect, useRef, useState } from "react";
import type { GameAction, Seat } from "@luminous/engine";
import { DialogScrollArea } from "../../components/DialogScrollArea";
import {
  GLASS_ACCENT_BUTTON,
  GLASS_DIALOG_GHOST_BUTTON,
  GLASS_DIALOG_PANEL,
} from "../../lib/glass";
import type { BoardState, CardModel, CardMoveRequest } from "../playmat/types";
import { CardChoice, cardChoiceDialogClass, cardChoiceGridClass } from "./CardChoice";
import { retreatDragIndex, type RetreatOption } from "./retreat";

export function useRetreatDrag({
  board,
  retreat,
  seat,
  dispatch,
}: {
  board: BoardState;
  retreat: RetreatOption | null;
  seat: Seat;
  dispatch: (action: GameAction) => void;
}) {
  // A new board snapshot invalidates an unfinished choice, including history navigation.
  const [pending, setPending] = useState<{ board: BoardState; index: number } | null>(null);
  const active = board.you.active;
  const current = pending?.board === board && retreat?.can ? pending : null;
  const promoted = current === null ? undefined : board.you.bench[current.index];
  const handleRetreatDrag = (request: CardMoveRequest): boolean => {
    const index = retreatDragIndex(board, request);
    if (index === null) return false;
    if (!retreat?.can || active === null) return true;
    const energies = active.attached?.energies ?? [];
    if (retreat.cost === 0 || energies.length === retreat.cost) {
      dispatch({
        type: "retreat",
        seat,
        promoteBenchIndex: index,
        discardEnergy: retreat.cost === 0 ? [] : energies.map((energy) => energy.id),
      });
    } else if (energies.length > retreat.cost) {
      setPending({ board, index });
    }
    return true;
  };
  return {
    handleRetreatDrag,
    retreatDialog:
      current !== null && active !== null && promoted !== undefined && retreat !== null ? (
        <RetreatEnergyDialog
          key={`${seat}:${active.id}:${current.index}:${retreat.cost}`}
          active={active}
          promoted={promoted}
          cost={retreat.cost}
          onClose={() => setPending(null)}
          onConfirm={(discardEnergy) => {
            dispatch({ type: "retreat", seat, promoteBenchIndex: current.index, discardEnergy });
            setPending(null);
          }}
        />
      ) : null,
  };
}

function RetreatEnergyDialog({
  active,
  promoted,
  cost,
  onClose,
  onConfirm,
}: {
  active: CardModel;
  promoted: CardModel;
  cost: number;
  onClose: () => void;
  onConfirm: (uids: string[]) => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [chosen, setChosen] = useState<string[]>([]);
  const energies = active.attached?.energies ?? [];
  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) {
      dialog.showModal();
      dialog.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true });
    }
  }, []);
  return (
    <dialog
      ref={dialogRef}
      aria-label="Choose retreat energy"
      onClose={onClose}
      className="leave-dialog m-auto border-0 bg-transparent p-0 text-white"
    >
      <div
        className={`game-choice-dialog ${cardChoiceDialogClass(energies.length)} ${GLASS_DIALOG_PANEL}`}
      >
        <h2 className="text-lg font-semibold text-white">Retreat {active.name}</h2>
        <p className="mt-1.5 text-sm text-white/55">
          Choose {cost} attached energ{cost === 1 ? "y" : "ies"} to discard ({chosen.length}/{cost}
          ). {promoted.name} will become Active.
        </p>
        <DialogScrollArea
          className="mt-2 min-h-0"
          contentClassName={cardChoiceGridClass(energies.length)}
        >
          {energies.map((energy) => (
            <CardChoice
              key={energy.id}
              name={energy.name}
              cardId={energy.cardId}
              hasImage={energy.imageUrl !== undefined}
              selected={chosen.includes(energy.id)}
              refused={!chosen.includes(energy.id) && chosen.length === cost}
              onSelect={() =>
                setChosen((previous) =>
                  previous.includes(energy.id)
                    ? previous.filter((uid) => uid !== energy.id)
                    : [...previous, energy.id],
                )
              }
            />
          ))}
        </DialogScrollArea>
        <div className="mt-5 flex justify-end gap-2.5">
          <button type="button" onClick={onClose} className={GLASS_DIALOG_GHOST_BUTTON}>
            Cancel
          </button>
          <button
            type="button"
            disabled={chosen.length !== cost}
            className={`cursor-pointer rounded-full px-4 py-2 text-sm font-semibold disabled:cursor-default disabled:opacity-40 ${GLASS_ACCENT_BUTTON}`}
            onClick={() => onConfirm(chosen)}
          >
            Retreat
          </button>
        </div>
      </div>
    </dialog>
  );
}
