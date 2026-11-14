/**
 * Pure tokeniser for Word by Word.
 *
 * This module has no Obsidian imports so it can be unit tested in isolation.
 *
 * Strategy: rather than deleting markdown syntax (which would break the link
 * between a word and its position in the note), every character of the source
 * is marked as either *visible* or *hidden*. Words are then the runs of visible,
 * non-whitespace characters. Hidden characters inside a run (for example the
 * `**` in `**bold**,`) are transparent, so `bold,` stays one word. Every token
 * keeps the exact `start`/`end` offsets of its first and last visible
 * character in the original source.
 */

export type TokenKind = 'word' | 'punctuation' | 'break';

export interface Token {
	/** `word` for normal words, `punctuation` and `break` only in punctuation mode. */
	kind: TokenKind;
	/** What the control bar shows. Words keep their attached punctuation. */
	display: string;
	/** What speech synthesis is asked to say. */
	speech: string;
	/** Offset of the first character of the token in the original source. */
	start: number;
	/** Offset just past the last character of the token in the original source. */
	end: number;
}

export interface TokenizeOptions {
	/** Speak punctuation and line breaks as their own steps. */
	speakPunctuation: boolean;
	/** Skip the contents of fenced code blocks instead of reading them. */
	skipCodeBlocks: boolean;
}

export interface TextRange {
	from: number;
	to: number;
}

export const DEFAULT_TOKENIZE_OPTIONS: TokenizeOptions = {
	speakPunctuation: false,
	skipCodeBlocks: true,
};

/**
 * Tokenise a markdown note.
 *
 * @param source The full text of the note.
 * @param options Tokeniser options.
 * @param range Optional range (for a selection). The whole note is still
 *   parsed, so context such as code blocks is respected, but only tokens that
 *   overlap the range are returned.
 */
export function tokenize(
	source: string,
	options: Partial<TokenizeOptions> = {},
	range?: TextRange,
): Token[] {
	const opts: TokenizeOptions = { ...DEFAULT_TOKENIZE_OPTIONS, ...options };
	const hidden = maskMarkdown(source, opts);
	let raw = collectRawTokens(source, hidden);
	if (range) {
		const from = Math.min(range.from, range.to);
		const to = Math.max(range.from, range.to);
		raw = raw.filter((t) => t.end > from && t.start < to);
	}
	return opts.speakPunctuation
		? buildPunctuationSteps(source, hidden, raw)
		: raw.map(buildPlainStep);
}

/**
 * Index of the token at or after `offset`. Used for "start from cursor" and for
 * restoring a saved position. Returns the last index if `offset` is past the
 * end, or -1 if there are no tokens.
 */
export function findTokenIndexAtOffset(tokens: readonly Token[], offset: number): number {
	if (tokens.length === 0) return -1;
	for (let i = 0; i < tokens.length; i++) {
		const t = tokens[i];
		if (t && t.end > offset) return i;
	}
	return tokens.length - 1;
}

/**
 * Break a word into the steps for spelling it out loud, e.g.
 * `Don't` → `capital D`, `o`, `n`, `apostrophe`, `t`.
 */
export function spellOut(word: string): string[] {
	const out: string[] = [];
	for (const ch of Array.from(word)) {
		if (/\s/.test(ch)) continue;
		const named = SPELL_NAMES[ch];
		if (named) {
			out.push(named);
		} else if (ch !== ch.toLowerCase() && ch === ch.toUpperCase()) {
			out.push(`capital ${ch}`);
		} else {
			out.push(ch);
		}
	}
	return out;
}

// ---------------------------------------------------------------------------
// Masking
// ---------------------------------------------------------------------------

interface Line {
	start: number;
	/** End of line content, excluding the line terminator. */
	end: number;
}

function splitLines(source: string): Line[] {
	const lines: Line[] = [];
	let start = 0;
	for (let i = 0; i < source.length; i++) {
		if (source[i] === '\n') {
			const end = i > start && source[i - 1] === '\r' ? i - 1 : i;
			lines.push({ start, end });
			start = i + 1;
		}
	}
	lines.push({ start, end: source.length });
	return lines;
}

