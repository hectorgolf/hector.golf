import "dotenv/config"; // apply the ".env" file to process.env

import { GenerativeModel } from "@google/generative-ai";
import { decodeBiography } from "../../html-entities";
import { withRetry } from "../../retry";
import { PlayerBiographyInput, describeEvent, nth } from "./common";

function buildPrimaryPrompt(input: PlayerBiographyInput): string {
    const prompt: string[] = [];
    prompt.push(
        [
            "I am going to provide you with some facts about a golfer.",
            "Please peruse the facts first, making sure you understand them and that you know the correct",
            "number of appearances in past events and the correct number of wins for the player.",
            "Proceed only once you have verified that you have the facts right.",
            "Please generate a biography for the tournament website for this player based on the facts I am going to provide below.",
        ].join("\n")
    );

    // TOURNAMENT HISTORY
    prompt.push(`# TOURNAMENT HISTORY`);
    prompt.push(
        [
            `The tournament has been organized ${input.allPastEvents.length} times:`,
            ...input.allPastEvents.map((x) => `- ${describeEvent(x)}`),
        ].join("\n")
    );
    if (input.nextEvent) {
        prompt.push(`The next event is going to be ${describeEvent(input.nextEvent)}.`);
    } else {
        prompt.push(`The date of the next event is not yet known.`);
    }

    // PLAYER'S DATA
    prompt.push(`# PLAYER`);
    prompt.push(
        [
            `- Name: ${input.name}.`,
            `- Gender: ${input.gender}.`,
            `- Home club: ${input.homeClub}.`,
            `- Past appearances: ${input.previousAppearances.length}.`,
            `- Past wins (Hector Trophée): ${input.hectorWins.length}.`,
            `- Past individual titles (Victor trophy): ${input.victorWins.length}.`,
            `- ${input.retired ? 'Considered as retired from Hector events' : 'Still active in the Hector community'}`,
        ].join("\n")
    );

    if (input.nextEvent) {
        if (input.nextEvent.participates) {
            if (input.previousAppearances.length === 0) {
                prompt.push(
                    `${input.nextEvent.name} in ${input.nextEvent.year} is going to be their first appearance in Hector Trophée.`
                );
            } else {
                prompt.push(
                    `${input.nextEvent.name} in ${input.nextEvent.year} is going to be their ${nth(
                        input.previousAppearances.length + 1
                    )} appearance in Hector Trophée.`
                );
            }
        } else {
            prompt.push(
                `They are not participating ${input.nextEvent.name} in ${input.nextEvent.year}, although it's always possible there are last-minute changes to the field.`
            );
        }
    }

    // MISCELLANEOUS DETAILS ABOUT THE PLAYER
    if (input.miscellaneousDetails.length > 0) {
        prompt.push(
            [
                `Miscellaneous details the biography should include somehow:`,
                ...input.miscellaneousDetails.map((x) => `- ${x}`),
            ].join("\n")
        );
    }

    return prompt.join("\n\n");
}

export const GeneratePlayerBiographyPromptV1 = async (
    model: GenerativeModel,
    input: PlayerBiographyInput
): Promise<string> => {
    const posteriorQualityControlPrompt = [
        "Double-check that the generated biography is factually accurate and does not contain any errors.",
        "If you find any such errors in the generated biography, please fix them and return an updated JSON object.",
        // The instructions above are wrapped in pseudo-XML tags, which is a
        // context that invites markup conventions — and the model duly wrote
        // `Hector Troph&eacute;e` into a JSON string. `html-entities.ts` undoes
        // it either way; this is the cheaper half of the fix.
        "Write accented and special characters as the characters themselves, in plain Unicode: " +
            "Trophée, naïve, Champs-Élysées. Never write them as HTML entities such as &eacute; or &#233;.",
    ].join("\n");

    const primaryPrompt = buildPrimaryPrompt(input);

    const fullPrompt = [primaryPrompt, posteriorQualityControlPrompt].flat().join("\n\n");

    /*
     * The one call that leaves this process, and the one that a demand spike on
     * the model shows up in: see `withRetry` for which failures come back here
     * and why the waits are as short as they are. A biography is generated one
     * player at a time by a sweep of 45, so a 503 that is not retried costs the
     * whole run rather than one paragraph.
     */
    const result = await withRetry(() => model.generateContent([primaryPrompt, posteriorQualityControlPrompt]));
    try {
        const data = JSON.parse(result.response.text());
        /*
         * The one place the model's prose enters the system, and so the one
         * place to undo its habit of writing `Troph&eacute;e` for `Trophée`.
         * The prompt asks it not to; this is what makes that a guarantee. See
         * `html-entities.ts` for what is decoded and what is deliberately left
         * alone.
         *
         * Only `biography` — `error` is a message for a log, and `prompt` below
         * is our own text going back out unchanged.
         */
        const biography = Array.isArray(data?.biography) ? decodeBiography(data.biography) : data?.biography;
        const decoded = { ...data, ...(biography === undefined ? {} : { biography }) };
        console.log(JSON.stringify(decoded, null, 2));
        return JSON.stringify({ ...decoded, prompt: fullPrompt }, null, 2);
    } catch (error: any) {
        const errorResponse = { error: error.message || error, prompt: fullPrompt, response: result.response.text() };
        console.error(`Gemini failed producing a valid JSON response.`, errorResponse);
        return JSON.stringify(errorResponse, null, 2);
    }
};
