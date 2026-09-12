import { Firestore } from "@google-cloud/firestore";
//#region src/lib/firestore.ts
/**
* Which database to talk to. Set by `terraform/cloud_run.tf` from the database
* resource, so the deployed service and the Terraform that created the database
* cannot disagree. Unset locally, where the client falls back to `(default)` —
* a *different* database, and one this project has no free tier left to spare.
*/
var databaseId = process.env.FIRESTORE_DATABASE_ID ?? "(default)";
/**
* Built on first use, not at import time: constructing it resolves credentials,
* and `astro check`, the tests and a laptop that has never authenticated must all
* work without any. Only a request that actually reads data should need them.
*/
var client;
function firestore() {
	client ??= new Firestore({ databaseId });
	return client;
}
/** https://grpc.github.io/grpc/core/md_doc_statuscodes.html */
var REASON_BY_GRPC_CODE = {
	4: "deadline-exceeded",
	5: "not-found",
	7: "permission-denied",
	14: "unavailable",
	16: "unauthenticated"
};
function classify(error) {
	const code = error?.code;
	return typeof code === "number" && REASON_BY_GRPC_CODE[code] || "unknown";
}
/**
* Listing collections is valid on an empty database and returns nothing, so this
* answers "can I reach it" without requiring anything to exist yet.
*
* The full error goes to stderr, which Cloud Run collects into Cloud Logging.
* That is where to look when the reason alone is not enough — deliberately a
* place that requires a Google Cloud role to read, rather than a page load.
*/
async function checkFirestore() {
	try {
		await firestore().listCollections();
		return {
			reachable: true,
			databaseId
		};
	} catch (error) {
		console.error("Firestore unreachable", { databaseId }, error);
		return {
			reachable: false,
			databaseId,
			reason: classify(error)
		};
	}
}
//#endregion
export { firestore as n, checkFirestore as t };