const FRONTMATTER_RE = /^---[ \t]*\r?\n(?:[\s\S]*?\r?\n)?(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/;
const QUOTE_PREFIX_RE = /^(?:[ \t]*>[ \t]?)+/;
const FENCE_RE = /^ {0,3}(`{3,}|~{3,})/;
const CALLOUT_RE = /^\[![\w-]+\][+-]?[ \t]*/;
const HR_RE = /^[ \t]*([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const SETEXT_RE = /^[ \t]*=+[ \t]*$/;
const HEADING_RE = /^[ \t]{0,3}#{1,6}(?:[ \t]+|$)/;
const HEADING_CLOSE_RE = /[ \t]+#+[ \t]*$/;
const LIST_RE = /^[ \t]*(?:[-*+]|\d{1,9}[.)])[ \t]+/;
const TASK_RE = /^\[[^\]]\][ \t]+/;
const TABLE_SEPARATOR_RE = /^[ \t]*\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/;

/** Returns an array where 1 marks a hidden character. */
export function maskMarkdown(source: string, opts: TokenizeOptions): Uint8Array {
	const n = source.length;
	const hidden = new Uint8Array(n);
	const literal = new Uint8Array(n);
	const hide = (from: number, to: number): void => {
		hidden.fill(1, Math.max(0, from), Math.min(n, to));
	};

	// Frontmatter.
	const fm = FRONTMATTER_RE.exec(source);
	let bodyStart = 0;
	if (fm) {
		hide(0, fm[0].length);
		bodyStart = fm[0].length;
	}

	// Pass 1: find fenced code blocks so later passes can ignore them.
	const lines = splitLines(source).filter((l) => l.start >= bodyStart);
	const codeLines = new Set<number>();
	let fence: { char: string; len: number; inQuote: boolean } | null = null;
	for (let li = 0; li < lines.length; li++) {
		const line = lines[li];
		if (!line) continue;
		const text = source.slice(line.start, line.end);
		const quote = QUOTE_PREFIX_RE.exec(text);
		const quoteLen = quote ? quote[0].length : 0;
		if (fence) {
			const prefixLen = fence.inQuote ? quoteLen : 0;
			const rest = text.slice(prefixLen);
			const close = FENCE_RE.exec(rest);
			codeLines.add(li);
			if (prefixLen) hide(line.start, line.start + prefixLen);
			const marker = close?.[1];
			if (
				marker &&
				marker[0] === fence.char &&
				marker.length >= fence.len &&
				rest.slice(close[0].length).trim() === ''
			) {
				hide(line.start, line.end);
				fence = null;
			} else if (opts.skipCodeBlocks) {
				hide(line.start, line.end);
			} else {
				literal.fill(1, line.start, line.end);
			}
			continue;
		}
		const open = FENCE_RE.exec(text.slice(quoteLen));
		const marker = open?.[1];
		if (marker) {
			fence = { char: marker[0] ?? '`', len: marker.length, inQuote: quoteLen > 0 };
			codeLines.add(li);
			hide(line.start, line.end);
		}
	}

	// Pass 2: HTML comments and Obsidian %% comments, which may span lines.
	const codeLineRanges = lines.filter((_, i) => codeLines.has(i));
	const isInCode = (offset: number): boolean =>
		codeLineRanges.some((l) => offset >= l.start && offset <= l.end);
	for (const re of [/<!--[\s\S]*?(?:-->|$)/g, /%%[\s\S]*?(?:%%|$)/g]) {
		re.lastIndex = bodyStart;
		let m: RegExpExecArray | null;
		while ((m = re.exec(source))) {
			if (m[0].length === 0) {
				re.lastIndex++;
				continue;
			}
			if (isInCode(m.index)) {
				re.lastIndex = m.index + 1;
				continue;
			}
			hide(m.index, m.index + m[0].length);
		}
	}

	// Pass 3: line-level and inline markdown.
	for (let li = 0; li < lines.length; li++) {
		const line = lines[li];
		if (!line || codeLines.has(li)) continue;
		maskLine(source, line, hidden, literal);
	}

	return hidden;
}

