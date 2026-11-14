import type { EditorView } from '@codemirror/view';
import type { MarkdownPostProcessorContext, MarkdownView } from 'obsidian';
import { coreOf, findOccurrences, sourceOffsetForRenderedIndex, visibleText } from '../text-match';
import { maskMarkdown, type Token, type TokenizeOptions } from '../tokenizer';

/** Name used with `CSS.highlights`; styled by `::highlight(word-by-word-current)`. */
export const RENDERED_HIGHLIGHT_NAME = 'word-by-word-current';

/** Rendered elements whose text does not come from the note's own words. */
const ALWAYS_SKIP = [
	'.frontmatter',
	'.metadata-container',
	'.callout-icon',
	'.callout-fold',
	'.internal-embed',
	'.footnote-backref',
	'sup.footnote-ref',
	'.footnotes',
	'.collapse-indicator',
	'.list-bullet',
	'.copy-code-button',
	'.edit-block-button',
	'.math',
].join(', ');

/** A window that may support the CSS Custom Highlight API. */
interface HighlightWindow extends Window {
	Highlight?: typeof Highlight;
	CSS?: { highlights?: HighlightRegistry };
}

/**
 * Highlights the current word in rendered markdown: reading view, and
 * blocks that Live Preview draws as widgets (callouts, tables), where
 * CodeMirror decorations are not visible.
 *
 * Rendered HTML has no direct link back to character offsets. We find the
 * rendered block that contains the word, count how many times the word
 * appears earlier in that block's source, and pick the same occurrence in the
 * rendered text. The page is never modified: the highlight is drawn with the
 * CSS Custom Highlight API.
 */
export class RenderedHighlighter {
	private readonly contexts = new WeakMap<HTMLElement, MarkdownPostProcessorContext>();
	private readonly rerendered = new WeakSet<MarkdownView>();
	private readonly windows = new Set<Window>();
	private maskCache: { source: string; skipCodeBlocks: boolean; hidden: Uint8Array } | null = null;

	constructor(private readonly onSectionRendered: () => void) {}

	/** Register with `registerMarkdownPostProcessor`. */
	readonly postProcessor = (el: HTMLElement, ctx: MarkdownPostProcessorContext): void => {
		this.contexts.set(el, ctx);
		this.onSectionRendered();
	};

	/**
	 * Find `word` in a reading-view `view` of the note whose text is `source`.
	 * May scroll the view so that the section is rendered.
	 */
	rangeInReadingView(
		view: MarkdownView,
		source: string,
		word: Token,
		options: TokenizeOptions,
		scroll: boolean,
	): Range | null {
		const line = lineOf(source, word.start);
		const section = this.findSection(view, line);
		if (!section) {
			if (!this.rerendered.has(view)) {
				// Sections rendered before the plugin loaded have no context yet.
				this.rerendered.add(view);
				view.previewMode.rerender(true);
			}
			// The section may not be rendered yet; scrolling to it renders it,
			// and the post-processor then triggers another attempt.
			if (scroll) view.previewMode.applyScroll(line);
			return null;
		}
		const range = this.findRange(section.el, source, offsetOfLine(source, section.lineStart), word, options);
		if (scroll) scrollIntoView(section.el, range ? range.getBoundingClientRect() : section.el.getBoundingClientRect());
		return range;
	}

	/**
	 * If `word` is inside a block that Live Preview renders as a widget (such
	 * as a callout or table), find it in the widget's rendered text.
	 */
	rangeInEditorWidget(cm: EditorView, word: Token, options: TokenizeOptions): Range | null {
		const source = cm.state.doc.toString();
		for (const el of Array.from(cm.contentDOM.querySelectorAll<HTMLElement>(':scope > .cm-embed-block'))) {
			let start: number;
			let end: number;
			try {
				start = cm.posAtDOM(el);
				const next = el.nextElementSibling;
				end = next ? cm.posAtDOM(next) : cm.state.doc.length;
			} catch {
				continue;
			}
			if (word.start >= start && word.start < end) {
				return this.findRange(el, source, start, word, options);
			}
		}
		return null;
	}

