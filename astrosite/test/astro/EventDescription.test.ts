/**
 * The contract the Hector, matchplay and admin event pages all now share.
 *
 * The component lives in `@hector/ui`, but this is the only Astro container test
 * setup in the repository, so its behaviour is pinned from here.
 *
 * The case worth pinning is the soft line break. The Hector page used to split on
 * `/\n+/`, so a single newline started a new paragraph; Markdown keeps it inside
 * one. No description in the data has a single newline today, which is what made
 * the switch a no-op — but the next one written might, and this says which way it
 * will land.
 */
import { experimental_AstroContainer as AstroContainer } from 'astro/container'
import { expect, describe, it } from 'vitest'
import EventDescription from '@hector/ui/components/EventDescription.astro'


describe('Component <EventDescription/>', async () => {
    const container = await AstroContainer.create()

    const render = (text?: string) => container.renderToString(EventDescription, { props: { text } })

    it('renders a blank line as a paragraph break', async () => {
        const result = await render('The first paragraph.\n\nThe second paragraph.')

        expect(result).toContain('<p>The first paragraph.</p>')
        expect(result).toContain('<p>The second paragraph.</p>')
    })

    it('keeps a single newline inside one paragraph', async () => {
        const result = await render('One sentence.\nAnother sentence.')

        expect(result.match(/<p>/g)).toHaveLength(1)
        expect(result).toContain('One sentence.\nAnother sentence.')
    })

    it('renders Markdown emphasis, which is the whole point', async () => {
        const result = await render('~~Sixteen~~ Fifteen dedicated amateur golfers.')

        expect(result).toContain('<s>Sixteen</s>')
    })

    it('escapes raw HTML rather than trusting whoever typed it', async () => {
        const result = await render('Nothing to see <script>alert(1)</script> here.')

        expect(result).not.toContain('<script>')
        expect(result).toContain('&lt;script&gt;')
    })

    it('renders nothing for an event without a description', async () => {
        expect(await render(undefined)).not.toContain('event-description')
        expect(await render('   ')).not.toContain('event-description')
    })
})