function maskLine(source: string, line: Line, hidden: Uint8Array, literal: Uint8Array): void {
	const text = source.slice(line.start, line.end);
	const base = line.start;
	const hideRel = (from: number, to: number): void => {
		if (to > from) hidden.fill(1, base + from, base + to);
	};
	const isFree = (from: number, to: number): boolean => {
		for (let i = base + from; i < base + to; i++) {
			if (hidden[i] === 1 || literal[i] === 1) return false;
		}
		return true;
	};

	// --- Line prefixes -------------------------------------------------------
	let p = 0;
	const quote = QUOTE_PREFIX_RE.exec(text);
	if (quote) {
		hideRel(0, quote[0].length);
		p = quote[0].length;
		const callout = CALLOUT_RE.exec(text.slice(p));
		if (callout) {
			hideRel(p, p + callout[0].length);
			p += callout[0].length;
		}
	}
	let rest = text.slice(p);
	if (HR_RE.test(rest) || SETEXT_RE.test(rest)) {
		hideRel(p, text.length);
		return;
	}
	const isTable = rest.trimStart().startsWith('|');
	if (isTable && TABLE_SEPARATOR_RE.test(rest)) {
		hideRel(p, text.length);
		return;
	}
	const heading = HEADING_RE.exec(rest);
	if (heading) {
		hideRel(p, p + heading[0].length);
		const close = HEADING_CLOSE_RE.exec(rest);
		if (close && close.index >= heading[0].length) {
			hideRel(p + close.index, text.length);
		}
		p += heading[0].length;
	} else {
		const list = LIST_RE.exec(rest);
		if (list) {
			hideRel(p, p + list[0].length);
			p += list[0].length;
			rest = text.slice(p);
			const task = TASK_RE.exec(rest);
			if (task) {
				hideRel(p, p + task[0].length);
				p += task[0].length;
			}
		}
	}

	// --- Escapes -------------------------------------------------------------
	for (let i = p; i < text.length - 1; i++) {
		if (text[i] === '\\' && /[!-/:-@[-`{-~]/.test(text[i + 1] ?? '') && isFree(i, i + 1)) {
			hideRel(i, i + 1);
			literal[base + i + 1] = 1;
			i++;
		}
	}

	// --- Inline code -----------------------------------------------------------
	for (let i = p; i < text.length; i++) {
		if (text[i] !== '`' || !isFree(i, i + 1)) continue;
		let runEnd = i;
		while (text[runEnd] === '`') runEnd++;
		const run = text.slice(i, runEnd);
		let close = -1;
		let j = runEnd;
		while (j < text.length) {
			const k = text.indexOf(run, j);
			if (k < 0) break;
			let kEnd = k + run.length;
			if (text[kEnd] === '`' || text[k - 1] === '`') {
				while (text[kEnd] === '`') kEnd++;
				j = kEnd;
				continue;
			}
			close = k;
			break;
		}
		if (close < 0) {
			i = runEnd - 1;
			continue;
		}
		hideRel(i, runEnd);
		hideRel(close, close + run.length);
		literal.fill(1, base + runEnd, base + close);
		i = close + run.length - 1;
	}

	const eachMatch = (re: RegExp, fn: (m: RegExpExecArray) => void): void => {
		re.lastIndex = p;
		let m: RegExpExecArray | null;
		while ((m = re.exec(text))) {
			if (m[0].length === 0) {
				re.lastIndex++;
				continue;
			}
			fn(m);
		}
	};

	// --- Embeds and images (not spoken at all) ---------------------------------
	eachMatch(/!\[\[[^\]\n]*\]\]/g, (m) => {
		if (isFree(m.index, m.index + 3)) hideRel(m.index, m.index + m[0].length);
	});
	eachMatch(/!\[[^\]\n]*\]\([^)\n]*\)/g, (m) => {
		if (isFree(m.index, m.index + 2)) hideRel(m.index, m.index + m[0].length);
	});

	// --- Wikilinks: speak the alias, or the note name --------------------------
	eachMatch(/\[\[([^\]\n]+)\]\]/g, (m) => {
		const start = m.index;
		const end = start + m[0].length;
		if (!isFree(start, start + 2) || !isFree(end - 2, end)) return;
		const inner = m[1] ?? '';
		const innerStart = start + 2;
		const [keepFrom, keepTo] = wikilinkKeepRange(inner);
		hideRel(start, end);
		if (keepTo > keepFrom) {
			hidden.fill(0, base + innerStart + keepFrom, base + innerStart + keepTo);
		}
	});

	// --- Markdown links: speak the link text, never the URL ---------------------
	eachMatch(/\[([^\]\n]*)\]\(([^)\n]*)\)/g, (m) => {
		const start = m.index;
		const textEnd = start + 1 + (m[1]?.length ?? 0);
		if (!isFree(start, start + 1) || !isFree(textEnd, textEnd + 2)) return;
		hideRel(start, start + 1);
		hideRel(textEnd, start + m[0].length);
	});
	eachMatch(/\[([^\]\n]+)\]\[([^\]\n]*)\]/g, (m) => {
		const start = m.index;
		const textEnd = start + 1 + (m[1]?.length ?? 0);
		if (!isFree(start, start + 1) || !isFree(textEnd, textEnd + 2)) return;
		hideRel(start, start + 1);
		hideRel(textEnd, start + m[0].length);
	});
	eachMatch(/<((?:https?|mailto|obsidian):[^>\s]+)>/g, (m) => {
		if (!isFree(m.index, m.index + 1)) return;
		hideRel(m.index, m.index + 1);
		hideRel(m.index + m[0].length - 1, m.index + m[0].length);
	});

	// --- Footnotes, HTML tags, block ids, tags ----------------------------------
	eachMatch(/\[\^[^\]\n]+\]/g, (m) => {
		if (isFree(m.index, m.index + 2)) hideRel(m.index, m.index + m[0].length);
	});
	eachMatch(/\^\[/g, (m) => {
		const close = text.indexOf(']', m.index + 2);
		if (close > 0 && isFree(m.index, m.index + 2)) {
			hideRel(m.index, m.index + 2);
			hideRel(close, close + 1);
		}
	});
	eachMatch(/<\/?[A-Za-z][A-Za-z0-9-]*(?:\s[^<>\n]*)?\/?>/g, (m) => {
		if (isFree(m.index, m.index + 1)) hideRel(m.index, m.index + m[0].length);
	});
	eachMatch(/(?:^|\s)(\^[A-Za-z0-9-]+)[ \t]*$/g, (m) => {
		const idStart = m.index + m[0].indexOf('^');
		if (isFree(idStart, idStart + 1)) hideRel(idStart, m.index + m[0].length);
	});
	eachMatch(/(?:^|[\s(])#(?=[\p{L}\p{N}_/-]*[\p{L}_/-])[\p{L}\p{N}_/-]+/gu, (m) => {
		const hash = m.index + m[0].indexOf('#');
		if (isFree(hash, hash + 1)) hideRel(hash, hash + 1);
	});

	// --- Table cell separators ---------------------------------------------------
	if (isTable) {
		for (let i = p; i < text.length; i++) {
			if (text[i] === '|' && isFree(i, i + 1)) hideRel(i, i + 1);
		}
	}

	// --- Emphasis: **bold**, *italic*, __bold__, _italic_, ~~strike~~, ==highlight==
	maskEmphasis(text, p, base, hidden, literal);
}

