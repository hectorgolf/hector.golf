import { expect, describe, it } from 'vitest'
import { dateOfRound, titleOfRound } from '../../src/code/rounds';

/**
 * The Hector Trophée 2026 schedule: Thursday through Sunday, with one round on the
 * first and last day and two on each of the two in between.
 */
const hector2026 = {
    timing: { start: '2026-09-24', end: '2026-09-27' },
    rounds: [
        { day: 1, round: 1 },
        { day: 2, round: 1 },
        { day: 2, round: 2 },
        { day: 3, round: 1 },
        { day: 3, round: 2 },
        { day: 4, round: 1 },
    ],
};

describe('Rounds', () => {

    describe('dateOfRound()', () => {

        it('puts day one on the event\'s first day', () => {
            expect(dateOfRound(hector2026, { day: 1, round: 1 })).toBe('2026-09-24');
        });

        it('offsets the later days from there', () => {
            expect(dateOfRound(hector2026, { day: 3, round: 1 })).toBe('2026-09-26');
            expect(dateOfRound(hector2026, { day: 4, round: 1 })).toBe('2026-09-27');
        });

        it('gives both of a day\'s rounds the same date', () => {
            expect(dateOfRound(hector2026, { day: 3, round: 1 }))
                .toBe(dateOfRound(hector2026, { day: 3, round: 2 }));
        });

        it('rolls over a month boundary', () => {
            const event = { timing: { start: '2026-09-30', end: '2026-10-02' }, rounds: [{ day: 1 }, { day: 2 }, { day: 3 }] };
            expect(dateOfRound(event, { day: 3, round: 1 })).toBe('2026-10-02');
        });
    });

    describe('titleOfRound()', () => {

        it('names the day\'s first round the morning one', () => {
            expect(titleOfRound(hector2026, { day: 3, round: 1 })).toBe('Saturday morning');
        });

        it('names the day\'s second round the afternoon one', () => {
            expect(titleOfRound(hector2026, { day: 3, round: 2 })).toBe('Saturday afternoon');
        });

        it('works the same on the other two-round day', () => {
            expect(titleOfRound(hector2026, { day: 2, round: 1 })).toBe('Friday morning');
            expect(titleOfRound(hector2026, { day: 2, round: 2 })).toBe('Friday afternoon');
        });

        it('names a day with a single round by its weekday alone', () => {
            // Nothing in the data records a tee time, so a lone round gives no clue
            // whether it is played in the morning or the afternoon.
            expect(titleOfRound(hector2026, { day: 1, round: 1 })).toBe('Thursday');
            expect(titleOfRound(hector2026, { day: 4, round: 1 })).toBe('Sunday');
        });

        it('calls a third round on the same day the evening one', () => {
            const event = {
                timing: { start: '2026-09-24', end: '2026-09-24' },
                rounds: [{ day: 1 }, { day: 1 }, { day: 1 }],
            };
            expect(titleOfRound(event, { day: 1, round: 1 })).toBe('Thursday morning');
            expect(titleOfRound(event, { day: 1, round: 2 })).toBe('Thursday afternoon');
            expect(titleOfRound(event, { day: 1, round: 3 })).toBe('Thursday evening');
        });

        it('falls back to the weekday when a day holds more rounds than it has names for', () => {
            const event = {
                timing: { start: '2026-09-24', end: '2026-09-24' },
                rounds: [{ day: 1 }, { day: 1 }, { day: 1 }, { day: 1 }],
            };
            expect(titleOfRound(event, { day: 1, round: 4 })).toBe('Thursday');
        });

        it('crosses a month boundary with the date', () => {
            const event = {
                timing: { start: '2026-09-30', end: '2026-10-02' },
                rounds: [{ day: 1 }, { day: 3 }, { day: 3 }],
            };
            // 30 September 2026 is a Wednesday, so day 3 is the Friday.
            expect(titleOfRound(event, { day: 3, round: 2 })).toBe('Friday afternoon');
        });
    });
});
