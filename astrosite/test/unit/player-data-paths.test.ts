import { readFileSync } from "fs";
import { basename } from "path";
import { glob } from "glob";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { schema as PlayerSchema, type Player } from "../../src/schemas/players.ts";

/**
 * `updatePlayerData` is the only writer of player data, and it must land on the
 * file the player was read from. Mocking the write keeps that assertion honest
 * without letting the test touch the committed data — and without needing the
 * WiseGolf credentials the workflows that call it require.
 */
vi.mock("../../src/code/json.ts", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../../src/code/json.ts")>();
    return { ...actual, writeJsonFile: vi.fn() };
});

import { writeJsonFile } from "../../src/code/json.ts";
import { playerDataPath } from "../../src/code/data.ts";
import { updatePlayerData } from "../../src/code/players.ts";

/**
 * Pins the one thing every writer of player data depends on: a player's file is
 * found by matching the `id` *inside* the files, never by building a path out of
 * the id.
 *
 * The two are not interchangeable here. Not one of the player files is named
 * after the id it holds — `anders-forss.json` holds `"id": "anders-f"`,
 * `lasse-koskela.json` holds `"id": "lasse-k"` — so a writer that composed
 * `src/data/players/${player.id}.json`, as `pathToPlayerJson()` used to, would
 * create a second file for a player who already had one. Nothing would fail at
 * that moment; `playersData` globs the directory, so the site would simply load
 * the player twice under one id, and the duplicate would be committed by the
 * scheduled club-membership job.
 *
 * Events get away with the id-to-path shortcut — all 18 of them are named after
 * their id — which is exactly why the mistake is easy to repeat by symmetry.
 */
const playerFiles = (await glob("src/data/players/**/*.json")).sort();

const readPlayer = (file: string): Player => PlayerSchema.parse(JSON.parse(readFileSync(file, "utf-8")));

describe("player data files", () => {
    it("are found, and are the ones the site loads", () => {
        // Guards against a glob mistake quietly making the cases below vacuous.
        expect(playerFiles.length).toBeGreaterThan(40);
        expect(playerFiles).toContain("src/data/players/anders-forss.json");
        expect(playerFiles).toContain("src/data/players/lasse-koskela.json");
    });

    it("hold ids that are unique across the directory", () => {
        // Two files claiming one id is the exact corruption this suite exists to
        // prevent, so it is worth asserting the current state is clean.
        const ids = playerFiles.map((file) => readPlayer(file).id);
        expect(new Set(ids).size).toEqual(ids.length);
    });

    it("are not named after the ids they hold", () => {
        // The premise of the whole suite. If this ever stops being true, the
        // cases below would pass whether or not the resolution is by id, and the
        // regression would be unguarded rather than fixed.
        const namedAfterId = playerFiles.filter((file) => basename(file, ".json") === readPlayer(file).id);
        expect(namedAfterId).toEqual([]);
    });
});

describe("playerDataPath", () => {
    it.each(playerFiles)("resolves %s back to itself", async (file) => {
        const player = readPlayer(file);
        expect(await playerDataPath(player)).toEqual(file);
        expect(await playerDataPath(player.id)).toEqual(file);
    });

    it("returns undefined for a player it has no file for", async () => {
        expect(await playerDataPath("no-such-player")).toBeUndefined();
    });
});

describe("updatePlayerData", () => {
    beforeEach(() => {
        vi.mocked(writeJsonFile).mockClear();
    });

    it.each(playerFiles)("writes a player read from %s back to that same file", async (file) => {
        const player = { ...readPlayer(file), club: "TEST" };

        await updatePlayerData(player);

        expect(vi.mocked(writeJsonFile).mock.calls).toEqual([[file, player]]);
    });

    it("refuses to write a player that has no file, rather than inventing one", async () => {
        const stranger = { ...readPlayer(playerFiles[0]), id: "no-such-player" };

        await expect(updatePlayerData(stranger)).rejects.toBeTruthy();
        expect(writeJsonFile).not.toHaveBeenCalled();
    });
});
