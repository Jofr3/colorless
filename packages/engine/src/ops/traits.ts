import type { EffectOp, EffectSlot, OpOf } from "../effectTypes";

export type OpName = EffectOp["op"];

type RecordSlot<K extends OpName> =
  | (K extends unknown ? ("recordAs" extends keyof OpOf<K> ? "recordAs" : never) : never)
  | { readonly fixed: EffectSlot };

type OpTraits<K extends OpName> = {
  /**
   * `true`: the op can park, and `answerOp` answers it. `false`: running it never parks.
   * `"indirectly"`: `answerOp` never answers it, but a program running it can still park. The
   * gates splice their branches, a coin flip parks a Backtrack Badge offer before its branch, some
   * ops schedule ops that park, and the copy-attack and attack-coin offers are parked and answered
   * by attack.ts.
   */
  readonly parks: boolean | "indirectly";
  /**
   * The slot a parking op files its answer under, so its park note can state what the answer
   * buys. `"recordAs"` reads the op's own field. Omitting it is silent: `withConsequence` drops
   * the clause.
   */
  readonly recordSlot?: RecordSlot<K>;
  /**
   * Moves damage counters between Pokémon, which Patrat "Watchful Eye" blocks. An in-place swap
   * that keeps counters on the body moves none.
   */
  readonly movesCounters?: true;
  /** `programPlayable` refuses the card when this op can only whiff, by its check in cardplay.ts. */
  readonly playable?: true;
};

