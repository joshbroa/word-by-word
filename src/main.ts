import { debounce, MarkdownView, Plugin, TFile } from 'obsidian';
import { registerCommands } from './commands';
import { WordByWordController, type ControllerHost } from './controller';
import { normalizeData, type PluginData, type SavedPosition, type WordByWordSettings } from './settings';
import { WordByWordSettingTab } from './settings-tab';
import { SpeechEngine } from './speech';

/** Keep at most this many saved positions; the oldest are dropped first. */
const MAX_SAVED_POSITIONS = 500;

export default class WordByWordPlugin extends Plugin implements ControllerHost {
	private data!: PluginData;
	/** The same object as `data.settings`. */
	settings!: WordByWordSettings;
	speech!: SpeechEngine;
	controller!: WordByWordController;

	/** Saving on every word would be wasteful, so batch writes. */
	private readonly requestSave = debounce(() => void this.persist(), 1500, true);

	get positionCount(): number {
		return Object.keys(this.data.positions).length;
	}

	async onload(): Promise<void> {
		this.data = normalizeData(await this.loadData());
		this.settings = this.data.settings;

		this.speech = new SpeechEngine(() => this.settings);
		this.register(() => this.speech.destroy());

		this.controller = new WordByWordController(this);
		this.register(() => this.controller.destroy());
		this.registerEditorExtension(this.controller.editorExtension);
		this.registerMarkdownPostProcessor(this.controller.postProcessor);

		registerCommands(this);
		this.addSettingTab(new WordByWordSettingTab(this.app, this));

		this.addRibbonIcon('volume-2', 'Read word by word', () => {
			if (this.controller.isActive) {
				this.controller.stop();
				return;
			}
			const view = this.app.workspace.getActiveViewOfType(MarkdownView);
			if (view?.file) this.controller.start(view, 'cursor');
		});

		// Reader keys and click-to-jump. Capture phase, so they run before the
		// editor sees the event; they do nothing unless a session is running.
		const listen = (win: Window): void => {
			this.registerDomEvent(win, 'keydown', (evt) => this.controller.handleKeydown(evt), { capture: true });
			this.registerDomEvent(win, 'mousedown', (evt) => this.controller.handleMouseDown(evt), { capture: true });
			this.registerDomEvent(win, 'click', (evt) => this.controller.handleClick(evt), { capture: true });
		};
		listen(window);
		this.registerEvent(this.app.workspace.on('window-open', (_workspaceWindow, win) => listen(win)));

		this.registerEvent(this.app.workspace.on('layout-change', () => this.controller.onLayoutChange()));
		this.registerEvent(this.app.workspace.on('active-leaf-change', () => this.controller.onLayoutChange()));
		this.registerEvent(
			this.app.vault.on('modify', (file) => {
				if (file instanceof TFile) this.controller.onFileModified(file);
			}),
		);
		this.registerEvent(
			this.app.vault.on('rename', (file, oldPath) => {
				if (!(file instanceof TFile)) return;
				this.controller.onFileRenamed(file, oldPath);
				const saved = this.data.positions[oldPath];
				if (saved) {
					delete this.data.positions[oldPath];
					this.data.positions[file.path] = saved;
					this.requestSave();
				}
			}),
		);
		this.registerEvent(
			this.app.vault.on('delete', (file) => {
				this.controller.onFileDeleted(file.path);
				this.deletePosition(file.path);
			}),
		);
	}

	onunload(): void {
		// Commands, events, the editor extension and the post-processor are
		// removed by Obsidian. Stop the session now (it is idempotent, and the
		// `register` callbacks run it again harmlessly) so its final position
		// is recorded, then flush the pending save.
		this.controller?.destroy();
		this.requestSave.run();
	}

	/** Save settings and let the active session pick up the changes. */
	async saveSettings(retokenize = false): Promise<void> {
		await this.persist();
		this.controller.onSettingsChanged(retokenize);
	}

	/** Called by Obsidian when data.json changes on disk (e.g. via sync). */
	async onExternalSettingsChange(): Promise<void> {
		this.data = normalizeData(await this.loadData());
		this.settings = this.data.settings;
		this.controller.onSettingsChanged(true);
	}

	getPosition(path: string): SavedPosition | undefined {
		return this.data.positions[path];
	}

	setPosition(path: string, position: SavedPosition): void {
		this.data.positions[path] = position;
		this.prunePositions();
		this.requestSave();
	}

	deletePosition(path: string): void {
		if (!(path in this.data.positions)) return;
		delete this.data.positions[path];
		this.requestSave();
	}

	async clearPositions(): Promise<void> {
		this.data.positions = {};
		await this.persist();
	}

	private prunePositions(): void {
		const entries = Object.entries(this.data.positions);
		if (entries.length <= MAX_SAVED_POSITIONS) return;
		entries.sort((a, b) => b[1].updated - a[1].updated);
		this.data.positions = Object.fromEntries(entries.slice(0, MAX_SAVED_POSITIONS));
	}

	private async persist(): Promise<void> {
		await this.saveData(this.data);
	}
}
