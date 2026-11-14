import {
	PluginSettingTab,
	requireApiVersion,
	Setting,
	type App,
	type SettingDefinitionItem,
	type SliderComponent,
} from 'obsidian';
import type WordByWordPlugin from './main';
import { DEFAULT_SETTINGS, type WordByWordSettings } from './settings';

const AUTO_VOICE_LABEL = 'Automatic (British English if available)';

/** One settings row: its label plus a callback that adds its controls. */
interface Row {
	name: string;
	desc: string;
	render: (setting: Setting) => void;
}

interface Section {
	heading: string;
	rows: Row[];
}

type NumericKey = 'rate' | 'pitch' | 'volume' | 'autoAdvanceSeconds';

/**
 * Settings are described once as sections of rows. On Obsidian 1.13+ they
 * are returned from `getSettingDefinitions()` (so they appear in settings
 * search); on older versions `display()` renders the same rows.
 */
export class WordByWordSettingTab extends PluginSettingTab {
	constructor(
		app: App,
		private readonly plugin: WordByWordPlugin,
	) {
		super(app, plugin);
		// Voices can arrive after the tab is built (Chromium loads them lazily).
		plugin.speech.onVoicesChanged(() => this.refresh());
	}

	getSettingDefinitions(): SettingDefinitionItem[] {
		return this.sections().map((section) => ({
			type: 'group',
			heading: section.heading,
			items: section.rows.map((row) => ({
				name: row.name,
				desc: row.desc,
				render: (setting: Setting) => row.render(setting),
			})),
		}));
	}

	/** Fallback for Obsidian versions before 1.13, which do not use definitions. */
	display(): void {
		this.renderLegacy();
	}

	private refresh(): void {
		if (requireApiVersion('1.13.0')) this.update();
		else this.renderLegacy();
	}

	private renderLegacy(): void {
		const { containerEl } = this;
		containerEl.empty();
		for (const section of this.sections()) {
			new Setting(containerEl).setName(section.heading).setHeading();
			for (const row of section.rows) {
				row.render(new Setting(containerEl).setName(row.name).setDesc(row.desc));
			}
		}
	}

	private get settings(): WordByWordSettings {
		return this.plugin.settings;
	}

	private sections(): Section[] {
		return [
			{ heading: 'Voice', rows: this.voiceRows() },
			{ heading: 'Reading', rows: this.readingRows() },
			{ heading: 'Display', rows: this.displayRows() },
			{ heading: 'Saved positions', rows: this.positionRows() },
		];
	}

	private voiceRows(): Row[] {
		const speech = this.plugin.speech;
		const voices = [...speech.getVoices()].sort(
			(a, b) => a.lang.localeCompare(b.lang) || a.name.localeCompare(b.name),
		);
		const resolved = speech.resolveVoice();
		let voiceDesc: string;
		if (!speech.isSupported) {
			voiceDesc = 'Speech synthesis is not available on this device, so words cannot be read aloud.';
		} else if (voices.length === 0) {
			voiceDesc = 'No voices found yet. They may still be loading, or none are installed.';
		} else {
			voiceDesc = `Currently using: ${resolved ? `${resolved.name} (${resolved.lang})` : 'system default'}.`;
		}

		return [
			{
				name: 'Voice',
				desc: voiceDesc,
				render: (setting) => {
					setting.addDropdown((dropdown) => {
						dropdown.addOption('', AUTO_VOICE_LABEL);
						for (const v of voices) {
							dropdown.addOption(v.voiceURI, `${v.name} (${v.lang})${v.localService ? '' : ', online'}`);
						}
						const current = this.settings.voiceURI;
						if (current && !voices.some((v) => v.voiceURI === current)) {
							dropdown.addOption(current, `${current} (not installed)`);
						}
						dropdown.setValue(current).onChange(async (value) => {
							this.settings.voiceURI = value;
							await this.plugin.saveSettings();
							this.refresh();
						});
					});
					setting.addExtraButton((button) =>
						button
							.setIcon('volume-2')
							.setTooltip('Test voice')
							.onClick(() => {
								void speech.speak('Word by Word is ready.');
							}),
					);
				},
			},
			this.sliderRow('Speech rate', 'How fast each word is spoken. 1 is normal speed.', 'rate', 0.5, 2, 0.05),
			this.sliderRow('Pitch', '1 is the voice’s normal pitch.', 'pitch', 0, 2, 0.1),
			this.sliderRow('Volume', 'Relative to your system volume.', 'volume', 0, 1, 0.05),
		];
	}

