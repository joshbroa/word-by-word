/**
 * Pure helpers for matching words between a note's source and its rendered
 * text. No Obsidian imports, so they can be unit tested.
 *
 * Rendered HTML has no link back to character offsets, so both directions
 * (source word → rendered word for highlighting, and clicked rendered word →
 * source word for jumping) work by occurrence: "the third whole-word `the`
 * in this block".
 */

/** The word without leading and trailing punctuation, e.g. `"Hello,` → `Hello`. */
export function coreOf(display: string): string {
	return display.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '') || display;
}

const isWordChar = (ch: string | undefined): boolean => ch !== undefined && /[\p{L}\p{N}]/u.test(ch);

/** Start indices of whole-word occurrences of `needle` in `haystack`. */
export function findOccurrences(haystack: string, needle: string): number[] {
	const out: number[] = [];
	if (!needle) return out;
	const checkStart = isWordChar(needle[0]);
	const checkEnd = isWordChar(needle[needle.length - 1]);
	let i = haystack.indexOf(needle);
	while (i >= 0) {
		const okStart = !checkStart || !isWordChar(haystack[i - 1]);
		const okEnd = !checkEnd || !isWordChar(haystack[i + needle.length]);
		if (okStart && okEnd) out.push(i);
		i = haystack.indexOf(needle, i + 1);
	}
	return out;
}

export interface VisibleText {
	text: string;
	/** Source offset of each character of `text`. */
	offsets: number[];
}

/** The visible (not hidden) characters of `source` between `from` and `to`. */
export function visibleText(source: string, hidden: Uint8Array, from: number, to: number): VisibleText {
	const chars: string[] = [];
	const offsets: number[] = [];
	const end = Math.min(to, source.length);
	for (let i = Math.max(0, from); i < end; i++) {
		if (hidden[i] === 1) continue;
		chars.push(source[i] ?? '');
		offsets.push(i);
	}
	return { text: chars.join(''), offsets };
}

/** The whitespace-delimited word containing `index` in `text`, as [start, end). */
export function wordAround(text: string, index: number): { start: number; end: number } | null {
	if (index < 0 || index >= text.length || /\s/.test(text[index] ?? ' ')) return null;
	let start = index;
	let end = index + 1;
	while (start > 0 && !/\s/.test(text[start - 1] ?? ' ')) start--;
	while (end < text.length && !/\s/.test(text[end] ?? ' ')) end++;
	return { start, end };
}

/**
 * Given the rendered text of a block and the index of a character the reader
 * clicked, find the matching position in the block's visible source text.
 * Returns an index into `visible.text`'s source offsets, i.e. a source
 * offset, or null if the word cannot be matched.
 */
export function sourceOffsetForRenderedIndex(renderedText: string, index: number, visible: VisibleText): number | null {
	const word = wordAround(renderedText, index);
	if (!word) return null;
	const raw = renderedText.slice(word.start, word.end);
	const needle = coreOf(raw);
	const coreStart = word.start + Math.max(0, raw.indexOf(needle));
	const renderedMatches = findOccurrences(renderedText, needle);
	const occurrence = renderedMatches.findIndex((m) => m === coreStart);
	if (occurrence < 0) return null;
	const sourceMatches = findOccurrences(visible.text, needle);
	const match = sourceMatches[Math.min(occurrence, sourceMatches.length - 1)];
	if (match === undefined) return null;
	return visible.offsets[match] ?? null;
}
