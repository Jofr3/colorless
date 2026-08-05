// THE REDUCED-MOTION SWEEP (D217) — the measure that says whether the app-wide
// `prefers-reduced-motion` story is actually finished, kept as a TEST rather
// than as the throwaway script D214 wrote and did not commit.
//
// WHY IT EXISTS. D90 recorded that "the reduced-motion story is now complete
// app-wide". It was complete for the seven `lib/glass.ts` constants only. D214
// swept for real and found 66 unguarded class contexts; D217 found four more
// D214's own regex could not see (below) and closed all of them. Every one of
// those numbers came from a script that lived in a scratch directory, so nobody
// after D214 could re-derive them. This file is that script, committed, so the
// number is a command instead of a claim — and so the NEXT unguarded
// `transition-*` fails CI instead of waiting for a fourth audit.
//
// WHAT IT MEASURES. Every "class context" in `src/**` — a `className=` attribute
// or a `const NAME = <string|template>` declaration, brace/quote balanced —
// that carries a transition utility of its own. A context passes only if it also
// carries `motion-reduce:transition-none`. A context that merely INTERPOLATES a
// shared constant (`${GLASS_ACCENT_BUTTON}`) has no transition of its own and is
// not flagged: the guard is checked where D90 put it, on the constant, which is
// itself one of these contexts.
//
// ⚠️ THE `transition` / `transition-` DISTINCTION, which D214's regex got wrong.
// Tailwind has BOTH a bare `transition` utility and `transition-<property>`.
// D214 matched only the second, so four contexts were invisible to it and its
// "54 remaining" was really 58 — including `DeckPanel`'s tooltip, whose bare
// `transition` drives a `scale-95 → scale-100` hover animation, i.e. the single
// most motion-y thing in the whole set. Both spellings are matched here.
//
// ⚠️ AND THE PARSER ITSELF SHIPPED A BLIND SPOT, WHICH D219 FOUND BY MUTATING IT.
// The first cut counted braces and, on a template's `${`, handed counting back to
// the brace loop without ever counting that `{` — so a context closed on the
// INTERPOLATION's `}` and every class written after it was unread. Both this
// file's assertions went quiet on it: the sweep saw a truncated string, and the
// orphan back-stop below is line-range based, so the truncated context still
// covered the line. `` className={`${SHARED} transition-…`} `` is the commonest
// class shape here, so the promise above did not hold for it. `spanEnd` is now a
// nesting STACK, and the two fixtures at the bottom of this file pin the shape.
//
// ⚠️ NOT COVERED, STATED. This reads Tailwind CLASS STRINGS. It cannot see a
// transition set from JavaScript — `components/useTiltJuice.ts`'s `TILT_STYLE`
// carries `transition: "transform 140ms …"` as an inline style, and the
// `animate-*` utilities need `motion-reduce:animate-none`, not
// `transition-none`. Those are real and separately owned; see polish.md.
//
// WHAT TURNS EACH ASSERTION RED:
//   * "no unguarded contexts" — deleting a `motion-reduce:transition-none` from
//     any constant or call site in `src/**`, or adding a new `transition-*` /
//     `transition` class without one. Verified by mutation, see the slice notes.
//   * "the parser still sees the app" — the parser silently matching nothing
//     (a rename, a refactor to `clsx()`, a bad regex). Without this, an empty
//     result set would make the first assertion pass VACUOUSLY, which is the
//     failure mode D213's Stadium test shipped with.
//   * "every transition line lies inside a parsed context" — a transition that
//     lives somewhere the parser does not look (a class string built by a
//     helper function, a ternary `const`). Catches under-counting, which is
//     exactly how 66 got reported as 1 and then 58 as 54.
//   * the fixture cases — the detector losing the ability to say RED at all
//     (over-broad guard matching, a lookbehind that swallows real hits).

import { describe, expect, it } from "vitest";

