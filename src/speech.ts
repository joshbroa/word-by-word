/**
 * Thin wrapper around the Web Speech API (speechSynthesis).
 *
 * Works offline with the voices installed on the device. Every call to
 * `speak` or `spell` cancels whatever is currently being said, so rapid key
 * presses never queue up or overlap.
 */

export interface VoiceSettings {
	/** `voiceURI` of the chosen voice, or '' for automatic. */
	voiceURI: string;
	rate: number;
	pitch: number;
	volume: number;
}

/** How a call to `speak` or `spell` finished. */
export type SpeechOutcome = 'ended' | 'cancelled' | 'error' | 'unavailable';

const BRITISH_LANG_RE = /^en[-_]GB$/i;
const ENGLISH_LANG_RE = /^en(?:[-_]|$)/i;

export class SpeechEngine {
	private readonly synth: SpeechSynthesis | null;
	private voices: SpeechSynthesisVoice[] = [];
	private readonly voiceListeners = new Set<() => void>();
	/** Incremented on every cancel so callbacks from old utterances are ignored. */
	private generation = 0;
	/**
	 * Keep references to queued utterances. Chromium can garbage-collect an
	 * utterance mid-speech, after which its `end` event never fires.
	 */
	private live: SpeechSynthesisUtterance[] = [];

	private readonly handleVoicesChanged = (): void => {
		this.refreshVoices();
	};

	constructor(private readonly getSettings: () => VoiceSettings) {
		this.synth = typeof window !== 'undefined' && 'speechSynthesis' in window ? window.speechSynthesis : null;
		if (this.synth) {
			// Electron/Chromium returns an empty list until voices have loaded,
			// then fires `voiceschanged`.
			this.synth.addEventListener('voiceschanged', this.handleVoicesChanged);
			this.refreshVoices();
		}
	}

	/** True if this device supports speech synthesis at all. */
	get isSupported(): boolean {
		return this.synth !== null;
	}

	getVoices(): SpeechSynthesisVoice[] {
		if (this.voices.length === 0) this.refreshVoices();
		return this.voices;
	}

	/** Be told when the voice list changes. Returns an unsubscribe function. */
	onVoicesChanged(listener: () => void): () => void {
		this.voiceListeners.add(listener);
		return () => this.voiceListeners.delete(listener);
	}

	/**
	 * The voice that will be used: the chosen one if it is installed,
	 * otherwise British English if available, otherwise the system default.
	 */
	resolveVoice(): SpeechSynthesisVoice | null {
		const voices = this.getVoices();
		const { voiceURI } = this.getSettings();
		if (voiceURI) {
			const chosen = voices.find((v) => v.voiceURI === voiceURI);
			if (chosen) return chosen;
		}
		return pickDefaultVoice(voices);
	}

	/** Say one piece of text, cancelling anything already being said. */
	speak(text: string): Promise<SpeechOutcome> {
		return this.speakParts([text]);
	}

	/** Say several short pieces one after another (used for spelling). */
	spell(parts: readonly string[]): Promise<SpeechOutcome> {
		return this.speakParts(parts);
	}

	/** Stop speaking immediately. */
	cancel(): void {
		this.generation++;
		this.live = [];
		if (this.synth && (this.synth.speaking || this.synth.pending)) {
			this.synth.cancel();
		}
	}

	destroy(): void {
		this.cancel();
		this.synth?.removeEventListener('voiceschanged', this.handleVoicesChanged);
		this.voiceListeners.clear();
	}

	private speakParts(parts: readonly string[]): Promise<SpeechOutcome> {
		this.cancel();
		const synth = this.synth;
		const items = parts.map((p) => p.trim()).filter((p) => p.length > 0);
		if (!synth) return Promise.resolve('unavailable');
		if (items.length === 0) return Promise.resolve('ended');

		const generation = this.generation;
		const settings = this.getSettings();
		const voice = this.resolveVoice();

		// Chromium sometimes leaves the engine paused (for example after the
		// window was hidden); resuming is harmless when it is not.
		synth.resume();

		return new Promise<SpeechOutcome>((resolve) => {
			let settled = false;
			const finish = (outcome: SpeechOutcome): void => {
				if (settled) return;
				settled = true;
				resolve(generation === this.generation ? outcome : 'cancelled');
			};

			items.forEach((text, i) => {
				const u = new SpeechSynthesisUtterance(text);
				if (voice) {
					u.voice = voice;
					u.lang = voice.lang;
				}
				u.rate = clamp(settings.rate, 0.1, 10);
				u.pitch = clamp(settings.pitch, 0, 2);
				u.volume = clamp(settings.volume, 0, 1);
				u.onerror = (e: SpeechSynthesisErrorEvent) => {
					finish(e.error === 'canceled' || e.error === 'interrupted' ? 'cancelled' : 'error');
				};
				if (i === items.length - 1) {
					u.onend = () => finish('ended');
				}
				this.live.push(u);
				synth.speak(u);
			});
		});
	}

	private refreshVoices(): void {
		if (!this.synth) return;
		const next = this.synth.getVoices();
		const changed =
			next.length !== this.voices.length || next.some((v, i) => v.voiceURI !== this.voices[i]?.voiceURI);
		this.voices = next;
		if (changed) {
			for (const listener of this.voiceListeners) listener();
		}
	}
}

/** British English if available, otherwise the system default, otherwise any English voice. */
export function pickDefaultVoice(voices: readonly SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
	const british = voices.filter((v) => BRITISH_LANG_RE.test(v.lang));
	if (british.length > 0) {
		// Prefer an offline voice so it keeps working without a connection.
		return british.find((v) => v.localService) ?? british[0] ?? null;
	}
	return (
		voices.find((v) => v.default) ??
		voices.find((v) => ENGLISH_LANG_RE.test(v.lang) && v.localService) ??
		voices[0] ??
		null
	);
}

function clamp(value: number, min: number, max: number): number {
	if (!Number.isFinite(value)) return min;
	return Math.min(max, Math.max(min, value));
}
