import type { Course } from '@hector/schemas/src/courses.ts'

/**
 * The scorecard, as a form can edit it: one grid, not two.
 *
 * A course record carries two arrays of holes, `men` and `ladies`, and the
 * second is almost always the first written out again. Sixteen of the
 * seventeen committed courses have no ladies array at all, and the one that
 * does — Sand Valley — differs from the men's card on **one hole**: par 4
 * becomes par 5 at the eleventh. Eighteen rows of duplication to record one
 * number, which is also the number the tee's `par_ladies` of 73 against 72 is
 * talking about.
 *
 * So the editor asks for the card once, with a women's par column that is
 * empty wherever the two agree. What a save writes is still a whole array,
 * because that is the shape of the record — but nobody types it twice, and a
 * course where nothing differs keeps `ladies: null` rather than gaining
 * eighteen rows that say the same thing as the eighteen above them.
 *
 * ## What is not asked for
 *
 * A women's **stroke index** and women's **lengths**. Neither differs anywhere
 * in the committed data, and lengths cannot differ: they are keyed by tee name
 * and both cards play the same tees. They are *preserved* rather than ignored
 * — a stored ladies hole is the starting point for the one this writes back,
 * so a difference somebody entered by hand survives a save it had nothing to
 * do with.
 */

/** One hole, as the boxes in a row of the grid. */
export type HoleRow = {
    hole: number
    par: string
    /** Empty when the women's par is the men's, which is almost always. */
    parLadies: string
    hcp: string
    /**
     * A length per tee, by the tee's row in the tee table above — not by name.
     *
     * By position because a name is what a save might be changing: renaming
     * Yellow to Gold rekeys the scorecard, and a length that arrived under the
     * old name would land in a column that no longer exists. The row is stable
     * across exactly the edit that makes the name unstable.
     */
    lengths: string[]
}

/*
 * The schema's own hole, rather than a hand-written copy of it. A copy is a
 * second declaration of the same thing, and the version of this file that had
 * one disagreed with the schema about whether `lengths` was optional — which
 * the compiler caught, and would not have if the copy had been closer.
 */
type Hole = NonNullable<Course['course']>['scorecard']['men'][number]

const lengthOf = (hole: Hole | undefined, teeName: string): string => {
    const value = (hole?.lengths as Record<string, number> | undefined)?.[teeName]
    return value === undefined ? '' : String(value)
}

/**
 * The grid a course's editor should show.
 *
 * `teeNames` is the tee table's rows in their order, blank ones included, so
 * that a column lines up with a row up there — including the empty row at the
 * end, which is how a tee and its lengths can be added in one save.
 */
export function holeRows(course: Course, teeNames: readonly string[]): HoleRow[] {
    const men = (course.course?.scorecard.men ?? []) as Hole[]
    const ladies = (Array.isArray(course.course?.scorecard.ladies) ? course.course.scorecard.ladies : []) as Hole[]

    return men.map((hole, index) => {
        const hers = ladies[index]
        return {
            hole: hole.hole,
            par: String(hole.par),
            // Shown only where it disagrees, which is the whole point of one grid.
            parLadies: hers && hers.par !== hole.par ? String(hers.par) : '',
            hcp: String(hole.hcp),
            lengths: teeNames.map((name) => (name.trim() === '' ? '' : lengthOf(hole, name))),
        }
    })
}

const number = (value: string): number | undefined => {
    const trimmed = value.trim()
    if (trimmed === '') return undefined
    const parsed = Number(trimmed)
    return Number.isFinite(parsed) ? parsed : Number.NaN
}

/**
 * The scorecard the grid describes, written onto the course the tees have
 * already been applied to.
 *
 * Called *after* `applyTeeEdits`, and that order is the whole of why lengths
 * arrive by position: by then the tees have their final names, and pairing the
 * k-th surviving tee with the k-th column it was rendered from is what carries
 * a length across a rename.
 *
 * A hole whose length box is empty for some tee simply has no length for it,
 * which is the state a tee added in this same save is in before somebody
 * measures it.
 */
export function scorecardFrom(
    stored: Course,
    finalTeeNames: readonly string[],
    columns: readonly number[],
    rows: readonly HoleRow[]
): Course['course'] {
    const course = stored.course
    if (!course) return course

    const storedLadies = (Array.isArray(course.scorecard.ladies) ? course.scorecard.ladies : []) as Hole[]

    const men = rows.map((row, index) => {
        const lengths: Record<string, number> = {}
        finalTeeNames.forEach((name, position) => {
            const value = number(row.lengths[columns[position]!] ?? '')
            if (value !== undefined) lengths[name] = value
        })
        return {
            hole: row.hole,
            par: number(row.par) ?? (course.scorecard.men[index]?.par as number),
            hcp: number(row.hcp) ?? (course.scorecard.men[index]?.hcp as number),
            lengths,
        }
    })

    /*
     * A women's card only when a women's par says something the men's does not
     * — which means a number that *differs*, not merely a number. Typing 4 into
     * a hole whose men's par is 4 is agreement, and agreement is what an absent
     * card already says; writing eighteen rows for it would be the duplication
     * this grid exists to avoid.
     *
     * Built on the stored hole rather than on the men's, so a women's stroke
     * index or length somebody entered by hand is not quietly replaced by the
     * men's — this form does not ask about those and therefore has no business
     * overwriting them.
     */
    const differs = rows.some((row, index) => {
        const hers = number(row.parLadies)
        return hers !== undefined && hers !== men[index]!.par
    })
    const ladies = differs
        ? rows.map((row, index) => {
              const hers = storedLadies[index]
              const par = number(row.parLadies) ?? men[index]!.par
              return hers ? { ...hers, hole: men[index]!.hole, par } : { ...men[index]!, par }
          })
        : null

    return { ...course, scorecard: { ...course.scorecard, men, ...(ladies ? { ladies } : { ladies: null }) } }
}
