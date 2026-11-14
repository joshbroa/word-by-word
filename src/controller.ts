import type { Extension } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { MarkdownView, Notice, TFile, type App, type MarkdownPostProcessor } from 'obsidian';
import { ControlBar, type AutoAdvanceState } from './control-bar';
import { EditorHighlighter, HIGHLIGHT_CLASS, type Span } from './highlight/editor';
import { offsetOfLine, RenderedHighlighter } from './highlight/rendered';
import { ReadingSession } from './session';
import type { SavedPosition, WordByWordSettings } from './settings';
import type { SpeechEngine } from './speech';
import { spellOut, type TextRange, type Token } from './tokenizer';

/** What the controller needs from the plugin. */
export interface ControllerHost {
	readonly app: App;
	readonly settings: WordByWordSettings;
	readonly speech: SpeechEngine;
	getPosition(path: string): SavedPosition | undefined;
	setPosition(path: string, position: SavedPosition): void;
	deletePosition(path: string): void;
}

export type StartPoint = 'beginning' | 'cursor' | 'saved';

/** Runs a reading session: speech, highlighting, the control bar and saved positions. */
export class WordByWordController {
	private session: ReadingSession | null = null;
	/** An editor whose document changed since the tokens were last computed. */
	private changedEditor: EditorView | null = null;
	private externalChangePending = false;
	private autoTimer: number | null = null;
	private autoPaused = false;
	private renderQueued = false;
	private retokenizeTimer: number | null = null;

	private readonly editorHighlighter: EditorHighlighter;
	private readonly renderedHighlighter: RenderedHighlighter;
	private readonly controlBar: ControlBar;
	private readonly styledBodies = new Set<HTMLElement>();

	constructor(private readonly host: ControllerHost) {
		this.editorHighlighter = new EditorHighlighter((view, path) => this.onEditorChanged(view, path));
		this.renderedHighlighter = new RenderedHighlighter(() => this.queueRender(false));
		this.controlBar = new ControlBar({
			previous: () => this.previous(),
			repeat: () => this.repeat(),
			next: () => this.next(),
			spell: () => this.spell(),
			toggleAutoAdvance: () => this.toggleAutoAdvance(),
			stop: () => this.stop(),
		});
	}

	get editorExtension(): Extension {
		return this.editorHighlighter.extension;
	}

	get postProcessor(): MarkdownPostProcessor {
		return this.renderedHighlighter.postProcessor;
	}

	get isActive(): boolean {
		return this.session !== null;
	}

	get activeFilePath(): string | null {
		return this.session?.filePath ?? null;
	}

	get autoAdvanceState(): AutoAdvanceState {
		if (this.host.settings.autoAdvanceSeconds <= 0) return 'off';
		return this.autoPaused ? 'paused' : 'running';
	}

	// -----------------------------------------------------------------------
	// Commands
	// -----------------------------------------------------------------------

	/** Start reading the note in `view`. Uses the selection if there is one. */
	start(view: MarkdownView, from: StartPoint): void {
		const file = view.file;
		if (!file) return;
		if (!this.host.speech.isSupported) {
			new Notice('Speech is not available on this device.');
			return;
		}

		const text = view.getViewData();
		let scope: TextRange | null = null;
		let startOffset = 0;

		if (view.getMode() === 'source') {
			const editor = view.editor;
			if (editor.somethingSelected()) {
				const a = editor.posToOffset(editor.getCursor('from'));
				const b = editor.posToOffset(editor.getCursor('to'));
				scope = { from: Math.min(a, b), to: Math.max(a, b) };
				startOffset = scope.from;
			} else if (from === 'cursor') {
				startOffset = editor.posToOffset(editor.getCursor());
			}
		} else if (from === 'cursor') {
			// Reading view has no cursor: start from the first visible line.
			startOffset = offsetOfLine(text, Math.max(0, Math.floor(view.previewMode.getScroll())));
		}

		if (from === 'saved' && !scope) {
			const saved = this.host.getPosition(file.path);
			if (saved) startOffset = Math.min(saved.offset, text.length);
		}

		const session = ReadingSession.create(file.path, text, this.host.settings, scope, startOffset);
		if (!session) {
			new Notice(scope ? 'There are no words to read in the selection.' : 'There are no words to read in this note.');
			return;
		}

		this.stop();
		this.session = session;
		this.autoPaused = false;
		if (this.host.settings.showControlBar) this.controlBar.show(view.containerEl.doc);
		this.speakCurrent();
	}

	next(): void {
		const s = this.prepare();
		if (!s) return;
		s.next();
		this.speakCurrent();
	}

	previous(): void {
		const s = this.prepare();
		if (!s) return;
		s.previous();
		this.speakCurrent();
	}

	repeat(): void {
		if (!this.prepare()) return;
		this.speakCurrent();
	}

