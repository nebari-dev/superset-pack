# Nebari Superset Pack Documentation

This directory contains the [Astro](https://astro.build) + [Starlight](https://starlight.astro.build) site for the Nebari Superset Pack.

## Prerequisites

- Node.js `>= 22` (enforced by the `engines` field in `package.json`)
- npm (bundled with Node.js)

## Install

```bash
cd docs
npm ci
```

## Local development

```bash
npm run dev
```

Starts the Astro dev server with hot reload on http://localhost:4321/.

## Production build

```bash
npm run build
```

Emits static files to `docs/dist/`.

## Preview the production build

```bash
npm run preview
```

Serves the contents of `docs/dist/` locally so you can verify the production output.

## Unit tests

```bash
npm test
```

Runs the Vitest suite (currently: the `remark-base-links` plugin tests).

## Link checking

```bash
bash ../scripts/check-links.sh
```

To test with the production base path: `BASE=/superset-pack/ bash ../scripts/check-links.sh`

## Content

Pages live in `src/content/docs/`. Each `.md` or `.mdx` file becomes a page. The sidebar is configured in `astro.config.mjs` under `starlight.sidebar`.

## CI

The [`Docs` workflow](../.github/workflows/docs.yml) runs unit tests, builds the site, checks internal links, and deploys to [Cloudflare Pages](https://pages.cloudflare.com) on every push to `main` and every pull request that touches `docs/`. Pull requests get a preview URL posted as a comment; the [`Docs preview cleanup`](../.github/workflows/docs-preview-cleanup.yml) workflow removes it when the PR closes.
