import { t as __exportAll } from "./rolldown-runtime_BBjsoOtd.mjs";
import { t as checkFirestore } from "./firestore_CD0Y0VvD.mjs";
//#region src/pages/readyz.ts
var readyz_exports = /* @__PURE__ */ __exportAll({ GET: () => GET });
/** Readiness: does depend on Firestore, and says 503 when it cannot reach it. */
var GET = async () => {
	const status = await checkFirestore();
	return new Response(JSON.stringify(status), {
		status: status.reachable ? 200 : 503,
		headers: { "content-type": "application/json" }
	});
};
//#endregion
//#region \0virtual:astro:page:src/pages/readyz@_@ts
var page = () => readyz_exports;
//#endregion
export { page };
