import { t as __exportAll } from "./rolldown-runtime_BBjsoOtd.mjs";
import { d as renderTemplate, f as maybeRenderHead, i as renderComponent, m as addAttribute } from "./server_DYlekdjc.mjs";
import { t as createComponent } from "./compiler_DprN28tx.mjs";
import { i as SECTIONS, n as $$AdminLayout, t as $$PageHeader } from "./PageHeader_BIunCCfm.mjs";
//#region src/pages/index.astro
var pages_exports = /* @__PURE__ */ __exportAll({
	default: () => $$Index,
	file: () => $$file,
	url: () => ""
});
var $$Index = createComponent(($$result, $$props, $$slots) => {
	return renderTemplate`${renderComponent($$result, "AdminLayout", $$AdminLayout, {
		"title": "Dashboard",
		"data-astro-cid-lcdefpme": true
	}, { "default": ($$result) => renderTemplate`${renderComponent($$result, "PageHeader", $$PageHeader, {
		"title": "Admin",
		"lede": "Manage the data behind hector.golf.",
		"data-astro-cid-lcdefpme": true
	})}${maybeRenderHead($$result)}<div class="sections" data-astro-cid-lcdefpme>${SECTIONS.map((section) => renderTemplate`<article${addAttribute([
		"card",
		"section-card",
		{ soon: !section.available }
	], "class:list")} data-astro-cid-lcdefpme><h2 data-astro-cid-lcdefpme>${section.available ? renderTemplate`<a${addAttribute(`/${section.slug}`, "href")} data-astro-cid-lcdefpme>${section.label}</a>` : section.label}${!section.available && renderTemplate`<span class="pill pill-outline" data-astro-cid-lcdefpme>Not built yet</span>`}</h2><p data-astro-cid-lcdefpme>${section.blurb}</p></article>`)}</div>` })}`;
}, "/Users/lkoskela/OSS/hectorgolf/hector.golf/.claude/worktrees/json-turso-migration-ca756d/admin/src/pages/index.astro", void 0);
var $$file = "/Users/lkoskela/OSS/hectorgolf/hector.golf/.claude/worktrees/json-turso-migration-ca756d/admin/src/pages/index.astro";
//#endregion
//#region \0virtual:astro:page:src/pages/index@_@astro
var page = () => pages_exports;
//#endregion
export { page };
