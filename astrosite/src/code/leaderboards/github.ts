import { Octokit, RequestError } from "octokit";
import { BOARD_SCORING, type GoogleSheetIndividualLeaderboard, type GoogleSheetTeamLeaderboard } from "@hector/schemas/src/leaderboards/types.ts";
import { serializeJson } from "../json";

/**
 * Who the leaderboard commits are attributed to.
 *
 * The address falls back rather than throwing, which it used to do. Attribution
 * is the least important thing this file does — the leaderboard is still correct
 * when the commit is signed by the wrong address, and unreachable when the run
 * dies — so an unset variable must not be what stops a live tournament updating.
 * That is not hypothetical: it is exactly what happened on 2026-09-24, when the
 * workflow passed the address to its commit step but not to the step that runs
 * this code, and the first ongoing tournament in a year found the gap.
 *
 * The fallback address matches COMMITTER in admin/src/lib/jobs/registry.ts, so
 * commits the admin makes and commits this makes are attributable to the same
 * place when neither has been told otherwise.
 */
const COMMITTER = {
    name: "UpdateHectorLeaderboard",
    email: process.env.GIT_COMMITTER_EMAIL || "noreply@hector.golf",
};

const standardOptions = {
    owner: "hectorgolf",
    repo: "hector.golf",
    headers: {
        "X-GitHub-Api-Version": "2026-03-10",
    },
};

const authenticate = async (githubToken: string): Promise<Octokit> => {
    if (!githubToken || githubToken.trim() === "") {
        throw new Error("GITHUB_ACCESS_TOKEN is missing - cannot authenticate to GitHub API");
    }
    return Promise.resolve(new Octokit({ auth: githubToken }));
};

const fetchExistingHectorLeaderboardDataFile = async (
    githubToken: string,
    eventId: string,
): Promise<{ sha: string; json: any } | undefined> => {
    try {
        const octokit = await authenticate(githubToken);
        const response = await octokit.rest.repos.getContent({
            ...standardOptions,
            path: `astrosite/src/data/leaderboards/${eventId}.json`,
        });
        const sha = (response.data as any).sha as string | undefined;
        const content = (response.data as any).content as string | undefined;
        const json = content ? JSON.parse(Buffer.from(content, "base64").toString("utf-8")) : {};
        if (sha && json) {
            return { sha, json };
        }
    } catch (err: any) {
        // HTTP 404 is expected if the file doesn't exist yet but let's log all other errors!
        if ((err as RequestError).status !== 404) {
            console.error(`Failed to fetch existing leaderboard data file for event ${eventId}`, err);
        }
        console.warn(
            `No existing leaderboard data file found for event ${eventId} (this is expected if the event doesn't have a leaderboard yet)`,
        );
    }
    return undefined;
};

const createOrReplaceHectorLeaderboardDataFile = async (
    githubToken: string,
    eventId: string,
    existingSHA: string | undefined,
    hector: GoogleSheetTeamLeaderboard,
    victor: GoogleSheetIndividualLeaderboard,
): Promise<boolean> => {
    const payload = {
        event: eventId,
        // Hector counts strokes (lower is better) from 2023 onwards, Victor counts
        // Stableford points (higher is better). Read from one definition rather
        // than restated here, because the app adapter signs its diffs by the same
        // fact and the two disagreeing would sign every gap backwards.
        scoring: BOARD_SCORING,
        hector: hector,
        victor: victor,
        updatedAt: new Date().toISOString(),
    };
    const fileContents = serializeJson(payload);
    const fileContentsBase64 = Buffer.from(fileContents).toString("base64");
    const octokit = await authenticate(githubToken);
    const response = await octokit.rest.repos.createOrUpdateFileContents({
        ...standardOptions,
        path: `astrosite/src/data/leaderboards/${eventId}.json`,
        message: `Automated leaderboard update for ${eventId} at ${payload.updatedAt}`,
        committer: COMMITTER,
        sha: existingSHA,
        content: fileContentsBase64,
    });
    console.log(`Created or updated leaderboard data file for event ${eventId} at ${response.data.content?.url}`);
    return true;
};

export const updateHectorEventLeaderboard = async (
    githubToken: string,
    eventId: string,
    hector: GoogleSheetTeamLeaderboard,
    victor: GoogleSheetIndividualLeaderboard,
): Promise<boolean> => {
    const existingFile = await fetchExistingHectorLeaderboardDataFile(githubToken, eventId);
    const sha = existingFile?.sha;
    if (sha === undefined) {
        console.log(`Creating a new leaderboard data file for event ${eventId}`);
        return await createOrReplaceHectorLeaderboardDataFile(githubToken, eventId, undefined, hector, victor);
    } else if (areDeeplyEqual(existingFile?.json.hector, hector) && areDeeplyEqual(existingFile?.json.victor, victor)) {
        console.log(`Leaderboard data for event ${eventId} hasn't changed; skipping the update for event ${eventId}`);
        return false;
    } else {
        console.log(`Leaderboard data for event ${eventId} has changed; doing the update for event ${eventId}`);
        return await createOrReplaceHectorLeaderboardDataFile(githubToken, eventId, sha, hector, victor);
    }
};

function areDeeplyEqual(obj1: any, obj2: any): boolean {
    if (obj1 === obj2) return true;

    if (Array.isArray(obj1) && Array.isArray(obj2)) {
        if (obj1.length !== obj2.length) return false;
        return obj1.every((elem, index) => {
            return areDeeplyEqual(elem, obj2[index]);
        });
    }

    if (typeof obj1 === "object" && typeof obj2 === "object" && obj1 !== null && obj2 !== null) {
        if (Array.isArray(obj1) || Array.isArray(obj2)) return false;
        const keys1 = Object.keys(obj1);
        const keys2 = Object.keys(obj2);
        if (keys1.length !== keys2.length || !keys1.every((key) => keys2.includes(key))) return false;
        for (let key in obj1) {
            let isEqual = areDeeplyEqual(obj1[key], obj2[key]);
            if (!isEqual) {
                return false;
            }
        }
        return true;
    }

    return false;
}
