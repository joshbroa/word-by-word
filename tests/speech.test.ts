import { describe, expect, it } from 'vitest';
import { pickDefaultVoice } from '../src/speech';

const voice = (name: string, lang: string, extra: Partial<SpeechSynthesisVoice> = {}): SpeechSynthesisVoice => ({
	name,
	lang,
	voiceURI: name,
	default: false,
	localService: true,
	...extra,
});

describe('pickDefaultVoice', () => {
	it('prefers a British English voice', () => {
		const voices = [voice('US', 'en-US', { default: true }), voice('UK', 'en-GB')];
		expect(pickDefaultVoice(voices)?.name).toBe('UK');
	});

	it('accepts underscore language tags (Android)', () => {
		expect(pickDefaultVoice([voice('A', 'fr_FR'), voice('B', 'en_GB')])?.name).toBe('B');
	});

	it('prefers an offline British voice over an online one', () => {
		const voices = [voice('Online', 'en-GB', { localService: false }), voice('Offline', 'en-GB')];
		expect(pickDefaultVoice(voices)?.name).toBe('Offline');
	});

	it('falls back to the system default voice', () => {
		const voices = [voice('A', 'de-DE'), voice('B', 'en-US', { default: true })];
		expect(pickDefaultVoice(voices)?.name).toBe('B');
	});

	it('returns null when no voices are available yet', () => {
		expect(pickDefaultVoice([])).toBeNull();
	});
});