/** Every op's traits, read by the op-generic sites instead of hand-kept lists of op names. */
export const OP_TRAITS = {
  applyStatus: { parks: false },
  attachEnergyFrom: { parks: true },
  attachFromDeck: { parks: true, recordSlot: "recordAs" },
  attachFromDiscard: { parks: true, playable: true },
  attachFromHand: { parks: true, recordSlot: "recordAs", playable: true },
  attachFromTop: { parks: true },
  boostAttack: { parks: false },
  boostSideAttacksThisTurn: { parks: false },
  bottomDeckTop: { parks: false },
  bottomFromOpponentHand: { parks: true, recordSlot: "recordAs", playable: true },
  bountyDefender: { parks: false },
  bountyThisAttack: { parks: false },
  chooseOneOffered: { parks: "indirectly", playable: true },
  clearStatus: { parks: false },
  coinFlipGate: { parks: "indirectly" },
  conditionGate: { parks: false },
  counterEachAll: { parks: false },
  counterUntilRemainingHp: { parks: false },
  countersOnRecordedBody: { parks: false },
  cycleOwnPrizes: { parks: false },
  damageActive: { parks: false },
  damageChosen: { parks: true, playable: true },
  damageDefender: { parks: false },
  damageNewActive: { parks: false },
  damageSelf: { parks: false },
  damageSubject: { parks: false },
  devolveChosen: { parks: true, playable: true },
  devolveEach: { parks: false },
  discardDeckBottom: { parks: false },
  discardDeckTop: { parks: false },
  discardDefender: { parks: false },
  discardEnergy: { parks: true, recordSlot: "recordAs", playable: true },
  discardFromOpponentHand: { parks: false },
  discardHand: { parks: false },
  discardPileRetrieval: { parks: true, recordSlot: "recordAs" },
  discardStadium: { parks: false },
  discardToolAndSpecialEnergyChosen: { parks: true, playable: true },
  // No `recordSlot` and no `recordAs`: no card pairs a Tool discard with an "If you do,"
  // consequent.
  discardTools: { parks: true, playable: true },
  drawCards: { parks: false },
  drawUntilHandSize: { parks: false },
  eachPlayerTakesPrize: { parks: false },
  evolveFromDeck: { parks: true, playable: true },
  evolveFromDeckChosen: { parks: true },
  evolveFromDeckEachBenched: { parks: "indirectly" },
  evolveFromDeckEachChosen: { parks: true },
  exposeDefender: { parks: false },
  exposeSelf: { parks: false },
  flipLockAttack: { parks: false },
  flipLockTrainerPlay: { parks: false },
  gust: { parks: true, recordSlot: "recordAs", playable: true },
  handRefresh: { parks: false },
  heal: { parks: false },
  healChosen: { parks: true, playable: true },
  healEach: { parks: false },
  healEachAll: { parks: false },
  healSubject: { parks: false },
  installChosenAttackShield: { parks: true },
  installNoWeakness: { parks: false },
  installRecoil: { parks: false },
  installSideAttackBlock: { parks: false },
  installSideDamageReductionNextTurn: { parks: false },
  knockOutChosen: { parks: true },
  knockOutDefender: { parks: false },
  knockOutEach: { parks: false },
  knockOutSelf: { parks: false },
  lockSideAttacks: { parks: false },
  lockSideRetreat: { parks: false },
  lookAtPrize: { parks: true },
  lookAtTopN: { parks: true },
  markHandAttach: { parks: false },
  moveCounterOwnChosen: { parks: true, movesCounters: true, playable: true },
  moveCountersChosen: { parks: true, movesCounters: true },
  moveCountersOpponentAnyWay: { parks: true, movesCounters: true },
  moveCountersToDefender: { parks: true, movesCounters: true },
  moveCountersToOpponentChosen: { parks: true, movesCounters: true, playable: true },
  moveEnergy: { parks: true, playable: true },
  opponentDiscardsFromHand: { parks: true },
  opponentGuessesHp: { parks: true, playable: true },
  opponentMayDraw: { parks: true },
  opponentSwitchOut: { parks: true, playable: true },
  optional: { parks: true },
  payFromHand: { parks: true, recordSlot: "recordAs" },
  preventAttack: { parks: false },
  preventAttackUse: { parks: false },
  preventChosenAttack: { parks: true },
  preventDamage: { parks: false },
  preventHandPlay: { parks: false },
  preventRetreat: { parks: false },
  putCountersOnSelfChosen: { parks: true, recordSlot: { fixed: "placed" } },
  // Records but takes no `recordSlot`; see `turnPrizeFaceUp`.
  randomFromOpponentHand: { parks: false },
  recordGate: { parks: false },
  recoverOneStatus: { parks: "indirectly" },
  reduceDamage: { parks: false },
  reflipAttackCoins: { parks: "indirectly" },
  reflipCoins: { parks: true },
  reorderTop: { parks: true },
  returnBenched: { parks: true, playable: true },
  returnBenchedChosen: { parks: true },
  returnBenchedRest: { parks: true },
  returnSelf: { parks: false },
  retypeDefenderWeakness: { parks: false },
  revealDeckBottomCount: { parks: false },
  revealFromHand: { parks: true, recordSlot: "recordAs" },
  revealOpponentHand: { parks: false },
  revealTopDiscardMatching: { parks: false },
  scheduleCounters: { parks: false },
  scheduleDiscard: { parks: false },
  scheduleEndOfTurnHandDiscard: { parks: false },
  scheduleKnockOut: { parks: false },
  searchDeck: { parks: true, recordSlot: "recordAs" },
  shuffleDeck: { parks: false },
  shufflePlayedCardIntoDeck: { parks: false },
  spreadDamage: { parks: false },
  swapTurnedPrizeWithRevealed: { parks: false },
  switchActive: { parks: true, recordSlot: "recordAs", playable: true },
  switchWithDeckChosen: { parks: true },
  switchWithDeckNamed: { parks: false },
  switchWithDiscardNamed: { parks: true, playable: true },
  takePrize: { parks: false },
  taxDefender: { parks: false },
  trimBench: { parks: true },
  trimTools: { parks: true },
  // `turnPrizeFaceUp` and `randomFromOpponentHand` record but take no `recordSlot`: their gates
  // wrap a second gate and an `optional` that `describeBranch` cannot phrase, and the switch is
  // asked by its own confirm.
  turnPrizeFaceUp: { parks: true },
  useAttackAs: { parks: "indirectly" },
  useFoundAttackAs: { parks: "indirectly" },
  useInPlayAttackAs: { parks: "indirectly" },
  useMilledSupporterEffect: { parks: "indirectly" },
  useOpponentSupporterEffect: { parks: true },
  weakenDefenderAttacks: { parks: false },
  winGame: { parks: false },
} as const satisfies { readonly [K in OpName]: OpTraits<K> };

type Traits = typeof OP_TRAITS;

/** The ops `answerOp` answers. */
export type ParkingOpName = {
  [K in OpName]: Traits[K]["parks"] extends true ? K : never;
}[OpName];

/** The ops `programPlayable` asks for a per-op whiff check. */
export type PlayableOpName = {
  [K in OpName]: Traits[K] extends { readonly playable: true } ? K : never;
}[OpName];

/**
 * The op's traits, or undefined for an op name this build does not know (a record written by
 * another engine version can carry one).
 */
export function traitsOf(op: { readonly op: string }): OpTraits<OpName> | undefined {
  return Object.hasOwn(OP_TRAITS, op.op) ? OP_TRAITS[op.op as OpName] : undefined;
}