/** Which part of a wikilink's inner text should be spoken, as [from, to). */
function wikilinkKeepRange(inner: string): [number, number] {
	const pipe = inner.indexOf('|');
	if (pipe >= 0) {
		return [pipe + 1, inner.length];
	}
	const hash = inner.indexOf('#');
	const noteEnd = hash >= 0 ? hash : inner.length;
	if (noteEnd === 0) {
		// [[#Heading]] → "Heading"; [[#^block]] → nothing.
		const heading = inner.slice(1);
		if (heading.startsWith('^')) return [0, 0];
		return [1, inner.length];
	}
	const slash = inner.lastIndexOf('/', noteEnd - 1);
	let from = slash >= 0 ? slash + 1 : 0;
	let to = noteEnd;
	if (inner.slice(from, to).toLowerCase().endsWith('.md')) to -= 3;
	if (to <= from) {
		from = 0;
		to = noteEnd;
	}
	return [from, to];
}

interface DelimiterRun {
	char: string;
	from: number;
	to: number;
}

function maskEmphasis(
	text: string,
	from: number,
	base: number,
	hidden: Uint8Array,
	literal: Uint8Array,
): void {
	const usable = (i: number): boolean => hidden[base + i] !== 1 && literal[base + i] !== 1;
	const isSpace = (ch: string | undefined): boolean => ch === undefined || /\s/.test(ch);
	const isAlnum = (ch: string | undefined): boolean => ch !== undefined && /[\p{L}\p{N}]/u.test(ch);
	const stack: DelimiterRun[] = [];

	let i = from;
	while (i < text.length) {
		const ch = text[i];
		if (!(ch === '*' || ch === '_' || ch === '~' || ch === '=') || !usable(i)) {
			i++;
			continue;
		}
		let j = i;
		while (j < text.length && text[j] === ch && usable(j)) j++;
		const len = j - i;
		if ((ch === '~' || ch === '=') && len !== 2) {
			i = j;
			continue;
		}
		const prev = text[i - 1];
		const next = text[j];
		const leftFlanking = !isSpace(next);
		const rightFlanking = !isSpace(prev);
		let canOpen = leftFlanking;
		let canClose = rightFlanking;
		if (ch === '_') {
			canOpen = leftFlanking && !isAlnum(prev);
			canClose = rightFlanking && !isAlnum(next);
		}
		let matched = false;
		if (canClose) {
			for (let s = stack.length - 1; s >= 0; s--) {
				const opener = stack[s];
				if (opener && opener.char === ch) {
					hidden.fill(1, base + opener.from, base + opener.to);
					hidden.fill(1, base + i, base + j);
					stack.length = s;
					matched = true;
					break;
				}
			}
		}
		if (!matched && canOpen) stack.push({ char: ch, from: i, to: j });
		i = j;
	}
}

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------

