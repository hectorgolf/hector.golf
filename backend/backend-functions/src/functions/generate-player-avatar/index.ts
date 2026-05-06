import { HttpFunction, Request, Response } from "@google-cloud/functions-framework";
import { generatePlayerAvatar } from "../../lib/prompts/avatar/genai";

type AvatarImagePayloadObject = {
    data?: string;
    base64?: string;
    mimeType?: string;
    inlineData?: {
        data?: string;
        mimeType?: string;
    };
};

function extractAuthToken(request: Request): string | undefined {
    const authorizationHeader = request.header("authorization");
    if (!authorizationHeader) {
        return undefined;
    }
    const token = authorizationHeader.replace(/^Bearer /i, "");
    return token ? token : undefined;
}

function validateAvatarImagePayload(image: unknown, fieldName: string): string[] {
    const errors: string[] = [];

    if (typeof image === "string") {
        if (!image.trim()) {
            errors.push(`${fieldName} must not be an empty string.`);
        }
        return errors;
    }

    if (typeof image !== "object" || image === null) {
        errors.push(`${fieldName} must be a base64 string, data URL string, or image object.`);
        return errors;
    }

    const payload = image as AvatarImagePayloadObject;
    const hasStringData = typeof payload.data === "string" || typeof payload.base64 === "string";
    const hasInlineData = typeof payload.inlineData === "object" && payload.inlineData !== null;

    if (!hasStringData && !hasInlineData) {
        errors.push(`${fieldName} object must include one of: data, base64, or inlineData.`);
        return errors;
    }

    if (typeof payload.data === "string" && !payload.data.trim()) {
        errors.push(`${fieldName}.data must not be empty when provided.`);
    }

    if (typeof payload.base64 === "string" && !payload.base64.trim()) {
        errors.push(`${fieldName}.base64 must not be empty when provided.`);
    }

    if (hasInlineData) {
        if (typeof payload.inlineData?.data !== "string" || !payload.inlineData.data.trim()) {
            errors.push(`${fieldName}.inlineData.data must be a non-empty string.`);
        }

        if (typeof payload.inlineData?.mimeType !== "string" || !payload.inlineData.mimeType.trim()) {
            errors.push(`${fieldName}.inlineData.mimeType must be a non-empty string.`);
        }
    }

    return errors;
}

export const GeneratePlayerAvatar: HttpFunction = async (request: Request, response: Response) => {
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

        const payload: any = typeof request.body === "string" ? JSON.parse(request.body) : request.body;

        const photo = payload?.photo;
        const sample = payload?.sample;

        const validationErrors = [
            ...validateAvatarImagePayload(photo, "photo"),
            ...validateAvatarImagePayload(sample, "sample"),
        ];

        if (validationErrors.length > 0) {
            console.warn(`Invalid payload for generating player avatar: ${JSON.stringify(payload)}.`);
            response.status(400).send(
                JSON.stringify({
                    error: "Invalid payload",
                    message: "Expected a JSON body with valid photo and sample image payloads.",
                    details: validationErrors,
                }),
            );
            return;
        }

        const avatar = await generatePlayerAvatar(process.env.GOOGLE_GEMINI_API_KEY, photo, sample);

        response.status(200).send(avatar);
    } catch (error) {
        console.error("Error generating player avatar:", error);
        response.status(500).send(
            JSON.stringify({
                error: "Internal server error",
                message: error instanceof Error ? error.message : "Unknown error occurred",
            }),
        );
    }
};

export default GeneratePlayerAvatar;
