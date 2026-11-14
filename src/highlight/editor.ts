import { StateEffect, StateField, type ChangeDesc, type EditorState, type Extension } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import { editorInfoField } from 'obsidian';

export interface Span {
	from: number;
	to: number;
}

/**
 * What a reading session stores in each editor showing its note. All
 * positions are mapped through edits, so the session can find its place
 * again after the note changes.
 */
export interface EditorMarks {
	/** The range to highlight, or null for none. */
	highlight: Span | null;
	/** Start of the current token. */
	anchor: number;
	/** The selection being read, or null for the whole note. */
	scope: Span | null;
}

export const HIGHLIGHT_CLASS = 'word-by-word-current';

/** Body class set while the floating control bar is visible (see control-bar.ts). */
const BAR_VISIBLE_CLASS = 'word-by-word-bar-visible';

/**
 * Tell CodeMirror that the bottom of the editor is covered by the floating
 * control bar, so scrolling keeps the current word clear of it.
 */
const barScrollMargin = EditorView.scrollMargins.of((view) =>
	view.dom.doc.body.hasClass(BAR_VISIBLE_CLASS) ? { bottom: 140 } : null,
);

const setMarks = StateEffect.define<EditorMarks | null>();

const currentMark = Decoration.mark({ class: HIGHLIGHT_CLASS });

function mapSpan(span: Span | null, changes: ChangeDesc): Span | null {
	if (!span) return null;
	return { from: changes.mapPos(span.from, 1), to: changes.mapPos(span.to, -1) };
}

const marksField = StateField.define<EditorMarks | null>({
	create: () => null,
	update(value, tr) {
		let next = value;
		if (next && tr.docChanged) {
			next = {
				highlight: mapSpan(next.highlight, tr.changes),
				anchor: tr.changes.mapPos(next.anchor, 1),
				scope: next.scope && {
					from: tr.changes.mapPos(next.scope.from, -1),
					to: tr.changes.mapPos(next.scope.to, 1),
				},
			};
		}
		for (const effect of tr.effects) {
			if (effect.is(setMarks)) next = effect.value;
		}
		return next;
	},
	provide: (field) =>
		EditorView.decorations.compute([field], (state): DecorationSet => {
			const span = state.field(field)?.highlight;
			if (!span) return Decoration.none;
			const docLength = state.doc.length;
			const from = Math.min(span.from, docLength);
			const to = Math.min(span.to, docLength);
			if (to <= from) return Decoration.none;
			return Decoration.set([currentMark.range(from, to)]);
		}),
});

function filePathOf(state: EditorState): string | null {
	return state.field(editorInfoField, false)?.file?.path ?? null;
}

/**
 * Highlights the current word in every editor (source or live preview) that
 * shows the note being read.
 */
export class EditorHighlighter {
	private readonly views = new Set<EditorView>();

	constructor(
		/**
		 * Called when an editor's document changes. Do not dispatch to the
		 * editor from this callback; CodeMirror forbids it during an update.
		 */
		private readonly onDocChanged: (view: EditorView, path: string) => void,
	) {}

	/** The CodeMirror extension to pass to `registerEditorExtension`. */
	get extension(): Extension {
		const views = this.views;
		const onDocChanged = this.onDocChanged;
		const tracker = ViewPlugin.define((view) => {
			views.add(view);
			return {
				update(update: ViewUpdate): void {
					if (!update.docChanged) return;
					const path = filePathOf(update.state);
					if (path) onDocChanged(update.view, path);
				},
				destroy(): void {
					views.delete(view);
				},
			};
		});
		return [marksField, tracker, barScrollMargin];
	}

	viewsFor(path: string): EditorView[] {
		return [...this.views].filter((v) => filePathOf(v.state) === path);
	}

	/** Update the marks in every editor showing `path`. */
	show(path: string, marks: EditorMarks, scroll: boolean): void {
		for (const view of this.viewsFor(path)) {
			const effects: StateEffect<unknown>[] = [setMarks.of(marks)];
			if (scroll && marks.highlight && view.dom.isConnected) {
				effects.push(EditorView.scrollIntoView(marks.highlight.from, { y: 'nearest', yMargin: 48 }));
			}
			safeDispatch(view, effects);
		}
	}

	/** The marks currently stored in `view` (mapped through any edits). */
	readMarks(view: EditorView): EditorMarks | null {
		return view.state.field(marksField, false) ?? null;
	}

	/** Remove the highlight from every editor. */
	clearAll(): void {
		for (const view of this.views) {
			if (view.state.field(marksField, false)) safeDispatch(view, [setMarks.of(null)]);
		}
	}
}

function safeDispatch(view: EditorView, effects: StateEffect<unknown>[]): void {
	try {
		view.dispatch({ effects });
	} catch (e) {
		// The view may have been destroyed between lookup and dispatch.
		console.debug('Word by Word: could not update editor', e);
	}
}
