import { t as __exportAll } from "./rolldown-runtime_BBjsoOtd.mjs";
import { S as createAstro, a as Fragment, d as renderTemplate, f as maybeRenderHead, i as renderComponent, m as addAttribute } from "./server_DYlekdjc.mjs";
import { t as createComponent } from "./compiler_DprN28tx.mjs";
import { n as $$AdminLayout, r as viewerFromHeaders, t as $$PageHeader } from "./PageHeader_BIunCCfm.mjs";
import { a as saveMatchplayEvent, c as formatEventDates, i as listPlayers, n as getMatchplayEvent, s as matchplayStatus } from "./events_iuFPS_Z_.mjs";
//#region src/lib/players.ts
/** How a player is named in the admin UI: full, never privacy-shortened. */
function fullName(player) {
	return `${player.name.first} ${player.name.last}`;
}
function nameById(players) {
	return new Map(players.map((p) => [p.id, fullName(p)]));
}
/** Resolve an id to a name, falling back to the id so a stale reference is visible. */
function displayName(names, id) {
	if (!id) return "—";
	return names.get(id) ?? id;
}
//#endregion
//#region src/components/Roster.astro
createAstro("https://astro.build");
var $$Roster = createComponent(($$result, $$props, $$slots) => {
	const Astro = $$result.createAstro($$props, $$slots);
	Astro.self = $$Roster;
	const { event, players, names } = Astro.props;
	const inField = event.participants;
	const available = players.filter((p) => !inField.includes(p.id)).sort((a, b) => fullName(a).localeCompare(fullName(b)));
	return renderTemplate`${maybeRenderHead($$result)}<section class="stack" data-astro-cid-eqfns3pq><div class="row-between" data-astro-cid-eqfns3pq><h2 data-astro-cid-eqfns3pq>Field</h2><span class="meta" data-astro-cid-eqfns3pq>${inField.length} ${inField.length === 1 ? "player" : "players"}</span></div>${inField.length === 0 && renderTemplate`<p class="notice" data-astro-cid-eqfns3pq>Nobody has been added yet.</p>`}${inField.length > 0 && renderTemplate`<div class="tablewrap" data-astro-cid-eqfns3pq><table class="grid" data-astro-cid-eqfns3pq><thead data-astro-cid-eqfns3pq><tr data-astro-cid-eqfns3pq><th data-astro-cid-eqfns3pq>Player</th><th data-astro-cid-eqfns3pq>Handicap</th><th data-astro-cid-eqfns3pq></th></tr></thead><tbody data-astro-cid-eqfns3pq>${inField.map((pid) => {
		const player = players.find((p) => p.id === pid);
		return renderTemplate`<tr data-astro-cid-eqfns3pq><td data-astro-cid-eqfns3pq>${names.get(pid) ?? pid}</td><td class="num" data-astro-cid-eqfns3pq>${player?.handicap ?? "—"}</td><td class="right" data-astro-cid-eqfns3pq><form method="POST" data-astro-cid-eqfns3pq><input type="hidden" name="action" value="remove-player" data-astro-cid-eqfns3pq><input type="hidden" name="playerId"${addAttribute(pid, "value")} data-astro-cid-eqfns3pq><button type="submit" class="secondary" data-astro-cid-eqfns3pq>Remove</button></form></td></tr>`;
	})}</tbody></table></div>`}${available.length > 0 && renderTemplate`<form method="POST" class="add" data-astro-cid-eqfns3pq><input type="hidden" name="action" value="add-player" data-astro-cid-eqfns3pq><div class="field" data-astro-cid-eqfns3pq><label for="playerId" data-astro-cid-eqfns3pq>Add a player</label><select id="playerId" name="playerId" data-astro-cid-eqfns3pq>${available.map((p) => renderTemplate`<option${addAttribute(p.id, "value")} data-astro-cid-eqfns3pq>${fullName(p)}${p.handicap !== void 0 ? ` (${p.handicap})` : ""}</option>`)}</select></div><button type="submit" data-astro-cid-eqfns3pq>Add</button></form>`}</section>`;
}, "/Users/lkoskela/OSS/hectorgolf/hector.golf/.claude/worktrees/json-turso-migration-ca756d/admin/src/components/Roster.astro", void 0);
//#endregion
//#region src/components/BracketBoard.astro
createAstro("https://astro.build");
var $$BracketBoard = createComponent(($$result, $$props, $$slots) => {
	const Astro = $$result.createAstro($$props, $$slots);
	Astro.self = $$BracketBoard;
	const { bracket, names, readonly = false } = Astro.props;
	function roundName(round, total) {
		const fromEnd = total - round;
		if (fromEnd === 0) return "Final";
		if (fromEnd === 1) return "Semi-finals";
		if (fromEnd === 2) return "Quarter-finals";
		return `Round ${round}`;
	}
	return renderTemplate`${maybeRenderHead($$result)}<section class="stack" data-astro-cid-joqibaeh><h2 data-astro-cid-joqibaeh>Bracket</h2>${bracket.map((round) => renderTemplate`<div class="round" data-astro-cid-joqibaeh><h3 data-astro-cid-joqibaeh>${roundName(round.round, bracket.length)}</h3><div class="matches" data-astro-cid-joqibaeh>${round.matches.map((match) => {
		const decided = match.winner !== null;
		const ready = match.left !== null && match.right !== null;
		return renderTemplate`<article${addAttribute([
			"card",
			"match",
			{
				decided,
				waiting: !ready
			}
		], "class:list")} data-astro-cid-joqibaeh><div class="players" data-astro-cid-joqibaeh><span${addAttribute({ won: match.winner === match.left }, "class:list")} data-astro-cid-joqibaeh>${displayName(names, match.left)}</span><span class="v" data-astro-cid-joqibaeh>v</span><span${addAttribute({ won: match.winner === match.right }, "class:list")} data-astro-cid-joqibaeh>${displayName(names, match.right)}</span></div>${decided && renderTemplate`<p class="result" data-astro-cid-joqibaeh><span class="score" data-astro-cid-joqibaeh>${match.score}</span></p>`}${!decided && !ready && renderTemplate`<p class="hint" data-astro-cid-joqibaeh>Waiting on ${match.leftSource} and ${match.rightSource}</p>`}${!decided && ready && !readonly && renderTemplate`<form method="POST" class="record" data-astro-cid-joqibaeh><input type="hidden" name="action" value="record" data-astro-cid-joqibaeh><input type="hidden" name="matchId"${addAttribute(match.id, "value")} data-astro-cid-joqibaeh><div class="field" data-astro-cid-joqibaeh><label${addAttribute(`winner-${match.id}`, "for")} data-astro-cid-joqibaeh>Winner</label><select${addAttribute(`winner-${match.id}`, "id")} name="winner" data-astro-cid-joqibaeh><option${addAttribute(match.left, "value")} data-astro-cid-joqibaeh>${displayName(names, match.left)}</option><option${addAttribute(match.right, "value")} data-astro-cid-joqibaeh>${displayName(names, match.right)}</option></select></div><div class="field" data-astro-cid-joqibaeh><label${addAttribute(`score-${match.id}`, "for")} data-astro-cid-joqibaeh>Score</label><input${addAttribute(`score-${match.id}`, "id")} name="score" type="text" required placeholder="3&amp;1" data-astro-cid-joqibaeh></div><button type="submit" data-astro-cid-joqibaeh>Record</button></form>`}<span class="mid" data-astro-cid-joqibaeh>${match.id}</span></article>`;
	})}</div></div>`)}</section>`;
}, "/Users/lkoskela/OSS/hectorgolf/hector.golf/.claude/worktrees/json-turso-migration-ca756d/admin/src/components/BracketBoard.astro", void 0);
//#endregion
//#region src/lib/matchplay/bracket.ts
/** A field must halve cleanly all the way down, or some players get no match. */
function isDrawableFieldSize(size) {
	return size >= 2 && (size & size - 1) === 0;
}
/** The next field size that would work, for telling an admin how far off they are. */
function nextDrawableSize(size) {
	let n = 2;
	while (n < size) n *= 2;
	return n;
}
/** Match ids are M01, M02 … in bracket order, which is how the existing events read. */
function matchId(index) {
	return `M${String(index + 1).padStart(2, "0")}`;
}
/**
* Order the field into first-round pairs: the list is read two at a time, so
* positions 0 and 1 meet, 2 and 3 meet, and so on.
*
* The draw is random for everyone, so it takes ids rather than players. A
* handicap is not something it can weigh even by accident, and a player whose
* handicap nobody has recorded draws like anybody else.
*
* The shuffle is injected so a caller — a test — can make it deterministic
* without the draw needing to know it is being tested.
*/
function orderForDraw(ids, shuffle = defaultShuffle) {
	return shuffle([...ids]);
}
function defaultShuffle(xs) {
	for (let i = xs.length - 1; i > 0; i -= 1) {
		const j = Math.floor(Math.random() * (i + 1));
		[xs[i], xs[j]] = [xs[j], xs[i]];
	}
	return xs;
}
/**
* Build the whole bracket from an ordered field.
*
* Every match exists from the start, including the final. Later rounds carry
* `leftSource`/`rightSource` naming the matches that feed them and `null`
* players until those are decided — which is the shape the existing events use
* and what lets the public bracket render before anything has been played.
*/
function drawBracket(ordered) {
	if (!isDrawableFieldSize(ordered.length)) throw new Error(`A bracket needs a power-of-two field; got ${ordered.length}. The nearest workable size is ${nextDrawableSize(ordered.length)}.`);
	const bracket = [];
	let created = 0;
	let previousRoundIds = [];
	for (let size = ordered.length; size >= 2; size /= 2) {
		const round = bracket.length + 1;
		const matches = [];
		for (let i = 0; i < size / 2; i += 1) {
			const id = matchId(created);
			created += 1;
			const isFirstRound = round === 1;
			matches.push({
				id,
				leftSource: isFirstRound ? null : previousRoundIds[i * 2] ?? null,
				rightSource: isFirstRound ? null : previousRoundIds[i * 2 + 1] ?? null,
				left: isFirstRound ? ordered[i * 2] ?? null : null,
				right: isFirstRound ? ordered[i * 2 + 1] ?? null : null,
				score: null,
				winner: null
			});
		}
		bracket.push({
			round,
			matches
		});
		previousRoundIds = matches.map((m) => m.id);
	}
	return bracket;
}
/**
* Record a result and carry the winner into whichever match is fed by this one.
*
* Returns a new bracket; nothing is mutated, so a caller can diff or discard it.
* Advancement follows `leftSource`/`rightSource` rather than arithmetic on match
* numbers, so it keeps working if a bracket is ever built some other way.
*/
function recordResult(bracket, { matchId: id, score, winner }) {
	const match = bracket.flatMap((r) => r.matches).find((m) => m.id === id);
	if (!match) throw new Error(`No match ${id} in this bracket.`);
	if (![match.left, match.right].filter((p) => p !== null).includes(winner)) throw new Error(`${winner} is not playing in ${id}.`);
	return bracket.map((round) => ({
		...round,
		matches: round.matches.map((m) => {
			if (m.id === id) return {
				...m,
				score,
				winner
			};
			if (m.leftSource === id) return {
				...m,
				left: winner
			};
			if (m.rightSource === id) return {
				...m,
				right: winner
			};
			return m;
		})
	}));
}
/** The tournament winner: whoever won the last round's only match. */
function championOf(bracket) {
	const final = bracket.at(-1)?.matches;
	if (final?.length !== 1) return void 0;
	return final[0]?.winner ?? void 0;
}
//#endregion
//#region src/pages/matchplay/[id].astro
var _id__exports = /* @__PURE__ */ __exportAll({
	default: () => $$Id,
	file: () => $$file,
	url: () => $$url
});
createAstro("https://astro.build");
var $$Id = createComponent(async ($$result, $$props, $$slots) => {
	const Astro = $$result.createAstro($$props, $$slots);
	Astro.self = $$Id;
	const { id } = Astro.params;
	if (!id) return Astro.redirect("/matchplay");
	let event = await getMatchplayEvent(id);
	if (!event) return new Response("Tournament not found", { status: 404 });
	const players = await listPlayers();
	let error;
	let flash;
	if (Astro.request.method === "POST") {
		const form = await Astro.request.formData();
		const action = String(form.get("action") ?? "");
		const by = viewerFromHeaders(Astro.request.headers).email ?? "unknown";
		try {
			if (action === "add-player") {
				const playerId = String(form.get("playerId"));
				if (!event.participants.includes(playerId)) {
					event = {
						...event,
						participants: [...event.participants, playerId]
					};
					await saveMatchplayEvent(event, by);
				}
			} else if (action === "remove-player") {
				const playerId = String(form.get("playerId"));
				event = {
					...event,
					participants: event.participants.filter((p) => p !== playerId)
				};
				await saveMatchplayEvent(event, by);
			} else if (action === "draw") {
				const bracket = drawBracket(orderForDraw(event.participants));
				event = {
					...event,
					status: "started",
					results: {
						winners: {},
						bracket
					}
				};
				await saveMatchplayEvent(event, by);
				flash = "Bracket drawn. The tournament is now started.";
			} else if (action === "record") {
				const bracket = recordResult(event.results?.bracket ?? [], {
					matchId: String(form.get("matchId")),
					score: String(form.get("score")).trim(),
					winner: String(form.get("winner"))
				});
				const champion = championOf(bracket);
				event = {
					...event,
					status: champion ? "complete" : "started",
					results: {
						winners: champion ? { matchplay: champion } : {},
						bracket
					}
				};
				await saveMatchplayEvent(event, by);
				flash = champion ? "Result recorded. That was the final." : "Result recorded.";
			} else if (action === "reopen-signup") {
				event = {
					...event,
					status: "signup",
					results: void 0
				};
				await saveMatchplayEvent(event, by);
				flash = "Back in signup. The bracket was discarded; the field was kept.";
			}
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		}
	}
	const status = matchplayStatus(event);
	const names = nameById(players);
	const fieldSize = event.participants.length;
	const canDraw = isDrawableFieldSize(fieldSize);
	const champion = event.results?.bracket ? championOf(event.results.bracket) : void 0;
	return renderTemplate`${renderComponent($$result, "AdminLayout", $$AdminLayout, {
		"title": event.name,
		"data-astro-cid-h2evdhk2": true
	}, { "default": ($$result) => renderTemplate`${maybeRenderHead($$result)}<div class="row-between" data-astro-cid-h2evdhk2>${renderComponent($$result, "PageHeader", $$PageHeader, {
		"title": event.name,
		"eyebrow": "Matchplay",
		"meta": [
			formatEventDates(event),
			event.location,
			`${fieldSize} players`
		],
		"data-astro-cid-h2evdhk2": true
	})}<span${addAttribute(["pill", status === "started" ? "pill-matchplay" : status === "complete" ? "pill-violet" : "pill-outline"], "class:list")} data-astro-cid-h2evdhk2>${status}</span></div>${error && renderTemplate`<p class="notice bad" data-astro-cid-h2evdhk2>${error}</p>`}${flash && renderTemplate`<p class="notice good" data-astro-cid-h2evdhk2>${flash}</p>`}${status === "signup" && renderTemplate`${renderComponent($$result, "Fragment", Fragment, {}, { "default": ($$result) => renderTemplate`${renderComponent($$result, "Roster", $$Roster, {
		"event": event,
		"players": players,
		"names": names,
		"data-astro-cid-h2evdhk2": true
	})}<section class="stack draw" data-astro-cid-h2evdhk2><h2 data-astro-cid-h2evdhk2>Draw the bracket</h2>${!canDraw ? renderTemplate`<p class="notice" data-astro-cid-h2evdhk2>A bracket needs a field that halves cleanly. There ${fieldSize === 1 ? "is" : "are"}${" "}${fieldSize} ${fieldSize === 1 ? "player" : "players"}; the nearest workable size is${" "}${nextDrawableSize(fieldSize)}.</p>` : renderTemplate`<form method="POST" class="stack" data-astro-cid-h2evdhk2><input type="hidden" name="action" value="draw" data-astro-cid-h2evdhk2><p class="hint" data-astro-cid-h2evdhk2>The field is shuffled and paired off at random. Handicaps play no part, so everyone draws the same way whether or not theirs is on record.</p><div class="actions" data-astro-cid-h2evdhk2><button type="submit" data-astro-cid-h2evdhk2>Draw and start</button><span class="hint" data-astro-cid-h2evdhk2>This locks the field of ${fieldSize} and moves the tournament to started. It can be undone.</span></div></form>`}</section>` })}`}${status !== "signup" && event.results?.bracket && renderTemplate`${renderComponent($$result, "Fragment", Fragment, {}, { "default": ($$result) => renderTemplate`${champion && renderTemplate`<p class="notice good" data-astro-cid-h2evdhk2><strong data-astro-cid-h2evdhk2>${names.get(champion) ?? champion}</strong> won the tournament.</p>`}${renderComponent($$result, "BracketBoard", $$BracketBoard, {
		"bracket": event.results.bracket,
		"names": names,
		"readonly": status === "complete",
		"data-astro-cid-h2evdhk2": true
	})}<form method="POST" class="actions reopen" data-astro-cid-h2evdhk2><input type="hidden" name="action" value="reopen-signup" data-astro-cid-h2evdhk2><button type="submit" class="danger" data-astro-cid-h2evdhk2>Discard bracket and reopen signup</button><span class="hint" data-astro-cid-h2evdhk2>Keeps the field. Use this if the draw was made too early.</span></form>` })}`}` })}`;
}, "/Users/lkoskela/OSS/hectorgolf/hector.golf/.claude/worktrees/json-turso-migration-ca756d/admin/src/pages/matchplay/[id].astro", void 0);
var $$file = "/Users/lkoskela/OSS/hectorgolf/hector.golf/.claude/worktrees/json-turso-migration-ca756d/admin/src/pages/matchplay/[id].astro";
var $$url = "/matchplay/[id]";
//#endregion
//#region \0virtual:astro:page:src/pages/matchplay/[id]@_@astro
var page = () => _id__exports;
//#endregion
export { page };
