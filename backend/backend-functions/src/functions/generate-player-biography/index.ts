import { HttpFunction, Request, Response } from "@google-cloud/functions-framework";
import { generatePlayerBiography, type PlayerBiographyInput } from "../../lib/prompts/biography/genai";

function extractAuthToken(request: Request): string | undefined {
    const authorizationHeader = request.header("authorization");
    if (!authorizationHeader) {
        return undefined;
    }
    const token = authorizationHeader.replace(/^Bearer /i, "");
    return token ? token : undefined;
}

export const GeneratePlayerBiography: HttpFunction = async (request: Request, response: Response) => {
    response.set("Access-Control-Allow-Origin", "*");
    response.set("content-type", "application/json");

    if (typeof process.env.GOOGLE_GEMINI_API_KEY === "undefined") {
        response.status(500).send("Internal server error: Missing API key");
        return;
    }

    try {
        const token = extractAuthToken(request);
        if (token !== process.env.ASTROSITE_API_KEY) {
            response.status(401).send("Valid API key required");
            return;
        }

        const payload: PlayerBiographyInput =
            typeof request.body === "string" ? JSON.parse(request.body) : request.body;

        if (!payload.name) {
            response.status(400).send(
                JSON.stringify({
                    error: "Invalid payload",
                    message: "expected a PlayerBiographyInput object",
                })
            );
            return;
        }

        const biography = await generatePlayerBiography(process.env.GOOGLE_GEMINI_API_KEY, payload);

        response.status(200).send(biography);
    } catch (error) {
        response.status(500).send(
            JSON.stringify({
                error: "Internal server error",
                message: error instanceof Error ? error.message : "Unknown error occurred",
            })
        );
    }
};

export default GeneratePlayerBiography;
