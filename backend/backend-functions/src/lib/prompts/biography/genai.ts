import { GoogleGenerativeAI, GenerativeModel } from "@google/generative-ai";

import { GeneratePlayerBiographyPromptV1, PlayerBiographyInput } from "./biography-v1";

export { type PlayerBiographyInput };

function initializeGenAIModel(apiKey: string): GenerativeModel {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
        model: "gemini-1.5-flash",
        generationConfig: {
            responseMimeType: "application/json",
        },
    });
    return model;
}

export async function generatePlayerBiography(apiKey: string, input: PlayerBiographyInput): Promise<string> {
    const model = initializeGenAIModel(apiKey);
    return await GeneratePlayerBiographyPromptV1(model, input);
}