interface RawToken {
	start: number;
	end: number;
	chars: string[];
	offsets: number[];
}

function collectRawTokens(source: string, hidden: Uint8Array): RawToken[] {
	const tokens: RawToken[] = [];
	let cur: RawToken | null = null;
	for (let i = 0; i < source.length; i++) {
		if (hidden[i] === 1) continue;
		const ch = source[i] ?? '';
		if (/\s/.test(ch)) {
			if (cur) tokens.push(cur);
			cur = null;
			continue;
		}
		if (!cur) cur = { start: i, end: i + 1, chars: [], offsets: [] };
		cur.chars.push(ch);
		cur.offsets.push(i);
		cur.end = i + 1;
	}
	if (cur) tokens.push(cur);
	return tokens;
}

interface PunctUnit {
	text: string;
	name: string;
	/** Index into the raw token's chars. */
	index: number;
}

interface SplitToken {
	lead: PunctUnit[];
	coreFrom: number;
	coreTo: number;
	trail: PunctUnit[];
}

const LEAD_NAMES: Record<string, string> = {
	'"': 'open quote',
	'“': 'open quote',
	'«': 'open quote',
	"'": 'open single quote',
	'‘': 'open single quote',
	'(': 'open bracket',
	'[': 'open square bracket',
	'{': 'open brace',
	'¿': 'inverted question mark',
	'¡': 'inverted exclamation mark',
};

const TRAIL_NAMES: Record<string, string> = {
	',': 'comma',
	'.': 'full stop',
	';': 'semicolon',
	':': 'colon',
	'!': 'exclamation mark',
	'?': 'question mark',
	'…': 'ellipsis',
	'"': 'close quote',
	'”': 'close quote',
	'»': 'close quote',
	"'": 'close single quote',
	'’': 'close single quote',
	')': 'close bracket',
	']': 'close square bracket',
	'}': 'close brace',
};

/** Names for tokens made up entirely of one punctuation mark. */
const STANDALONE_NAMES: Record<string, string> = {
	'-': 'dash',
	'--': 'dash',
	'–': 'dash',
	'—': 'dash',
	'...': 'ellipsis',
	'…': 'ellipsis',
	'/': 'slash',
	'&': 'and',
	'+': 'plus',
	'=': 'equals',
	'*': 'asterisk',
	'•': 'bullet',
};

const SPELL_NAMES: Record<string, string> = {
	"'": 'apostrophe',
	'’': 'apostrophe',
	'-': 'hyphen',
	'‐': 'hyphen',
	'–': 'dash',
	'—': 'dash',
	'.': 'dot',
	',': 'comma',
	'/': 'slash',
	'&': 'ampersand',
	'@': 'at',
	'#': 'hash',
	'%': 'percent',
	'+': 'plus',
	'=': 'equals',
	':': 'colon',
	';': 'semicolon',
	'!': 'exclamation mark',
	'?': 'question mark',
	'(': 'open bracket',
	')': 'close bracket',
	'"': 'quote',
	'“': 'quote',
	'”': 'quote',
	'_': 'underscore',
	'*': 'asterisk',
};

const SINGLE_LETTER_ABBREVIATION_RE = /^(?:\p{L}\.)+\p{L}$/u;

