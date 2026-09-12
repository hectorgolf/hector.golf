import { t as __exportAll } from "./rolldown-runtime_BBjsoOtd.mjs";
//#region src/pages/healthz.ts
var healthz_exports = /* @__PURE__ */ __exportAll({ GET: () => GET });
/**
* Liveness. Touches nothing on purpose: a probe that depends on Firestore turns
* a database blip into a restart loop, which is strictly worse than a running
* service reporting that its database is unreachable. `/readyz` is the one that
* checks.
*/
var GET = () => new Response("ok\n", { status: 200 });
//#endregion
//#region \0virtual:astro:page:src/pages/healthz@_@ts
var page = () => healthz_exports;
//#endregion
export { page };
