# Plot navigator

This project contains multiple pieces that will be used for visualizing data for the Vera C. Rubin LSST. There will be a main page that allows users to view multiple plots for the Data Preview 2 (DP2) data that is released publicly.

## Tech stack

- Svelte 5 + TypeScript
- Vite
- D3 for data visualization

## Package manager

npm

## Commands

- `npm run dev` — start dev server
- `npm run build` — production build
- `npm run preview` — preview production build
- `npm run check` — type-check with svelte-check and tsc
- `npm run lint` — lint with ESLint
- `npm run lint:fix` — lint and auto-fix
- `npm run format` — format all files with Prettier
- `npm run format:check` — check formatting without writing
- `npx vitest` — run tests

## Testing

Use Vitest for all tests.

## Linting & formatting

Use ESLint and Prettier. After making changes to any source files, run `npm run format` to keep files properly formatted. Configuration lives in:

- `.prettierrc` — Prettier config (single quotes, semicolons, 100 char width, Svelte plugin)
- `eslint.config.js` — ESLint flat config (TypeScript, Svelte, Prettier integration)

## Git

Do not commit, push, or create branches. The user handles all git operations.

## Notes

- `temp/` is a staging area for files being converted from Python or other formats. It is not version controlled and not part of the package. Do not modify or reference files in `temp/`.
- **Do NOT** put the data in the info.json heatmaps on multiple lines. For ease of reading this should all be on a single line.
