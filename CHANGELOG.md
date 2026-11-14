# Changelog

All notable changes to this project are documented here. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.0] - 2026-11-14

### Added

- Read a note aloud one word at a time, advancing only on request.
- Commands: start from beginning, start from cursor (reads only the selection if there is one), resume where you left off, next word, repeat current word, previous word, spell current word, pause or resume auto-advance, and stop and close. None has a default hotkey.
- Current-word highlighting in editing view (CodeMirror 6 decorations, including inside Live Preview callouts and tables) and reading view (CSS Custom Highlight API), with auto-scroll.
- Floating control bar with the current word, position and buttons for every action.
- Markdown-aware tokeniser that skips frontmatter, heading marks, list markers, emphasis markers, link URLs, wikilink targets, embeds, comments, callout markers, footnotes and block IDs, and maps every word back to its exact position in the note.
- Optional punctuation mode that speaks punctuation and line breaks as separate steps.
- Voice, rate, pitch and volume settings. Defaults to a British English voice when one is installed.
- Optional auto-advance after a set number of seconds.
- Saved position per note, kept when notes are renamed.

[Unreleased]: https://github.com/joshbroa/word-by-word/compare/0.1.0...HEAD
[0.1.0]: https://github.com/joshbroa/word-by-word/releases/tag/0.1.0
