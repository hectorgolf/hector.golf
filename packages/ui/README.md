# @hector/ui

The components and design tokens both `astrosite` (the public site) and `admin` render with.

Everything here is deliberately **atomic**: each component takes props and imports nothing from
either application's domain layer. That is the admission criterion, not a description — a component
that needs `src/code/` or `src/schemas/` belongs to the app that owns those, not here.

| | |
| --- | --- |
| `styles/hector.css` | The design system. Every token the components reference lives here |
| `components/*.astro` | Card, PageHeader, Breadcrumb, Highlight, and the competition marks |

`hector.css` is loaded once per app, by its layout. The components only carry their own scoped
styles and read tokens from it, so a component rendered without the stylesheet will lay out but look
wrong.

## Consuming it

```astro
---
import Card from '@hector/ui/components/Card.astro'
---
```

Resolution works through the npm workspace at the repository root; there is no build step and
nothing is published. Astro compiles these `.astro` files as part of whichever app imports them,
which is also why both apps must keep their Astro versions compatible.
