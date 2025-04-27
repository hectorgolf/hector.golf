import 'dotenv/config'  // apply the ".env" file to process.env

import { extractScorecardInformation } from '../lib/genai'
import { existsSync } from 'fs'


if (process.argv.length < 3 || !existsSync(process.argv[2]) ) {
    console.log(`Usage: ${process.argv[0]} ${process.argv[1]} <image file>`)
    process.exit(1)
}

if (!process.env.GOOGLE_GEMINI_API_KEY) {
    console.log(`Please provide GOOGLE_GEMINI_API_KEY as an environment variable.`)
    process.exit(1)
}

async function run(apiKey: string, imageFile: string) {
    const data = await extractScorecardInformation(apiKey, imageFile)
    console.log(JSON.stringify(data, null, 2))
}

const imageFile: string = process.argv[2]!
run(process.env.GOOGLE_GEMINI_API_KEY, imageFile)
