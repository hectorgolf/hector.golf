import type { Loader, LoaderContext } from "astro/loaders";

import { snapshot } from "./data-source.ts";

/**
 * An Astro content collection backed by the data snapshot.
 *
 * ## Why this exists, and how it was nearly missed
 *
 * `src/data/` had two readers, not one. `data.ts` globbed it directly, and
 * `content.config.ts` pointed Astro's own `glob()` loader at the same
 * directories for the pages that use `getCollection()` — the course pages, the
 * hole pages, the brand page.
 *
 * Deleting the directories made the second one return nothing. Nothing failed:
 * `astro check` passed, the build passed, and it produced 77 pages instead of
 * 328 — every course page and all 306 hole pages silently absent, because an
 * empty collection is a legal collection and `getStaticPaths` returning an empty
 * array is a legal answer.
 *
 * That is the exact failure `docs/plans/everything-to-firestore.md` calls the
 * dangerous one, so it is worth being precise about what saved it: nothing did.
 * It was caught by counting pages in the build log. A page count assertion is
 * cheap and is now in `test/unit/data-source.test.ts`.
 */
export function snapshotCollection(key: "players" | "events" | "courses"): Loader {
    return {
        name: `snapshot-${key}`,

        async load({ store, parseData, generateDigest, logger }: LoaderContext): Promise<void> {
            const rows = (await snapshot())[key] as Array<Record<string, unknown>>;

            // Cleared rather than merged. A record deleted in Firestore has to
            // disappear here too, and Astro persists the store between dev-server
            // reloads — so without this, a deletion would keep rendering until
            // somebody cleared `.astro/`.
            store.clear();

            for (const row of rows) {
                const id = String(row.id ?? "");
                if (!id) {
                    // Loud rather than skipped-in-silence: a record with no id is
                    // a record that cannot be linked to, and it would otherwise
                    // vanish exactly the way the 251 pages did.
                    logger.error(`A ${key} record has no id and cannot be loaded: ${JSON.stringify(row).slice(0, 200)}`);
                    continue;
                }
                // `parseData` applies the collection's schema, which is how a
                // record that would not render is caught here rather than on the
                // page. It is also why the extra fields the course files carry —
                // `images.hero`, the Finnish hole descriptions — do not reach the
                // site: the schema does not mention them. Firestore keeps them.
                const data = await parseData({ id, data: row });
                store.set({ id, data, digest: generateDigest(data) });
            }

            logger.info(`Loaded ${rows.length} ${key} from the data snapshot`);
        },
    };
}
