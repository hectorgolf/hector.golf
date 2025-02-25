import { expect, describe, it } from 'vitest'
import { compareDateStrings } from '../../src/code/dates';

describe('Dates', () => {
    describe('compareDateStrings()', () => {

        describe('should return 0 for equal dates', () => {

            it('year only', () => {
                expect(compareDateStrings('2024', '2024')).toBe(0);
                expect(compareDateStrings('2025', '2025')).toBe(0);
            });

            describe('single date', () => {
                it('"January 31, 2025"', () => expect(compareDateStrings('January 31, 2025', 'January 31, 2025')).toBe(0));
            });

            describe('date range', () => {

                it('September 7-11, 2025', () => {
                    expect(compareDateStrings('September 7-11, 2025', 'September 7-11, 2025')).toBe(0);
                    expect(compareDateStrings('September 7-11, 2025', 'September 7 - 11, 2025')).toBe(0);
                });

                it('September 30 - October 2, 2025', () => {
                    expect(compareDateStrings('September 30 - October 2, 2025', 'September 30 - October 2, 2025')).toBe(0);
                    expect(compareDateStrings('September 30-October 2, 2025', 'September 30 - October 2, 2025')).toBe(0);
                    expect(compareDateStrings('September 30 - October 2, 2025', 'September 30-October 2, 2025')).toBe(0);
                });
            });
        });

        describe('sorts oldest first', () => {

            describe('years', () => {
                it('2024 vs 2025', () => {
                    expect(['2024', '2025'].sort(compareDateStrings)).toStrictEqual(['2024', '2025']);
                    expect(['2025', '2024'].sort(compareDateStrings)).toStrictEqual(['2024', '2025']);
                });
            });

            describe('dates', () => {
                it('"June 10, 2024" vs "March 11, 2024"', () => {
                    expect(['June 10, 2024', 'March 11, 2024'].sort(compareDateStrings)).toStrictEqual(['March 11, 2024', 'June 10, 2024']);
                    expect(['March 11, 2024', 'June 10, 2024'].sort(compareDateStrings)).toStrictEqual(['March 11, 2024', 'June 10, 2024']);
                });
            });

            describe('date ranges', () => {
                it('"June 10 - 15, 2024" vs "June 12 - 16, 2024"', () => {
                    expect(['June 10 - 15, 2024', 'June 12 - 16, 2024'].sort(compareDateStrings)).toStrictEqual(['June 10 - 15, 2024', 'June 12 - 16, 2024']);
                    expect(['June 10-15, 2024', 'June 12 - 16, 2024'].sort(compareDateStrings)).toStrictEqual(['June 10-15, 2024', 'June 12 - 16, 2024']);
                    expect(['June 12 - 16, 2024', 'June 10 - 15, 2024'].sort(compareDateStrings)).toStrictEqual(['June 10 - 15, 2024', 'June 12 - 16, 2024']);
                    expect(['June 12-16, 2024', 'June 10 - 15, 2024'].sort(compareDateStrings)).toStrictEqual(['June 10 - 15, 2024', 'June 12-16, 2024']);
                });
            });

            it('mix of dates, date ranges, and formats', () => {
                const sorted = [
                    '2025',
                    'January 31, 2024',
                    'September 30 - October 2, 2024',
                    'September 7-11, 2024',
                ].sort(compareDateStrings);
                expect(sorted).toStrictEqual([
                    'January 31, 2024',
                    'September 7-11, 2024',
                    'September 30 - October 2, 2024',
                    '2025',
                ]);
            });
        });

        describe('sorts undefined last', () => {
            it('undefined vs defined', () => {
                expect([undefined, '2024'].sort(compareDateStrings)).toStrictEqual(['2024', undefined]);
                expect(['2024', undefined].sort(compareDateStrings)).toStrictEqual(['2024', undefined]);
            });

            it('undefined vs undefined', () => {
                expect([undefined, undefined].sort(compareDateStrings)).toStrictEqual([undefined, undefined]);
            });
        });
    });
});