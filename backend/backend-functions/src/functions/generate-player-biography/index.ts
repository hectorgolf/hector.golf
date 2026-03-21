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
        response.status(500).send("Internal server error: Missing API key (1)");
        return;
    }

    if (typeof process.env.ASTROSITE_API_KEY === "undefined") {
        response.status(500).send("Internal server error: Missing API key (2)");
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

        if (!payload?.name) {
            const samplePayload: PlayerBiographyInput = {
                name: "John",
                gender: "male",
                homeClub: "Hector Golf Club",
                previousAppearances: [
                    { name: "Hector Open 2022", year: 2022 },
                    { name: "Hector Invitational 2023", year: 2023 },
                ],
                hectorWins: [{ name: "Hector Open 2022", year: 2022 }],
                victorWins: [{ name: "Hector Invitational 2023", year: 2023 }],
                miscellaneousDetails: ["Enjoys long walks on the beach", "Has a pet parrot named Polly"],
                allPastEvents: [
                    { name: "Hector Open 2021", year: 2021 },
                    { name: "Hector Open 2022", year: 2022 },
                    { name: "Hector Invitational 2023", year: 2023 },
                ],
                nextEvent: {
                    name: "Hector Championship 2024",
                    year: 2024,
                    participates: true,
                },
                retired: false,
            };
            console.warn(`Invalid payload for generating player biography: ${JSON.stringify(payload)}.`);
            response.status(400).send(
                JSON.stringify({
                    error: "Invalid payload",
                    message: `Expected a PlayerBiographyInput object. Expected a PlayerBiographyInput object like this sample: ${JSON.stringify(samplePayload)}`,
                }),
            );
            return;
        }

        const biography = await generatePlayerBiography(process.env.GOOGLE_GEMINI_API_KEY, payload);

        response.status(200).send(biography);
    } catch (error) {
        console.error("Error generating player biography:", error);
        response.status(500).send(
            JSON.stringify({
                error: "Internal server error",
                message: error instanceof Error ? error.message : "Unknown error occurred",
            }),
        );
    }
};

export default GeneratePlayerBiography;
