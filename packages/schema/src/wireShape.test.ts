import { describe, expect, it } from "vitest";
import * as z from "zod";
import { lobbyServerMessageSchema } from "./lobby/serverWire";
import { unsafeChanges, type WireShape, wireShape } from "./wireShape";
import snapshot from "./wireShape.snapshot.json";

const RECORD = "WIRE_SHAPE_WRITE=1 bunx vitest run packages/schema/src/wireShape.test.ts -u";
const env =
  (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
// One string per path, so the file is already in the formatter's layout.
const SEPARATOR = " | ";
const recorded: WireShape = Object.fromEntries(
  Object.entries(snapshot as Record<string, string>).map(([p, atoms]) => [
    p,
    atoms.split(SEPARATOR),
  ]),
);

describe("the server-to-client lobby wire", () => {
  it("changes only in ways a tab still running the recorded client survives", async () => {
    const current = wireShape(lobbyServerMessageSchema);
    if (env.WIRE_SHAPE_WRITE) {
      const lines = Object.entries(current).map(([p, atoms]) => [p, atoms.join(SEPARATOR)]);
      await expect(`${JSON.stringify(Object.fromEntries(lines), null, 2)}\n`).toMatchFileSnapshot(
        "./wireShape.snapshot.json",
      );
    }
    expect(
      unsafeChanges(recorded, current),
      `unsafe for open tabs: ship the client first (backend-data.md §3.7.1), recording the shape with ${RECORD}`,
    ).toEqual([]);
  });
});

describe("wireShape and unsafeChanges", () => {
  const frame = (reason: z.ZodType, extra: Record<string, z.ZodType> = {}) =>
    z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("reject"), reason, ...extra }),
      z.object({ kind: z.literal("match-error"), reason: z.string() }),
    ]);
  const base = wireShape(frame(z.enum(["full"]), { to: z.string() }));
  const changed = (schema: z.ZodType) => unsafeChanges(base, wireShape(schema));

  it("files a union's literal key at the union and each branch's fields under its value", () => {
    expect(base).toEqual({
      "frame.kind": ['="match-error"', '="reject"'],
      'frame{kind="match-error"}': ["object"],
      'frame{kind="match-error"}.kind': ['="match-error"'],
      'frame{kind="match-error"}.reason': ["string"],
      'frame{kind="reject"}': ["object"],
      'frame{kind="reject"}.kind': ['="reject"'],
      'frame{kind="reject"}.reason': ['="full"'],
      'frame{kind="reject"}.to': ["string"],
    });
  });

  it("fails a new literal, a new union kind, a gone key, a new type and a new absence", () => {
    expect(changed(frame(z.enum(["full", "kicked"]), { to: z.string() }))).toEqual([
      'frame{kind="reject"}.reason now carries ="kicked", which old clients have no arm for',
    ]);
    expect(
      unsafeChanges(
        base,
        wireShape(
          z.discriminatedUnion("kind", [
            z.object({ kind: z.literal("reject"), reason: z.enum(["full"]), to: z.string() }),
            z.object({ kind: z.literal("match-error"), reason: z.string() }),
            z.object({ kind: z.literal("nudge") }),
          ]),
        ),
      ),
    ).toEqual(['frame.kind now carries ="nudge", which old clients have no arm for']);
    expect(changed(frame(z.enum(["full"])))).toEqual([
      'frame{kind="reject"}.to is gone, and old clients read it',
    ]);
    expect(changed(frame(z.enum(["full"]), { to: z.number() }))).toEqual([
      'frame{kind="reject"}.to now carries number, which old clients have no arm for',
    ]);
    expect(changed(frame(z.enum(["full"]), { to: z.string().nullable() }))).toEqual([
      'frame{kind="reject"}.to now carries null, which old clients have no arm for',
    ]);
    expect(changed(frame(z.enum(["full"]), { to: z.string().optional() }))).toEqual([
      'frame{kind="reject"}.to may now be missing, and old clients read it',
    ]);
    expect(changed(frame(z.string(), { to: z.string() }))).toEqual([
      'frame{kind="reject"}.reason now carries string, which old clients have no arm for',
    ]);
  });

  it("passes a new key and a dropped literal", () => {
    expect(changed(frame(z.enum(["full"]), { to: z.string(), extra: z.number() }))).toEqual([]);
    const wider = wireShape(frame(z.enum(["full", "kicked"]), { to: z.string() }));
    expect(unsafeChanges(wider, base)).toEqual([]);
  });

  it("walks arrays, records and nullable unions", () => {
    const shape = wireShape(
      z.object({
        log: z.array(z.object({ turn: z.number().int() })),
        names: z.record(z.string(), z.string()),
        prompt: z
          .discriminatedUnion("kind", [
            z.object({ kind: z.literal("a") }),
            z.object({ kind: z.literal("b") }),
          ])
          .nullable(),
      }),
    );
    expect(shape).toMatchObject({
      "frame.log[].turn": ["integer"],
      "frame.names{}": ["string"],
      "frame.prompt": ["null"],
      "frame.prompt.kind": ['="a"', '="b"'],
    });
  });
});
