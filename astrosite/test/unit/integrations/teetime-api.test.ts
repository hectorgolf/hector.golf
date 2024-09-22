import { expect, describe, it } from 'vitest'

import { type HandicapSource } from '../../../src/code/handicaps/handicap-source-api.ts'
import { createTeetimeSession } from '../../../src/code/handicaps/teetime-api.ts'


describe('Integration to Teetime', () => {

    describe('TeetimeSession', async () => {
        const session: HandicapSource = await createTeetimeSession()

        it('The TeetimeSession has a name', async () => {
            expect(session.name).toBe('Teetime')
        })

        it('Can find Lasse\'s handicap', async () => {
            const handicap = await session.getPlayerHandicap('Lasse', 'Koskela', 'Tapiola Golf')
            expect(handicap).not.toBe(undefined)
            expect(handicap).toBeGreaterThan(0.0) // Lasse is a magnificent player but not a scratch golfer...
        })

        it('Resolves to undefined for a non-existent player', async () => {
            const handicap = await session.getPlayerHandicap('NoSuch', 'PlayerAt', 'Hirsala Golf')
            expect(handicap).toBe(undefined)
        })
    })
})