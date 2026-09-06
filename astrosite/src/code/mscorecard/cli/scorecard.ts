/** Reading a scorecard off the terminal. */

import type { RosterPlayer } from "../types.ts";
import { describeHoles, type NineConfiguration } from "./nines.ts";
import type { Prompter } from "./prompts.ts";

/** Orders the player menu, floating a named player and the account's own to the top. */
export function byPreferredFirst(preferred: string) {
    const rank = (p: RosterPlayer) => (p.name === preferred ? 0 : p.isDefaultPlayer ? 1 : 2);
    return (a: RosterPlayer, b: RosterPlayer) => rank(a) - rank(b) || a.name.localeCompare(b.name);
}

/** Reads the whole card on one line, re-asking until it parses. Defaults to par. */
export async function askForStrokes(prompt: Prompter, config: NineConfiguration): Promise<number[]> {
    for (;;) {
        const answer = await prompt.ask(`\nStrokes for ${describeHoles(config)} (par)`, config.pars.join(", "));
        const values = answer
            .split(/[\s,]+/)
            .filter(Boolean)
            .map(Number);
        if (values.length !== config.holes) {
            console.log(`Expected ${config.holes} numbers, got ${values.length}.`);
            continue;
        }
        const bad = values.findIndex((value) => !Number.isInteger(value) || value < 1);
        if (bad !== -1) {
            console.log(`Hole ${config.holeNumbers[bad]} is not a positive whole number.`);
            continue;
        }
        return values;
    }
}