	spell(): void {
		const s = this.prepare();
		if (!s) return;
		this.clearAutoAdvance();
		const t = s.current;
		if (!t) {
			void this.host.speech.speak(this.endMessage(s));
			return;
		}
		this.render(true);
		void this.host.speech.spell(t.kind === 'word' ? spellOut(t.display) : [t.speech]);
	}

	toggleAutoAdvance(): void {
		if (!this.session || this.host.settings.autoAdvanceSeconds <= 0) return;
		this.autoPaused = !this.autoPaused;
		if (this.autoPaused) {
			this.clearAutoAdvance();
			new Notice('Auto-advance paused.');
		} else {
			new Notice('Auto-advance resumed.');
			this.next();
			return;
		}
		this.render(false);
	}

	/** Stop speaking, remove all highlights and close the control bar. */
	stop(): void {
		const s = this.session;
		this.clearAutoAdvance();
		this.clearRetokenizeTimer();
		this.host.speech.cancel();
		if (s) this.savePosition(s);
		this.session = null;
		this.changedEditor = null;
		this.externalChangePending = false;
		this.editorHighlighter.clearAll();
		this.renderedHighlighter.clearAll();
		this.controlBar.hide();
	}

	// -----------------------------------------------------------------------
	// Workspace and vault events
	// -----------------------------------------------------------------------

	/** Re-apply highlights, e.g. after switching between editing and reading view. */
	onLayoutChange(): void {
		this.queueRender(false);
	}

	onSettingsChanged(retokenize: boolean): void {
		this.applyHighlightColor();
		const s = this.session;
		if (!s) return;
		if (!this.host.settings.showControlBar) {
			this.controlBar.hide();
		} else if (!this.controlBar.isShown) {
			this.controlBar.show(activeDocument);
		}
		if (this.autoAdvanceState !== 'running') this.clearAutoAdvance();
		if (retokenize) this.externalChangePending = true;
		this.prepare();
		this.render(false);
	}

	onFileRenamed(file: TFile, oldPath: string): void {
		if (this.session?.filePath === oldPath) this.session.filePath = file.path;
	}

	onFileDeleted(path: string): void {
		if (this.session?.filePath === path) {
			this.session = null;
			this.stop();
		}
	}

	/** The note was changed on disk (e.g. by sync) rather than in an editor. */
	onFileModified(file: TFile): void {
		const s = this.session;
		if (!s || s.filePath !== file.path) return;
		if (this.editorHighlighter.viewsFor(file.path).length > 0) return; // Handled via editor changes.
		this.externalChangePending = true;
		this.scheduleRetokenize();
	}

	destroy(): void {
		this.stop();
		for (const body of this.styledBodies) body.setCssProps({ '--word-by-word-highlight': '' });
		this.styledBodies.clear();
	}

	// -----------------------------------------------------------------------
	// Internals
	// -----------------------------------------------------------------------

	private onEditorChanged(view: EditorView, path: string): void {
		if (this.session?.filePath !== path) return;
		this.changedEditor = view;
		this.scheduleRetokenize();
	}

	private scheduleRetokenize(): void {
		this.clearRetokenizeTimer();
		this.retokenizeTimer = window.setTimeout(() => {
			this.retokenizeTimer = null;
			if (this.prepare()) this.render(false);
		}, 400);
	}

	private clearRetokenizeTimer(): void {
		if (this.retokenizeTimer !== null) window.clearTimeout(this.retokenizeTimer);
		this.retokenizeTimer = null;
	}

	/**
	 * Return the session, re-tokenising first if the note changed. Uses
	 * positions mapped through the edit by the editor so the reader keeps
	 * their place.
	 */
	private prepare(): ReadingSession | null {
		const s = this.session;
		if (!s) return null;

		const editor = this.changedEditor;
		if (editor) {
			this.changedEditor = null;
			this.externalChangePending = false;
			const marks = this.editorHighlighter.readMarks(editor);
			const anchor = marks?.anchor ?? s.currentOffset;
			s.retokenize(editor.state.doc.toString(), this.host.settings, marks?.scope ?? s.scope, anchor);
		} else if (this.externalChangePending) {
			this.externalChangePending = false;
			const text = this.currentText(s.filePath);
			if (text !== null) {
				s.retokenize(text, this.host.settings, s.scope, s.currentOffset);
			} else {
				void this.retokenizeFromDisk(s);
			}
		}
		return this.session;
	}

	private async retokenizeFromDisk(s: ReadingSession): Promise<void> {
		const file = this.host.app.vault.getAbstractFileByPath(s.filePath);
		if (!(file instanceof TFile)) return;
		const text = await this.host.app.vault.cachedRead(file);
		if (this.session !== s) return;
		s.retokenize(text, this.host.settings, s.scope, s.currentOffset);
		this.render(false);
	}

