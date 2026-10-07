import type { CardModel } from "../types";
import { CardGalleryDialog } from "./CardGalleryDialog";

export function DiscardPileDialog(props: {
  title: string;
  cards: CardModel[];
  onDismiss: () => void;
}) {
  return (
    <CardGalleryDialog
      {...props}
      closeLabel="Close discard pile"
      emptyMessage="No discarded cards yet."
      newestFirst
      showHeading={false}
    />
  );
}
