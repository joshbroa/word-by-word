# Contributing to Word by Word

Thanks for helping! Bug reports, ideas, documentation fixes and code are all welcome.

## Reporting bugs and ideas

Use the [issue templates](https://github.com/joshbroa/word-by-word/issues/new/choose). For bugs, a small piece of markdown that shows the problem helps most, along with your operating system, Obsidian version and voice.

## Development setup

You need [Node.js](https://nodejs.org/) 20 or newer and git.

```bash
git clone https://github.com/joshbroa/word-by-word.git
cd word-by-word
npm install
npm run dev      # rebuilds main.js whenever you save
```

| Script | What it does |
| --- | --- |
| `npm run dev` | Build in watch mode, with source maps. |
| `npm run build` | Type-check, then make a production build of `main.js`. |
| `npm test` | Run the unit tests (Vitest). |
| `npm run lint` | Run ESLint with Obsidian's plugin rules. |

### Loading your build into a test vault

Use a **separate test vault**, not your real one. Link the repository folder into the vault's plugins folder so Obsidian loads your build directly:

**Windows** (Command Prompt; a directory junction needs no admin rights):

```bat
mklink /J "C:\path\to\TestVault\.obsidian\plugins\word-by-word" "C:\path\to\word-by-word"
```

**macOS / Linux:**

```bash
ln -s /path/to/word-by-word /path/to/TestVault/.obsidian/plugins/word-by-word
```

Then, in the test vault, enable **Word by Word** in **Settings → Community plugins**. After each rebuild, reload the plugin by turning it off and on, or run **Reload app without saving** from the command palette. The [Hot-Reload](https://github.com/pjeby/hot-reload) plugin can do this for you automatically.

## Project layout

```
src/
  main.ts              Plugin lifecycle: settings, events, registration
  commands.ts          Command definitions (no default hotkeys)
  controller.ts        Runs a session: speech, highlighting, bar, positions
  session.ts           Pure: current position within the tokens
  tokenizer.ts         Pure: markdown masking, tokens and offsets, spelling
  speech.ts            Web Speech API wrapper (cancel-on-press, voice choice)
  control-bar.ts       Floating control bar
  settings.ts          Settings types, defaults and data normalisation
  settings-tab.ts      Settings UI (declarative on 1.13+, display() fallback)
  highlight/editor.ts  CodeMirror 6 decorations for editing view
  highlight/rendered.ts  CSS Custom Highlight for reading view and LP widgets
tests/                 Vitest unit tests for the pure modules
```

`tokenizer.ts` and `session.ts` must stay free of Obsidian imports so they can be unit tested. If you change how markdown is read, add a test to `tests/tokenizer.test.ts`.

## Guidelines

This plugin follows Obsidian's [developer policies](https://docs.obsidian.md/Developer+policies) and [plugin guidelines](https://docs.obsidian.md/Plugins/Releasing/Plugin+guidelines). In particular:

- **No network requests and no telemetry.**
- **No `innerHTML`, `outerHTML` or `insertAdjacentHTML`.** Build the DOM with Obsidian's helpers (`createEl`, `createDiv`, `setText`).
- **Register everything that needs cleaning up** with `registerEvent`, `registerDomEvent`, `registerInterval` or `register`, and make sure stopping a session removes every highlight, class and element.
- **Sentence case** for all UI text. Don't put "Obsidian" or "plugin" in command names.
- **Strict TypeScript with no `any`.** `npm run build`, `npm test` and `npm run lint` must all pass; CI checks them on every push.
- Prefer Obsidian CSS variables in `styles.css` so themes keep working, and avoid inline styles.

## Pull requests

1. Fork the repository and create a branch from `main`.
2. Keep changes focused, and include tests for tokeniser changes.
3. Add a line under **Unreleased** in [CHANGELOG.md](CHANGELOG.md).
4. Open the pull request with a short description of the change and how you tested it (operating system, Obsidian version, editing or reading view).

## Releasing (maintainers)

1. Move the **Unreleased** notes in `CHANGELOG.md` under a new version heading.
2. Run `npm version <x.y.z>`. This updates `package.json`, `manifest.json` and `versions.json`, commits, and creates a tag with no `v` prefix.
3. Run `git push --follow-tags`. The release workflow builds the plugin and creates a **draft** GitHub release with `main.js`, `manifest.json` and `styles.css` attached.
4. Review the draft, paste in the changelog notes, and publish it.
