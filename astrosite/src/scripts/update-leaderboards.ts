import { parseEventDateRange, isoDate} from '../code/dates.ts'
import { fetchHectorLeaderboardData, fetchVictorLeaderboardData } from '../code/leaderboards/google-sheets.ts'
import { updateHectorEventLeaderboard } from '../code/leaderboards/github.ts'

import eventsData from '../data/events.json'


type HectorEvent = {
    id: string,
    name: string,
    format: string,
    date: string,
    leaderboardSheetId: string|undefined
}

const updateLeaderboardsForAllOngoingTournaments = async () => {
    const events = (eventsData as Array<HectorEvent>)
        .filter(e => e.format === 'hector')
        .map(e => e as HectorEvent)
        .filter(e => !!(e.leaderboardSheetId))
        .filter(e => {
            const { startDate, endDate } = parseEventDateRange(e.date) || {}
            if (!startDate) return false
            if (!endDate) return false
            if (isoDate(startDate) > isoDate(new Date())) return false  // event hasn't even started yet
            if (isoDate(endDate) < isoDate(new Date(new Date().getTime() - 1000 * 60 * 60 * 24))) return false  // event finished yesterday or earlier
            return true
        })

    console.log(`Found ${events.length} ongoing Hector events with a live leaderboard Google Sheet: ${events.map(e => e.name).join(', ')}`)
    for (let event of events) {
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