import { t as __exportAll } from "./rolldown-runtime_BBjsoOtd.mjs";
import { S as createAstro, d as renderTemplate, f as maybeRenderHead, i as renderComponent, m as addAttribute } from "./server_DYlekdjc.mjs";
import { t as createComponent } from "./compiler_DprN28tx.mjs";
import { n as $$AdminLayout, r as viewerFromHeaders, t as $$PageHeader } from "./PageHeader_BIunCCfm.mjs";
import { a as saveMatchplayEvent, o as matchplayEventSchema, t as eventExists } from "./events_iuFPS_Z_.mjs";
//#region src/pages/matchplay/new.astro
var new_exports = /* @__PURE__ */ __exportAll({
	default: () => $$New,
	file: () => $$file,
	url: () => $$url
});
createAstro("https://astro.build");
var $$New = createComponent(async ($$result, $$props, $$slots) => {
	const Astro = $$result.createAstro($$props, $$slots);
	Astro.self = $$New;
	let error;
	let submitted = {};
	if (Astro.request.method === "POST") {
		const form = await Astro.request.formData();
		submitted = Object.fromEntries([...form.entries()].map(([k, v]) => [k, String(v)]));
		const candidate = {
			id: submitted.id?.trim().toUpperCase(),
			name: submitted.name?.trim(),
			location: submitted.location?.trim(),
			timing: {
				start: submitted.start,
				end: submitted.end
			},
			description: submitted.description?.trim() || void 0,
			format: "matchplay",
			status: "signup",
			participants: []
		};
		const parsed = matchplayEventSchema.safeParse(candidate);
		if (!parsed.success) error = parsed.error.issues.map((i) => `${i.path.join(".") || "form"}: ${i.message}`).join("; ");
		else if (await eventExists(parsed.data.id)) error = `A tournament with id ${parsed.data.id} already exists.`;
		else {
			const viewer = viewerFromHeaders(Astro.request.headers);
			await saveMatchplayEvent(parsed.data, viewer.email ?? "unknown");
			return Astro.redirect(`/matchplay/${parsed.data.id}`);
		}
	}
	const thisYear = (/* @__PURE__ */ new Date()).getFullYear();
	return renderTemplate`${renderComponent($$result, "AdminLayout", $$AdminLayout, {
		"title": "New tournament",
		"data-astro-cid-bkeu3kzs": true
	}, { "default": ($$result) => renderTemplate`${renderComponent($$result, "PageHeader", $$PageHeader, {
		"title": "New matchplay tournament",
		"lede": "It starts in signup, where the field can still change. The bracket is drawn later.",
		"data-astro-cid-bkeu3kzs": true
	})}${error && renderTemplate`${maybeRenderHead($$result)}<p class="notice bad" data-astro-cid-bkeu3kzs>${error}</p>`}<form method="POST" class="stack" data-astro-cid-bkeu3kzs><div class="field" data-astro-cid-bkeu3kzs><label for="id" data-astro-cid-bkeu3kzs>Id</label><input id="id" name="id" type="text" required${addAttribute(submitted.id ?? `HECTORMATCHPLAY${thisYear}`, "value")} data-astro-cid-bkeu3kzs><span class="hint" data-astro-cid-bkeu3kzs>Uppercase, no spaces. Becomes the URL on the public site and cannot be changed later.</span></div><div class="field" data-astro-cid-bkeu3kzs><label for="name" data-astro-cid-bkeu3kzs>Name</label><input id="name" name="name" type="text" required${addAttribute(submitted.name ?? `Hector Matchplay ${thisYear}`, "value")} data-astro-cid-bkeu3kzs></div><div class="field" data-astro-cid-bkeu3kzs><label for="location" data-astro-cid-bkeu3kzs>Location</label><input id="location" name="location" type="text" required${addAttribute(submitted.location ?? "Finland", "value")} data-astro-cid-bkeu3kzs></div><div class="pair" data-astro-cid-bkeu3kzs><div class="field" data-astro-cid-bkeu3kzs><label for="start" data-astro-cid-bkeu3kzs>First day</label><input id="start" name="start" type="date" required${addAttribute(submitted.start ?? "", "value")} data-astro-cid-bkeu3kzs></div><div class="field" data-astro-cid-bkeu3kzs><label for="end" data-astro-cid-bkeu3kzs>Last day</label><input id="end" name="end" type="date" required${addAttribute(submitted.end ?? "", "value")} data-astro-cid-bkeu3kzs></div></div><div class="field" data-astro-cid-bkeu3kzs><label for="description" data-astro-cid-bkeu3kzs>Description</label><textarea id="description" name="description" rows="4" data-astro-cid-bkeu3kzs>${submitted.description ?? ""}</textarea><span class="hint" data-astro-cid-bkeu3kzs>Shown on the public event page. Optional.</span></div><div class="actions" data-astro-cid-bkeu3kzs><button type="submit" data-astro-cid-bkeu3kzs>Create</button><a href="/matchplay" data-astro-cid-bkeu3kzs><button type="button" class="secondary" data-astro-cid-bkeu3kzs>Cancel</button></a></div></form>` })}`;
}, "/Users/lkoskela/OSS/hectorgolf/hector.golf/.claude/worktrees/json-turso-migration-ca756d/admin/src/pages/matchplay/new.astro", void 0);
var $$file = "/Users/lkoskela/OSS/hectorgolf/hector.golf/.claude/worktrees/json-turso-migration-ca756d/admin/src/pages/matchplay/new.astro";
var $$url = "/matchplay/new";
//#endregion
//#region \0virtual:astro:page:src/pages/matchplay/new@_@astro
var page = () => new_exports;
//#endregion
export { page };
