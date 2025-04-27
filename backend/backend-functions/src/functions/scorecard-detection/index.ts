import { HttpFunction, Request, Response } from '@google-cloud/functions-framework';
import { extractScorecardInformationBase64 } from '../../lib/prompts/scorecard-detection/genai';

export const ExtractScorecardInformation: HttpFunction = async (request: Request, response: Response) => {
  response.set('Access-Control-Allow-Origin', '*')
  response.set('content-type', 'application/json')

  if (typeof(process.env.GOOGLE_GEMINI_API_KEY) === 'undefined') {
    response.status(500).send('Missing API key')
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

  const errorResponse = {
    error: 'Invalid request',
    message: 'Request must include an image and a mime type',
    details: {
      headers: request.headersDistinct
    }
  }
  response.status(401)
  response.send(JSON.stringify(errorResponse, null, 2))
}

export default ExtractScorecardInformation
