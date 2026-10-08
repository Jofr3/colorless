import type { DiscardScope, PokemonRef, Seat } from "@luminous/engine";
import { type CSSProperties, useState } from "react";
import { CardImage } from "../../components/CardImage";
import { DialogScrollArea } from "../../components/DialogScrollArea";
import { CheckIcon } from "../../components/icons";
import { useTiltJuice } from "../../components/useTiltJuice";
import { FOCUS_RING_INSET } from "../../lib/glass";
import type { CardModel, PlayerBoard } from "../playmat/types";
import "./DiscardEnergyChoices.css";

export interface EnergyDiscardHost {
  key: string;
  label: string;
  card: CardModel;
  uids: string[];
}

/** Show Pokémon on the affected side only when they have attached Energy. */
export function energyDiscardHosts(
  board: Record<"you" | "opponent", Pick<PlayerBoard, "active" | "bench">>,
  viewerSeat: Seat,
  discardable: readonly { uid: string; from: PokemonRef }[],
): EnergyDiscardHost[] {
  return [...new Set(discardable.map(({ from }) => from.seat))].flatMap((seat) => {
    const side = seat === viewerSeat ? board.you : board.opponent;
    const hosts = [
      ...(side.active === null ? [] : [{ card: side.active, spot: "active", index: 0 }]),
      ...side.bench.map((card, index) => ({ card, spot: "bench", index })),
    ];
    return hosts
      .filter(({ card }) => (card.attached?.energies.length ?? 0) > 0)
      .map(({ card, spot, index }) => ({
        key: `${seat}-${spot}-${spot === "active" ? "active" : index}`,
        label: `${card.name} · ${spot === "active" ? "Active" : `Bench ${index + 1}`}${seat === viewerSeat ? "" : " · opponent"}`,
        card,
        uids: discardable
          .filter(
            ({ from }) =>
              from.seat === seat &&
              from.spot.spot === spot &&
              (from.spot.spot === "active" || from.spot.index === index),
          )
          .map(({ uid }) => uid),
      }));
  });
}

export function DiscardEnergyChoices({
  hosts,
  scope,
  picked,
  onPick,
}: {
  hosts: readonly EnergyDiscardHost[];
  scope: DiscardScope;
  picked: readonly string[];
  onPick: (groupUids: readonly string[], uid: string) => void;
}) {
  // Single-Energy offers collapse identical prints to one engine uid. Keep every
  // physical copy clickable, while sending the offered uid and highlighting only
  // the copy the player actually clicked.
  const [selectedCopies, setSelectedCopies] = useState<Record<string, string>>({});
  return (
    <DialogScrollArea as="div" contentClassName="discard-energy-choices" trackInset={12}>
      {hosts.map((host) => {
        const attached = host.card.attached?.energies ?? [];
        const energies: CardModel[] = [
          ...attached,
          ...host.uids
            .filter((uid) => !attached.some((energy) => energy.id === uid))
            .map((uid) => ({
              id: uid,
              cardId: uid,
              name: uid,
              type: "energy" as const,
            })),
        ];
        return (
          <fieldset
            key={host.key}
            className="discard-energy-host"
            style={
              { "--energy-columns": Math.max(1, Math.min(3, energies.length)) } as CSSProperties
            }
          >
            <legend className="sr-only">{host.label}</legend>
            <PokemonPreview card={host.card} />
            <ul className="discard-energy-host__energies">
              {energies.map((energy, index) => {
                const choiceUid = host.uids.includes(energy.id)
                  ? energy.id
                  : scope.kind === "each" || (scope.kind === "total" && scope.count === 1)
                    ? host.uids.find((uid) =>
                        attached.some((card) => card.id === uid && card.cardId === energy.cardId),
                      )
                    : undefined;
                const selected =
                  choiceUid !== undefined &&
                  picked.includes(choiceUid) &&
                  (selectedCopies[choiceUid] ?? choiceUid) === energy.id;
                const refused =
                  !selected &&
                  ((scope.kind === "total" && scope.count > 1 && picked.length >= scope.count) ||
                    (scope.kind === "upTo" && picked.length >= scope.max));
                return (
                  <li
                    key={energy.id}
                    className="discard-energy-host__energy"
                    style={{ "--energy-column": index % 3 } as CSSProperties}
                  >
                    <DiscardEnergyCard
                      energy={energy}
                      selected={selected}
                      refused={refused}
                      onSelect={
                        choiceUid === undefined
                          ? undefined
                          : () => {
                              setSelectedCopies((prev) => ({ ...prev, [choiceUid]: energy.id }));
                              if (selected || !picked.includes(choiceUid))
                                onPick(host.uids, choiceUid);
                            }
                      }
                    />
                  </li>
                );
              })}
            </ul>
          </fieldset>
        );
      })}
    </DialogScrollArea>
  );
}

function PokemonPreview({ card }: { card: CardModel }) {
  const { juiceLayerRef, juiceStyle } = useTiltJuice<HTMLDivElement>({
    idle: true,
    juiceOnMount: true,
  });
  return (
    <div className="discard-energy-host__pokemon">
      <div ref={juiceLayerRef} style={juiceStyle} className="discard-energy-host__motion">
        <div className="discard-energy-host__pokemon-surface">
          <CardImage
            fill
            priority
            imageUrl={card.imageUrl}
            alt={card.name}
            className="h-full w-full object-cover"
          />
        </div>
      </div>
    </div>
  );
}

function DiscardEnergyCard({
  energy,
  selected,
  refused,
  onSelect,
}: {
  energy: CardModel;
  selected: boolean;
  refused: boolean;
  onSelect?: () => void;
}) {
  const { tiltRef, juiceLayerRef, juiceStyle, tiltStyle, handlers } =
    useTiltJuice<HTMLButtonElement>({
      idle: true,
      juiceOnMount: true,
      disabled: refused || onSelect === undefined,
      pulse: selected ? 1 : null,
    });
  const art = (
    <CardImage
      fill
      priority
      imageUrl={energy.imageUrl}
      alt={energy.name}
      className="h-full w-full object-cover"
    />
  );
  return (
    <div ref={juiceLayerRef} style={juiceStyle} className="discard-energy-host__motion">
      {onSelect === undefined ? (
        <span
          className="discard-energy-host__unavailable"
          title={`${energy.name} cannot be discarded by this effect`}
        >
          {art}
          <span className="discard-energy-host__fallback">{energy.name}</span>
        </span>
      ) : (
        <button
          ref={tiltRef}
          style={tiltStyle}
          {...handlers}
          type="button"
          aria-label={energy.name}
          aria-pressed={selected}
          aria-disabled={refused || undefined}
          title={energy.name}
          onClick={() => {
            if (!refused) onSelect();
          }}
          className={`discard-energy-host__choice ${FOCUS_RING_INSET}`}
        >
          {art}
          <span className="discard-energy-host__fallback">{energy.name}</span>
          {selected && (
            <span className="discard-energy-host__check" aria-hidden>
              <CheckIcon className="h-4 w-4" />
            </span>
          )}
        </button>
      )}
    </div>
  );
}
