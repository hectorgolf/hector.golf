import { HttpFunction, Request, Response } from "@google-cloud/functions-framework";
import { generatePlayerBiography, type PlayerBiographyInput } from "../../lib/prompts/biography/genai";

export const GeneratePlayerBiography: HttpFunction = async (request: Request, response: Response) => {
    response.set("Access-Control-Allow-Origin", "*");
    response.set("content-type", "application/json");

    if (typeof process.env.GOOGLE_GEMINI_API_KEY === "undefined") {
        response.status(500).send("Internal server error: Missing API key");
        return;
    }

    try {
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

        const biography = await generatePlayerBiography(process.env.GOOGLE_GEMINI_API_KEY, {
            name: payload.name,
            gender: payload.gender,
            homeClub: payload.homeClub,
            previousAppearances: payload.previousAppearances,
            hectorWins: payload.hectorWins,
            victorWins: payload.victorWins,
            miscellaneousDetails: payload.miscellaneousDetails,
        });

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
