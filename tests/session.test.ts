import { describe, expect, it } from 'vitest';
import { ReadingSession } from '../src/session';
import { DEFAULT_TOKENIZE_OPTIONS } from '../src/tokenizer';

const opts = DEFAULT_TOKENIZE_OPTIONS;

describe('ReadingSession', () => {
	it('returns null when there is nothing to read', () => {
		expect(ReadingSession.create('a.md', '---\nx: 1\n---\n', opts, null)).toBeNull();
	});

	it('moves forwards and backwards and reports its position', () => {
		const s = ReadingSession.create('a.md', 'one two three', opts, null);
		expect(s?.current?.display).toBe('one');
		expect(s?.positionLabel).toBe('1 / 3');
		expect(s?.next()?.display).toBe('two');
		expect(s?.previous()?.display).toBe('one');
		expect(s?.previous()?.display).toBe('one');
	});

	it('finishes after the last word instead of wrapping', () => {
		const s = ReadingSession.create('a.md', 'one two', opts, null);
		s?.next();
		expect(s?.next()).toBeUndefined();
		expect(s?.isFinished).toBe(true);
		expect(s?.positionLabel).toBe('2 / 2');
		expect(s?.next()).toBeUndefined();
		expect(s?.previous()?.display).toBe('two');
	});

	it('starts at the word containing the start offset', () => {
		const text = 'alpha beta gamma';
		const s = ReadingSession.create('a.md', text, opts, null, text.indexOf('eta'));
		expect(s?.current?.display).toBe('beta');
	});

	it('reads only the selection when given a scope', () => {
		const text = 'one two three four';
		const scope = { from: text.indexOf('two'), to: text.indexOf('three') + 5 };
		const s = ReadingSession.create('a.md', text, opts, scope, scope.from);
		expect(s?.tokens.map((t) => t.display)).toEqual(['two', 'three']);
	});

	it('keeps its place when re-tokenised after an edit', () => {
		const s = ReadingSession.create('a.md', 'one two three', opts, null);
		s?.next(); // "two"
		const edited = 'zero one two three';
		s?.retokenize(edited, opts, null, edited.indexOf('two'));
		expect(s?.current?.display).toBe('two');
		expect(s?.positionLabel).toBe('3 / 4');
	});

	it('jumps to the word at an offset', () => {
		const text = 'one two three four';
		const s = ReadingSession.create('a.md', text, opts, null);
		expect(s?.jumpTo(text.indexOf('hree'))?.display).toBe('three');
		expect(s?.positionLabel).toBe('3 / 4');
		expect(s?.jumpTo(0)?.display).toBe('one');
	});

	it('finds the nearest word for a punctuation step', () => {
		const s = ReadingSession.create('a.md', 'Hi, you', { ...opts, speakPunctuation: true }, null);
		s?.next(); // ","
		expect(s?.current?.display).toBe(',');
		expect(s?.currentWord?.display).toBe('Hi');
	});
});
