import * as z from "zod";

/**
 * A client action, deliberately loose (`z.looseObject`): the DO overwrites `seat`, and
 * `applyAction`, which never throws, is the real validator. A strict object would strip the
 * action's fields.
 */
export const wireActionSchema = z.looseObject({ type: z.string() });
export type WireAction = z.infer<typeof wireActionSchema>;
