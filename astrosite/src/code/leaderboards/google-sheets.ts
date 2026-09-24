import { google, sheets_v4, Common } from "googleapis";
import type { GoogleSheetIndividualLeaderboard, GoogleSheetTeamLeaderboard } from "@hector/schemas/src/leaderboards/types.ts";

type Rows = Array<Row>;
type Row = Array<CellValue>;
type CellValue = number | string | undefined;
type CellReference = { row: number; column: number; name: string };

const columnNames = (() => {
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
    return alphabet.concat(alphabet.flatMap((firstChar) => alphabet.map((secondChar) => `${firstChar}${secondChar}`)));
})();

function acquireGoogleCredentials() {
    // Escapes literal newlines that appear inside quoted JSON string values (e.g. a
    // multi-line private_key), without touching whitespace between JSON properties.
    const escapeNewlinesWithinJsonStrings = (value: string): string => {
        return value.replace(/"(?:[^"\\]|\\.)*"/gs, (quotedString) => quotedString.replace(/\r?\n/g, "\\n"));
    };

    const value = process.env.GOOGLE_CREDENTIALS;
    if (!value) {
        // Not a warning, and not a problem: unset is the normal case since the
        // move to Workload Identity Federation. Application Default Credentials
        // resolves the identity instead — see authenticate() below.
        return undefined;
    }
    try {
        return JSON.parse(value);
    } catch {
        // Fall through to try normalizing embedded newlines (e.g. a local .env with a raw multi-line private_key).
    }
    const normalizedValue = escapeNewlinesWithinJsonStrings(value);
    try {
        return JSON.parse(normalizedValue);
    } catch (error) {
        // Deliberately does not log the value.
        //
        // GitHub Actions masks registered secrets, and it did catch this on the
        // five runs that hit this branch on 2026-09-01 — the credential came out
        // as fourteen `***` rather than as a private key. That was luck rather
        // than design: what gets logged here is a *transformed* copy, and masking
        // only held because escaping the newlines left the PEM body's own lines
        // intact as substrings. A transformation that did not preserve them —
        // stripping whitespace, re-encoding — would print a usable key into a
        // public repository's log. Nothing outside Actions masks anything at all,
        // so a local run printed the whole thing regardless.
        //
        // The length is the diagnostic that was actually useful: it distinguishes
        // "empty or truncated" from "present but malformed" without quoting it.
        console.error(
            `Error parsing GOOGLE_CREDENTIALS as JSON (${value.length} characters). ` +
                `Expected the contents of a service account key file.`,
            error,
        );
        return undefined;
    }
}

const googleCredentials = acquireGoogleCredentials();

const columnName = (index: number): string => columnNames[index] || `${index}?`;

// Omitting `credentials` is what makes GoogleAuth fall back to Application
// Default Credentials, which is the whole of the change away from a downloadable
// service account key: in Actions, google-github-actions/auth writes an ADC file
// and points GOOGLE_APPLICATION_CREDENTIALS at it, and on a laptop
// `gcloud auth application-default login` does the same. An explicit
// GOOGLE_CREDENTIALS still wins where one is set, so nothing breaks on the way.
const auth = new google.auth.GoogleAuth({
    ...(googleCredentials ? { credentials: googleCredentials } : {}),
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});

// Which identity the request actually went out as, for the 403 below. Only the
// auth library knows under ADC, and finding out can cost a token exchange, so
// this is asked for lazily and never allowed to fail: turning a clear 403 into
// an obscure crash of its own would defeat the point of asking.
const actingIdentity = async (): Promise<string | undefined> => {
    try {
        return (await auth.getCredentials()).client_email;
    } catch {
        return undefined;
    }
};

const authenticate = async (): Promise<sheets_v4.Sheets> => {
    return google.sheets({ version: "v4", auth });
};