function splitToken(chars: string[], openSingleQuote: boolean): SplitToken {
	const lead: PunctUnit[] = [];
	const trail: PunctUnit[] = [];
	let from = 0;
	let to = chars.length;

	while (from < to) {
		const ch = chars[from] ?? '';
		const name = LEAD_NAMES[ch];
		if (!name) break;
		lead.push({ text: ch, name, index: from });
		if (ch === "'" || ch === '‘') openSingleQuote = true;
		from++;
	}

	const trailRev: PunctUnit[] = [];
	while (to > from) {
		const ch = chars[to - 1] ?? '';
		// Treat "..." as one ellipsis.
		if (ch === '.' && to - 3 >= from && chars[to - 2] === '.' && chars[to - 3] === '.') {
			trailRev.push({ text: '...', name: 'ellipsis', index: to - 3 });
			to -= 3;
			continue;
		}
		const name = TRAIL_NAMES[ch];
		if (!name) break;
		if ((ch === "'" || ch === '’') && !openSingleQuote) break; // possessive, e.g. "students'"
		if (ch === '.' && SINGLE_LETTER_ABBREVIATION_RE.test(chars.slice(from, to - 1).join(''))) break; // e.g. "e.g."
		if (ch === "'" || ch === '’') openSingleQuote = false;
		trailRev.push({ text: ch, name, index: to - 1 });
		to--;
	}
	trail.push(...trailRev.reverse());
	return { lead, coreFrom: from, coreTo: to, trail };
}

function standaloneSpeech(display: string): string | undefined {
	return STANDALONE_NAMES[display];
}

function buildPlainStep(raw: RawToken): Token {
	const display = raw.chars.join('');
	const standalone = standaloneSpeech(display);
	if (standalone) {
		return { kind: 'word', display, speech: standalone, start: raw.start, end: raw.end };
	}
	const split = splitToken(raw.chars, true);
	const core = raw.chars.slice(split.coreFrom, split.coreTo).join('');
	const speech = core || [...split.lead, ...split.trail].map((u) => u.name).join(' ') || display;
	return { kind: 'word', display, speech, start: raw.start, end: raw.end };
}

function buildPunctuationSteps(source: string, hidden: Uint8Array, raws: RawToken[]): Token[] {
	const steps: Token[] = [];
	let openSingle = false;
	let prev: RawToken | null = null;

	for (const raw of raws) {
		if (prev) {
			const brk = lineBreakBetween(source, hidden, prev.end, raw.start);
			if (brk) steps.push(brk);
		}
		prev = raw;

		const display = raw.chars.join('');
		const standalone = standaloneSpeech(display);
		if (standalone) {
			steps.push({
				kind: 'punctuation',
				display,
				speech: standalone,
				start: raw.start,
				end: raw.end,
			});
			continue;
		}

		const split = splitToken(raw.chars, openSingle);
		openSingle = updateSingleQuoteState(openSingle, split);
		const unitStep = (u: PunctUnit): Token => {
			const first = raw.offsets[u.index] ?? raw.start;
			const last = raw.offsets[u.index + u.text.length - 1] ?? first;
			return { kind: 'punctuation', display: u.text, speech: u.name, start: first, end: last + 1 };
		};
		for (const u of split.lead) steps.push(unitStep(u));
		if (split.coreTo > split.coreFrom) {
			const core = raw.chars.slice(split.coreFrom, split.coreTo).join('');
			const start = raw.offsets[split.coreFrom] ?? raw.start;
			const end = (raw.offsets[split.coreTo - 1] ?? raw.end - 1) + 1;
			steps.push({ kind: 'word', display: core, speech: core, start, end });
		}
		for (const u of split.trail) steps.push(unitStep(u));
	}
	return steps;
}

function updateSingleQuoteState(open: boolean, split: SplitToken): boolean {
	let state = open;
	for (const u of split.lead) if (u.name === 'open single quote') state = true;
	for (const u of split.trail) if (u.name === 'close single quote') state = false;
	return state;
}

/** A "new line" or "new paragraph" step for the gap between two tokens, if any. */
function lineBreakBetween(
	source: string,
	hidden: Uint8Array,
	from: number,
	to: number,
): Token | null {
	let newlines = 0;
	let firstNewline = -1;
	for (let i = from; i < to; i++) {
		if (source[i] === '\n' && hidden[i] !== 1) {
			if (firstNewline < 0) firstNewline = i;
			newlines++;
		}
	}
	if (newlines === 0) return null;
	const paragraph = newlines >= 2;
	return {
		kind: 'break',
		display: paragraph ? '¶' : '↵',
		speech: paragraph ? 'new paragraph' : 'new line',
		start: firstNewline,
		end: firstNewline + 1,
	};
}
