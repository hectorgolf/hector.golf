import { experimental_AstroContainer as AstroContainer } from 'astro/container'
import { expect, describe, it } from 'vitest'
import Card from '../../src/components/events/EventCard.astro'


describe('Component <EventCard/>', async () => {
    const container = await AstroContainer.create()

    it('renders a card with all props', async () => {
        const result = await container.renderToString(Card, {
            props: {
                title: 'Test Invitational 2024',
                href: '/events/imaginary/test-invitational-2024',
                date: 'November 1, 2024',
                location: 'Nova Scotia, Canada',
                image: 'https://example.com/image.jpg',
            },
        })

        expect(result).toContain('Test Invitational 2024')
        expect(result).toContain('Nova Scotia, Canada')
        expect(result).toContain('November 1, 2024')
        expect(result).toContain(`<a href="/events/imaginary/test-invitational-2024"`)
        expect(result).toContain(`<img src="https://example.com/image.jpg"`)
    })

    it('omits the image if not provided', async () => {
        const result = await container.renderToString(Card, {
            props: {
                title: 'Test Invitational 2024',
                href: '/events/imaginary/test-invitational-2024',
                date: 'November 1, 2024',
                location: 'Nova Scotia, Canada',
            },
        })
        expect(result).toContain('Test Invitational 2024')
        expect(result).toContain('Nova Scotia, Canada')
        expect(result).toContain('November 1, 2024')
        expect(result).toContain(`<a href="/events/imaginary/test-invitational-2024"`)
        expect(result).not.toContain(`<img src="https://example.com/image.jpg"`)
    })

})
