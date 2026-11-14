import { findTokenIndexAtOffset, tokenize, type TextRange, type Token, type TokenizeOptions } from './tokenizer';

/**
 * Tracks where the reader is in a note. Pure (no Obsidian imports).
 *
 * `index` runs from 0 to `tokens.length`; `tokens.length` means "finished",
 * so pressing next on the last word announces the end rather than wrapping.
 */
export class ReadingSession {
	private _tokens: Token[];
	private _index: number;

	constructor(
		/** Path of the note being read. Updated if the note is renamed. */
		public filePath: string,
		/** Selection being read, or null for the whole note. */
		public scope: TextRange | null,
		tokens: Token[],
		index = 0,
	) {
		this._tokens = tokens;
		this._index = clampIndex(index, tokens.length);
	}

	/**
	 * Tokenise `text` and start at the token at or after `startOffset`.
	 * Returns null if there is nothing to read.
	 */
	static create(
		filePath: string,
		text: string,
		options: TokenizeOptions,
		scope: TextRange | null,
		startOffset = 0,
	): ReadingSession | null {
		const tokens = tokenize(text, options, scope ?? undefined);
		if (tokens.length === 0) return null;
		const index = Math.max(0, findTokenIndexAtOffset(tokens, startOffset));
		return new ReadingSession(filePath, scope, tokens, index);
	}

	get tokens(): readonly Token[] {
		return this._tokens;
	}

	get index(): number {
		return this._index;
	}

	get length(): number {
		return this._tokens.length;
	}

	get isFinished(): boolean {
		return this._index >= this._tokens.length;
	}

	/** The current token, or undefined once finished. */
	get current(): Token | undefined {
		return this._tokens[this._index];
	}

	/** The nearest word at or before the current position (for highlighting breaks). */
	get currentWord(): Token | undefined {
		for (let i = Math.min(this._index, this._tokens.length - 1); i >= 0; i--) {
			const t = this._tokens[i];
			if (t && t.kind === 'word') return t;
		}
		return undefined;
	}

	/** Offset of the current position in the note, used to save and restore it. */
	get currentOffset(): number {
		const t = this.current ?? this._tokens[this._tokens.length - 1];
		return t ? t.start : 0;
	}

	/** Human-readable position, e.g. "42 / 310". */
	get positionLabel(): string {
		return `${Math.min(this._index + 1, this.length)} / ${this.length}`;
	}

	/** Move to the next token. Returns it, or undefined if now finished. */
	next(): Token | undefined {
		if (this._index < this._tokens.length) this._index++;
		return this.current;
	}

	/** Move to the previous token. Stays on the first token. */
	previous(): Token | undefined {
		if (this._index > 0) this._index--;
		return this.current;
	}

	/**
	 * Jump to the token at (or just after) `offset` in the note, e.g. after the
	 * reader clicks a word. Offsets outside a selection clamp to its ends.
	 */
	jumpTo(offset: number): Token | undefined {
		const index = findTokenIndexAtOffset(this._tokens, offset);
		if (index >= 0) this._index = index;
		return this.current;
	}

	/**
	 * Re-tokenise after the note changed. `anchorOffset` is where the current
	 * token now starts (after mapping through the edit), and `scope` is the
	 * mapped selection, if any.
	 */
	retokenize(text: string, options: TokenizeOptions, scope: TextRange | null, anchorOffset: number): void {
		const wasFinished = this.isFinished;
		this.scope = scope;
		this._tokens = tokenize(text, options, scope ?? undefined);
		this._index = wasFinished
			? this._tokens.length
			: Math.max(0, findTokenIndexAtOffset(this._tokens, anchorOffset));
	}
}

function clampIndex(index: number, length: number): number {
	if (!Number.isFinite(index)) return 0;
	return Math.min(Math.max(0, Math.floor(index)), length);
}
