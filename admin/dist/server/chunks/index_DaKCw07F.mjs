import { t as __exportAll } from "./rolldown-runtime_BBjsoOtd.mjs";
import { d as renderTemplate, f as maybeRenderHead, i as renderComponent, m as addAttribute } from "./server_DYlekdjc.mjs";
import { t as createComponent } from "./compiler_DprN28tx.mjs";
import { n as $$AdminLayout, t as $$PageHeader } from "./PageHeader_BIunCCfm.mjs";
import { c as formatEventDates, r as listMatchplayEvents, s as matchplayStatus } from "./events_iuFPS_Z_.mjs";
//#region src/pages/matchplay/index.astro
var matchplay_exports = /* @__PURE__ */ __exportAll({
	default: () => $$Index,
	file: () => $$file,
	url: () => $$url
});
var $$Index = createComponent(async ($$result, $$props, $$slots) => {
	let events = [];
	let error;
	try {
		events = await listMatchplayEvents();
	} catch {
		error = "Could not read the tournaments. Check the service logs.";
	}
	const STATUS_PILL = {
		signup: "pill-outline",
		started: "pill-matchplay",
		complete: "pill-violet"
	};
	return renderTemplate`${renderComponent($$result, "AdminLayout", $$AdminLayout, { "title": "Matchplay" }, { "default": ($$result) => renderTemplate`${maybeRenderHead($$result)}<div class="row-between">${renderComponent($$result, "PageHeader", $$PageHeader, {
		"title": "Matchplay",
		"lede": "Every Hector Matchplay tournament."
	})}<a href="/matchplay/new"><button>New tournament</button></a></div>${error && renderTemplate`<p class="notice bad">${error}</p>`}${!error && events.length === 0 && renderTemplate`<p class="notice">No tournaments yet. Create one to get started.</p>`}${events.length > 0 && renderTemplate`<div class="tablewrap"><table class="grid"><thead><tr><th>Tournament</th><th>When</th><th>Field</th><th>Status</th></tr></thead><tbody>${events.map((event) => {
		const status = matchplayStatus(event);
		return renderTemplate`<tr><td><a${addAttribute(`/matchplay/${event.id}`, "href")}>${event.name}</a></td><td class="num">${formatEventDates(event)}</td><td class="num">${event.participants.length}</td><td><span${addAttribute(["pill", STATUS_PILL[status]], "class:list")}>${status}</span></td></tr>`;
	})}</tbody></table></div>`}` })}`;
}, "/Users/lkoskela/OSS/hectorgolf/hector.golf/.claude/worktrees/json-turso-migration-ca756d/admin/src/pages/matchplay/index.astro", void 0);
var $$file = "/Users/lkoskela/OSS/hectorgolf/hector.golf/.claude/worktrees/json-turso-migration-ca756d/admin/src/pages/matchplay/index.astro";
var $$url = "/matchplay";
//#endregion
//#region \0virtual:astro:page:src/pages/matchplay/index@_@astro
var page = () => matchplay_exports;
//#endregion
export { page };