	private readingRows(): Row[] {
		return [
			{
				name: 'Speak punctuation',
				desc: 'Say punctuation and line breaks ("comma", "full stop", "new line", "new paragraph") as separate steps, so you know where to put them.',
				render: (setting) => {
					setting.addToggle((toggle) =>
						toggle.setValue(this.settings.speakPunctuation).onChange(async (value) => {
							this.settings.speakPunctuation = value;
							await this.plugin.saveSettings(true);
						}),
					);
				},
			},
			{
				name: 'Skip code blocks',
				desc: 'Leave out fenced code blocks. Turn off to read them word by word.',
				render: (setting) => {
					setting.addToggle((toggle) =>
						toggle.setValue(this.settings.skipCodeBlocks).onChange(async (value) => {
							this.settings.skipCodeBlocks = value;
							await this.plugin.saveSettings(true);
						}),
					);
				},
			},
			this.sliderRow(
				'Auto-advance (seconds)',
				'Speak the next word automatically this many seconds after the last one. 0 turns it off, so words only advance when you ask.',
				'autoAdvanceSeconds',
				0,
				10,
				0.5,
			),
		];
	}

	private displayRows(): Row[] {
		return [
			{
				name: 'Highlight colour',
				desc: 'Colour used to highlight the current word.',
				render: (setting) => {
					setting.addColorPicker((picker) =>
						picker.setValue(this.settings.highlightColor).onChange(async (value) => {
							this.settings.highlightColor = value;
							await this.plugin.saveSettings();
						}),
					);
					setting.addExtraButton((button) =>
						button
							.setIcon('rotate-ccw')
							.setTooltip('Restore default')
							.onClick(async () => {
								this.settings.highlightColor = DEFAULT_SETTINGS.highlightColor;
								await this.plugin.saveSettings();
								this.refresh();
							}),
					);
				},
			},
			{
				name: 'Show control bar',
				desc: 'Show a floating bar with the current word, your position and buttons for each action.',
				render: (setting) => {
					setting.addToggle((toggle) =>
						toggle.setValue(this.settings.showControlBar).onChange(async (value) => {
							this.settings.showControlBar = value;
							await this.plugin.saveSettings();
						}),
					);
				},
			},
		];
	}

	private positionRows(): Row[] {
		const count = this.plugin.positionCount;
		return [
			{
				name: 'Remember position in each note',
				desc: 'When you stop, remember the word you were on so you can resume from it later.',
				render: (setting) => {
					setting.addToggle((toggle) =>
						toggle.setValue(this.settings.rememberPosition).onChange(async (value) => {
							this.settings.rememberPosition = value;
							await this.plugin.saveSettings();
						}),
					);
				},
			},
			{
				name: 'Forget saved positions',
				desc: count === 1 ? '1 note has a saved position.' : `${count} notes have a saved position.`,
				render: (setting) => {
					setting.addButton((button) =>
						button
							.setButtonText('Forget all')
							.setDisabled(count === 0)
							.onClick(async () => {
								await this.plugin.clearPositions();
								this.refresh();
							}),
					);
				},
			},
		];
	}

	private sliderRow(name: string, desc: string, key: NumericKey, min: number, max: number, step: number): Row {
		return {
			name,
			desc,
			render: (setting) => {
				let slider: SliderComponent | null = null;
				setting.addSlider((s) => {
					slider = s;
					s.setLimits(min, max, step)
						.setValue(this.settings[key])
						.onChange(async (value) => {
							this.settings[key] = value;
							await this.plugin.saveSettings();
						});
				});
				setting.addExtraButton((button) =>
					button
						.setIcon('rotate-ccw')
						.setTooltip('Restore default')
						.onClick(async () => {
							this.settings[key] = DEFAULT_SETTINGS[key];
							slider?.setValue(DEFAULT_SETTINGS[key]);
							await this.plugin.saveSettings();
						}),
				);
			},
		};
	}
}