const findCellContaining = (rows: Rows, matcher: (value: CellValue) => boolean) => {
    for (let r = 0; r < rows.length; r++) {
        for (let c = 0; c < rows[r].length; c++) {
            const value = rows[r][c];
            if (!value) {
                continue;
            }
            const match = () => ({ name: `${columnName(c)}${r + 1}`, row: r, column: c });
            if (typeof matcher === "string") {
                if (matcher === value.toString()) return match();
            } else if (typeof matcher === "function") {
                if (matcher(value)) return match();
            } else {
                console.error(`Invalid matcher type: ${typeof matcher}: ${JSON.stringify(matcher)}`);
            }
        }
    }
    return undefined;
};

const findCellBelowContaining = (rows: Rows, cell: CellReference, matcher: (value: CellValue) => boolean) => {
    for (let r = cell.row + 1; r < rows.length; r++) {
        const value = rows[r][cell.column];
        if (!value) {
            continue;
        }
        const match = () => ({ name: `${columnName(cell.column)}${r + 1}`, row: r, column: cell.column });
        if (typeof matcher === "string") {
            if (matcher === value.toString()) return match();
        } else if (typeof matcher === "function") {
            if (matcher(value)) return match();
        } else {
            console.error(`Invalid matcher type: ${typeof matcher}: ${JSON.stringify(matcher)}`);
        }
    }
    return undefined;
};

const findEmptyCellBelow = (rows: Rows, cell: CellReference) => {
    for (let nextBelow = cellBelow(cell); !!nextBelow; nextBelow = cellBelow(nextBelow)) {
        if (cellValueSafe(rows, nextBelow) === "") {
            return nextBelow;
        }
    }
    throw new Error(`WTF? There must be an empty cell *somewhere* below ${columnName(cell.column)}${cell.row + 1}!`);
};

const findEmptyCellToRightOf = (rows: Rows, cell: CellReference) => {
    for (let nextRight = cellToRightOf(cell); !!nextRight; nextRight = cellToRightOf(nextRight)) {
        if (cellValueSafe(rows, nextRight) === "") {
            return nextRight;
        }
    }
    throw new Error(`WTF? There must be an empty cell *somewhere* to the right of ${cell.name}!`);
};

const cellAbove = (cell: CellReference): CellReference => ({
    ...cell,
    row: cell.row - 1,
    name: `${columnName(cell.column)}${cell.row}`,
});
const cellBelow = (cell: CellReference): CellReference => ({
    ...cell,
    row: cell.row + 1,
    name: `${columnName(cell.column)}${cell.row + 2}`,
});
const cellToRightOf = (cell: CellReference): CellReference => ({
    ...cell,
    column: cell.column + 1,
    name: `${columnName(cell.column + 1)}${cell.row + 1}`,
});
const cellToLeftOf = (cell: CellReference): CellReference => ({
    ...cell,
    column: cell.column - 1,
    name: `${columnName(cell.column - 1)}${cell.row + 1}`,
});
const cellValue = (rows: Rows, cell: CellReference) => {
    const row = rows[cell.row];
    if (row === undefined) return undefined;
    return row[cell.column];
};
const cellValueSafe = (rows: Rows, cell: CellReference) => {
    const value = cellValue(rows, cell);
    if (value === undefined || value === null) return "";
    return value;
};

