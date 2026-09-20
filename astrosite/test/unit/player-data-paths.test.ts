import { readFileSync } from "fs";
import { basename } from "path";
import { glob } from "glob";
import { describe, expect, it } from "vitest";

import { schema as PlayerSchema, type Player } from "@hector/schemas/src/players.ts";

/**
 * Pins the naming the admin's export depends on: a player's file is named after
 * the `id` it holds.
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
 * **This package no longer writes a player at all.** `updatePlayerData` and
 * `playerDataPath` went with the two workflows on 2026-09-21, so the assertions
 * about a writer landing on the file it read from went with them — there is no
 * writer here to land anywhere. The naming is now asserted for a reader in
 * another package, which is a thinner reason to keep a test and still the right
 * one: nothing else checks it, and the thing it prevents is a silent deletion.
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
