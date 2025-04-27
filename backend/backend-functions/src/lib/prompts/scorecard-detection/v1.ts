import 'dotenv/config'  // apply the ".env" file to process.env

import { GenerativeModel, Part } from "@google/generative-ai";


type AbsoluteStrokeBasedScoreWithoutHandicaps = {
    hole: number,
    strokes: number
}

type PointBasedScore = AbsoluteStrokeBasedScoreWithoutHandicaps & { points: number }

type AbsoluteStrokeBasedScoreWithHandicaps = AbsoluteStrokeBasedScoreWithoutHandicaps & { net: number }

type RelativeStrokeBasedScore = {
    hole: number,
    score: '-4'|'-3'|'-2'|'-1'|'E'|'+1'|'+2'|'+3'|'+4'|'+5'|'+6'|'+7'|'+8'|'+9'|'+10',
}

// Individual game formats:
export type StablefordScore = PointBasedScore
export type StrokePlayNetScore = AbsoluteStrokeBasedScoreWithHandicaps
export type StrokePlayScratchScore = AbsoluteStrokeBasedScoreWithoutHandicaps

// Team-based game formats:
export type BetterBallScore = RelativeStrokeBasedScore
export type ScrambleNetScore = AbsoluteStrokeBasedScoreWithHandicaps
export type ScrambleScratchScore = AbsoluteStrokeBasedScoreWithoutHandicaps

export type ExtractedScorecardInformationV1 = {
    gameFormat: {
        format: 'strokeplay'|'stableford'|'scramble'|'bestball',
        handicaps: boolean
    },
    scoresPerHole: Array<StablefordScore>|Array<StrokePlayNetScore>|Array<StrokePlayScratchScore>|Array<BetterBallScore>|Array<ScrambleNetScore>|Array<ScrambleScratchScore>,
    totalScore: {
        strokes: number,
        score: number
    }
}

export const promptV1 = async (model: GenerativeModel, imagePart: Part): Promise<ExtractedScorecardInformationV1> => {
    const prompt = `
        Please detect the game format this golf scorecard is for, and extract the strokes and score accordingly.

        The game format should be one of "strokeplay", "stableford", "scramble", or "bestball" and may have a
        "NET" suffix to imply handicaps are involved. Sometimes the image does not literally say the game format
        but in those situations you can deduce the game format based on the scoring system used:
        - In Stroke Play, the scorecard will show actual strokes and "net" strokes.
        - In Stableford, the scorecard will show actual strokes and "points" scored.

        This information should be encoded in this JSON format:
        { "format": <string>, "handicaps": <boolean> }

        If the game format is Stableford, extract the actual strokes taken and the points scored for each hole.
        That information should be encoded in this JSON format:
        { "hole": <number>, "strokes": <number>, "points": <number> }

        If the game format is Stroke Play, extrat the actual strokes taken for each hole and the net score for
        each hole, taking handicaps into account. That information should be encoded in this JSON format:
        { "hole": <number>, "strokes": <number>, "net": <number> }

        If the game format is Scramble, extract the actual strokes taken for each hole and the hole result for
        each hole. That information should be encoded in this JSON format:
        { "hole": <number>, "strokes": <number>, "net": <string> }

        If the game format is Best Ball, extract the actual strokes taken for each hole and the hole result for
        each hole. That information should be encoded in this JSON format:
        { "hole": <number>, "strokes": <number>, "net": <string> }

        Finally, count the total strokes taken and the total score for the round. That information should be
        encoded as follows:
        { "strokes": <number>, "score": <number> }

        Return the composite information extracted from the scorecard in this JSON format:
        { "gameFormat": <object>, "scoresPerHole": [ <object>, ... ], "totalScore": <object> }
        `
    const result = await model.generateContent([ prompt, imagePart ]);
    try {
        const data = JSON.parse(result.response.text())
        console.log(JSON.stringify(data, null, 2))
        return data as ExtractedScorecardInformationV1
    } catch {
        console.error(`Gemini produced invalid JSON as output:\n` + result.response.text())
        return Promise.reject("Failed to extract scorecard information")
    }
}
