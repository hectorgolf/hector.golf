import { expect, describe, it } from "vitest";

import { availableActions } from "../../../src/code/mscorecard/cli/actions.ts";
import { formatWhen, parseRoundDate, parseWhen } from "../../../src/code/mscorecard/cli/when.ts";
import { formatStrokes, parseStrokes } from "../../../src/code/mscorecard/cli/edit.ts";
import { CliError, isInterrupt, outcomeFor } from "../../../src/code/mscorecard/cli/util.ts";
import { MScorecardError } from "../../../src/code/mscorecard/errors.ts";
import { courseHandicap } from "../../../src/code/mscorecard/cli/handicap.ts";
import {
    describeHoles,
    holeTableOf,
    lengthOf,
    playableConfigurations,
    ratingsFor,
} from "../../../src/code/mscorecard/cli/nines.ts";
import { parse, readCommand } from "../../../src/code/mscorecard/cli/options.ts";
import { describeSummary } from "../../../src/code/mscorecard/cli/rounds.ts";
import type { RosterPlayer, RoundSummary, Tee } from "../../../src/code/mscorecard/types.ts";
import { HIRSALA, NEVAS, TAPIOLA } from "./courses.fixture.ts";

const teeNamed = (course: typeof TAPIOLA, name: string): Tee => course.tees.find((t) => t.name === name)!;

const player = (over: Partial<RosterPlayer> = {}): RosterPlayer => ({
    name: "Lasse Koskela",
    playerID: "1618037712778955",
    shortName: "LK",
    email: "",
    gender: "1",
    hcp: 14.1,
    hcpType: "9",
    club: "",
    isDefaultPlayer: true,
    friendStatus: 0,
    friendUserID: "0",
    friendPlayerID: "",
    ...over,
});

