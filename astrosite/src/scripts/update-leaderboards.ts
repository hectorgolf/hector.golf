import { getAllEventsGroupedByChronology, parseEventDateRange } from '../code/events.ts'
import { fetchHectorLeaderboardData, fetchVictorLeaderboardData } from '../code/leaderboards/google-sheets.ts'
import type { HectorEvent } from '../schemas/events.ts'
import { updateHectorEventLeaderboard } from '../code/leaderboards/github.ts'


const updateLeaderboardsForAllOngoingTournaments = async () => {
    const { ongoing, past } = getAllEventsGroupedByChronology(e => e.format === 'hector' && !!(e as HectorEvent).leaderboardSheetId)
    const recent = past.filter(e => {
        const { endDate } = parseEventDateRange(e.date) || {}
        return !!endDate && endDate < new Date() && endDate > new Date(new Date().getTime() - 1000 * 60 * 60 * 24 * 2)
    })
    const relevantEvents = ongoing.concat(recent)
    for (let event of relevantEvents) {
        console.log(`Updating leaderboard for ${event.name}...`)
        const hectorEvent = event as HectorEvent
        const leaderboardSheetId = hectorEvent.leaderboardSheetId
        console.log(`Leaderboard sheet ID: ${leaderboardSheetId}`)
        if (leaderboardSheetId) {
            console.log(`Fetching Hector leaderboard data for ${hectorEvent.name} from the Google Sheet`)
            const hectorLeaderboard = await fetchHectorLeaderboardData(leaderboardSheetId)

            console.log(`Fetching Victor leaderboard data for ${hectorEvent.name} from the Google Sheet`)
            const victorLeaderboard = await fetchVictorLeaderboardData(leaderboardSheetId)

            // TODO: check if the leaderboards have changed (compared to the file on disk right now) before making a commit

            const githubToken = process.env.GITHUB_ACCESS_TOKEN as string
            console.log(`Updating leaderboard data for ${hectorEvent.name} on Github with token ${githubToken.replace(/./g, '*')}`)
            updateHectorEventLeaderboard(githubToken, hectorEvent.id, hectorLeaderboard, victorLeaderboard)
            console.log(`Updated leaderboard data for ${hectorEvent.name}`)
        }
    }
}

updateLeaderboardsForAllOngoingTournaments()