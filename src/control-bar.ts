import { setIcon, setTooltip, type IconName } from 'obsidian';
import type { ReaderAction } from './keys';

export interface ControlBarActions {
	previous(): void;
	repeat(): void;
	next(): void;
	spell(): void;
	toggleAutoAdvance(): void;
	stop(): void;
}

/** Also read by highlight/editor.ts to keep the current word clear of the bar. */
const BODY_CLASS = 'word-by-word-bar-visible';

export type AutoAdvanceState = 'off' | 'running' | 'paused';

export interface ControlBarState {
	/** The word (or punctuation) being read. */
	word: string;
	/** e.g. "42 / 310". */
	position: string;
	/** True once past the last word. */
	finished: boolean;
	autoAdvance: AutoAdvanceState;
}

/**
 * A small floating panel showing the current word, the position, and buttons
 * for each action. Buttons never take focus away from the editor, so keyboard
 * shortcuts (and foot pedals that send keystrokes) keep working.
 */
export class ControlBar {
	private root: HTMLElement | null = null;
	private wordEl: HTMLElement | null = null;
	private positionEl: HTMLElement | null = null;
	private autoButton: HTMLButtonElement | null = null;
	private body: HTMLElement | null = null;
	/** Buttons for actions that can have a reader key, with their base labels. */
	private readonly actionButtons = new Map<ReaderAction, { el: HTMLButtonElement; label: string }>();

	constructor(private readonly actions: ControlBarActions) {}

	get isShown(): boolean {
		return this.root !== null;
	}

	show(doc: Document): void {
		if (this.root?.isConnected && this.root.doc === doc) return;
		this.hide();

		const root = doc.body.createDiv({
			cls: 'word-by-word-bar',
			attr: { role: 'toolbar', 'aria-label': 'Word by Word controls' },
		});
		const readout = root.createDiv({ cls: 'word-by-word-readout' });
		this.wordEl = readout.createDiv({ cls: 'word-by-word-word' });
		this.positionEl = readout.createDiv({ cls: 'word-by-word-position' });

		const buttons = root.createDiv({ cls: 'word-by-word-buttons' });
		this.actionButton(buttons, 'previous', 'skip-back', 'Previous word', () => this.actions.previous());
		this.actionButton(buttons, 'repeat', 'rotate-ccw', 'Repeat word', () => this.actions.repeat());
		this.actionButton(buttons, 'next', 'skip-forward', 'Next word', () => this.actions.next(), 'word-by-word-next');
		this.actionButton(buttons, 'spell', 'spell-check', 'Spell word', () => this.actions.spell());
		this.autoButton = this.button(buttons, 'pause', 'Pause auto-advance', () => this.actions.toggleAutoAdvance());
		this.actionButton(buttons, 'stop', 'x', 'Stop', () => this.actions.stop());
		this.root = root;
		// Lets the stylesheet add room at the bottom of notes so the bar never covers the last lines.
		this.body = doc.body;
		this.body.addClass(BODY_CLASS);
	}

	update(state: ControlBarState): void {
		if (!this.root || !this.wordEl || !this.positionEl) return;
		this.wordEl.setText(state.finished ? 'End' : state.word);
		this.wordEl.toggleClass('is-finished', state.finished);
		this.positionEl.setText(state.position);
		if (this.autoButton) {
			this.autoButton.toggleClass('word-by-word-hidden', state.autoAdvance === 'off');
			const paused = state.autoAdvance === 'paused';
			setIcon(this.autoButton, paused ? 'play' : 'pause');
			const label = paused ? 'Resume auto-advance' : 'Pause auto-advance';
			this.autoButton.setAttr('aria-label', label);
			setTooltip(this.autoButton, label);
		}
	}

	/** Show each action's reader key in its tooltip, e.g. "Next word (→)". */
	setKeyHints(hints: Partial<Record<ReaderAction, string>>): void {
		for (const [action, { el, label }] of this.actionButtons) {
			const hint = hints[action];
			const text = hint ? `${label} (${hint})` : label;
			el.setAttr('aria-label', text);
			setTooltip(el, text);
		}
	}

	hide(): void {
		this.root?.remove();
		this.body?.removeClass(BODY_CLASS);
		this.body = null;
		this.root = null;
		this.wordEl = null;
		this.positionEl = null;
		this.autoButton = null;
		this.actionButtons.clear();
	}

	private actionButton(
		parent: HTMLElement,
		action: ReaderAction,
		icon: IconName,
		label: string,
		onClick: () => void,
		extraClass?: string,
	): void {
		this.actionButtons.set(action, { el: this.button(parent, icon, label, onClick, extraClass), label });
	}

	private button(
		parent: HTMLElement,
		icon: IconName,
		label: string,
		onClick: () => void,
		extraClass?: string,
	): HTMLButtonElement {
		const btn = parent.createEl('button', {
			cls: ['clickable-icon', 'word-by-word-button', ...(extraClass ? [extraClass] : [])],
			attr: { type: 'button', 'aria-label': label },
		});
		setIcon(btn, icon);
		setTooltip(btn, label);
		// Keep focus (and the cursor) in the editor.
		btn.addEventListener('mousedown', (e) => e.preventDefault());
		btn.addEventListener('click', (e) => {
			e.preventDefault();
			onClick();
		});
		return btn;
	}
}
