import { cardOfUid, topUid, type EffectChoice, type PokemonRef } from "@luminous/engine";
import type { RedactedEffectPrompt, RedactedCard } from "@luminous/schema";
import type { LuaSimulator, SimMenu, SimOption } from "./simulator";

/** Shared engine prompt shapes, rendered by Lua as button lists, real card
 * rows (the pack picker), board targets or prize slots. Board/prize menus name
 * the top-card uid / prize slot so the table itself becomes the picker. */
export function effectMenu(sim: LuaSimulator, prompt: RedactedEffectPrompt): SimMenu {
  const host = sim.host;
  if (!host) return { kind: "list", title: "No game", options: [] };
  const seat = host.viewerSeat;
  const selected: string[] = [];
  const assignments = new Map<string, number>();
  let amount = prompt.kind === "choosePokemon" ? (prompt.upTo ?? 1) : 100;
  let target = 0;
  const refName = (ref: PokemonRef) => {
    const side = host.game.players[ref.seat];
    const body = ref.spot.spot === "active" ? side.active : side.bench[ref.spot.index];
    const who = ref.seat === seat ? "You" : "Opponent";
    return `${who}: ${body ? (cardOfUid(host.game, topUid(body) ?? "")?.name ?? "Pokemon") : "Pokemon"}`;
  };
  const refUid = (ref: PokemonRef) => {
    const side = host.game.players[ref.seat];
    const body = ref.spot.spot === "active" ? side.active : side.bench[ref.spot.index];
    return (body && topUid(body)) || "";
  };
  const card = (uid: string): RedactedCard | undefined => {
    const c = cardOfUid(host.game, uid);
    return (
      c && {
        id: uid,
        cardId: c.id,
        name: c.name,
        category: c.category,
        trainerType: c.trainerType ?? null,
        hasImage: !!c.image,
      }
    );
  };
  const confirm = (choice: EffectChoice, label = "Confirm", colour = "blue") =>
    sim.action(label, { type: "resolveEffect", seat, choice }, colour);
  const refresh = () => {
    sim.menu = build();
    sim.emit();
  };
  const toggle = (id: string) => {
    const i = selected.indexOf(id);
    if (i >= 0) selected.splice(i, 1);
    else selected.push(id);
    refresh();
  };
  const pick = (id: string, label: string, face?: RedactedCard, uid = ""): SimOption => ({
    label,
    card: face,
    uid,
    selected: selected.includes(id),
    run: () => toggle(id),
  });
  const build = (): SimMenu => {
    const menu: SimMenu = {
      kind: "list",
      title: "Choose",
      note: prompt.note,
      options: [],
      mandatory: true,
    };
    switch (prompt.kind) {
      case "mayDraw":
        menu.title = "Draw cards";
        menu.options = [
          confirm({ kind: "mayDraw", draw: true }, `Draw ${prompt.count}`),
          confirm({ kind: "mayDraw", draw: false }, "Skip", "red"),
        ];
        break;
      case "confirm": {
        const targets = prompt.targets ?? [];
        menu.title = prompt.note || "Confirm";
        menu.note = targets.length ? "Choose a Pokémon, then confirm." : prompt.note;
        menu.kind = targets.length ? "board" : "list";
        menu.options = targets.map((ref, i) => ({
          label: refName(ref),
          uid: refUid(ref),
          selected: target === i,
          run: () => {
            target = i;
            refresh();
          },
        }));
        menu.footer = [
          confirm(
            {
              kind: "confirm",
              yes: true,
              ...(targets[target] ? { target: targets[target] } : {}),
            },
            prompt.labels?.yes ?? "Yes",
            "green",
          ),
          confirm({ kind: "confirm", yes: false }, prompt.labels?.no ?? "No", "red"),
        ];
        break;
      }
      case "guessHp":
        menu.title = `Guess ${prompt.name}'s HP`;
        menu.options = [
          {
            label: `HP: ${amount}  (-10)`,
            run: () => {
              amount = Math.max(0, amount - 10);
              refresh();
            },
          },
          {
            label: `HP: ${amount}  (+10)`,
            run: () => {
              amount += 10;
              refresh();
            },
          },
        ];
        menu.footer = [confirm({ kind: "hpGuess", hp: amount })];
        break;
      case "chooseAttack":
        menu.title = "Choose an attack";
        menu.options = prompt.candidates.map((c) =>
          confirm({ kind: "attack", index: c.index }, c.name, "red"),
        );
        break;
      case "choosePrize":
        menu.kind = "prizes";
        menu.title = "Choose a Prize";
        menu.note = prompt.note || "Click one of your Prize cards.";
        menu.options = prompt.indices.map((index) => ({
          ...confirm({ kind: "prize", index }, `Prize ${index + 1}`),
          uid: `prize:${index}`,
        }));
        break;
      case "choosePokemon":
        menu.kind = "board";
        menu.title = "Choose a Pokémon";
        menu.options = prompt.candidates.map((ref) => ({
          ...confirm({ kind: "pokemon", ref, ...(prompt.upTo ? { take: amount } : {}) }, refName(ref)),
          uid: refUid(ref),
        }));
        if (prompt.upTo)
          menu.footer = [
            {
              label: `Amount: ${amount}`,
              run: () => {
                amount = (amount % (prompt.upTo ?? 1)) + 1;
                refresh();
              },
            },
            confirm({ kind: "pokemon" }, "Skip", "red"),
          ];
        break;
      case "choosePokemonMulti":
        menu.kind = "board";
        menu.title = `Choose Pokémon (${selected.length}/${prompt.max})`;
        menu.options = prompt.candidates.map((ref, i) => ({
          ...pick(String(i), refName(ref)),
          uid: refUid(ref),
        }));
        menu.footer = [
          confirm({
            kind: "pokemonMulti",
            refs: selected.flatMap((i) => {
              const ref = prompt.candidates[Number(i)];
              return ref ? [ref] : [];
            }),
          }),
        ];
        break;
      case "chooseCards":
      case "orderCards":
        menu.kind = "cards";
        menu.title =
          prompt.kind === "orderCards"
            ? "Choose card order"
            : `Choose cards (${selected.length}/${prompt.max})`;
        menu.options = prompt.candidates.map((c) =>
          pick(
            c.id,
            `${prompt.kind === "orderCards" && selected.includes(c.id) ? `${selected.indexOf(c.id) + 1}. ` : ""}${c.name}`,
            c,
            c.id,
          ),
        );
        menu.footer = [
          confirm({
            kind: prompt.kind === "orderCards" ? "orderCards" : "cards",
            uids: [...selected],
          }),
        ];
        break;
      case "discardEnergy":
      case "discardTools":
        menu.kind = "cards";
        menu.title = prompt.kind === "discardTools" ? "Discard Tools" : "Discard Energy";
        menu.options = prompt.discardable.map((c) =>
          pick(c.uid, `${card(c.uid)?.name ?? "Card"} — ${refName(c.from)}`, card(c.uid), c.uid),
        );
        menu.footer = [confirm({ kind: prompt.kind, uids: [...selected] })];
        break;
      case "attachCards":
      case "moveEnergy": {
        const targets = prompt.kind === "attachCards" ? prompt.targets : prompt.destinations;
        const cards =
          prompt.kind === "attachCards"
            ? prompt.candidates
            : prompt.movable.map((c) => card(c.uid)).filter((c): c is RedactedCard => !!c);
        menu.kind = "cards";
        menu.title = prompt.kind === "attachCards" ? "Attach cards" : "Move Energy";
        menu.note = `${prompt.note ?? ""}\nClick each card to cycle its destination; unselected cards stay put.`;
        menu.options = cards.map((c) => ({
          label: `${c.name}: ${targets[assignments.get(c.id) ?? -1] ? refName(targets[assignments.get(c.id) ?? -1] as PokemonRef) : "stays"}`,
          card: c,
          uid: c.id,
          selected: assignments.has(c.id),
          run: () => {
            const next = (assignments.get(c.id) ?? -1) + 1;
            if (next >= targets.length) assignments.delete(c.id);
            else assignments.set(c.id, next);
            refresh();
          },
        }));
        const pairs = [...assignments].flatMap(([uid, i]) => {
          const to = targets[i];
          return to ? [{ uid, to }] : [];
        });
        menu.footer = [
          confirm(
            prompt.kind === "attachCards"
              ? { kind: "attachCards", assignments: pairs }
              : { kind: "moveEnergy", picks: pairs.map((p) => ({ uid: p.uid, dest: p.to })) },
          ),
        ];
        break;
      }
      default: {
        const exhaustive: never = prompt;
        return exhaustive;
      }
    }
    return menu;
  };
  return build();
}
