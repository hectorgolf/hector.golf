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
    /** The Hector it was written for. */
    eventId: string
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
        eventId: String(draft?.eventId ?? ''),
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
    const { playerId, ...fields } = draft
    await firestore().collection(DRAFTS).doc(playerId).set(fields)
}

export async function deleteBiographyDraft(playerId: string): Promise<void> {
    await firestore().collection(DRAFTS).doc(playerId).delete()
}
