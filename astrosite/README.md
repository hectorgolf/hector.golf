# hector.golf

The public site for the Hector Trophée: events, players, courses and past issues of
the Golf Report. Live scoring and leaderboards live in a separate app at
[app.hector.golf](https://app.hector.golf).

## Design system

Colour, type and the shared component primitives are defined in
[`src/styles/hector.css`](src/styles/hector.css), which mirrors the scorecard app's
theme so the two properties read as one product.

**[The colour brandbook is at `/brand`](src/pages/brand.astro)** — run `npm run dev`
and open <http://localhost:4321/brand>. It is generated from the stylesheet rather
than describing it: every swatch, hex code, hue angle and contrast ratio is parsed
out of `hector.css` at build time, the tee-marker colours come from the course
collection, and the component specimens are the real components. Change a token and
the brandbook follows on the next build. It is deliberately not linked from the site's
navigation.

The one rule worth knowing before touching colour: **violet is the interface**
(buttons, links, selection, active state) and **gold, fairway and ember are the three
competitions** (Hector, Victor, Matchplay). The two sets never borrow from each other.
Reach for the semantic tokens — `--hector`, `--victor`, `--matchplay` — rather than
the underlying `--gold-400`, and let `<CompetitionMark />` pair a competition with its
mark and its tint.

---

# Astro Starter Kit: Basics

```sh
npm create astro@latest -- --template basics
```

[![Open in StackBlitz](https://developer.stackblitz.com/img/open_in_stackblitz.svg)](https://stackblitz.com/github/withastro/astro/tree/latest/examples/basics)
[![Open with CodeSandbox](https://assets.codesandbox.io/github/button-edit-lime.svg)](https://codesandbox.io/p/sandbox/github/withastro/astro/tree/latest/examples/basics)
[![Open in GitHub Codespaces](https://github.com/codespaces/badge.svg)](https://codespaces.new/withastro/astro?devcontainer_path=.devcontainer/basics/devcontainer.json)

> 🧑‍🚀 **Seasoned astronaut?** Delete this file. Have fun!

![just-the-basics](https://github.com/withastro/astro/assets/2244813/a0a5533c-a856-4198-8470-2d67b1d7c554)

## 🚀 Project Structure

Inside of your Astro project, you'll see the following folders and files:

```text
/
├── public/
│   └── favicon.svg
├── src/
│   ├── components/
│   │   └── Card.astro
│   ├── layouts/
│   │   └── Layout.astro
│   └── pages/
│       └── index.astro
└── package.json
```

Astro looks for `.astro` or `.md` files in the `src/pages/` directory. Each page is exposed as a route based on its file name.

There's nothing special about `src/components/`, but that's where we like to put any Astro/React/Vue/Svelte/Preact components.

Any static assets, like images, can be placed in the `public/` directory.

## 🧞 Commands

All commands are run from the root of the project, from a terminal:

| Command                   | Action                                           |
| :------------------------ | :----------------------------------------------- |
| `npm install`             | Installs dependencies                            |
| `npm run dev`             | Starts local dev server at `localhost:4321`      |
| `npm run build`           | Build your production site to `./dist/`          |
| `npm run preview`         | Preview your build locally, before deploying     |
| `npm run astro ...`       | Run CLI commands like `astro add`, `astro check` |
| `npm run astro -- --help` | Get help using the Astro CLI                     |

## 👀 Want to learn more?

Feel free to check [our documentation](https://docs.astro.build) or jump into our [Discord server](https://astro.build/chat).
