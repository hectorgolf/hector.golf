import { S as createAstro, a as Fragment, c as renderSlot, d as renderTemplate, f as maybeRenderHead, i as renderComponent, m as addAttribute, p as renderHead } from "./server_DYlekdjc.mjs";
import { t as createComponent } from "./compiler_DprN28tx.mjs";
//#region ../packages/ui/components/HectorMark.astro
createAstro("https://astro.build");
var $$HectorMark = createComponent(($$result, $$props, $$slots) => {
	const Astro = $$result.createAstro($$props, $$slots);
	Astro.self = $$HectorMark;
	const { size = 24, class: className, title } = Astro.props;
	return renderTemplate`${maybeRenderHead($$result)}<svg viewBox="0 0 600 600"${addAttribute(size, "width")}${addAttribute(size, "height")} fill="none"${addAttribute(className, "class")}${addAttribute(title ? "img" : "presentation", "role")}${addAttribute(title, "aria-label")}${addAttribute(title ? void 0 : "true", "aria-hidden")}><g transform="translate(96.4092, 31.572)"><path fill-rule="evenodd" fill="currentColor" d="M48.514946,390.280675 L85.291257,390.280675 L74.241545,419.754359 L59.801315,419.754359 L59.801315,460.175411 L11.269325,460.175411 L0,536.80699 L381.498684,536.80699 L370.229317,460.175411 L321.696052,460.175411 L321.696052,419.754359 L307.937685,419.754359 C311.435279,413.860403 313.443421,406.978742 313.443421,399.628043 C313.443421,377.815708 295.761019,360.133306 273.948684,360.133306 C271.495785,360.133306 269.095127,360.356908 266.765954,360.784869 L280.350575,324.14484 L298.322903,312.676768 L343.838795,172.135239 L298.445065,112.688281 L283.787335,74.5344158 L321.210423,74.5344158 L302.688548,23.1797287 L279.195559,16.001727 L274.32722,0 L199.538219,5.7981497 L185.162438,125.52278 L172.807607,125.52278 L48.514946,390.280675 Z M271.74634,125.52278 L204.669983,125.52278 L216.874527,23.8806744 L260.322861,20.5122533 L263.668811,31.5099918 L287.757894,38.8701481 L293.635259,55.1659948 L255.597944,55.1659948 L281.362787,122.231497 L322.285526,175.823356 L294.053906,262.995395 L271.74634,125.52278 Z M107.392835,386.501645 L291.972389,269.422595 L282.040028,300.091201 L95.168421,419.333306 L95.08421,419.333306 L107.392835,386.501645 Z M302.327631,460.175411 L302.327631,439.12278 L79.169736,439.12278 L79.169736,460.175411 L302.327631,460.175411 Z M27.997779,479.543832 L22.425041,517.438569 L359.073643,517.438569 L353.500904,479.543832 L27.997779,479.543832 Z M205.043318,419.754359 L130.515049,419.754359 L196.172204,377.858758 L205.043318,419.754359 Z M294.075,399.628043 C294.075,410.743504 285.064144,419.754359 273.948684,419.754359 C262.833223,419.754359 253.822368,410.743504 253.822368,399.628043 C253.822368,388.512582 262.833223,379.501727 273.948684,379.501727 C285.064144,379.501727 294.075,388.512582 294.075,399.628043 Z M224.624712,418.732114 L213.613528,366.729523 L253.292352,341.410609 L224.624712,418.732114 Z M255.267475,144.891201 L273.640152,258.114597 L95.810382,370.912254 L79.004132,370.912254 L88.487438,350.711719 L195.723149,282.691941 L191.442311,262.471135 L103.82098,318.049466 L119.901089,283.796978 L186.953063,241.26581 L182.672245,221.044984 L135.234642,251.134704 L185.111492,144.891201 L255.267475,144.891201 Z"></path></g></svg>`;
}, "/Users/lkoskela/OSS/hectorgolf/hector.golf/.claude/worktrees/json-turso-migration-ca756d/packages/ui/components/HectorMark.astro", void 0);
//#endregion
//#region src/lib/sections.ts
var SECTIONS = [
	{
		slug: "matchplay",
		label: "Matchplay",
		blurb: "Create a tournament, manage its field, draw the bracket and record results.",
		available: true
	},
	{
		slug: "events",
		label: "Events",
		blurb: "Hector and Finnkampen events: rounds, game formats and the courses they are played on.",
		available: false
	},
	{
		slug: "courses",
		label: "Courses",
		blurb: "Tees, ratings, slope and the per-hole descriptions the course guides render.",
		available: false
	},
	{
		slug: "players",
		label: "Players",
		blurb: "Profiles, biography text and the prompt hints the biography generator reads.",
		available: false
	}
];
/** Which section a pathname belongs to, for marking the nav item current. */
function sectionForPath(pathname) {
	const first = pathname.split("/").filter(Boolean)[0];
	return SECTIONS.find((s) => s.slug === first);
}
//#endregion
//#region src/lib/identity.ts
/** IAP prefixes the identity with its provider, e.g. `accounts.google.com:me@example.com`. */
function stripProvider(value) {
	const separator = value.indexOf(":");
	return separator === -1 ? value : value.slice(separator + 1);
}
function viewerFromHeaders(headers) {
	const raw = headers.get("x-goog-authenticated-user-email");
	if (!raw) return { authenticated: false };
	const email = stripProvider(raw).trim();
	return email ? {
		email,
		authenticated: true
	} : { authenticated: false };
}
//#endregion
//#region src/layouts/AdminLayout.astro
createAstro("https://astro.build");
var $$AdminLayout = createComponent(($$result, $$props, $$slots) => {
	const Astro = $$result.createAstro($$props, $$slots);
	Astro.self = $$AdminLayout;
	const { title } = Astro.props;
	const current = sectionForPath(Astro.url.pathname);
	const viewer = viewerFromHeaders(Astro.request.headers);
	return renderTemplate`<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title} · Hector Admin</title><!-- Nothing here is public, so keep it out of indexes regardless of IAP. --><meta name="robots" content="noindex, nofollow">${renderHead($$result)}</head><body><header class="topbar"><a href="/" class="brand">${renderComponent($$result, "HectorMark", $$HectorMark, {})}<span>Admin</span></a><nav aria-label="Sections">${SECTIONS.map((section) => section.available ? renderTemplate`<a${addAttribute(`/${section.slug}`, "href")}${addAttribute(current?.slug === section.slug ? "page" : void 0, "aria-current")}>${section.label}</a>` : renderTemplate`<span class="soon" title="Not built yet">${section.label}</span>`)}</nav><span class="who">${viewer.email ?? "not signed in"}</span></header><main>${renderSlot($$result, $$slots["default"])}</main></body></html>`;
}, "/Users/lkoskela/OSS/hectorgolf/hector.golf/.claude/worktrees/json-turso-migration-ca756d/admin/src/layouts/AdminLayout.astro", void 0);
//#endregion
//#region ../packages/ui/components/PageHeader.astro
createAstro("https://astro.build");
var $$PageHeader = createComponent(($$result, $$props, $$slots) => {
	const Astro = $$result.createAstro($$props, $$slots);
	Astro.self = $$PageHeader;
	const { title, eyebrow, meta, lede, align = "left" } = Astro.props;
	const metaParts = (meta ?? []).filter((part) => !!part);
	return renderTemplate`${maybeRenderHead($$result)}<header class="page-header"${addAttribute(align, "data-align")} data-astro-cid-ncvbubqc>${eyebrow && renderTemplate`<span class="eyebrow" data-astro-cid-ncvbubqc>${eyebrow}</span>`}<h1 data-astro-cid-ncvbubqc>${title}</h1>${metaParts.length > 0 && renderTemplate`<span class="meta meta-parts" data-astro-cid-ncvbubqc>${metaParts.map((part, index) => renderTemplate`${renderComponent($$result, "Fragment", Fragment, {}, { "default": ($$result) => renderTemplate`${index > 0 && renderTemplate`<span class="meta-separator" aria-hidden="true" data-astro-cid-ncvbubqc>·</span>`}<span class="meta-part" data-astro-cid-ncvbubqc>${part}</span>` })}`)}</span>`}${lede && renderTemplate`<p class="lede" data-astro-cid-ncvbubqc>${lede}</p>`}${renderSlot($$result, $$slots["default"])}</header>`;
}, "/Users/lkoskela/OSS/hectorgolf/hector.golf/.claude/worktrees/json-turso-migration-ca756d/packages/ui/components/PageHeader.astro", void 0);
//#endregion
export { SECTIONS as i, $$AdminLayout as n, viewerFromHeaders as r, $$PageHeader as t };
