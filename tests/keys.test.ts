import { describe, expect, it } from 'vitest';
import { actionForKey, assignKey, DEFAULT_READER_KEYS, isModifierKey, keyLabel } from '../src/keys';
import { normalizeData } from '../src/settings';

describe('reader keys', () => {
	it('uses arrows for next and previous and space for repeat by default', () => {
		expect(actionForKey(DEFAULT_READER_KEYS, 'ArrowRight')).toBe('next');
		expect(actionForKey(DEFAULT_READER_KEYS, 'ArrowLeft')).toBe('previous');
		expect(actionForKey(DEFAULT_READER_KEYS, ' ')).toBe('repeat');
		expect(actionForKey(DEFAULT_READER_KEYS, 'x')).toBeNull();
		expect(actionForKey(DEFAULT_READER_KEYS, '')).toBeNull();
	});

	it('keeps keys unique when reassigning', () => {
		const keys = assignKey(DEFAULT_READER_KEYS, 'next', ' ');
		expect(keys.next).toBe(' ');
		expect(keys.repeat).toBe('');
		expect(DEFAULT_READER_KEYS.repeat).toBe(' '); // not mutated
	});

	it('labels keys readably', () => {
		expect(keyLabel(' ')).toBe('Space');
		expect(keyLabel('ArrowRight')).toBe('→');
		expect(keyLabel('j')).toBe('J');
		expect(keyLabel('F9')).toBe('F9');
		expect(keyLabel('')).toBe('None');
	});

	it('recognises modifier keys', () => {
		expect(isModifierKey('Shift')).toBe(true);
		expect(isModifierKey('a')).toBe(false);
	});
});

describe('normalizeData', () => {
	it('fills in reader keys for data saved by older versions', () => {
		const data = normalizeData({ settings: { rate: 1.2 } });
		expect(data.settings.rate).toBe(1.2);
		expect(data.settings.readerKeys).toEqual(DEFAULT_READER_KEYS);
		expect(data.settings.clickToJump).toBe(true);
	});

	it('keeps saved keys and ignores bad values', () => {
		const data = normalizeData({ settings: { readerKeys: { next: 'j', previous: 5 } } });
		expect(data.settings.readerKeys.next).toBe('j');
		expect(data.settings.readerKeys.previous).toBe('ArrowLeft');
	});

	it('does not share the default keys object between loads', () => {
		const a = normalizeData({});
		a.settings.readerKeys.next = 'q';
		expect(normalizeData({}).settings.readerKeys.next).toBe('ArrowRight');
	});
});
