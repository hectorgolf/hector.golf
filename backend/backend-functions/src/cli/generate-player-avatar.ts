import "dotenv/config";

import { readFileSync, writeFileSync } from "fs";
import { extname, resolve } from "path";

type AvatarResponse = {
    avatar?: string;
    mimeType?: string;
    error?: string;
    message?: string;
    details?: string[];
};

function getMimeType(filePath: string): string {
    const extension = extname(filePath).toLowerCase();
    if (extension === ".png") return "image/png";
    if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
    if (extension === ".webp") return "image/webp";
    if (extension === ".heic") return "image/heic";
    if (extension === ".heif") return "image/heif";
    throw new Error(`Unsupported image file extension: ${extension || "(none)"}`);
}

function resolveFunctionUrl(): string {
    if (process.env.GENERATE_PLAYER_AVATAR_URL) {
        return process.env.GENERATE_PLAYER_AVATAR_URL;
    }

    if (!process.env.FUNCTION_REGION || !process.env.GCLOUD_PROJECT_ID) {
        throw new Error(
            "Missing function URL configuration. Set GENERATE_PLAYER_AVATAR_URL or both FUNCTION_REGION and GCLOUD_PROJECT_ID in .env.",
        );
    }

    return `https://${process.env.FUNCTION_REGION}-${process.env.GCLOUD_PROJECT_ID}.cloudfunctions.net/GeneratePlayerAvatar`;
}

function toInlineData(filePath: string): { inlineData: { mimeType: string; data: string } } {
    const absolutePath = resolve(filePath);
    const mimeType = getMimeType(absolutePath);
    const base64 = readFileSync(absolutePath).toString("base64");

    return {
        inlineData: {
            mimeType,
            data: base64,
        },
    };
}

async function run(photoPath: string, samplePath: string, outputPath: string): Promise<void> {
    if (!process.env.ASTROSITE_API_KEY) {
        throw new Error("Missing ASTROSITE_API_KEY in .env.");
    }

    const functionUrl = resolveFunctionUrl();
    const payload = {
        photo: toInlineData(photoPath),
        sample: toInlineData(samplePath),
    };

    const response = await fetch(functionUrl, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${process.env.ASTROSITE_API_KEY}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
    });

    const body = await response.text();
    let parsed: AvatarResponse;

    try {
        parsed = JSON.parse(body) as AvatarResponse;
    } catch {
        throw new Error(`Cloud Function returned non-JSON output (HTTP ${response.status}): ${body}`);
    }

    if (!response.ok) {
        const details = Array.isArray(parsed.details) ? `\nDetails: ${parsed.details.join("; ")}` : "";
        throw new Error(
            `Cloud Function call failed (HTTP ${response.status}): ${parsed.message || parsed.error || body}${details}`,
        );
    }

    if (!parsed.avatar) {
        throw new Error(`Cloud Function response did not contain avatar data: ${body}`);
    }

    const outputAbsolutePath = resolve(outputPath);
    writeFileSync(outputAbsolutePath, Buffer.from(parsed.avatar, "base64"));

    console.log(`Avatar image saved to: ${outputAbsolutePath}`);
    console.log(`Returned mime type: ${parsed.mimeType || "image/png"}`);
}

if (process.argv.length < 4) {
    console.error(`Usage: ${process.argv[0]} ${process.argv[1]} <photo-file> <sample-file> [output-file]`);
    process.exit(1);
}

const photoPath = process.argv[2] as string;
const samplePath = process.argv[3] as string;
const outputPath = (process.argv[4] as string | undefined) || "generated-avatar.png";

run(photoPath, samplePath, outputPath).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
});
