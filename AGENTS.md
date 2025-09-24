# Repository Guidelines

## Project Structure & Module Organization
The app ships as a static single-page client. `index.html` wires the layout, loads styles, and injects the JavaScript. `styles.css` contains all styling; keep new rules grouped by component class names. `app.js` handles WebRTC set up, OpenAI realtime messaging, and UI state. Assets live alongside the entry files—prefer subdirectories (`assets/`, `docs/`) if you introduce media or longer-form notes. Tests are not yet present; place future suites under `tests/` mirroring the runtime paths.

## Build, Test, and Development Commands
No bundler is required. During development run a static server such as `npx serve .` or `python3 -m http.server 4173` and open `http://localhost:4173`. Use `npm init -y` only if you add tooling; commit resulting lockfiles. Linting is manual today—run `npx eslint app.js` if you introduce ESLint.

## Coding Style & Naming Conventions
Follow modern ES2020 syntax. Use `const`/`let`, arrow functions for callbacks, and early returns to keep control flow flat. Indent with two spaces in HTML, CSS, and JavaScript. Name DOM helpers with short verbs (`updateToggleButton`), and persist shared state in module-level constants. CSS classes should stay kebab-case. Store API keys in `localStorage`, never commit them.

## Testing Guidelines
Until automated coverage lands, perform manual regression passes: connect with and without keys, toggle recording, and clear saved data. If you add automated tests, prefer Jest with `tests/**/*.test.js` filenames and ensure new behavior has at least one positive and one failure-path check. Document any new npm scripts in this guide.

## Commit & Pull Request Guidelines
Existing history favors brief summaries with optional leading emoji (e.g., `✨ add connection retries`). Keep the first line under 60 characters and use the imperative mood. For pull requests, include a concise problem statement, screenshots or GIFs for UI changes, and note manual test steps (browser, OS, mic setup). Link related issues and call out any follow-up work.

## Security & Configuration Tips
Treat API keys as user-provided secrets; clearing them calls `localStorage.removeItem`. When sharing builds, remind testers to supply their own keys. Review browser console warnings before shipping and rotate keys immediately if exposed.
