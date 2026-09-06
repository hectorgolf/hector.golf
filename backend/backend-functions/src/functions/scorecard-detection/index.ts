import { HttpFunction, Request, Response } from '@google-cloud/functions-framework';
import { extractScorecardInformationBase64 } from '../../lib/prompts/scorecard-detection/genai';

function extractAuthToken(request: Request): string | undefined {
  const authorizationHeader = request.header('authorization')
  if (!authorizationHeader) {
    return undefined
  }
  const token = authorizationHeader.replace(/^Bearer /i, '')
  return token ? token : undefined
}

export const ExtractScorecardInformation: HttpFunction = async (request: Request, response: Response) => {
  response.set('Access-Control-Allow-Origin', '*')
  response.set('content-type', 'application/json')

  if (typeof(process.env.GOOGLE_GEMINI_API_KEY) === 'undefined') {
    response.status(500).send('Internal server error: Missing API key (1)')
    return
  }

  if (typeof(process.env.ASTROSITE_API_KEY) === 'undefined') {
    response.status(500).send('Internal server error: Missing API key (2)')
    return
  }

  const token = extractAuthToken(request)
  if (token !== process.env.ASTROSITE_API_KEY) {
    response.status(401).send('Valid API key required')
    return
  }

  const payload = typeof(request.body) === 'string' ? JSON.parse(request.body) : request.body
  if (payload.image && payload.mime) {
    const version = parseInt(payload.version || '1')
    const data = await extractScorecardInformationBase64(process.env.GOOGLE_GEMINI_API_KEY, payload.image, payload.mime, version)
    response.status(200)
    response.send(JSON.stringify(data, null, 2))
    return
  }

  const { authorization, ...headersWithoutCredentials } = request.headersDistinct
  const errorResponse = {
    error: 'Invalid request',
    message: 'Request must include an image and a mime type',
    details: {
      headers: headersWithoutCredentials
    }
  }
  response.status(400)
  response.send(JSON.stringify(errorResponse, null, 2))
}

export default ExtractScorecardInformation
