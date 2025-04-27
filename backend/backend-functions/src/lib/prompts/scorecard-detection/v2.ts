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

export type ExtractedScorecardInformationV2 = {
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

export const promptV2 = async (model: GenerativeModel, imagePart: Part): Promise<ExtractedScorecardInformationV2> => {
    const prompt = `
        I have an image that should represent a golf scorecard that I want you to examine
        and extract information from.

        Before I tell you what I want you to extract, let me provide you with some useful
        taxonomy and language to help you extract the information correctly:

        - "NET" usually refers to handicaps being involved. A player's or team's "net score" is
          calculated by adjusting their actual strokes by removing strokes based on their handicap.
        - "SCR" or "SCRATCH" refers to no handicaps being involved. A player's or team's "scratch
          score" is their actual strokes taken.
        - "Stableford" is a scoring system where points are awarded based on the number of strokes
          taken relative to par on a hole. Usually, but not always, handicaps are involved.
        - "Stroke play" is a scoring system where the total number of strokes taken over the entire
          round of golf is counted. This can be done with ("stroke play net") or without ("stroke
          play scratch") handicaps.
        - "Better ball" and "best ball" are terms used interchangeably to refer to a team-based
          scoring system where the best score of the team members is taken for each hole. In practice,
          "better ball" (or "best ball" when there are more than 2 players in the team) is combined
          with some individual scoring system like Stableford or stroke play.
        - "Scramble" is a team-based scoring system where all team members play a shot, and the team
          chooses which of their shots to play from there. This can be done with ("scramble net") or
          without ("scramble scratch") handicaps where all players' individual scores are first
          calculated and the best score of these for each hole is selected for the team's collective
          scorecard.

        Also, keep note of what your reasoning is at each step of the way. In the end, I want you to
        include a decision log in the JSON output that briefly explains how you arrived at the final
        result through each of the steps I'll describe next.

        Please do the following:

        1. First, determine whether the provided image represents a golf scorecard. If it doesn't
           look like a valid scorecard, return an error message saying so.

        2. If it does look like a golf scorecard, determine how many holes have been played.
           It's typically either 18 holes or 9 holes, but sometimes it might be e.g. just
           12 holes in which case the scorecard typically looks like an 18-hole course
           with a bunch of missing scores in the back nine.

        3. Next, look for the row headings. Make note of which of these are present:
           "Hole", "Handicap" (a.k.a. "HCP" or "SI"), "Par", "Score", "Points", "Net",
           "Putts", "Fairway", "GIR".

           I want you to only consider the values within these rows and columns when extracting the
           scores. Ignore any other information that might be visible in the image.

        4. If the image does indeed look like a golf scorecard, detect the game format this
           golf scorecard is for.

           The game format should be one of the following:
           - "Stableford NET" (with handicaps)
           - "Stableford SCR" (without handicaps)
           - "Stroke Play NET" (with handicaps)
           - "Stroke Play SCR" (without handicaps),
           - "Scramble Stableford NET" (with handicaps)
           - "Scramble Stableford SCR" (without handicaps)
           - "Scramble Stroke Play NET" (with handicaps)
           - "Scramble Stroke Play SCR" (without handicaps)
           - "Better Ball Stableford NET" (with handicaps)
           - "Better Ball Stableford SCR" (without handicaps)
           - "Better Ball Stroke Play NET" (with handicaps)
           - "Better Ball Stroke Play SCR" (without handicaps)

           Note that the image might be a screenshot from an app that allows the player to
           track multiple game formats in the same scorecard. In such cases where the names
           of multiple game formats are visible in the image, the game format we want is the
           one highlighted, underlined, or otherwise explicitly emphasized in the image.

           In addition to the image explicitly stating the game format, you can deduce the game
           format in question from the row headings present in the scorecard.
           - If there is a row indicating "Points" for each hole, it's likely a Stableford game
             format.
           - If there is a row indicating "Net" for each hole, it's likely a game format with
             handicaps
           - If there is a row indicating "Score" for each hole, with positive integers for values,
             that row is likely showing the actual strokes taken on a hole. If there is also a
             row indicating "Net" for each hole, the "Score" refers to the actual strokes taken
             and the "Net" refers to the net score after applying handicaps.
           - If the "Score" row has values such as "E", "-1", "+2", etc., it's likely the number
             of strokes relative to par for each hole. "E" stands for "even" and means the player
             or team took the same amoung of strokes as the par for the hole. "-1" means one stroke
             fewer than par, "+2" means two strokes more than par, etc.

        5. If the game format is "stableford", extract the actual strokes taken and the
           Stableford points scored for each hole.

        6. If the game format is "strokeplay" without handicaps (scratch), extract the actual
           strokes taken for each hole.

        7. If the game format is "strokeplay" with handicaps (net), extract the actual strokes
           taken for each hole and the net score for each hole, taking handicaps into account.

        8. If the game format is a "scramble" stroke play without handicaps (scratch), extract
           the actual strokes taken for each hole.

        9. If the game format is "scramble" stroke play with handicaps (net), extract the actual
           strokes taken and the net score for each hole, taking handicaps into account.

        10. If the game format is "scramble" stableford, extract the actual strokes taken and
           the points scored for each hole.

        11. If the game format is "bestball", extract the actual strokes taken for each hole
           or the score relative to par, and calculate the missing half - the scorecard generally
           includes either one or the other but not both. For example, if the scorecard shows
           "+2" for a hole and the hole's par is 5, the team's strokes for that hole would be 7.
           Similarly, if the scorecard says "E" (for "even") and the hole's par is 4, the
           team's strokes for that hole would be 4. For best ball, it doesn't matter whether
           the scoring was done by Stableford, stroke play net, or stroke play scratch – all
           we want in these cases is the strokes taken and resulting score relative to par.

        12. Make sure that the total score is also extracted. This should include the total of
           actual strokes taken, net strokes if applicable, and the total number of Stableford
           points awarded or strokes taken (after applying handicaps if it's a "net" format).

           In scratch stroke play, the total score is simply the total number of strokes taken.

           In net stroke play, the total score is the total number of strokes taken minus the
           handicap strokes.

           In stableford, the total score is the total number of points awarded and the total
           strokes are the total strokes taken throughout the round.

           Sometimes, a score for a given hole might be missing or be marked as a "-". In Stableford
           games, the score for that hole is 0 points. In stroke play formats (individual or scramble),
           the score for that hole should be marked as par + 5 strokes. For best ball formats, a missing
           score for a hole simply means that team's other scores are used for that hole. If none of the
           players on a team have a score for a hole, pretend the team made "par + 5 strokes" on that hole.

           In other words, some or all of the values in the total score section can be null if the
           information is not present in the scorecard, or the value isn't applicable to the specific
           game format in question. For example, a stroke play scorecard wouldn't have Stableford points,
           and a Better Ball scorecard usually doesn't include both net and actual strokes.

        13. Finally, double check that the total score has been calculated correctly:
           - The number of holes played should match the number of hole-specific scores
           - Hole-specific points sum up to the total points cited as part of the total score (if applicable).
           - Hole-specific strokes sum up to the total strokes cited as part of the total score (if applicable).
           - Hole-specific net strokes sum up to the total net strokes cited as part of the total score (if applicable).

        As a result, I want you to produce the extracted information in JSON format that matches
        the following structure:

        {
            "gameFormat": 'Stroke Play NET' | 'Stroke Play SCR'
                          | 'Stableford NET' | 'Stableford SCR'
                          | 'Scramble Stroke Play NET' | 'Scramble Stroke Play SCR'
                          | 'Scramble Stableford NET' | 'Scramble Stableford SCR'
                          | 'Better Ball Stroke Play NET' | 'Better Ball Stroke Play SCR'
                          | 'Better Ball Stableford NET' | 'Better Ball Stableford SCR',
            "totalScore": {
                "actualStrokes": <number | null>,
                "netStrokes": <number | null>,
                "stablefordPoints": <number | null>
            }
            "scoresPerHole": [
                {
                    "hole": <number>,
                    "strokes": <number | null>,
                    "net": <number | null>,
                    "points": <number | null>
                },
                ...
            ],
            "log": [
                {
                    "step": <number>,
                    "reasoning": <string>
                },
                ...
            ]
        }
        `

    const result = await model.generateContent([ imagePart, prompt, ]);
    try {
        const data = JSON.parse(result.response.text())
        console.log(JSON.stringify(data, null, 2))
        return data as ExtractedScorecardInformationV2
    } catch {
        console.error(`Gemini produced invalid JSON as output:\n` + result.response.text())
        return Promise.reject("Failed to extract scorecard information")
    }
}