const findVictorLeaderboard = (rows: Rows): string | undefined => {
    // Find the title cell
    const titleCell = findCellContaining(rows, (value) => {
        return value?.toString().toLowerCase().replace(/\s+/g, " ").trim() === "victor leaderboard";
    });
    if (!titleCell) {
        console.error(`Could not find the title cell of the Victor leaderboard!`);
        return undefined;
    }

    // Find the header row (somewhere below the title)
    const firstHeaderCell = findCellBelowContaining(
        rows,
        titleCell,
        (value) => value?.toString().toLowerCase().trim() === "player",
    );
    if (firstHeaderCell && cellValueSafe(rows, firstHeaderCell).toString().toLowerCase().trim() !== "player") {
        console.error(
            `Could not find the first header cell in the Victor leaderboard – ${firstHeaderCell.name} value is ${JSON.stringify(rows[firstHeaderCell.row][firstHeaderCell.column])}!`,
        );
        return undefined;
    }

    // Find the first data row (immediately below the header row)
    const firstDataCell = cellBelow(firstHeaderCell!);
    if (cellValueSafe(rows, firstDataCell).toString().toLowerCase().trim() === "") {
        console.error(
            `Could not find the first data row in the Victor leaderboard – ${firstDataCell.name} value is ${JSON.stringify(rows[firstDataCell.row][firstDataCell.column])}!`,
        );
        return undefined;
    }

    const firstEmptyCellBelowHeader = findEmptyCellBelow(rows, firstHeaderCell!);
    let lastDataCell = cellAbove(firstEmptyCellBelowHeader);
    if (cellValueSafe(rows, lastDataCell).toString().toLowerCase().trim() === "") {
        console.error(
            `Could not find the last data row in the Victor leaderboard – ${lastDataCell.name} value is ${JSON.stringify(rows[lastDataCell.row][lastDataCell.column])}!`,
        );
        return undefined;
    }

    // look for the last non-empty cell to the right of the last known data cell
    const firstEmptyCellToRightOfLastDataCell = findEmptyCellToRightOf(rows, lastDataCell);
    lastDataCell = cellToLeftOf(firstEmptyCellToRightOfLastDataCell);
    if (cellValueSafe(rows, lastDataCell).toString().toLowerCase().trim() === "") {
        console.error(
            `Could not find the last column fo the last data row in the Victor leaderboard – ${lastDataCell.name} value is ${JSON.stringify(rows[lastDataCell.row][lastDataCell.column])}!`,
        );
        return undefined;
    }

    return `${firstDataCell.name}:${lastDataCell.name}`;
};

const findHectorLeaderboard = (rows: Rows) => {
    for (let r = 0; r < rows.length; r++) {
        for (let c = 0; c < rows[r].length; c++) {
            if (!rows[r][c]) {
                continue;
            }
            const value = rows[r][c]?.toString().toLowerCase().replace(/\s+/g, " ").trim();
            if (value === "hector leaderboard") {
                // console.log(`${columnName(c)}${r + 1}:\t${JSON.stringify(rows[r][c])} -> found the leaderboard title in column ${columnName(c)}`)
                let state = "looking for header row";
                let firstHeaderCell = undefined;
                let firstDataCell = undefined;
                let lastDataCell = undefined;
                for (let r2 = r + 1; r2 < rows.length; r2++) {
                    const value = rows[r2][c];
                    if (state === "looking for header row") {
                        if (value && value.toString().toLowerCase().replace(/\s+/g, " ").trim() === "points") {
                            // console.log(`${columnName(c)}${r2 + 1}:\t${JSON.stringify(value)} -> marking as header row`)
                            firstHeaderCell = `${columnName(c)}${r2 + 1}`;
                            state = "looking for first data row";
                        } else {
                            // console.log(`${columnName(c)}${r2 + 1}:\t${JSON.stringify(value)} -> continuing to next row`)
                        }
                    } else if (state === "looking for first data row") {
                        if (value && value.toString().trim() !== "") {
                            firstDataCell = `${columnName(c)}${r2 + 1}`;
                            lastDataCell = `${columnName(c)}${r2 + 2}`;
                            // console.log(`${columnName(c)}${r2 + 1}:\t${JSON.stringify(value)} -> marking ${firstDataCell} as the first data cell`)
                            state = "looking for last data row";
                        } else {
                            console.warn(`Could not find data rows below the header row (${firstHeaderCell})!`);
                        }
                    } else if (state === "looking for last data row") {
                        if (value && value.toString().trim() !== "") {
                            for (let c2 = c + 1; c2 < rows[r2].length; c2++) {
                                const value2 = rows[r2][c2];
                                if (value2) {
                                    lastDataCell = `${columnName(c2)}${r2 + 1}`;
                                    // console.log(`${columnName(c)}${r2 + 1}:\t${JSON.stringify(value)} -> updating ${lastDataCell} as the last data cell`)
                                } else {
                                    break;
                                }
                            }
                        } else {
                            // console.log(`${columnName(c)}${r2 + 1}:\t${JSON.stringify(value)} -> finalizing ${lastDataCell} as the last data cell`)
                            break;
                        }
                    }
                }
                console.log(`Returning Hector leaderboard data range as ${firstDataCell}:${lastDataCell}`);
                return `${firstDataCell}:${lastDataCell}`;
            }
        }
    }
    console.log(`Returning Hector leaderboard data range as undefined`);
    return undefined;
};

