import type { RosterPlayer } from "./types.ts";

/**
 * Which IDs identify a roster player inside a round.
 *
 * Not simply their roster entry, which is the trap here. Once a friend request has
 * been *accepted*, the two accounts are linked and a round refers to that person by
 * their own player record — the `friendPlayerID` they have in their own roster,
 * under their own user ID — rather than by our copy of them. Toni, an accepted
 * friend, goes into a round as `playerID 1438582589166807, playerUserID 207653`,
 * even though our roster calls him `1788645892735896`.
 *
 * A player of our own invention, and a friend whose request is still pending, are
 * both referred to by our roster entry under our own user ID.
 */
export function roundReferenceFor(
    player: RosterPlayer,
    ownUserID: string,
): { playerID: string; playerUserID: string } {
    const linked = player.friendStatus === 2 && player.friendPlayerID !== "" && player.friendUserID !== "0";
    return linked
        ? { playerID: player.friendPlayerID, playerUserID: player.friendUserID }
        : { playerID: player.playerID, playerUserID: ownUserID };
}
