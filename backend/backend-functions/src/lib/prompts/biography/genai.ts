import { GoogleGenerativeAI, GenerativeModel, SchemaType, ResponseSchema } from "@google/generative-ai";

import { GeneratePlayerBiographyPromptV1 } from "./biography-v1";
import { EventNameAndYear, PlayerBiographyInput, describeEvent } from "./common";

/**
 * The response schema for the Gemini GenAI model for generating player biographies.
 *
 * This is used to ensure that the response is always in the correct format.
 *
 * The response is always a JSON object with one of the following properties:
 * - `biography`: an array of strings, each representing a paragraph of the biography
 * - `error`: a string, representing the error message if the response is an error
 */
const responseSchema: ResponseSchema = {
    type: SchemaType.OBJECT,
    properties: {
        biography: {
            type: SchemaType.ARRAY,
            description: "An array of strings, each representing a paragraph of the biography",
            items: { type: SchemaType.STRING },
            nullable: true,
        },
        error: {
            type: SchemaType.STRING,
            description: "A string, representing the error message if the response is an error",
            nullable: true,
        },
    },
    required: [], // all fields are optional (because it might be a success response or an error response)
};

function initializeGenAIModel(
    apiKey: string,
    pastEvents: EventNameAndYear[],
    nextEvent: EventNameAndYear | undefined
): GenerativeModel {
    const systemInstruction: string[] = [
        "<INSTRUCTIONS>",
        "You are a sports journalist that writes about golf. Your style is formal and you are very detail-oriented.",
        "As a notable deviation from your otherwise formal style, you only ever refer to players by their first name.",
        "You are free to make up details about the player's personality to spice up a player biography.",
        "",
        "DO NOT make up details about a player's participation in past events or their winning record!",
        "This is extremely important. In fact, it's better to not mention how many times a player has participated",
        "in past events at all unless you are absolutely certain that the number is correct.",
        "",
        "You are specialized in writing about the Hector Trophée, a golf tournament that takes place once every year.",
        "Hector Trophée is a pair competition, in which two players compete against each other in a multi-day event",
        "including both individual and pair formats. The best individual player is awarded with the Victor Trophy and",
        "the winning pair takes home the coveted Hector Trophée.",
        "",
        "When asked to write a biography for a player or an analysis of their current or recent form and performance,",
        "split the text into paragraphs as necessary to avoid overwhelming the reader.",
        "Be extra careful to misrepresent the player's historical appearance and winning record. It is of utmost",
        "importance that a player's biography is factually accurate and does not contain any errors.",
        "</INSTRUCTIONS>",
        "",
    ];

    // TOURNAMENT HISTORY
    systemInstruction.push("<TOURNAMENT HISTORY>");
    systemInstruction.push(`The tournament has been organized ${pastEvents.length} times:`);
    systemInstruction.push(...pastEvents.map((x) => `- ${describeEvent(x)}`));
    systemInstruction.push("</TOURNAMENT HISTORY>");

    systemInstruction.push("");
    systemInstruction.push("<NEXT EVENT>");
    if (nextEvent) {
        systemInstruction.push(`The next event is going to be ${describeEvent(nextEvent)}.`);
    } else {
        systemInstruction.push(`The date of the next event is not yet known.`);
    }
    systemInstruction.push("</NEXT EVENT>");

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
        model: "gemini-2.0-flash",
        generationConfig: {
            responseMimeType: "application/json",
            responseSchema: responseSchema,
        },
        systemInstruction: systemInstruction.join("\n"),
    });
    return model;
}

export async function generatePlayerBiography(apiKey: string, input: PlayerBiographyInput): Promise<string> {
    const model = initializeGenAIModel(apiKey, input.allPastEvents, input.nextEvent);
    return await GeneratePlayerBiographyPromptV1(model, input);
}

export { type PlayerBiographyInput };
