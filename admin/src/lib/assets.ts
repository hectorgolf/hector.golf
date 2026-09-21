import { createHash } from 'node:crypto'

import { Storage } from '@google-cloud/storage'

/**
 * Files somebody uploaded in the admin, on their way to the repository.
 *
 * One bucket for everything the admin accepts, prefixed by what the file
 * belongs to — `terraform/storage.tf` says why one rather than three. Course
 * descriptions are the first caller; player portraits and event heroes are the
 * ones it was named `assets` for.
 *
 * ## Nothing here is served
 *
 * An object in this bucket is not public and never becomes public. The site
 * reads committed files under `astrosite/public/`, and `npm run export`
 * downloads what a record references and writes it there. So an upload reaches
 * the public site through the same Publish press as the record that references
 * it, which is the property the whole arrangement exists for: a photograph
 * dropped into the wrong course is a mistake somebody fixes, not a commit in
 * the repository's history.
 */

/**
 * Where this service puts uploads. Unset on a laptop, which is a supported
 * state — the editor says uploading is unavailable rather than failing at it.
 */
export const assetBucket = process.env.ASSET_BUCKET

/** The collections that may own an uploaded file. */
export type AssetOwner = 'courses' | 'players' | 'events'

/**
 * What a file is called in the bucket, and the only place that decides.
 *
 * `{owner}/{recordId}/{digest}.{ext}` — one function rather than a convention,
 * because a prefix invented at a call site is how two collections end up
 * sharing a directory, and nothing about a flat object name would complain.
 *
 * **The digest is of the bytes**, which buys two things worth more than a
 * shorter name. Uploading the same picture twice writes the same object rather
 * than a second copy, so replacing an image with itself is genuinely nothing.
 * And because the export names the committed file after the object, an image
 * that has not changed produces no diff — the alternative, a random id per
 * upload, would rewrite a file in git every time somebody re-picked the same
 * photograph.
 */
export function assetName(owner: AssetOwner, recordId: string, bytes: Uint8Array, extension: string): string {
    const digest = createHash('sha256').update(bytes).digest('hex').slice(0, 16)
    return `${owner}/${recordId}/${digest}.${extension.replace(/^\.+/, '').toLowerCase()}`
}

/**
 * The image types the editor accepts, and what each is called on disk.
 *
 * A list rather than "anything that says image/*", because the extension ends
 * up in a filename the site serves and a browser has to guess a type for. SVG
 * is deliberately absent: it is a document that can carry script, and this
 * bucket's contents are written into a directory the site serves verbatim.
 */
export const IMAGE_TYPES: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/avif': 'avif',
}

/**
 * How large an upload may be.
 *
 * Generous for a photograph and small enough that a mistake is not expensive:
 * the committed copy of every one of these ends up in git history for good, and
 * `astrosite/public/images/courses/` is already 160 MB.
 */
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024

let client: Storage | undefined
const storage = (): Storage => (client ??= new Storage())

/** Thrown when this deployment has nowhere to put a file. */
export class NoAssetBucketError extends Error {
    readonly notConfigured = true

    constructor() {
        super('This service has no asset bucket configured, so it cannot accept an upload.')
        this.name = 'NoAssetBucketError'
    }
}

/**
 * Stores a file and answers the name it was given.
 *
 * Idempotent by construction: the name is the digest, so writing the same bytes
 * twice is the same object written twice with the same content.
 */
export async function putAsset(name: string, bytes: Uint8Array, contentType: string): Promise<string> {
    if (!assetBucket) throw new NoAssetBucketError()

    await storage()
        .bucket(assetBucket)
        .file(name)
        .save(Buffer.from(bytes), {
            contentType,
            // The object is immutable — its name is its digest — so anything
            // that does cache it may cache it for good.
            metadata: { cacheControl: 'public, max-age=31536000, immutable' },
        })

    return name
}

/** One object's bytes, for the export to write into the repository. */
export async function getAsset(name: string): Promise<Buffer> {
    if (!assetBucket) throw new NoAssetBucketError()
    const [contents] = await storage().bucket(assetBucket).file(name).download()
    return contents
}

/**
 * Whether an object is there, without downloading it.
 *
 * The editor uses this to tell a reference that has lost its object from one
 * that simply has not been published yet, which are otherwise the same blank
 * square.
 */
export async function assetExists(name: string): Promise<boolean> {
    if (!assetBucket) return false
    try {
        const [exists] = await storage().bucket(assetBucket).file(name).exists()
        return exists
    } catch {
        return false
    }
}
