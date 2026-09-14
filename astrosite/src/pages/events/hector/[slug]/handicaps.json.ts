import type { APIRoute } from "astro";

import { type HectorEvent } from "@hector/schemas/src/events.ts";
import { getAllEventIds, getEventById } from "../../../../code/events";
import { fieldHandicaps } from "../../../../code/field-handicaps";

/**
 * Every Hector gets a handicaps file, including the ones long finished: a past
 * event's field is a fact about it, and app.hector.golf asking for one it cannot
 * have is a worse failure mode than a file nobody fetches.
 */
export function getStaticPaths() {
    return getAllEventIds((event) => event.format === "hector").map((id) => ({ params: { slug: id } }));
}

export const GET: APIRoute = ({ params }) => {
    const event = params.slug ? (getEventById(params.slug) as HectorEvent | undefined) : undefined;
    if (!event) {
        return new Response(JSON.stringify({ error: `No such event: ${params.slug}` }), {
            status: 404,
            headers: { "content-type": "application/json" },
        });
    }
    // The header matters to `astro dev` and `astro preview` only. The built site is
    // static files on GitHub Pages, which types a response from its extension — and
    // sends `access-control-allow-origin: *` on every one of them, which is what
    // lets app.hector.golf fetch this cross-origin without a proxy.
    return new Response(JSON.stringify(fieldHandicaps(event), null, 2) + "\n", {
        headers: { "content-type": "application/json; charset=utf-8" },
    });
};
