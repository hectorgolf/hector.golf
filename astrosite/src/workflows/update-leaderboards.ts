import { writeFileSync } from 'fs'

import { type HectorEvent } from '../schemas/events.ts'
import { parseEventDateRange, isoDate, isoDateToday} from '../code/dates.ts'
import { playersData, eventsData, pathToEventJson, isHectorEvent } from '../code/data.ts'
import { fetchHectorLeaderboardData, fetchVictorLeaderboardData } from '../code/leaderboards/google-sheets.ts'
import { updateHectorEventLeaderboard } from '../code/leaderboards/github.ts'


type HectorTeam = {
    name: string,
    players: string[]
}

function getPlayerByName(name: string): string|undefined {
    return playersData.find((player: any) => {
        const aliases = [player.name, ...(player.aliases || [])].map((name: any) => {
            if (name.first && name.last) {
                return `${name.first} ${name.last}`
            }
            return name.toString()
        })
        return aliases.map(n => n.toLowerCase()).includes(name.toLowerCase())
    })?.id
}

function getOngoingEvents(): Array<HectorEvent> {
    return (eventsData as Array<HectorEvent>)
        .filter(isHectorEvent)
        .filter(e => !!(e.leaderboardSheet))
        .filter(e => {
            const { startDate, endDate } = parseEventDateRange(e.date) || {}
            if (!startDate) return false
            if (!endDate) return false
            if (isoDate(startDate) > isoDateToday()) {
                console.log(`Not updating leaderboards for ${e.name} because it's in the future: the tournament's date is ${JSON.stringify(e.date)} while today is ${isoDateToday()}`)
                return false  // event hasn't even started yet
            }
            if (isoDate(endDate) < isoDate(new Date(new Date().getTime() - 1000 * 60 * 60 * 24))) {
                console.log(`Not updating leaderboards for ${e.name} because it's in the past: the tournament's date is ${JSON.stringify(e.date)} while today is ${isoDateToday()}`)
                return false // event finished yesterday or earlier
            }
            return true
        });
}

async function updateLeaderboardsForAllOngoingTournaments(): Promise<void> {
    const events = getOngoingEvents()

    let updatedTeamPairings = 0
    console.log(`Found ${events.length} ongoing Hector events with a live leaderboard Google Sheet: ${events.map(e => e.name).join(', ')}`)
    for (let event of events) {
        console.log(`Updating leaderboard for ${event.name}...`)
        const hectorEvent = event as HectorEvent
        const leaderboardSheetId = hectorEvent.leaderboardSheet?.replace(/https?:\/\/docs.google.com\/spreadsheets\/d\//, '').replace(/\/.*$/, '')
        console.log(`Leaderboard sheet URL: ${hectorEvent.leaderboardSheet}`)
        console.log(`Leaderboard sheet ID:  ${leaderboardSheetId}`)
        if (leaderboardSheetId) {
            console.log(`Fetching Hector leaderboard data for ${hectorEvent.name} from the Google Sheet`)
            const hectorLeaderboard = await fetchHectorLeaderboardData(leaderboardSheetId)

            console.log(`Fetching Victor leaderboard data for ${hectorEvent.name} from the Google Sheet`)
            const victorLeaderboard = await fetchVictorLeaderboardData(leaderboardSheetId)

            // TODO: check if the leaderboards have changed (compared to the file on disk right now) before making a commit

            const githubToken = process.env.GITHUB_ACCESS_TOKEN as string
            console.log(`Updating leaderboard data for ${hectorEvent.name} on Github with token ${githubToken.replace(/./g, '*')}`)
            await updateHectorEventLeaderboard(githubToken, hectorEvent.id, hectorLeaderboard, victorLeaderboard)
            console.log(`Updated leaderboard data for ${hectorEvent.name}`)

            const teams = event.results?.teams || []
            if (teams.length === 0) {
                // src/data/events/{format}/{id}.json does not yet have teams for this event
                const leaderboardHasPairings = hectorLeaderboard.every((team, index) => team.team && team.team.trim().length > 0)
                if (leaderboardHasPairings) {
                    console.log(`The Hector leaderboard for ${hectorEvent.name} has pairings, so we'll use them to generate the teams`)
                    const teams = hectorLeaderboard.map(team => {
                        return {
                            name: team.team,
                            players: team.team.split('+').map(name => getPlayerByName(name.trim()))
                        }
                    })
                    if (teams.every(team => team.players.every(p => !!p))) {
                        const rawEvent = eventsData.find(e => e.id === hectorEvent.id)
                        if (rawEvent) {
                            rawEvent.results = { teams: teams as Array<HectorTeam>, winners: { hector: [], victor: [] } }
                            console.log(`Added ${teams.length} teams for ${hectorEvent.name} from live leaderboard data`)
                            updatedTeamPairings += 1
                            const filePath = pathToEventJson(rawEvent)
                            writeFileSync(filePath, JSON.stringify(rawEvent, null, 4))
                            console.log(`Updated team pairings for ${updatedTeamPairings} events in ${filePath}`)
                        }
                    }
                } else {
                    console.log(`The Hector leaderboard for ${hectorEvent.name} does not have pairings yet, so we can't generate the teams: ${JSON.stringify(hectorLeaderboard, null, 2)}`)
                }
            }
        }
    }
}

updateLeaderboardsForAllOngoingTournaments()
