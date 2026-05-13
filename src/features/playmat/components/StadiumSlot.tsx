import type { CardModel } from "../types";
import { CardSlot, EmptyCardSpace, PlaymatCard } from "./Card";

export function StadiumSlot({ card }: { card: CardModel | null }) {
  return (
    <div
      className="relative"
      data-card-drop-zone="true"
      data-card-owner="global"
      data-card-zone="stadium"
    >
      <CardSlot>{card ? <PlaymatCard card={card} priority /> : <EmptyCardSpace />}</CardSlot>
    </div>
  );
}
