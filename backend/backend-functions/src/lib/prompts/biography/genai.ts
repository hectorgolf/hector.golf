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
    nextEvent: EventNameAndYear | undefined,
    otherGeneratedBiographies: string[],
): GenerativeModel {
    const systemInstruction: string[] = [
        "<INSTRUCTIONS>",
        "You are a sports journalist that writes about golf. Your style is formal and you are very detail-oriented.",
        "As a notable deviation from your otherwise formal style, you only ever refer to players by their first name.",
        "You are free to make up details about the player's personality to spice up a player biography.",
        "",
        "Also, for each biography you write, try to adopt a unique angle or theme to make the biography more",
        "interesting. For example, if a player has a very good record in the tournament, you might want to adopt the",
        "angle of them being a dominant force in the tournament. On the other hand, if a player has had a lot of close",
        "calls but hasn't won yet, you might want to adopt the angle of them being an underdog or a perennial",
        "contender. However, no matter what angle you choose, make sure that all the details about the player's",
        "participation in past events and their winning record are factually accurate and not made up.",
        "",
        "The <OTHER BIOGRAPHIES> section further down contains other biographies you've already generated for",
        "other players. You can use those for inspiration, but do not copy them or reuse any details from them that",
        "are not factually accurate for the player you're currently writing about. Furthermore, AVOID REPEATING THE",
        "CHOICE OF WORDS AND PHRASES YOU USE IN OTHER BIOGRAPHIES, as that would make the biographies more repetitive",
        'and less interesting to read. For example, if you have already used the phrase "a dominant force" in many',
        "other biographies, try to avoid using that same phrase again and instead come up with a different way to",
        "express the same idea.",
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
        "Be extra careful to misrepresent the player's historical appearance and winning record.",
        "It is of utmost importance that a player's biography is factually accurate and does not contain any errors.",
        "Similarly, pay extra attention to the chronology of events in the player's history. For example, if the player",
        "has just won the previous year's tournament, make sure to work that into the biography by identifying them as",
        '"the defending champion" or something along those lines.',
        "When you're done with the biography, read through it once again to make sure that there are no logical errors",
        "or inconsistencies in the chronology of events. For example, if the player has won in the past, do not allow",
        "the biography to suggest that they are still chasing their first victory.",
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

    systemInstruction.push("\n<OTHER BIOGRAPHIES>");
    if (otherGeneratedBiographies.length > 0) {
        otherGeneratedBiographies.forEach((bio, index) => {
            systemInstruction.push(`<OTHER BIOGRAPHY #${index + 1}>`);
            systemInstruction.push(bio);
            systemInstruction.push(`</OTHER BIOGRAPHY #${index + 1}>`);
        });
    } else {
        systemInstruction.push("<!-- No other biographies have been generated yet -->");
    }
    systemInstruction.push("</OTHER BIOGRAPHIES>");

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
        model: "gemini-2.5-flash",
        generationConfig: {
            responseMimeType: "application/json",
            responseSchema: responseSchema,
        },
        systemInstruction: systemInstruction.join("\n"),
    });
    return model;
}

export async function generatePlayerBiography(apiKey: string, input: PlayerBiographyInput): Promise<string> {
    const model = initializeGenAIModel(apiKey, input.allPastEvents, input.nextEvent, input.otherGeneratedBiographies);
    return await GeneratePlayerBiographyPromptV1(model, input);
}

export { type PlayerBiographyInput };
