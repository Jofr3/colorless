import { registryCardIds } from "../registry";
import { PROGRAM_ALIAS } from "../registryAliases.generated";

const reprints = new Map<string, string[]>();
for (const [member, canonical] of Object.entries(PROGRAM_ALIAS)) {
  const members = reprints.get(canonical);
  if (members === undefined) reprints.set(canonical, [member]);
  else members.push(member);
}
for (const members of reprints.values()) members.sort();

/** The printings that share `id`'s print_key group and play its program, sorted; `id` excluded. */
export function reprintsOf(id: string): readonly string[] {
  return reprints.get(id) ?? [];
}

/**
 * Every printing the registry programs: each `registryCardIds()` id followed by its reprints, so a
 * sweep over the authored pool reaches every card that plays an authored program.
 */
export function programmedCardIds(): string[] {
  return registryCardIds().flatMap((id) => [id, ...reprintsOf(id)]);
}
