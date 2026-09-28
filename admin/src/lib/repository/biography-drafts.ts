import { firestore } from '../firestore.ts'

/**
 * Generated biographies waiting for somebody to read them.
 *
 * Kept apart from `players` so that nothing the export or the site reads can see
 * a draft: a biography reaches a player record only when it is approved on
 * `/players/biographies`, and reaches the site only through the export after that.
 */
export type BiographyDraft = {
    playerId: string
    biography: string[]
    /**
     * The Hector it was written for, when one was upcoming.
     *
     * Absent rather than empty for a draft written out of season, which the
     * sweep never produces and a single-player draft can: the sweep exists to
     * refresh the field of the next Hector and stops when there is not one, but
     * somebody asking for one player is asking about that player rather than
     * about an event. The prompt leaves out the "next event" lines when it has
     * none, so the text is honest either way — this is what says which.
     */
    eventId?: string
    generatedAt: string
}

const DRAFTS = 'biographyDrafts'

function parse(raw: unknown, id: string): BiographyDraft | undefined {
    const draft = raw as Partial<BiographyDraft> | undefined
    const biography = draft?.biography
    if (!Array.isArray(biography) || biography.some((p) => typeof p !== 'string')) {
        console.error(`Stored biography draft ${id} has no biography; skipping it`)
        return undefined
    }
    return {
        playerId: id,
        biography,
        eventId: draft?.eventId ? String(draft.eventId) : undefined,
        generatedAt: String(draft?.generatedAt ?? ''),
    }
}

export async function listBiographyDrafts(): Promise<BiographyDraft[]> {
    const snapshot = await firestore().collection(DRAFTS).get()
    return snapshot.docs
        .map((d) => parse(d.data(), d.id))
        .filter((d): d is BiographyDraft => d !== undefined)
        .sort((a, b) => a.playerId.localeCompare(b.playerId))
}

export async function getBiographyDraft(playerId: string): Promise<BiographyDraft | undefined> {
    const doc = await firestore().collection(DRAFTS).doc(playerId).get()
    return doc.exists ? parse(doc.data(), playerId) : undefined
}

/** One draft per player: a later run replaces a draft nobody has reviewed yet. */
export async function saveBiographyDraft(draft: BiographyDraft): Promise<void> {
    const { playerId, biography, generatedAt, eventId } = draft
    await firestore()
        .collection(DRAFTS)
        .doc(playerId)
        .set({
            biography,
            generatedAt,
            // Firestore rejects `undefined` outright rather than skipping the
            // field, so an absent event has to be an absent key. `jobs/log.ts`
            // strips them the same way and for the same reason.
            ...(eventId ? { eventId } : {}),
        })
}

export async function deleteBiographyDraft(playerId: string): Promise<void> {
    await firestore().collection(DRAFTS).doc(playerId).delete()
}
