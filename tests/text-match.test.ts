import { describe, expect, it } from 'vitest';
import { coreOf, findOccurrences, sourceOffsetForRenderedIndex, visibleText, wordAround } from '../src/text-match';
import { DEFAULT_TOKENIZE_OPTIONS, maskMarkdown } from '../src/tokenizer';

describe('coreOf', () => {
	it('strips surrounding punctuation', () => {
		expect(coreOf('"Hello,')).toBe('Hello');
		expect(coreOf("didn't")).toBe("didn't");
		expect(coreOf('—')).toBe('—');
	});
});

describe('findOccurrences', () => {
	it('finds whole words only', () => {
		expect(findOccurrences('the theme of the day', 'the')).toEqual([0, 13]);
		expect(findOccurrences('anything', '')).toEqual([]);
	});
});

describe('wordAround', () => {
	it('expands to the surrounding whitespace-delimited word', () => {
		expect(wordAround('say "hello," now', 6)).toEqual({ start: 4, end: 12 });
		expect(wordAround('a b', 1)).toBeNull();
	});
});

describe('visibleText', () => {
	it('drops hidden characters and keeps their source offsets', () => {
		const src = 'A **bold** word';
		const v = visibleText(src, maskMarkdown(src, DEFAULT_TOKENIZE_OPTIONS), 0, src.length);
		expect(v.text).toBe('A bold word');
		expect(v.offsets[2]).toBe(src.indexOf('bold'));
	});
});

describe('sourceOffsetForRenderedIndex', () => {
	const src = 'The cat sat on [[Mats/The mat|the mat]], and the **cat** purred.';
	const visible = visibleText(src, maskMarkdown(src, DEFAULT_TOKENIZE_OPTIONS), 0, src.length);
	const rendered = 'The cat sat on the mat, and the cat purred.';

	it('maps a clicked rendered word to the same occurrence in the source', () => {
		const secondCat = rendered.lastIndexOf('cat') + 1; // click in the middle of the word
		expect(sourceOffsetForRenderedIndex(rendered, secondCat, visible)).toBe(src.lastIndexOf('cat'));
	});

	it('handles words inside links and repeated words', () => {
		const thirdThe = rendered.indexOf('the', rendered.indexOf('mat'));
		expect(sourceOffsetForRenderedIndex(rendered, thirdThe, visible)).toBe(src.indexOf('the', src.indexOf('and')));
		const linkWord = rendered.indexOf('mat');
		expect(sourceOffsetForRenderedIndex(rendered, linkWord, visible)).toBe(src.indexOf('mat]]'));
	});

	it('returns null for whitespace', () => {
		expect(sourceOffsetForRenderedIndex(rendered, 3, visible)).toBeNull();
	});
});
