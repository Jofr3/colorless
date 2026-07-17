// The first sliver of M4's effect-op system: derive executable steps from
// printed attack text. Deliberately CONSERVATIVE — only a handful of exact,
// whole-effect sentence shapes (verified against real catalog rows) derive;
// everything else returns null and stays on the loud ATTACK_EFFECT_SKIPPED
// path (simulator.md coverage strategy: apply what is understood completely,
// flag the rest rather than guess). Execution lives in attack.ts — this
// module is pure text → steps.

/** One derived effect operation. The M4 system grows this union; M3 only
    needs the Special-Condition slice (§12) plus the self-heal and coin-flip
    gate that ride along on the same sentences. */
export type EffectStep =
  | {
      op: "applyStatus";
      target: "defender" | "self";
      status: "asleep" | "paralyzed" | "confused" | "burned" | "poisoned";
      /** Only for "poisoned": HP placed per Checkup when the text raises it
          above the default 10 ("put N damage counters … instead of 1"). */
      poisonDamage?: number;
    }
  | { op: "heal"; target: "self"; amount: number }
  /** "Flip a coin. If heads, …" — `then` runs on heads only. */
  | { op: "coinFlipGate"; then: EffectStep[] };

type StatusWord = "Asleep" | "Burned" | "Confused" | "Paralyzed" | "Poisoned";

const STATUS_OF_WORD: Record<
  StatusWord,
  "asleep" | "burned" | "confused" | "paralyzed" | "poisoned"
> = {
  Asleep: "asleep",
  Burned: "burned",
  Confused: "confused",
  Paralyzed: "paralyzed",
  Poisoned: "poisoned",
};

// The five recognized sentence shapes, anchored end to end and compiled once
// (no /g flag — exec is stateless, so module scope is safe). Catalog rows use
// the straight apostrophe ("opponent's"); the character class also admits
// the typographic one so a re-ingest changing only punctuation cannot
// silently un-derive every status attack. {X} = the five status words;
// {N} = a positive integer.
const STATUS_WORDS = "Asleep|Burned|Confused|Paralyzed|Poisoned";
// SELF-inflicted statuses deliberately EXCLUDE Paralyzed. Official timing
// (ptcg-rules.md §12/§13.4): paralysis recovers at the Checkup after its
// owner's next turn — only if it was Paralyzed since the BEGINNING of that
// turn. Paralysis applied by the owner's own attack (i.e. at their own
// turn's end) must therefore SURVIVE the immediately-following Checkup, but
// the engine's §13.4 clear is unconditional for the ended seat (correct for
// every opponent-inflicted case). Until the condition carries an
// applied-this-turn stamp, self-paralyzing text derives to null and stays on
// the loud ATTACK_EFFECT_SKIPPED path.
const SELF_STATUS_WORDS = "Asleep|Burned|Confused|Poisoned";
const DEFENDER_NOW = new RegExp(`^Your opponent['’]s Active Pokémon is now (${STATUS_WORDS})\\.$`);
const FLIP_DEFENDER_NOW = new RegExp(
  `^Flip a coin\\. If heads, your opponent['’]s Active Pokémon is now (${STATUS_WORDS})\\.$`,
);
const SELF_NOW = new RegExp(`^This Pokémon is now (${SELF_STATUS_WORDS})\\.$`);
const SELF_SLEEP_HEAL = /^This Pokémon is now Asleep\. Heal (\d+) damage from it\.$/;
const DEFENDER_POISON_N =
  /^Your opponent['’]s Active Pokémon is now Poisoned\. During Pokémon Checkup, put (\d+) damage counters on that Pokémon instead of 1\.$/;

/** Parse printed attack text into executable steps, or null when the text is
    ANYTHING but one of the five recognized whole sentences (leading/trailing
    whitespace excepted) — null keeps the attack on the skipped-effect path. */
export function deriveAttackEffect(text: string): EffectStep[] | null {
  const effect = text.trim();

  // 1. "Your opponent's Active Pokémon is now {X}."
  let match = DEFENDER_NOW.exec(effect);
  if (match !== null) {
    return [{ op: "applyStatus", target: "defender", status: statusOf(match[1]) }];
  }

  // 2. "Flip a coin. If heads, your opponent's Active Pokémon is now {X}."
  match = FLIP_DEFENDER_NOW.exec(effect);
  if (match !== null) {
    return [
      {
        op: "coinFlipGate",
        // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
        then: [{ op: "applyStatus", target: "defender", status: statusOf(match[1]) }],
      },
    ];
  }

  // 3. "This Pokémon is now {X}." — {X} excludes Paralyzed (see
  //    SELF_STATUS_WORDS: the §13.4 self-paralysis timing gap).
  match = SELF_NOW.exec(effect);
  if (match !== null) {
    return [{ op: "applyStatus", target: "self", status: statusOf(match[1]) }];
  }

  // 4. "This Pokémon is now Asleep. Heal {N} damage from it."
  match = SELF_SLEEP_HEAL.exec(effect);
  if (match !== null) {
    return [
      { op: "applyStatus", target: "self", status: "asleep" },
      { op: "heal", target: "self", amount: Number(match[1]) },
    ];
  }

  // 5. "Your opponent's Active Pokémon is now Poisoned. During Pokémon
  //    Checkup, put {N} damage counters on that Pokémon instead of 1."
  match = DEFENDER_POISON_N.exec(effect);
  if (match !== null) {
    // Counters → HP (one counter = 10, §12).
    return [
      {
        op: "applyStatus",
        target: "defender",
        status: "poisoned",
        poisonDamage: Number(match[1]) * 10,
      },
    ];
  }

  return null;
}

/** The matched status word, lowercased into the event vocabulary. The regex
    alternation guarantees the word; the fallback only satisfies
    noUncheckedIndexedAccess. */
function statusOf(
  word: string | undefined,
): "asleep" | "burned" | "confused" | "paralyzed" | "poisoned" {
  return STATUS_OF_WORD[(word ?? "Asleep") as StatusWord];
}