// The whole of `src/**` as raw text, read through Vite's own module graph
// (`?raw`) rather than node:fs — the app tsconfig ships only `vite/client`
// types, and a sweep is not a reason to put node's globals into the browser
// build's type environment.
const RAW = import.meta.glob("../**/*.{ts,tsx}", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

/** The guard D90 standardised on. */
const GUARD = "motion-reduce:transition-none";

/** A transition utility a context OWNS: bare `transition` or
    `transition-<property>`, excluding `transition-none` (which is the guard's
    own value, not a transition) and anything variant-prefixed such as
    `motion-reduce:transition-none` or `hover:transition-all` — a prefixed token
    is matched separately below, since a `hover:transition-*` still animates. */
const OWN_TRANSITION =
  /(?<![\w-])transition(?![\w-])|(?<![\w-])transition-(?!none[\s"'`]|none$)[\w[\]/.%-]+/;

type Ctx = { file: string; line: number; kind: string; text: string };

function sourceFiles(): string[] {
  // Tests do not ship, and this file's own RED fixtures are deliberately
  // unguarded class strings — scanning them would make the sweep flag itself.
  return Object.keys(RAW)
    .filter((p) => !/\.(test|spec)\.tsx?$/.test(p))
    .sort();
}

const read = (file: string): string => RAW[file] ?? "";

/** The index one PAST the span that opens at `start`, which must be a `{`, a
    quote or a backtick.

    ⚠️ THIS IS A NESTING STACK AND NOT A BRACE COUNTER, WHICH IS THE BUG D219
    FOUND. The first cut counted braces and skipped quoted runs, and when a
    template hit `${` it handed counting back to the brace loop WITHOUT ever
    counting that `{` — so the interpolation's own `}` closed the whole context.
    `` className={`${SHARED} transition-opacity …`} `` therefore truncated at the
    interpolation, and every class written after it was invisible to the sweep
    AND to the orphan back-stop below (whose line ranges still covered the line).
    That is the single commonest shape in this codebase, so the file's central
    promise — the next unguarded `transition-*` fails CI — did not hold.

    A stack gets it right because the two modes nest arbitrarily: a brace can
    hold a template, a template can hold `${`, and that can hold another
    template. Backslash escapes are honoured inside strings and templates only;
    in brace mode a `\` is just a character. */
function spanEnd(src: string, start: number): number {
  const stack: string[] = [src[start] as string];
  let j = start + 1;
  while (j < src.length && stack.length > 0) {
    const top = stack[stack.length - 1];
    const c = src[j];
    if (c === "\\" && top !== "{") {
      j += 2;
      continue;
    }
    if (top === '"' || top === "'") {
      if (c === top) stack.pop();
    } else if (top === "`") {
      if (c === "`") stack.pop();
      else if (c === "$" && src[j + 1] === "{") {
        stack.push("{");
        j += 2;
        continue;
      }
    } else {
      // Brace mode: nested braces, and any string/template opens a new frame.
      if (c === "{") stack.push("{");
      else if (c === "}") stack.pop();
      else if (c === '"' || c === "'" || c === "`") stack.push(c);
    }
    j++;
  }
  return j;
}

/** Every class context in one source string, brace/quote balanced. */
function contextsIn(file: string, src: string): Ctx[] {
  const found: Ctx[] = [];
  const lineOf = (i: number) => src.slice(0, i).split("\n").length;

  for (const m of src.matchAll(/className=/g)) {
    const i = m.index + m[0].length;
    const open = src[i];
    const end = open === "{" || open === '"' || open === "'" ? spanEnd(src, i) : i;
    found.push({ file, line: lineOf(m.index), kind: "className", text: src.slice(m.index, end) });
  }

  for (const m of src.matchAll(/\bconst\s+([A-Za-z0-9_]+)\s*=\s*(`|"|')/g)) {
    // The quote itself is the last character the pattern consumed.
    const end = spanEnd(src, m.index + m[0].length - 1);
    found.push({
      file,
      line: lineOf(m.index),
      kind: `const ${m[1]}`,
      text: src.slice(m.index, end),
    });
  }
  return found;
}

function transitionContexts(): { all: Ctx[]; unguarded: Ctx[] } {
  const all: Ctx[] = [];
  for (const f of sourceFiles()) {
    for (const c of contextsIn(f, read(f))) {
      if (OWN_TRANSITION.test(c.text)) all.push(c);
    }
  }
  return { all, unguarded: all.filter((c) => !c.text.includes(GUARD)) };
}

const rel = (c: Ctx) => `${c.file.replace(/^\.\.\//, "")}:${c.line} (${c.kind})`;

/** Does this line carry a transition utility INSIDE a quoted span? Quoted is
    what makes it a class string rather than prose, an object key or a
    `.style.transition` write. */
function quotedTransitionOn(line: string): boolean {
  const bare = line.trim();
  // A whole-line comment is prose. It must be skipped BEFORE quote scanning,
  // because an English apostrophe ("the tilt's 140ms transition") opens a span
  // that never closes and would read as a string.
  if (bare.startsWith("//") || bare.startsWith("*") || bare.startsWith("/*")) return false;
  let quote: string | null = null;
  let start = 0;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote === null) {
      if (c === '"' || c === "'" || c === "`") {
        quote = c;
        start = i + 1;
      }
    } else if (c === "\\") {
      i++;
    } else if (c === quote) {
      // Only CLOSED spans count — an unterminated one is either an apostrophe
      // in a trailing comment or the head of a multi-line template, and the
      // template's `const` declaration is already a parsed context.
      if (OWN_TRANSITION.test(line.slice(start, i))) return true;
      quote = null;
    }
  }
  return false;
}

describe("every transition in src/** honours prefers-reduced-motion (D217)", () => {
  const { all, unguarded } = transitionContexts();

  it("the parser still sees the app — the anti-vacuity floor", () => {
    // If a refactor moves class strings somewhere this parser cannot read, the
    // "no unguarded contexts" assertion below would pass on an EMPTY list and
    // say nothing. It found 63 the day it was written; the floor is deliberately
    // slack (a real deletion of half the app's transitions is a code review, not
    // a test failure) but non-zero.
    expect(all.length).toBeGreaterThanOrEqual(40);
  });

  it("no class context carries a transition without the guard", () => {
    expect(unguarded.map(rel)).toEqual([]);
  });

  it("every transition IN A STRING lies inside a context the parser read", () => {
    // Under-counting is this audit's historical failure: 66 was reported as 1,
    // and 58 as 54. A transition token that sits in a string literal the parser
    // never looked at is a blind spot — a class list built by a helper, a
    // ternary `const`, an array of variants. It would go unmeasured and unfixed.
    //
    // The token must be INSIDE a quoted span to count. That is what separates a
    // class string from the three things that legitimately say "transition" in
    // code: prose in a comment ("the transition that matters is short →
    // satisfied"), an object key (`useTiltJuice`'s inline `transition:` style),
    // and a DOM property write (`el.style.transition = "none"`). None of those
    // is a Tailwind utility and none can be fixed by appending a class.
    const ranges = new Map<string, [number, number][]>();
    for (const f of sourceFiles()) {
      const src = read(f);
      ranges.set(
        f,
        contextsIn(f, src).map((c) => [c.line, c.line + c.text.split("\n").length - 1]),
      );
    }
    const orphans: string[] = [];
    for (const f of sourceFiles()) {
      read(f)
        .split("\n")
        .forEach((line: string, i: number) => {
          if (!quotedTransitionOn(line)) return;
          const n = i + 1;
          if (!(ranges.get(f) ?? []).some(([a, b]) => a <= n && n <= b)) {
            orphans.push(`${f.replace(/^\.\.\//, "")}:${n}`);
          }
        });
    }
    expect(orphans).toEqual([]);
  });
});

describe("the sweep can still say RED (D217)", () => {
  const scan = (src: string) =>
    contextsIn("fixture.tsx", src).filter((c) => OWN_TRANSITION.test(c.text));
  const unguardedIn = (src: string) => scan(src).filter((c) => !c.text.includes(GUARD)).length;

  it("reports an unguarded transition-<property>", () => {
    expect(unguardedIn('<b className="rounded transition-colors hover:bg-white/10" />')).toBe(1);
  });

  it("reports an unguarded BARE transition — the spelling D214's regex missed", () => {
    expect(
      unguardedIn('<b className="scale-95 transition duration-150 group-hover:scale-100" />'),
    ).toBe(1);
  });

  it("reports an unguarded transition inside a const declaration", () => {
    expect(unguardedIn('const ROW = "rounded transition-all active:scale-95";')).toBe(1);
  });

  it("reports a variant-PREFIXED transition, which still animates", () => {
    expect(unguardedIn('<b className="hover:transition-all" />')).toBe(1);
  });

  it("accepts a guarded transition", () => {
    expect(unguardedIn(`<b className="transition-colors ${GUARD}" />`)).toBe(0);
  });

  it("does not treat the guard's own transition-none as a transition to guard", () => {
    // Without this the guard would be self-satisfying: `transition-none` would
    // count as a transition, and appending the guard would add another one.
    expect(scan('<b className="transition-none" />')).toEqual([]);
    expect(scan(`<b className="${GUARD}" />`)).toEqual([]);
  });

  it("⚠️ reports a transition written AFTER an interpolation — D219's blind spot", () => {
    // THE REGRESSION THIS FILE SHIPPED WITH. The first parser closed the context
    // on the interpolation's own `}` (see `spanEnd`), so everything after `${…}`
    // was unread — and `` className={`${SHARED} transition-…`} `` is the commonest
    // class shape in this codebase. Both assertions matter: the first is the shape
    // that was invisible, the second is the same list without the interpolation,
    // which the broken parser DID flag. Only the pair says the fix is the
    // interpolation and not the utility.
    expect(
      unguardedIn(
        "<b className={`${ROW} font-medium transition-opacity duration-150 hover:opacity-50`} />",
      ),
    ).toBe(1);
    expect(
      unguardedIn(
        '<b className={"font-medium transition-opacity duration-150 hover:opacity-50"} />',
      ),
    ).toBe(1);
  });

  it("reads THROUGH a nested template inside an interpolation", () => {
    // The reason `spanEnd` carries a stack rather than a mode flag: a ternary
    // inside `${…}` can open a second template, and a counter that treated the
    // inner backtick as the outer one's close would resume brace-counting inside
    // a string. RED if the guard on the OUTER list stops being read.
    expect(
      unguardedIn("<b className={`${on ? `bg-white` : ``} transition-colors`} />"),
    ).toBe(1);
    expect(
      unguardedIn(`<b className={\`\${on ? \`bg-white\` : \`\`} transition-colors ${GUARD}\`} />`),
    ).toBe(0);
  });

  it("does not flag a context that only interpolates a shared constant", () => {
    // D90's placement: the guard lives on the constant, so the read site is
    // clean. Flagging read sites would have re-litigated D89 vs D90.
    expect(scan("<b className={`rounded-full ${GLASS_ACCENT_BUTTON}`} />")).toEqual([]);
  });
});
