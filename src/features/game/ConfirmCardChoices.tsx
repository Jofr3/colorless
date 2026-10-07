import { DialogScrollArea } from "../../components/DialogScrollArea";
import { GLASS_NEUTRAL_BUTTON } from "../../lib/glass";
import { CardChoice, cardChoiceGridClass } from "./CardChoice";

export interface ConfirmCardChoice {
  name: string;
  cardId: string;
  hasImage: boolean;
  yes: boolean;
}

/** A card click immediately answers the binary prompt. */
export function ConfirmCardChoices({
  cards,
  noLabel,
  onAnswer,
}: {
  cards: ConfirmCardChoice[];
  noLabel: string;
  onAnswer: (yes: boolean) => void;
}) {
  return (
    <>
      <DialogScrollArea contentClassName={cardChoiceGridClass(cards.length)} trackInset={20}>
        {cards.map((card) => (
          <CardChoice
            key={String(card.yes)}
            name={card.name}
            cardId={card.cardId}
            hasImage={card.hasImage}
            selected={false}
            refused={false}
            onSelect={() => onAnswer(card.yes)}
          />
        ))}
      </DialogScrollArea>
      {!cards.some((card) => !card.yes) && (
        <div className="mt-5 flex justify-end">
          <button type="button" className={GLASS_NEUTRAL_BUTTON} onClick={() => onAnswer(false)}>
            {noLabel}
          </button>
        </div>
      )}
    </>
  );
}