	/** The latest text of the note from an open view, if any. */
	private currentText(path: string): string | null {
		const editors = this.editorHighlighter.viewsFor(path);
		const editor = editors[0];
		if (editor) return editor.state.doc.toString();
		for (const view of this.markdownViewsFor(path)) return view.getViewData();
		return null;
	}

	private speakCurrent(): void {
		const s = this.session;
		if (!s) return;
		this.clearAutoAdvance();
		this.render(true);
		this.savePosition(s);

		const token = s.current;
		const index = s.index;
		const text = token ? token.speech : this.endMessage(s);
		void this.host.speech.speak(text).then((outcome) => {
			if (outcome === 'ended' && token && this.session === s && s.index === index) {
				this.scheduleAutoAdvance(s);
			}
		});
	}

	private endMessage(s: ReadingSession): string {
		return s.scope ? 'End of selection' : 'End of note';
	}

	private scheduleAutoAdvance(s: ReadingSession): void {
		this.clearAutoAdvance();
		if (this.autoAdvanceState !== 'running') return;
		const delay = this.host.settings.autoAdvanceSeconds * 1000;
		this.autoTimer = window.setTimeout(() => {
			this.autoTimer = null;
			if (this.session === s && !s.isFinished) this.next();
		}, delay);
	}

	private clearAutoAdvance(): void {
		if (this.autoTimer !== null) window.clearTimeout(this.autoTimer);
		this.autoTimer = null;
	}

	private queueRender(scroll: boolean): void {
		if (!this.session || this.renderQueued) return;
		this.renderQueued = true;
		window.requestAnimationFrame(() => {
			this.renderQueued = false;
			this.render(scroll);
		});
	}

	/** Update highlights in every view of the note, and the control bar. */
	private render(scroll: boolean): void {
		const s = this.session;
		if (!s) return;
		this.applyHighlightColor();

		const token = s.current;
		// Line breaks have nothing visible to highlight, so keep the previous word lit.
		const target: Token | undefined = token && token.kind !== 'break' ? token : token ? s.currentWord : undefined;
		const highlight: Span | null = target ? { from: target.start, to: target.end } : null;

		this.editorHighlighter.show(s.filePath, { highlight, anchor: s.currentOffset, scope: s.scope }, scroll);

		// Words inside blocks that Live Preview draws as widgets (callouts,
		// tables) and words in reading view are highlighted in the rendered HTML.
		const ranges: Range[] = [];
		if (target) {
			for (const cm of this.editorHighlighter.viewsFor(s.filePath)) {
				if (cm.dom.getClientRects().length === 0) continue; // Hidden (e.g. in reading view).
				if (cm.contentDOM.querySelector(`.${HIGHLIGHT_CLASS}`)) continue; // Decoration is visible.
				const range = this.renderedHighlighter.rangeInEditorWidget(cm, target, this.host.settings);
				if (range) ranges.push(range);
			}
		}
		const word = token ? (token.kind === 'word' ? token : s.currentWord) : undefined;
		if (word) {
			for (const view of this.markdownViewsFor(s.filePath)) {
				if (view.getMode() !== 'preview') continue;
				const range = this.renderedHighlighter.rangeInReadingView(
					view,
					view.getViewData(),
					word,
					this.host.settings,
					scroll,
				);
				if (range) ranges.push(range);
			}
		}
		this.renderedHighlighter.apply(ranges);
		// Scrolling can bring new lines and widgets into the DOM; look again once it settles.
		if (scroll) this.queueRender(false);

		this.controlBar.update({
			word: token?.display ?? '',
			position: s.positionLabel,
			finished: s.isFinished,
			autoAdvance: this.autoAdvanceState,
		});
	}

	private markdownViewsFor(path: string): MarkdownView[] {
		const views: MarkdownView[] = [];
		this.host.app.workspace.iterateAllLeaves((leaf) => {
			const view = leaf.view;
			if (view instanceof MarkdownView && view.file?.path === path) views.push(view);
		});
		return views;
	}

	private savePosition(s: ReadingSession): void {
		if (!this.host.settings.rememberPosition) return;
		if (s.isFinished) {
			this.host.deletePosition(s.filePath);
			return;
		}
		const token = s.current;
		if (!token) return;
		this.host.setPosition(s.filePath, { offset: token.start, word: token.display, updated: Date.now() });
	}

	private applyHighlightColor(): void {
		const color = this.host.settings.highlightColor;
		const bodies = new Set<HTMLElement>([activeDocument.body]);
		this.host.app.workspace.iterateAllLeaves((leaf) => bodies.add(leaf.view.containerEl.doc.body));
		for (const body of bodies) {
			body.setCssProps({ '--word-by-word-highlight': color });
			this.styledBodies.add(body);
		}
	}
}