	/**
	 * The note offset of the word at screen point (x, y), when `target` is
	 * inside a rendered section of reading-view `view`. Null if no word is there.
	 */
	offsetAtPointInReadingView(
		view: MarkdownView,
		target: Element,
		x: number,
		y: number,
		source: string,
		options: TokenizeOptions,
	): number | null {
		const section = target.closest<HTMLElement>('.markdown-preview-section > div');
		if (!section || !view.previewMode.containerEl.contains(section)) return null;
		const info = this.contexts.get(section)?.getSectionInfo(section);
		if (!info) return null;
		const from = offsetOfLine(source, info.lineStart);
		const to = offsetOfLine(source, info.lineEnd + 1);
		return this.offsetAtPoint(section, source, from, to, x, y, options);
	}

	/**
	 * The note offset of the word at screen point (x, y), when `target` is
	 * inside a block that Live Preview renders as a widget (callout, table).
	 */
	offsetAtPointInEditorWidget(
		cm: EditorView,
		target: Element,
		x: number,
		y: number,
		options: TokenizeOptions,
	): number | null {
		const widget = target.closest<HTMLElement>('.cm-embed-block');
		if (!widget || !cm.contentDOM.contains(widget)) return null;
		let from: number;
		let to: number;
		try {
			from = cm.posAtDOM(widget);
			const next = widget.nextElementSibling;
			to = next ? cm.posAtDOM(next) : cm.state.doc.length;
		} catch {
			return null;
		}
		return this.offsetAtPoint(widget, cm.state.doc.toString(), from, to, x, y, options);
	}

	/** Show exactly these ranges, replacing any previous highlight in every window. */
	apply(ranges: readonly Range[]): void {
		const byWindow = new Map<Window, Range[]>();
		for (const range of ranges) {
			const win = range.startContainer.win;
			const list = byWindow.get(win) ?? [];
			list.push(range);
			byWindow.set(win, list);
		}
		for (const win of this.windows) {
			if (!byWindow.has(win)) highlightRegistry(win)?.delete(RENDERED_HIGHLIGHT_NAME);
		}
		this.windows.clear();
		for (const [win, list] of byWindow) {
			const registry = highlightRegistry(win);
			const HighlightCtor = (win as HighlightWindow).Highlight;
			if (!registry || !HighlightCtor) continue;
			registry.set(RENDERED_HIGHLIGHT_NAME, new HighlightCtor(...list));
			this.windows.add(win);
		}
	}

	/** Remove the highlight from every window. */
	clearAll(): void {
		this.apply([]);
		this.maskCache = null;
	}

	private findSection(view: MarkdownView, line: number): { el: HTMLElement; lineStart: number } | null {
		const sections = view.previewMode.containerEl.querySelectorAll<HTMLElement>('.markdown-preview-section > div');
		for (const el of Array.from(sections)) {
			const info = this.contexts.get(el)?.getSectionInfo(el);
			if (info && info.lineStart <= line && line <= info.lineEnd) {
				return { el, lineStart: info.lineStart };
			}
		}
		return null;
	}

	private findRange(
		el: HTMLElement,
		source: string,
		blockStart: number,
		word: Token,
		options: TokenizeOptions,
	): Range | null {
		const needle = coreOf(word.display);
		if (!needle) return null;

		// How many times does the word appear earlier in this block's visible text?
		const before = visibleText(source, this.mask(source, options), blockStart, word.start);
		const occurrence = findOccurrences(before.text, needle).length;

		// Pick the same occurrence in the rendered text.
		const { text, nodes } = collectText(el, options.skipCodeBlocks);
		const matches = findOccurrences(text, needle);
		const start = matches[Math.min(occurrence, matches.length - 1)];
		if (start === undefined) return null;
		const startPos = locate(nodes, start);
		const endPos = locate(nodes, start + needle.length, true);
		if (!startPos || !endPos) return null;
		const range = el.doc.createRange();
		range.setStart(startPos.node, startPos.offset);
		range.setEnd(endPos.node, endPos.offset);
		return range;
	}

