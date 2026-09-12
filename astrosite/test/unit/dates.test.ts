import { expect, describe, it } from 'vitest'
import {
    addDays,
    compareIsoDates,
    formatDateRange,
    formatEventDates,
    isValidIsoDate,
    isoDate,
    parseIsoDate,
    weekdayOf,
} from '@hector/schemas/src/dates.ts';

describe('Dates', () => {

    describe('isoDate()', () => {

        it('renders a date from its local calendar fields', () => {
            expect(isoDate(new Date(2026, 8, 24, 12, 0, 0))).toBe('2026-09-24');
        });

        it('pads single-digit months and days', () => {
            expect(isoDate(new Date(2026, 0, 5, 12, 0, 0))).toBe('2026-01-05');
        });

        it('stays on the local day at either end of it', () => {
            // The naive `toISOString().slice(0, 10)` gets this wrong in every timezone
            // west of Greenwich: local midnight is the previous day in UTC.
            expect(isoDate(new Date(2026, 8, 24, 0, 0, 0))).toBe('2026-09-24');
            expect(isoDate(new Date(2026, 8, 24, 23, 59, 59))).toBe('2026-09-24');
        });

        it('renders an empty string for no date at all', () => {
            expect(isoDate(undefined)).toBe('');
        });
    });

    describe('isValidIsoDate()', () => {

        it('accepts a real calendar date', () => {
            expect(isValidIsoDate('2026-09-24')).toBe(true);
            expect(isValidIsoDate('2024-02-29')).toBe(true);  // a leap year
        });

        it('rejects a date that does not exist', () => {
            expect(isValidIsoDate('2026-02-30')).toBe(false);
            expect(isValidIsoDate('2025-02-29')).toBe(false);  // not a leap year
            expect(isValidIsoDate('2026-13-01')).toBe(false);
        });

        it('rejects anything that is not an ISO date to begin with', () => {
            expect(isValidIsoDate('September 24, 2026')).toBe(false);
            expect(isValidIsoDate('2026-9-24')).toBe(false);
            expect(isValidIsoDate('')).toBe(false);
        });
    });

    describe('parseIsoDate()', () => {

        it('lands on noon of the given day, local time', () => {
            const parsed = parseIsoDate('2026-09-24');
            expect(parsed.getFullYear()).toBe(2026);
            expect(parsed.getMonth()).toBe(8);
            expect(parsed.getDate()).toBe(24);
            expect(parsed.getHours()).toBe(12);
        });

        it('refuses a date that is not a real one', () => {
            expect(() => parseIsoDate('2026-02-30')).toThrow();
            expect(() => parseIsoDate('September 24, 2026')).toThrow();
        });
    });

    describe('addDays()', () => {

        it('moves forward within a month', () => {
            expect(addDays('2026-09-24', 3)).toBe('2026-09-27');
        });

        it('moves backwards', () => {
            expect(addDays('2026-09-24', -3)).toBe('2026-09-21');
        });

        it('stays put for zero', () => {
            expect(addDays('2026-09-24', 0)).toBe('2026-09-24');
        });

        it('rolls over a month boundary', () => {
            expect(addDays('2026-09-30', 2)).toBe('2026-10-02');
        });

        it('rolls over a year boundary', () => {
            expect(addDays('2025-12-31', 1)).toBe('2026-01-01');
        });

        it('knows about leap years', () => {
            expect(addDays('2024-02-28', 1)).toBe('2024-02-29');
            expect(addDays('2025-02-28', 1)).toBe('2025-03-01');
        });
    });

    describe('weekdayOf()', () => {

        it('names the weekday', () => {
            // Hector Trophée 2026 runs Thursday through Sunday.
            expect(weekdayOf('2026-09-24')).toBe('Thursday');
            expect(weekdayOf('2026-09-25')).toBe('Friday');
            expect(weekdayOf('2026-09-26')).toBe('Saturday');
            expect(weekdayOf('2026-09-27')).toBe('Sunday');
        });
    });

    describe('formatDateRange()', () => {

        it('names a single day once', () => {
            expect(formatDateRange('2014-08-22', '2014-08-22')).toBe('August 22, 2014');
        });

        it('names a month once for a range inside it', () => {
            expect(formatDateRange('2026-09-24', '2026-09-27')).toBe('September 24–27, 2026');
        });

        it('names both months for a range that crosses one', () => {
            expect(formatDateRange('2024-06-19', '2024-09-01')).toBe('June 19 – September 1, 2024');
        });

        it('names both years for a range that crosses New Year', () => {
            expect(formatDateRange('2025-12-30', '2026-01-02')).toBe('December 30, 2025 – January 2, 2026');
        });

        it('does not pad the day numbers', () => {
            expect(formatDateRange('2021-09-01', '2021-09-04')).toBe('September 1–4, 2021');
        });
    });

    describe('formatEventDates()', () => {

        it('reads the dates off an event', () => {
            expect(formatEventDates({ timing: { start: '2026-09-24', end: '2026-09-27' } }))
                .toBe('September 24–27, 2026');
        });
    });

    describe('compareIsoDates()', () => {

        it('returns 0 for the same date', () => {
            expect(compareIsoDates('2026-09-24', '2026-09-24')).toBe(0);
        });

        it('sorts oldest first', () => {
            expect(['2026-09-24', '2014-08-22'].sort(compareIsoDates))
                .toStrictEqual(['2014-08-22', '2026-09-24']);
            expect(['2014-08-22', '2026-09-24'].sort(compareIsoDates))
                .toStrictEqual(['2014-08-22', '2026-09-24']);
        });

        it('sorts within a year and within a month', () => {
            expect(['2024-09-07', '2024-01-31', '2024-09-30'].sort(compareIsoDates))
                .toStrictEqual(['2024-01-31', '2024-09-07', '2024-09-30']);
        });

        it('sorts undefined last', () => {
            expect([undefined, '2024-01-31'].sort(compareIsoDates))
                .toStrictEqual(['2024-01-31', undefined]);
            expect(['2024-01-31', undefined].sort(compareIsoDates))
                .toStrictEqual(['2024-01-31', undefined]);
            expect([undefined, undefined].sort(compareIsoDates))
                .toStrictEqual([undefined, undefined]);
        });
    });
});
