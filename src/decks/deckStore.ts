import { DECK_SIZE } from "@colorless/engine/rules";
import type { Deck as SavedDeck } from "@colorless/schema";
import * as api from "../lib/api";
import { type DeckVerdict, judgeDecks } from "../game/sandboxDecks";
import type { AccountStatus } from "../lua/account";
import type { Deck } from "./data";

/** One user's deck list as the store last had it. */
export interface DeckList {
  readonly user: string;
  /** Moves whenever the list's contents change, by a fetch or a write. */
  readonly revision: number;
  /** Sorted by `position`, as GET /decks serves them. */
  readonly decks: readonly Deck[];
}

/** The library, the sandbox picker and the online picker share one copy of the signed-in user's
 * decks: screens publish the list they find here at once and revalidate it (one GET /decks in
 * flight for all of them), and deck writes patch it with the server's answer. Each revision's
 * verdicts (playable, legal, ...) are judged once for every screen. */
class DeckStore {
  private user = "";
  private list: DeckList | undefined;
  private signature = "";
  private revision = 0;
  /** Moves on every write and user change: a fetch sent before one is not shared after it, and
   * its answer does not land. */
  private writes = 0;
  private fetching: { writes: number; promise: Promise<DeckList> } | undefined;
  private judged: { revision: number; verdicts: Map<string, DeckVerdict> } | undefined;
  private judging: { revision: number; promise: Promise<Map<string, DeckVerdict>> } | undefined;

  /** Follows the signed-in user ("" when signed out): another user's list is dropped. */
  session(user: string) {
    if (user === this.user) return;
    this.user = user;
    this.list = undefined;
    this.signature = "";
    this.judged = undefined;
    this.judging = undefined;
    this.fetching = undefined;
    this.writes++;
  }

  /** Follows the account: a sign-out drops the list, and a signed-in user's first fetch starts
   * at once. A session check still loading or unable to reach the server changes nothing. */
  follow(status: AccountStatus, userId: string) {
    if (status === "anonymous") this.session("");
    if (status !== "authenticated") return;
    this.session(userId);
    this.prefetch(userId);
  }

  /** The list last held for `user`, without a request. */
  peek(user: string): DeckList | undefined {
    return this.list?.user === user && user !== "" ? this.list : undefined;
  }

  /** The verdicts already judged for `list`, without a request. */
  peekVerdicts(list: DeckList): Map<string, DeckVerdict> | undefined {
    return this.judged?.revision === list.revision && this.list?.user === list.user
      ? this.judged.verdicts
      : undefined;
  }

  /** Asks the server for `user`'s decks. A request already in flight for them answers instead,
   * unless a write came after it; then it is asked again, and the older answer is dropped. */
  revalidate(user: string): Promise<DeckList> {
    this.session(user);
    const writes = this.writes;
    if (this.fetching?.writes === writes) return this.fetching.promise;
    const promise = api.listDecks().then((decks): DeckList => {
      if (this.fetching?.promise === promise) this.fetching = undefined;
      if (writes !== this.writes) return this.list ?? { user, revision: this.revision, decks };
      this.replace(user, decks);
      return this.list as DeckList;
    });
    promise.catch(() => {
      if (this.fetching?.promise === promise) this.fetching = undefined;
    });
    this.fetching = { writes, promise };
    return promise;
  }

  /** Starts the first fetch for a user who just signed in, so a page opened from a link need not
   * wait for it after the game boots. Failures are left to the page that asks next. */
  prefetch(user: string) {
    if (user === "" || this.peek(user) || (this.user === user && this.fetching)) return;
    this.revalidate(user).catch(() => {});
  }

  /** The verdicts on `list`'s complete decks, judged once per revision; a failed judgement is
   * not kept. */
  judge(list: DeckList): Promise<Map<string, DeckVerdict>> {
    const known = this.peekVerdicts(list);
    if (known) return Promise.resolve(known);
    if (this.judging?.revision === list.revision && this.list?.user === list.user)
      return this.judging.promise;
    const user = list.user;
    // A judgement of an older revision still answers its own list; only a new user stops it.
    const promise = judgeDecks([...list.decks], () => this.user === user).then((verdicts) => {
      if (this.list?.revision === list.revision && this.user === user)
        this.judged = { revision: list.revision, verdicts };
      return verdicts;
    });
    const judging = { revision: list.revision, promise };
    this.judging = judging;
    const clear = () => {
      if (this.judging === judging) this.judging = undefined;
    };
    promise.then(clear, clear);
    return promise;
  }

  /** A deck the server just created or saved (its answer to POST or PATCH /decks), applied to
   * `user`'s list without a request. The builder calls this after a save. */
  put(user: string, deck: SavedDeck) {
    const list = this.peek(user);
    if (!list) return;
    const cardCount = deck.cards.reduce((sum, entry) => sum + entry.count, 0);
    const old = list.decks.find((d) => d.id === deck.id);
    const row: Deck = {
      id: deck.id,
      name: deck.name,
      format: deck.format,
      folderId: deck.folderId,
      cardCount,
      // GET /decks lists the cards of a complete deck only.
      cards: cardCount === DECK_SIZE ? deck.cards : undefined,
      tint: deck.tint,
      // The drawn cover is resolved by the server on read; the next fetch brings a new one.
      coverCardId: old?.coverCardId ?? null,
      position: deck.position,
      updated: deck.updated,
    };
    const decks = [...list.decks.filter((d) => d.id !== deck.id), row].sort(
      (a, b) => a.position - b.position,
    );
    this.writes++;
    this.replace(user, decks);
  }

  /** A deck the server just deleted, dropped from `user`'s list. */
  remove(user: string, id: string) {
    const list = this.peek(user);
    if (!list) return;
    this.writes++;
    this.replace(
      user,
      list.decks.filter((d) => d.id !== id),
    );
  }

  /** Forgets everything: between test cases. */
  reset() {
    this.session("");
    this.revision = 0;
  }

  private replace(user: string, decks: readonly Deck[]) {
    const signature = JSON.stringify(decks);
    if (this.list?.user === user && signature === this.signature) return;
    this.signature = signature;
    this.list = { user, revision: ++this.revision, decks };
  }
}

export const deckStore = new DeckStore();