	private offsetAtPoint(
		el: HTMLElement,
		source: string,
		from: number,
		to: number,
		x: number,
		y: number,
		options: TokenizeOptions,
	): number | null {
		const { text, nodes } = collectText(el, options.skipCodeBlocks);
		const index = indexAtPoint(nodes, x, y);
		if (index === null) return null;
		const visible = visibleText(source, this.mask(source, options), from, to);
		return sourceOffsetForRenderedIndex(text, index, visible);
	}

	private mask(source: string, options: TokenizeOptions): Uint8Array {
		const cache = this.maskCache;
		if (cache && cache.source === source && cache.skipCodeBlocks === options.skipCodeBlocks) {
			return cache.hidden;
		}
		const hidden = maskMarkdown(source, options);
		this.maskCache = { source, skipCodeBlocks: options.skipCodeBlocks, hidden };
		return hidden;
	}
}

function highlightRegistry(win: Window): HighlightRegistry | null {
	return (win as HighlightWindow).CSS?.highlights ?? null;
}

interface TextNodeSpan {
	node: Text;
	start: number;
}

function collectText(root: HTMLElement, skipCode: boolean): { text: string; nodes: TextNodeSpan[] } {
	const skip = skipCode ? `${ALWAYS_SKIP}, pre` : ALWAYS_SKIP;
	const walker = root.doc.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
		acceptNode: (node) =>
			node.parentElement?.closest(skip) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
	});
	const nodes: TextNodeSpan[] = [];
	const parts: string[] = [];
	let length = 0;
	for (let n = walker.nextNode(); n; n = walker.nextNode()) {
		if (!n.instanceOf(Text)) continue;
		nodes.push({ node: n, start: length });
		parts.push(n.data);
		length += n.data.length;
	}
	return { text: parts.join(''), nodes };
}

/**
 * Index (into the concatenated text) of the word drawn at screen point (x, y).
 * Hit-tests each word's rectangles, which works on every platform, unlike the
 * caret-from-point APIs.
 */
function indexAtPoint(nodes: TextNodeSpan[], x: number, y: number): number | null {
	const slop = 2;
	for (const span of nodes) {
		const re = /\S+/g;
		let m: RegExpExecArray | null;
		while ((m = re.exec(span.node.data))) {
			const range = span.node.doc.createRange();
			range.setStart(span.node, m.index);
			range.setEnd(span.node, m.index + m[0].length);
			for (const r of Array.from(range.getClientRects())) {
				if (x >= r.left - slop && x <= r.right + slop && y >= r.top - slop && y <= r.bottom + slop) {
					return span.start + m.index;
				}
			}
		}
	}
	return null;
}

/** Map an index into the concatenated text back to a text node and offset. */
function locate(nodes: TextNodeSpan[], index: number, isEnd = false): { node: Text; offset: number } | null {
	for (let i = nodes.length - 1; i >= 0; i--) {
		const span = nodes[i];
		if (!span) continue;
		if (index > span.start || (index === span.start && !isEnd)) {
			return { node: span.node, offset: Math.min(index - span.start, span.node.data.length) };
		}
	}
	return null;
}

function lineOf(source: string, offset: number): number {
	let line = 0;
	for (let i = 0; i < offset && i < source.length; i++) if (source[i] === '\n') line++;
	return line;
}

export function offsetOfLine(source: string, line: number): number {
	let offset = 0;
	for (let l = 0; l < line; l++) {
		const next = source.indexOf('\n', offset);
		if (next < 0) return source.length;
		offset = next + 1;
	}
	return offset;
}

function scrollIntoView(el: HTMLElement, rect: DOMRect): void {
	const scroller = el.closest<HTMLElement>('.markdown-preview-view');
	if (!scroller) return;
	const bounds = scroller.getBoundingClientRect();
	const margin = Math.min(160, bounds.height / 4);
	if (rect.top < bounds.top + margin || rect.bottom > bounds.bottom - margin) {
		scroller.scrollTop += rect.top - bounds.top - bounds.height / 3;
	}
}
