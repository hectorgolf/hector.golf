import "dotenv/config"; // apply the ".env" file to process.env

import { GenerativeModel } from "@google/generative-ai";
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
    prompt.push(`<TOURNAMENT HISTORY>`);
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
    prompt.push(`<PLAYER>`);
    prompt.push(
        [
            `- Name: ${input.name}.`,
            `- Gender: ${input.gender}.`,
            `- Home club: ${input.homeClub}.`,
            `- Past appearances: ${input.previousAppearances.length}.`,
            `- Past wins (Hector Trophée): ${input.hectorWins.length}.`,
            `- Past individual titles (Victor trophy): ${input.victorWins.length}.`,
            `- ${input.retired ? 'Considered as retired from Hector events' : 'Still active in Hector events'}`,
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
    prompt.push(`</PLAYER>`);

    return prompt.join("\n\n");
}

export const GeneratePlayerBiographyPromptV1 = async (
    model: GenerativeModel,
    input: PlayerBiographyInput
): Promise<string> => {
    const posteriorQualityControlPrompt = [
        "Double-check that the generated biography is factually accurate and does not contain any errors.",
        "If you find any such errors in the generated biography, please fix them and return an updated JSON object.",
    ].join("\n");

    const primaryPrompt = buildPrimaryPrompt(input);

    const fullPrompt = [primaryPrompt, posteriorQualityControlPrompt].flat().join("\n\n");

    const result = await model.generateContent([primaryPrompt, posteriorQualityControlPrompt]);
    try {
        const data = JSON.parse(result.response.text());
        console.log(JSON.stringify(data, null, 2));
        return JSON.stringify({ ...data, prompt: fullPrompt }, null, 2);
    } catch (error: any) {
        const errorResponse = { error: error.message || error, prompt: fullPrompt, response: result.response.text() };
        console.error(`Gemini failed producing a valid JSON response.`, errorResponse);
        return JSON.stringify(errorResponse, null, 2);
    }
};
