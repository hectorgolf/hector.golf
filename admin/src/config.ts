/**
 * Everything the service reads from its environment, resolved once at startup so
 * a missing value fails loudly here rather than on the first request that needs it.
 */

/** Cloud Run supplies PORT; 8080 is its default and the one to use locally. */
export const port = Number(process.env.PORT ?? 8080);

/**
 * Which Firestore database to talk to.
 *
 * Set by `terraform/cloud_run.tf` from the database resource, so the deployed
 * service and the Terraform that created the database cannot disagree about the
 * name. Locally this is unset and the client falls back to `(default)`, which is
 * almost certainly not what you want — see the README.
 */
export const firestoreDatabaseId = process.env.FIRESTORE_DATABASE_ID ?? "(default)";

/**
 * The GCP project. Cloud Run does not set this, but the Firestore client finds it
 * through Application Default Credentials, so it is only needed for display.
 */
export const projectId = process.env.GOOGLE_CLOUD_PROJECT ?? process.env.GCLOUD_PROJECT;

/** Commit this image was built from. Set by the deploy workflow; empty locally. */
export const revision = process.env.GIT_SHA ?? "dev";
