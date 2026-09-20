import { readFileSync } from "fs";
import { basename } from "path";
import { glob } from "glob";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { schema as PlayerSchema, type Player } from "@hector/schemas/src/players.ts";

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
 * Pins the naming every writer of player data depends on: a player's file is
 * named after the `id` it holds, and the two ways of finding it agree.
 *
 * **This suite used to argue the opposite, and the inversion is the point.**
 * Until 2026-09-20 not one of the files was named after its id —
 * `anders-forss.json` held `"id": "anders-f"` — so composing
 * `src/data/players/${player.id}.json` found nothing and created a second file
 * for a player who already had one. Nothing failed at that moment: `playersData`
 * globs the directory, so the site loaded the player twice under one id. The
 * admin's export made the same mistake more expensively, writing forty-five new
 * files and deleting all forty-five real ones as absent from the store.
 *
 * The files were renamed to match their ids as part of step 1 of
 * `docs/plans/authoring-players-and-events.md`, when the admin became the
 * primary writer and human-readable filenames stopped earning their keep. So the
 * composition this suite forbade is now what `admin/scripts/export.ts` does, and
 * what makes that safe is the case below: if a file ever stops being named after
 * its id, this fails before the export can lose it.
 *
 * The rest is unchanged and still worth having. `updatePlayerData` landing on
 * the file the player was read from is the same assertion whether the path is
 * composed or discovered — and `playerDataPath` still globs and matches rather
 * than composing, deliberately, since nothing forces it to and a lookup that
 * cannot invent a path is the safer of the two to leave alone.
 */
const playerFiles = (await glob("src/data/players/**/*.json")).sort();

const readPlayer = (file: string): Player => PlayerSchema.parse(JSON.parse(readFileSync(file, "utf-8")));

describe("player data files", () => {
    it("are found, and are the ones the site loads", () => {
        // Guards against a glob mistake quietly making the cases below vacuous.
        expect(playerFiles.length).toBeGreaterThan(40);
        expect(playerFiles).toContain("src/data/players/anders-f.json");
        expect(playerFiles).toContain("src/data/players/lasse-k.json");
    });

    it("hold ids that are unique across the directory", () => {
        // Two files claiming one id is the exact corruption this suite exists to
        // prevent, so it is worth asserting the current state is clean.
        const ids = playerFiles.map((file) => readPlayer(file).id);
        expect(new Set(ids).size).toEqual(ids.length);
    });

    it("are named after the ids they hold", () => {
        /*
         * The load-bearing one, and the case that changed direction. The admin's
         * export composes `players/{id}.json` on the strength of it, and a file
         * that stopped matching would be written as a new file while the real one
         * was removed as absent from the store. Failing here is how that is a
         * red test rather than a commit that deletes somebody.
         */
        const misnamed = playerFiles.filter((file) => basename(file, ".json") !== readPlayer(file).id);
        expect(misnamed).toEqual([]);
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
