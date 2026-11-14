import type { VoiceSettings } from './speech';
import type { TokenizeOptions } from './tokenizer';

export interface WordByWordSettings extends VoiceSettings, TokenizeOptions {
	/** Colour of the current-word highlight, as a hex string. */
	highlightColor: string;
	showControlBar: boolean;
	/** Remember where you stopped in each note so you can resume later. */
	rememberPosition: boolean;
	/** Speak the next word automatically after this many seconds. 0 = off. */
	autoAdvanceSeconds: number;
}

export const DEFAULT_SETTINGS: WordByWordSettings = {
	voiceURI: '',
	rate: 0.9,
	pitch: 1,
	volume: 1,
	speakPunctuation: false,
	skipCodeBlocks: true,
	highlightColor: '#ffb703',
	showControlBar: true,
	rememberPosition: true,
	autoAdvanceSeconds: 0,
};

export interface SavedPosition {
	/** Character offset of the word you were on. */
	offset: number;
	/** The word itself, shown when resuming. */
	word: string;
	/** When it was saved (ms since epoch), used to prune old entries. */
	updated: number;
}

/** Everything stored in the plugin's data.json. */
export interface PluginData {
	settings: WordByWordSettings;
	/** Saved positions keyed by note path. */
	positions: Record<string, SavedPosition>;
}

/** Merge stored data with defaults, ignoring anything malformed. */
export function normalizeData(raw: unknown): PluginData {
	const data = isRecord(raw) ? raw : {};
	const storedSettings = isRecord(data.settings) ? data.settings : {};
	const settings: WordByWordSettings = { ...DEFAULT_SETTINGS };
	for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof WordByWordSettings)[]) {
		const value = storedSettings[key];
		if (typeof value === typeof DEFAULT_SETTINGS[key]) {
			(settings as unknown as Record<string, unknown>)[key] = value;
		}
	}
	const positions: Record<string, SavedPosition> = {};
	if (isRecord(data.positions)) {
		for (const [path, value] of Object.entries(data.positions)) {
			if (
				isRecord(value) &&
				typeof value.offset === 'number' &&
				typeof value.word === 'string' &&
				typeof value.updated === 'number'
			) {
				positions[path] = { offset: value.offset, word: value.word, updated: value.updated };
			}
		}
	}
	return { settings, positions };
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
