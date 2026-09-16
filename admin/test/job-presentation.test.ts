import { describe, expect, it } from 'vitest'

import type { JobRun } from '../src/lib/jobs/log.ts'
import { changesInWords, labelOfJob, requesterInWords, toneOfJob } from '../src/lib/jobs/presentation.ts'

/** A run with the fields these functions read, and defaults for the rest. */
const run = (over: Partial<JobRun> = {}): JobRun => ({
    slug: 'handicaps',
    startedAt: '2026-09-16T03:00:00.000Z',
    finishedAt: '2026-09-16T03:00:42.000Z',
    by: 'the schedule',
    dryRun: false,
    outcome: 'ok',
    changes: [],
    ...over,
})

describe('what the pill says', () => {
    it('calls a shadow run a shadow run, not a success', () => {
        // The distinction the whole shadow period rests on: it succeeded at
        // deciding, not at writing, and the pill is what actually gets read.
        expect(labelOfJob(run({ dryRun: true }))).toBe('shadow')
        expect(labelOfJob(run({ dryRun: false }))).toBe('success')
    })

    it('reports a failure as a failure whether or not it was a shadow run', () => {
        expect(labelOfJob(run({ dryRun: true, outcome: 'failed' }))).toBe('failed')
        expect(labelOfJob(run({ dryRun: false, outcome: 'failed' }))).toBe('failed')
    })

    it('tones a skipped run neutrally, because it is not a problem', () => {
        // A run dropped for the lease is the interlock working, not an error.
        expect(toneOfJob(run({ outcome: 'skipped' }))).toBe('neutral')
        expect(toneOfJob(run({ outcome: 'failed' }))).toBe('bad')
        expect(toneOfJob(run({ outcome: 'ok' }))).toBe('good')
    })
})

describe('summarising what a run found', () => {
    it('says so plainly when nothing moved', () => {
        expect(changesInWords([])).toBe('nothing changed')
    })

    it('names them while there are few enough to read', () => {
        expect(changesInWords([{ subject: 'lasse-k', from: '14.7', to: '14.5' }])).toBe('lasse-k 14.7 → 14.5')
    })

    it('shows a dash rather than nothing for a first-ever reading', () => {
        expect(changesInWords([{ subject: 'jari-k', from: undefined, to: '1.8' }])).toBe('jari-k — → 1.8')
    })

    it('counts past the point where naming them stops helping', () => {
        const many = ['a', 'b', 'c', 'd', 'e'].map((subject) => ({ subject, from: '1', to: '2' }))
        expect(changesInWords(many)).toBe('a 1 → 2, b 1 → 2, c 1 → 2, and 2 more')
    })
})

describe('who asked', () => {
    it('leaves the schedule alone', () => {
        expect(requesterInWords(run({ by: 'the schedule' }))).toBe('the schedule')
    })

    it('shortens an email to the part that distinguishes two admins', () => {
        expect(requesterInWords(run({ by: 'lasse@example.com' }))).toBe('lasse')
    })

    it('passes through whatever IAP forwarded when it is not an email', () => {
        expect(requesterInWords(run({ by: 'unidentified caller admitted by IAP' }))).toBe(
            'unidentified caller admitted by IAP'
        )
    })
})