type RowsProcessingFunction = (rows: Rows) => any;

const processRangeInSheet = async (
    spreadsheetId: string,
    range: string,
    operation: RowsProcessingFunction,
): Promise<any> => {
    return new Promise(async (resolve, reject) => {
        try {
            const sheets = await authenticate();
            const callback: Common.BodyResponseCallback<sheets_v4.Schema$ValueRange> = async (err: any, res: any) => {
                if (err) {
                    if (err.response?.status === 403) {
                        // Worth naming the identity: a sheet that has not been
                        // shared fails here, and a 403 on an authenticated
                        // request reads like an authentication problem, which
                        // sends you looking in the wrong place.
                        const email = await actingIdentity();
                        let msg = `Access to ${spreadsheetId} denied - check that you've shared the Google Sheet with the service account email address`;
                        if (email) msg += `: ${email}`;
                        console.error(msg);
                    } else {
                        console.error("The API returned an error.", err);
                    }
                    reject(err);
                } else {
                    const rows = res.data.values as Rows;
                    if (rows.length === 0) {
                        console.log("No data found.");
                        reject("No data found.");
                    } else {
                        const result = operation(rows);
                        resolve(result);
                    }
                }
            };
            sheets.spreadsheets.values.get({ spreadsheetId, range }, callback);
        } catch (err) {
            console.error(`Error updating leaderboard`, err);
            reject(err);
        }
    });
};

const locateHectorLeaderboard = async (sheetId: string) => {
    const sheetName = "LEADERBOARD";
    const range = await processRangeInSheet(sheetId, `${sheetName}!A1:Z50`, findHectorLeaderboard);
    return `${sheetName}!${range}`;
};

const locateVictorLeaderboard = async (sheetId: string) => {
    const sheetName = "LEADERBOARD";
    const range = await processRangeInSheet(sheetId, `${sheetName}!A1:Z50`, findVictorLeaderboard);
    return `${sheetName}!${range}`;
};

const valueOrEmpty = (value: string | number | undefined): string => {
    return value === undefined ? "" : value.toString();
};

export const fetchHectorLeaderboardData = async (sheetId: string): Promise<GoogleSheetTeamLeaderboard> => {
    const hectorLeaderboardRange = await locateHectorLeaderboard(sheetId);
    if (hectorLeaderboardRange) {
        return await processRangeInSheet(sheetId, hectorLeaderboardRange, (rows) => {
            return rows.map((row) => ({
                points: row[0],
                // row[1] is the team number - we don't want to include that
                team: valueOrEmpty(row[2]),
                diff: valueOrEmpty(row[3]),
                through: valueOrEmpty(row[4]),
            }));
        });
    } else {
        console.warn(`Could not find Hector leaderboard`);
        return [];
    }
};

export const fetchVictorLeaderboardData = async (sheetId: string): Promise<GoogleSheetIndividualLeaderboard> => {
    const victorLeaderboardRange = await locateVictorLeaderboard(sheetId);
    if (victorLeaderboardRange) {
        return await processRangeInSheet(sheetId, victorLeaderboardRange, (rows) => {
            return rows.map((row) => ({
                player: valueOrEmpty(row[0]),
                points: row[1],
                diff: valueOrEmpty(row[2]),
                through: valueOrEmpty(row[3]),
            }));
        });
    } else {
        console.warn(`Could not find Victor leaderboard`);
        return [];
    }
};
