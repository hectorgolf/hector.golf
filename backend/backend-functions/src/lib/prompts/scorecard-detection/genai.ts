import { readFileSync, statSync } from 'fs'
import { GoogleGenerativeAI, GenerativeModel, FileDataPart, InlineDataPart, Part } from "@google/generative-ai";
import { FileMetadataResponse, GoogleAIFileManager } from "@google/generative-ai/server";

import { promptV1 } from './v1'
import { promptV2 } from './v2'
import { promptV3 } from './v3'


function initializeGenAIModel(apiKey: string): GenerativeModel {
    const genAI = new GoogleGenerativeAI(apiKey)
    const model = genAI.getGenerativeModel({
        model: "gemini-1.5-flash",
        generationConfig: {
            responseMimeType: "application/json"
        }
    });
    return model
}

function getMimeType(fileName: string): string {
    fileName = fileName.toLowerCase()
    if (fileName.endsWith('.png')) return 'image/png'
    if (fileName.endsWith('.jpg') || fileName.endsWith('.jpeg')) return 'image/jpeg'
    if (fileName.endsWith('.webp')) return 'image/webp'
    if (fileName.endsWith('.heic')) return 'image/heic'
    if (fileName.endsWith('.heif')) return 'image/heif'
    throw new Error(`Unsupported file type: ${fileName}`)
}

async function uploadImage(imageFile: string): Promise<FileDataPart> {
    console.log(`Uploading an image file (${imageFile})...`)
    const mimeType = getMimeType(imageFile)
    const fileManager = new GoogleAIFileManager(process.env.API_KEY!);
    const uploadResponse = await fileManager.uploadFile(imageFile, { mimeType });
    const getResponse = await fileManager.getFile(uploadResponse.file.name);
    const metadata: FileMetadataResponse = { ...getResponse }
    const fileDataPart: FileDataPart = {
        fileData: {
            mimeType: metadata.mimeType,
            fileUri: metadata.uri
        }
    }
    return fileDataPart
}

// Converts local file information to a GoogleGenerativeAI.Part object.
function convertLocalImageFileToGenerativePart(filePath: string, mimeType?: string): InlineDataPart {
    mimeType = mimeType || getMimeType(filePath)
    return {
        inlineData: {
            data: Buffer.from(readFileSync(filePath)).toString("base64"),
            mimeType
        }
    };
}

async function prepareImageFile(imageFile: string): Promise<InlineDataPart|FileDataPart> {
    const stats = statSync(imageFile)
    const fileSizeInMegabytes = stats.size / (1024 * 1024)
    if (fileSizeInMegabytes >= 10) {
        return await uploadImage(imageFile)
    } else {
        return convertLocalImageFileToGenerativePart(imageFile)
    }
}

const runV1 = async (model: GenerativeModel, imageFile: string|InlineDataPart): Promise<any> => runModel(model, imageFile, promptV1)
const runV2 = async (model: GenerativeModel, imageFile: string|InlineDataPart): Promise<any> => runModel(model, imageFile, promptV2)
const runV3 = async (model: GenerativeModel, imageFile: string|InlineDataPart): Promise<any> => runModel(model, imageFile, promptV3)

async function runModel(model: GenerativeModel, imageFile: string|InlineDataPart|FileDataPart, implementation: (model: GenerativeModel, image: Part) => Promise<any>): Promise<any> {
    const imagePart: Part = typeof(imageFile) === 'string' ? await prepareImageFile(imageFile) : imageFile;
    return implementation(model, imagePart)
}

export async function extractScorecardInformation(apiKey: string, imageFile: string): Promise<any> {
    const model = initializeGenAIModel(apiKey)
    const data = await runV1(model, imageFile);
    return data
}

export async function extractScorecardInformationBase64(apiKey: string, base64EncodedImage: string, mimeType: string, version: number): Promise<any> {
    const inlineData = {
        inlineData: {
            data: base64EncodedImage,
            mimeType: mimeType
        }
    }
    const model = initializeGenAIModel(apiKey)
    if (version === 3) {
        return await runV3(model, inlineData)
    } else if (version === 2) {
        return await runV2(model, inlineData)
    } else {
        return await runV1(model, inlineData)
    }
}
