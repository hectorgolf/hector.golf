import "dotenv/config"; // apply the ".env" file to process.env

import { GenerativeModel } from "@google/generative-ai";

export type PlayerBiographyInput = {
    name: string;
    gender: "male" | "female";
    homeClub: string;
    previousAppearances: string[];
    hectorWins: string[];
    victorWins: string[];
    miscellaneousDetails: string[];
};

export const GeneratePlayerBiographyPromptV1 = async (
    model: GenerativeModel,
    input: PlayerBiographyInput
): Promise<string> => {
    const prompt: string[] = [];
    prompt.push(`
I am going to describe a golfer who is competing in an annual invitational golf tournament called "Hector Trophée".
In addition to the Hector Trophée itself, which is a pair competition, the best individual player is awarded with the "Victor" trophy.

Please generate a biography for the tournament website for this player based on the data I am going to provide below.

The style of the biography should be relatively formal – something a talking head on Golf Channel might say when asked
to analyze a PGA Tour player. As a notable deviation from your otherwise formal style, you must only refer to the player by their first name.

Be extra careful to misrepresent the player's historical appearance and winning record. It is of utmost importance that 
a player's biography is factually accurate and does not contain any errors.

Split the biography into paragraphs as necessary to avoid overwhelming the reader.

Provide the generated biography in JSON format following this schema:
{
    "biography": ["<first paragraph>", "<second paragraph>", ...]
}

THE PLAYER'S DATA:`);

    prompt.push(`The player's name is ${input.name}. They are ${input.gender}.`);

    prompt.push(`Their home club is ${input.homeClub}.`);

    if (input.previousAppearances.length > 0) {
        prompt.push(`Their previous appearances include: ${input.previousAppearances.join(", ")}.`);
    } else {
        prompt.push(`This is their first appearance in Hector Trophée.`);
    }

    if (input.hectorWins.length === 1) {
        prompt.push(`They have won the Hector Trophée once: ${input.hectorWins[0]}`);
    } else if (input.hectorWins.length > 1) {
        prompt.push(
            `They have won the Hector Trophée ${
                input.hectorWins.length
            } times in the following years:\n${input.hectorWins.map((x) => `- ${x}`).join("\n")}.`
        );
    } else {
        prompt.push(`They have never won the Hector Trophée.`);
    }

    if (input.victorWins.length === 1) {
        prompt.push(`They have won the Victor trophy once: ${input.victorWins[0]}`);
    } else if (input.victorWins.length > 1) {
        prompt.push(
            `They have won the Victor trophy ${
                input.victorWins.length
            } times in the following years:\n${input.victorWins.map((x) => `- ${x}`).join("\n")}.`
        );
    } else {
        prompt.push(`They have never won the Victor trophy.`);
    }

    if (input.miscellaneousDetails.length > 0) {
        prompt.push(
            `Miscellaneous details the biography should include somehow:\n${input.miscellaneousDetails
                .map((x) => `- ${x}`)
                .join("\n")}`
        );
    }

    const result = await model.generateContent([prompt.join("\n\n")]);
    try {
        const data = JSON.parse(result.response.text());
        console.log(JSON.stringify(data, null, 2));
        return JSON.stringify(data, null, 2);
    } catch {
        console.error(`Gemini produced invalid JSON as output:\n` + result.response.text());
        return Promise.reject("Failed to extract scorecard information");
    }
};