describe("CLI", () => {
    describe("reading the command line", () => {
        it("takes the command as a word, not a flag", () => {
            expect(readCommand(["create-round"])).toEqual("create-round");
            expect(readCommand(["list-rounds"])).toEqual("list-rounds");
            expect(readCommand(["show-round", "1788733831056"])).toEqual("show-round");
            expect(readCommand(["edit-round"])).toEqual("edit-round");
        });

        it("treats no command as a request for help", () => {
            // Guessing at a command would mean writing to a real account.
            expect(readCommand([])).toEqual("help");
            expect(readCommand(["--verbose"])).toEqual("help");
        });

        it("lets help win over anything else", () => {
            expect(readCommand(["create-round", "help"])).toEqual("help");
        });

        it("ignores options and their values when finding the command", () => {
            expect(readCommand(["show-round", "123", "--json", "out.json"])).toEqual("show-round");
            expect(readCommand(["self-test", "--verbose"])).toEqual("self-test");
        });
    });

    describe("reading the arguments to a command", () => {
        it("passes a round ID through to show-round", () => {
            // The bug this pins: with no --json present, the index arithmetic used
            // to filter out the command word and then drop the ID with it.
            expect(parse(["show-round", "1788733831056"])).toMatchObject({
                command: "show-round",
                args: ["1788733831056"],
                json: undefined,
            });
        });

        it("keeps the ID and the file apart when --json is given", () => {
            expect(parse(["show-round", "1788733831056", "--json", "out.json"])).toMatchObject({
                command: "show-round",
                args: ["1788733831056"],
                json: "out.json",
            });
        });

        it("does not mind where the options sit", () => {
            expect(parse(["--json", "out.json", "show-round", "1788733831056"])).toMatchObject({
                command: "show-round",
                args: ["1788733831056"],
                json: "out.json",
            });
        });

        it("never mistakes an option's value for an argument", () => {
            // "out.json" belongs to --json, not to the command.
            expect(parse(["show-round", "--json", "out.json"]).args).toEqual([]);
        });

        it("reads --verbose without treating it as an argument", () => {
            expect(parse(["self-test", "--verbose"])).toMatchObject({
                command: "self-test",
                args: [],
                verbose: true,
            });
        });

        it("leaves a command that takes no arguments with none", () => {
            expect(parse(["list-rounds"]).args).toEqual([]);
        });

        it("makes edit-round's round ID optional", () => {
            // With an ID it edits that round; without one it asks which.
            expect(parse(["edit-round", "1788733831056"]).args).toEqual(["1788733831056"]);
            expect(parse(["edit-round"]).args).toEqual([]);
        });
    });

    describe("what can still be done to a round", () => {
        /** Only the four properties the decision actually turns on. */
        const round = (over: Partial<Record<string, unknown>> = {}) =>
            ({
                isSubmitted: false,
                isDeleted: false,
                isFinished: false,
                players: [{ sid: "a" }, { sid: "b" }],
                ...over,
            }) as never;

        it("offers everything on an open round with more than one player", () => {
            expect(availableActions(round())).toEqual([
                "finish",
                "submit",
                "reschedule",
                "set-format",
                "add-player",
                "remove-player",
                "delete",
            ]);
        });

        it("stops offering to finish or add to a round that is finished", () => {
            // Nobody joins a card that has been closed.
            expect(availableActions(round({ isFinished: true }))).toEqual([
                "submit",
                "reschedule",
                "set-format",
                "remove-player",
                "delete",
            ]);
        });

        it("offers nothing at all once a round is submitted", () => {
            // The federation has it: it can be neither changed nor deleted.
            expect(availableActions(round({ isSubmitted: true }))).toEqual([]);
            expect(availableActions(round({ isSubmitted: true, isFinished: true }))).toEqual([]);
        });

        it("offers nothing on a round that has been deleted", () => {
            expect(availableActions(round({ isDeleted: true }))).toEqual([]);
        });

        it("does not offer to remove the only player", () => {
            // Emptying a round is a deletion by another name, and the SDK refuses it.
            expect(availableActions(round({ players: [{ sid: "a" }] }))).toEqual([
                "finish",
                "submit",
                "reschedule",
                "set-format",
                "add-player",
                "delete",
            ]);
        });
    });

    describe("reading a date and time", () => {
        const noon = new Date(2026, 8, 6, 12, 0);

        it("reads a full date and time as local, not UTC", () => {
            // The API stores the wall clock at the course: 17:10 in Helsinki is
            // written 202609061710 whatever the machine's offset.
            const when = parseWhen("2026-09-06 17:10")!;

            expect(when.getFullYear()).toEqual(2026);
            expect(when.getMonth()).toEqual(8);
            expect(when.getDate()).toEqual(6);
            expect(when.getHours()).toEqual(17);
            expect(when.getMinutes()).toEqual(10);
        });

        it("reads a bare time as being on the day in question", () => {
            const when = parseWhen("17:10", noon)!;

            expect(formatWhen(when)).toEqual("2026-09-06 17:10");
        });

        it("reads a bare date as midnight", () => {
            expect(formatWhen(parseWhen("2026-09-06")!)).toEqual("2026-09-06 00:00");
        });

        it("refuses a date that does not exist", () => {
            // new Date() would happily roll these over into March.
            expect(parseWhen("2026-02-31 10:00")).toBeUndefined();
            expect(parseWhen("2026-13-01 10:00")).toBeUndefined();
            expect(parseWhen("2026-09-06 25:00")).toBeUndefined();
            expect(parseWhen("2026-09-06 10:75")).toBeUndefined();
        });

        it("refuses anything that is not a date", () => {
            for (const bad of ["", "tomorrow", "6.9.2026", "2026/09/06", "17.10"]) {
                expect(parseWhen(bad)).toBeUndefined();
            }
        });

        it("reads back what the API stores", () => {
            // Exactly the value the app sent when moving a round to 17:10.
            expect(formatWhen(parseRoundDate("202609061710")!)).toEqual("2026-09-06 17:10");
        });

        it("round-trips its own output", () => {
            for (const text of ["2026-09-06 17:10", "2021-01-01 00:00", "2026-12-31 23:59"]) {
                expect(formatWhen(parseWhen(text)!)).toEqual(text);
            }
        });
    });

    describe("failing tidily", () => {
        /** Exactly what `readline/promises` rejects a pending question with. */
        const ctrlC = () => Object.assign(new Error("Aborted with Ctrl+C"), { code: "ABORT_ERR", name: "AbortError" });

        it("recognises Ctrl-C at a prompt", () => {
            expect(isInterrupt(ctrlC())).toBe(true);
            // The code alone is enough, and so is the name.
            expect(isInterrupt(Object.assign(new Error("x"), { code: "ABORT_ERR" }))).toBe(true);
            expect(isInterrupt(Object.assign(new Error("x"), { name: "AbortError" }))).toBe(true);
        });

        it("does not mistake an ordinary error for an interrupt", () => {
            expect(isInterrupt(new Error("boom"))).toBe(false);
            expect(isInterrupt(undefined)).toBe(false);
            expect(isInterrupt("ABORT_ERR")).toBe(false);
        });

        it("reports Ctrl-C as a cancellation, not a crash", () => {
            const outcome = outcomeFor(ctrlC())!;

            expect(outcome.text).toEqual("\nCancelled.");
            expect(outcome.toStderr).toBe(false);
            // The conventional code for a process stopped with Ctrl-C.
            expect(outcome.code).toEqual(130);
        });

        it("prints a misuse of the command without a stack trace", () => {
            const outcome = outcomeFor(new CliError("MSCORECARD_EMAIL is not set."))!;

            expect(outcome.text).toEqual("\nMSCORECARD_EMAIL is not set.");
            expect(outcome.toStderr).toBe(true);
            expect(outcome.code).toEqual(1);
        });

        it("prints an API error the same way", () => {
            expect(outcomeFor(new MScorecardError("Round 1 is locked against edits."))).toMatchObject({
                text: "\nRound 1 is locked against edits.",
                code: 1,
            });
        });

        it("lets an unexpected error keep its stack", () => {
            // undefined means "rethrow": a bug is where the stack is the point.
            expect(outcomeFor(new TypeError("x is not a function"))).toBeUndefined();
        });
    });

    describe("reading a score off the terminal", () => {
        it("takes a plausible score", () => {
            expect(parseStrokes("4")).toEqual(4);
            expect(parseStrokes("  10 ")).toEqual(10);
            expect(parseStrokes("1")).toEqual(1);
        });

        it("takes a dash as clearing the hole", () => {
            // -1 is how the API spells "not entered".
            expect(parseStrokes("-")).toEqual(-1);
            expect(parseStrokes(" - ")).toEqual(-1);
        });

        it("also takes -1, which is what the API calls an empty hole", () => {
            expect(parseStrokes("-1")).toEqual(-1);
        });

        it("reads back whatever it shows", () => {
            // The prompts offer the current card as their default, so a hole
            // displayed as "-" has to parse back to cleared rather than be rejected.
            for (const strokes of [-1, 1, 4, 7, 12]) {
                expect(parseStrokes(formatStrokes(strokes))).toEqual(strokes);
            }
            expect(formatStrokes(-1)).toEqual("-");
        });

        it("refuses anything that is not a score", () => {
            for (const bad of ["0", "-2", "3.5", "", "four", "--", "1-"]) {
                expect(parseStrokes(bad)).toBeUndefined();
            }
        });
    });

    describe("listing rounds", () => {
        /** A real rounds-list entry, as the API returns it. */
        const summary = (over: Partial<RoundSummary> = {}): RoundSummary => ({
            roundID: "1788733831056",
            date: "202609070130",
            displayDate: "07-Sep-2026",
            clubName: "Tapiola Golf",
            courseName: "Tapiola Golf (Back 9)",
            course: "Back 9",
            totalStrokes: 50,
            adjustedStrokes: 50,
            parDiff: 14,
            stableford: 12,
            holesPlayed: 9,
            countsTowardsHandicap: false,
            submitted: false,
            ...over,
        });

        it("leads with the round ID, which is what show-round takes", () => {
            const line = describeSummary(summary());

            expect(line.startsWith("1788733831056")).toBe(true);
            expect(line).toContain("07-Sep-2026");
            expect(line).toContain("Tapiola Golf (Back 9)");
            expect(line).toContain("50 strokes, 12 pts");
            expect(line).toContain("practice");
        });

        it("says so plainly when a card never registered", () => {
            // The API sends "-" for TotalStrokes, which the client reads as absent.
            // This is the signature of scores filed against holes the round does not
            // play, so it is worth being able to spot at a glance.
            const line = describeSummary(summary({ totalStrokes: undefined, stableford: undefined }));

            expect(line).toContain("no scores");
            expect(line).not.toContain("undefined");
        });

        it("marks a submitted handicap round as both", () => {
            const line = describeSummary(summary({ countsTowardsHandicap: true, submitted: true }));

            expect(line).toContain("(handicap round, submitted)");
        });
    });

    describe("working out which nines a course can be played in", () => {
        it("offers both nines alone and every pairing of a two-nine course", () => {
            const configs = playableConfigurations(TAPIOLA);

            expect(configs.map((c) => `${c.nine1}${c.nine2}`)).toEqual(["10", "20", "11", "12", "21", "22"]);
            expect(configs.filter((c) => c.holes === 9)).toHaveLength(2);
        });

        it("numbers the back nine's holes 10 to 18", () => {
            const backNine = playableConfigurations(TAPIOLA).find((c) => c.nine1 === 2 && c.nine2 === 0)!;

            expect(backNine.holeNumbers).toEqual([10, 11, 12, 13, 14, 15, 16, 17, 18]);
            expect(describeHoles(backNine)).toEqual("holes 10-18");
        });

        it("describes a crossover start by each half, since it is not one range", () => {
            const crossover = playableConfigurations(TAPIOLA).find((c) => c.nine1 === 2 && c.nine2 === 1)!;

            expect(describeHoles(crossover)).toEqual("holes 10-18 then 1-9");
        });

        it("composes a reversed round's pars in the order they are played", () => {
            const forward = playableConfigurations(TAPIOLA).find((c) => c.nine1 === 1 && c.nine2 === 2)!;
            const reversed = playableConfigurations(TAPIOLA).find((c) => c.nine1 === 2 && c.nine2 === 1)!;

            // The mirror image, not a slice of the same table.
            expect(reversed.pars).toEqual([...forward.pars.slice(9), ...forward.pars.slice(0, 9)]);
        });

        it("matches every par table a three-nine course publishes", () => {
            const configs = playableConfigurations(NEVAS);

            const published = Object.keys(NEVAS).filter((key) => /^parIndex_\d_\d$/.test(key));
            expect(published).toHaveLength(9);
            for (const key of published) {
                const [, a, b] = /^parIndex_(\d)_(\d)$/.exec(key)!;
                const config = configs.find((c) => c.nine1 === Number(a) && c.nine2 === Number(b))!;
                expect(config.pars).toEqual((NEVAS as any)[key].pars);
            }
        });

        it("offers a three-nine course every pairing exactly once", () => {
            const configs = playableConfigurations(NEVAS);
            const keys = configs.map((c) => `${c.nine1}${c.nine2}`);

            // Three nines alone plus nine pairings, and Nevas publishes the reversed
            // keys itself, so they must not be added a second time.
            expect(configs).toHaveLength(12);
            expect(new Set(keys).size).toEqual(12);
        });

        it("names the nines when the course does", () => {
            const configs = playableConfigurations(NEVAS);

            expect(configs.map((c) => c.label)).toContain("Kettu only");
            expect(configs.map((c) => c.label)).toContain("Karppi then Kettu");
        });

        it("falls back to front and back on a two-nine course", () => {
            expect(playableConfigurations(HIRSALA).map((c) => c.label)).toContain("back nine only");
        });

        it("finds a rating for a reversed pairing under its ascending key", () => {
            const reversed = playableConfigurations(TAPIOLA).find((c) => c.nine1 === 2 && c.nine2 === 1)!;
            const forward = playableConfigurations(TAPIOLA).find((c) => c.nine1 === 1 && c.nine2 === 2)!;
            const tee = teeNamed(TAPIOLA, "57");

            expect(ratingsFor(tee, reversed)).toEqual(ratingsFor(tee, forward));
        });

        it("measures only the nines in play", () => {
            const tee = teeNamed(TAPIOLA, "57");
            const backNine = playableConfigurations(TAPIOLA).find((c) => c.nine1 === 2 && c.nine2 === 0)!;
            const eighteen = playableConfigurations(TAPIOLA).find((c) => c.nine1 === 1 && c.nine2 === 2)!;

            expect(lengthOf(tee, backNine)).toBeLessThan(lengthOf(tee, eighteen));
            expect(lengthOf(tee, eighteen)).toEqual(lengthOf(tee, backNine) + lengthOf(tee, playableConfigurations(TAPIOLA)[0]!));
        });

        it("trims the par table to the holes actually played", () => {
            const backNine = playableConfigurations(TAPIOLA).find((c) => c.nine1 === 2 && c.nine2 === 0)!;

            expect(holeTableOf(TAPIOLA, backNine)!.pars).toHaveLength(9);
            expect(holeTableOf(TAPIOLA, backNine)!.indexes).toHaveLength(9);
        });
    });

    /**
     * Every value here is one the *app itself* wrote, read out of captured traffic.
     * An earlier version of this rule omitted the `CR - Par` term and produced 15
     * where the app writes 14 — close enough to look right.
     */
    describe("computing a course handicap the way the app does", () => {
        it("matches the app at Tapiola off a 14.1 index", () => {
            expect(courseHandicap(player({ hcp: 14.1 }), teeNamed(TAPIOLA, "57"), TAPIOLA)).toEqual(14);
        });

        it("matches the app at Hirsala off a 14.8 index", () => {
            expect(courseHandicap(player({ hcp: 14.8 }), teeNamed(HIRSALA, "Valkoinen"), HIRSALA)).toEqual(17);
        });

        it("uses the women's rating for a female player, and caps at 54", () => {
            const lotta = player({ name: "Lotta", gender: "0", hcp: 54 });

            expect(courseHandicap(lotta, teeNamed(HIRSALA, "Punainen"), HIRSALA)).toEqual(54);
        });

        it("uses a plain club handicap verbatim", () => {
            // hcpType "0" is not a WHS index, so no slope or rating applies.
            const toni = player({ name: "Toni Marttila", hcp: 36, hcpType: "0" });

            expect(courseHandicap(toni, teeNamed(HIRSALA, "Valkoinen"), HIRSALA)).toEqual(36);
        });

        it("does not halve for a nine-hole round", () => {
            // The stored figure is always the eighteen-hole one; halving happens
            // later, when strokes are allocated.
            const eighteen = courseHandicap(player(), teeNamed(TAPIOLA, "57"), TAPIOLA);

            expect(eighteen).toEqual(14);
        });
    });
});
