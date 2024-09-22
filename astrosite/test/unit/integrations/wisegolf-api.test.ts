import { expect, describe, it } from 'vitest'

import { type HandicapSource } from '../../../src/code/handicaps/handicap-source-api.ts'
import { createWisegolfSession } from '../../../src/code/handicaps/wisegolf-api.ts'


describe('Integration to WiseGolf', () => {

    describe('WisegolfSession', async () => {
        const session: HandicapSource = await createWisegolfSession()

        it('The WisegolfSession has a name', async () => {
            expect(session.name).toBe('WiseGolf')
        })

        it('Can find Lasse\'s handicap', async () => {
            const handicap = await session.getPlayerHandicap('Lasse', 'Koskela', 'Tapiola Golf')
            expect(handicap).not.toBe(undefined)
            expect(handicap).toBeGreaterThan(0.0) // Lasse is a magnificent player but not a scratch golfer...
        })

        it('Resolves to undefined for a non-existent player', async () => {
            const handicap = await session.getPlayerHandicap('NoSuch', 'PlayerAt', 'Master Golf Club')
            expect(handicap).toBe(undefined)
        })
    })
})