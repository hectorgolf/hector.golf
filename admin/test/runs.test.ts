import { describe, expect, it } from 'vitest'

import type { WorkflowRun } from '../src/lib/github.ts'
import { ageInWords, formatUtc, labelOf, toneOf, triggerInWords } from '../src/lib/runs.ts'

const run = (overrides: Partial<WorkflowRun> = {}): WorkflowRun => ({
    status: 'completed',
    conclusion: 'success',
    startedAt: '2026-09-13T07:45:05Z',
    event: 'workflow_dispatch',
    runNumber: 1505,
    url: 'https://github.com/hectorgolf/hector.golf/actions/runs/34745996205',
    ...overrides,
})

describe('how long ago a run started', () => {
    const now = new Date('2026-09-13T12:00:00Z')

    it('reads as hours for the case this page exists to show', () => {
        // The run that prompted all of this: dispatched at 03:00, still four
        // hours old by lunchtime because GitHub delivered its cron late.
        expect(ageInWords('2026-09-13T07:45:05Z', now)).toBe('4 hours ago')
    })

    it('says minutes below an hour and days above a day', () => {
        expect(ageInWords('2026-09-13T11:20:00Z', now)).toBe('40 minutes ago')
        expect(ageInWords('2026-09-11T12:00:00Z', now)).toBe('2 days ago')
    })

    it('uses the singular where it matters', () => {
        expect(ageInWords('2026-09-13T11:00:00Z', now)).toBe('1 hour ago')
        expect(ageInWords('2026-09-12T12:00:00Z', now)).toBe('1 day ago')
    })

    it('calls a few seconds of clock skew "just now" rather than a run from the future', () => {
        expect(ageInWords('2026-09-13T12:00:20Z', now)).toBe('just now')
        expect(ageInWords('2026-09-13T11:59:30Z', now)).toBe('just now')
    })

    it('does not turn an unparseable timestamp into "Invalid Date ago"', () => {
        expect(ageInWords('', now)).toBe('at an unknown time')
        expect(ageInWords('not a date', now)).toBe('at an unknown time')
    })
})

describe('the exact start time in the execution log', () => {
    /*
     * The seconds are the feature. A reader works out that tonight's run is at
     * three by seeing 03:00:24 / 03:00:19 / 03:01:06 down the column, so a
     * formatter that rounded to the minute would take away the whole point of
     * the log — and anything that shifted the times into local time would make
     * them incomparable with the schedules, which are all written in UTC.
     */
    it('renders UTC to the second, whatever timezone the server is in', () => {
        expect(formatUtc('2026-09-13T03:00:24.000Z')).toBe('2026-09-13 03:00:24')
        expect(formatUtc('2026-09-13T12:01:06Z')).toBe('2026-09-13 12:01:06')
    })

    it('converts an offset timestamp to UTC rather than printing it as given', () => {
        // 06:00:24 in Helsinki summer time is the 03:00 run, and must line up
        // with the other rows in the column.
        expect(formatUtc('2026-09-13T06:00:24+03:00')).toBe('2026-09-13 03:00:24')
    })

    it('says so rather than printing "Invalid Date" when there is nothing to format', () => {
        expect(formatUtc('')).toBe('unknown')
        expect(formatUtc('not a date')).toBe('unknown')
    })
})

describe('how a run is described', () => {
    it('colours a success, a failure and a run still going differently', () => {
        expect(toneOf(run({ conclusion: 'success' }))).toBe('good')
        expect(toneOf(run({ conclusion: 'failure' }))).toBe('bad')
        expect(toneOf(run({ conclusion: 'timed_out' }))).toBe('bad')
        expect(toneOf(run({ status: 'in_progress', conclusion: null }))).toBe('running')
    })

    it('treats a cancelled run as neither good news nor bad', () => {
        expect(toneOf(run({ conclusion: 'cancelled' }))).toBe('neutral')
        expect(toneOf(run({ conclusion: 'skipped' }))).toBe('neutral')
    })

    it('labels a run with its conclusion once there is one, and its status until then', () => {
        expect(labelOf(run({ conclusion: 'success' }))).toBe('success')
        expect(labelOf(run({ status: 'in_progress', conclusion: null }))).toBe('in progress')
        expect(labelOf(run({ status: 'queued', conclusion: null }))).toBe('queued')
    })

    it('distinguishes a run we asked for from one GitHub started on its own', () => {
        expect(triggerInWords(run({ event: 'workflow_dispatch' }))).toBe('on request')
        expect(triggerInWords(run({ event: 'schedule' }))).toBe("GitHub's own cron")
        expect(triggerInWords(run({ event: 'push' }))).toBe('push')
    })
})
