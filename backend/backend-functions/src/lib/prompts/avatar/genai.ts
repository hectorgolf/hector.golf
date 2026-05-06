import { GoogleGenerativeAI, GenerativeModel, InlineDataPart, Part } from "@google/generative-ai";

type AvatarImageInput =
    | string
    | {
          data?: string;
          base64?: string;
          mimeType?: string;
          inlineData?: {
              data: string;
              mimeType: string;
          };
      };

function getImagePart(input: AvatarImageInput, label: string): InlineDataPart {
    if (
        typeof input === "object" &&
        input !== null &&
        typeof input.inlineData === "object" &&
        input.inlineData !== null
    ) {
        if (!input.inlineData.data || !input.inlineData.mimeType) {
            throw new Error(`Invalid ${label} image input: inlineData must include both data and mimeType.`);
        }
        return {
            inlineData: {
                data: input.inlineData.data,
                mimeType: input.inlineData.mimeType,
            },
        };
    }

    const rawData = typeof input === "string" ? input : input.data || input.base64;
    if (!rawData) {
        throw new Error(`Invalid ${label} image input: expected a base64 string, data URL, or inlineData object.`);
    }

    const dataUrlMatch = rawData.match(/^data:([^;]+);base64,(.+)$/i);
    if (dataUrlMatch) {
        return {
            inlineData: {
                mimeType: dataUrlMatch[1],
                data: dataUrlMatch[2],
            },
        };
    }

    return {
        inlineData: {
            data: rawData,
            mimeType: typeof input === "string" ? "image/png" : input.mimeType || "image/png",
        },
    };
}

function extractGeneratedImage(result: any): { avatar: string; mimeType: string } {
    const parts = result?.response?.candidates?.[0]?.content?.parts;
    if (Array.isArray(parts)) {
        for (const part of parts) {
            if (part?.inlineData?.data) {
                return {
                    avatar: part.inlineData.data,
                    mimeType: part.inlineData.mimeType || "image/png",
                };
            }
        }
    }

    const responseText = result?.response?.text?.();
    if (responseText) {
        try {
            const parsed = JSON.parse(responseText);
            if (typeof parsed?.avatar === "string") {
                return {
                    avatar: parsed.avatar,
                    mimeType: typeof parsed?.mimeType === "string" ? parsed.mimeType : "image/png",
                };
            }
            if (typeof parsed?.error === "string") {
                throw new Error(parsed.error);
            }
        } catch {
            // Ignore parse errors here. We will throw a detailed error below.
        }
    }

    throw new Error("Gemini response did not include a generated image.");
}

function initializeGenAIModel(apiKey: string): GenerativeModel {
    const genAI = new GoogleGenerativeAI(apiKey);
    const modelParams: any = {
        model: "gemini-2.5-flash-image",
        generationConfig: {
            // Request image output while still allowing text fallback in edge cases.
            responseModalities: ["IMAGE", "TEXT"],
        },
        systemInstruction: [
            "Your job is to generate a cartoon-style avatar portrait of a specific",
            "person, based on two input images described below.",
            "",
            "<INPUT IMAGE 1 — IDENTITY SOURCE>",
            "The first image is a real photograph of the person to portray.",
            "This is the authoritative source for all identity-related details:",
            "  - Face shape, facial structure, and proportions",
            "  - Skin tone and complexion",
            "  - Eye color, shape, and eyebrows",
            "  - Hair color, length, and style",
            "  - Facial hair (beard, stubble, moustache) — replicate exactly",
            "  - Any other distinctive facial features (e.g. glasses)",
            "The generated avatar MUST be a recognizable cartoon likeness of",
            "THIS person. Do not alter or omit any of the above features.",
            "</INPUT IMAGE 1 — IDENTITY SOURCE>",
            "",
            "<INPUT IMAGE 2 — STYLE REFERENCE ONLY>",
            "The second image is a style reference. Use it ONLY to understand:",
            "  - The cartoon / illustration rendering style",
            "  - Line weight, shading technique, and color saturation",
            "  - Overall composition and framing",
            "Do NOT copy the identity of the person shown in the style",
            "reference. Do NOT borrow their facial features, facial hair,",
            "hair style, skin tone, clothing details, or any other personal",
            "characteristics. The style reference person and the output avatar",
            "person are two different individuals.",
            "</INPUT IMAGE 2 — STYLE REFERENCE ONLY>",
            "",
            "<CLOTHING>",
            "Dress the avatar in a plain white polo golf shirt with no logos,",
            "text, or patterns. Ignore whatever clothing the person in the",
            "photo or the style reference is wearing.",
            "</CLOTHING>",
            "",
            "<COMPOSITION>",
            "Headshot portrait, showing face and shoulders.",
            "Solid flat gray background (#cccccc) — no scenery or gradients.",
            "</COMPOSITION>",
            "",
            "<OUTPUT FORMAT>",
            "Portrait orientation (9:16 aspect ratio), PNG format.",
            "</OUTPUT FORMAT>",
        ].join("\n"),
    };
    const model = genAI.getGenerativeModel(modelParams);
    return model;
}

export async function generatePlayerAvatar(
    apiKey: string,
    photo: AvatarImageInput,
    sample: AvatarImageInput,
): Promise<string> {
    const model = initializeGenAIModel(apiKey);

    const photoPart = getImagePart(photo, "photo");
    const samplePart = getImagePart(sample, "sample");

    const prompt = [
        "Generate a cartoon avatar portrait using the two images provided.",
        "",
        "Image 1 (IDENTITY SOURCE): the real photograph of the person to portray.",
        "Replicate their face, skin tone, hair, and any facial hair exactly.",
        "",
        "Image 2 (STYLE REFERENCE): defines the illustration style only.",
        "Do NOT copy the person shown in image 2 — their looks, hair, facial",
        "hair, or clothing must not appear in the output.",
        "",
        "Dress the subject in a plain white polo golf shirt (no logos).",
        "Gray (#cccccc) background. Portrait headshot, 9:16 aspect ratio.",
    ].join("\n");

    const result = await model.generateContent([{ text: prompt } as Part, photoPart as Part, samplePart as Part]);

    const image = extractGeneratedImage(result);
    return JSON.stringify(image);
}
