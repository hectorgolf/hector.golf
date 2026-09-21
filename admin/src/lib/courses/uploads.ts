import { IMAGE_TYPES, MAX_UPLOAD_BYTES, assetName, putAsset } from '../assets.ts'

export { assetBucket } from '../assets.ts'

/** What the file input offers, from the one list that decides what is allowed. */
export const ACCEPTED_TYPES = Object.keys(IMAGE_TYPES).join(',')

/**
 * Takes a file off the submitted form and puts it in the bucket.
 *
 * ## Why the upload happens on save, rather than at its own endpoint
 *
 * The obvious build is a separate upload endpoint the browser posts to, with a
 * little script to do it and show progress. This form is `multipart/form-data`
 * instead, so a chosen file arrives with the save that references it and there
 * is no endpoint, no script and no window in which an object exists that no
 * form knows about.
 *
 * The cost is honest and small: a rejected save loses the chosen file, because
 * a browser will not re-populate a file input. Every other box keeps what was
 * typed; this one says "no file chosen" again. For an admin two people use a
 * handful of times a month that is a better trade than a second moving part.
 *
 * ## What it refuses
 *
 * Type and size, both before anything is uploaded. The type list is short and
 * excludes SVG deliberately — see `assets.ts` — because whatever this accepts is
 * eventually written into a directory the public site serves verbatim.
 */
export async function storeUpload(courseId: string, file: File): Promise<string> {
    const extension = IMAGE_TYPES[file.type]
    if (!extension) {
        throw new Error(
            `${file.name} is a ${file.type || 'file of unknown type'}; images must be ${Object.values(IMAGE_TYPES).join(', ')}.`
        )
    }

    if (file.size > MAX_UPLOAD_BYTES) {
        const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`
        throw new Error(`${file.name} is ${mb(file.size)}; the limit is ${mb(MAX_UPLOAD_BYTES)}.`)
    }

    const bytes = new Uint8Array(await file.arrayBuffer())
    return putAsset(assetName('courses', courseId, bytes, extension), bytes, file.type)
}
