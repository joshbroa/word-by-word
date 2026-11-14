/**
 * Plain keys (no modifiers) that control the reader while a session is
 * running, e.g. → for next word. Pure: no Obsidian imports.
 */

export type ReaderAction = 'next' | 'previous' | 'repeat' | 'spell' | 'stop';

export const READER_ACTIONS: readonly ReaderAction[] = ['next', 'previous', 'repeat', 'spell', 'stop'];

/** Values are `KeyboardEvent.key` strings; '' means "no key". */
export type ReaderKeys = Record<ReaderAction, string>;

export const DEFAULT_READER_KEYS: ReaderKeys = {
	next: 'ArrowRight',
	previous: 'ArrowLeft',
	repeat: ' ',
	spell: 'ArrowDown',
	stop: 'Escape',
};

export const ACTION_LABELS: Record<ReaderAction, string> = {
	next: 'Next word',
	previous: 'Previous word',
	repeat: 'Repeat current word',
	spell: 'Spell current word',
	stop: 'Stop and close',
};

const KEY_NAMES: Record<string, string> = {
	' ': 'Space',
	ArrowRight: '→',
	ArrowLeft: '←',
	ArrowUp: '↑',
	ArrowDown: '↓',
	Escape: 'Esc',
	Enter: 'Enter',
	Backspace: 'Backspace',
	Tab: 'Tab',
	PageDown: 'Page down',
	PageUp: 'Page up',
};

/** A short, readable name for a key, e.g. ' ' → 'Space', 'ArrowRight' → '→'. */
export function keyLabel(key: string): string {
	if (!key) return 'None';
	return KEY_NAMES[key] ?? (key.length === 1 ? key.toUpperCase() : key);
}

/** Keys that can't be used on their own. */
export function isModifierKey(key: string): boolean {
	return ['Shift', 'Control', 'Alt', 'Meta', 'AltGraph', 'CapsLock', 'Fn', 'OS', 'Dead', 'Unidentified'].includes(key);
}

/** The action bound to `key`, if any. */
export function actionForKey(keys: ReaderKeys, key: string): ReaderAction | null {
	if (!key) return null;
	for (const action of READER_ACTIONS) {
		if (keys[action] === key) return action;
	}
	return null;
}

/** Bind `key` to `action`, removing it from any other action so keys stay unique. */
export function assignKey(keys: ReaderKeys, action: ReaderAction, key: string): ReaderKeys {
	const next: ReaderKeys = { ...keys };
	if (key) {
		for (const other of READER_ACTIONS) {
			if (other !== action && next[other] === key) next[other] = '';
		}
	}
	next[action] = key;
	return next;
}
