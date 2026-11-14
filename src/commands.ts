import { MarkdownView } from 'obsidian';
import type WordByWordPlugin from './main';

/**
 * Register all commands. None has a default hotkey, so nothing clashes with
 * existing shortcuts; bind them in Settings → Hotkeys.
 */
export function registerCommands(plugin: WordByWordPlugin): void {
	const controller = plugin.controller;
	const activeMarkdownView = (): MarkdownView | null => {
		const view = plugin.app.workspace.getActiveViewOfType(MarkdownView);
		return view?.file ? view : null;
	};

	plugin.addCommand({
		id: 'start-from-beginning',
		name: 'Start from beginning',
		checkCallback: (checking) => {
			const view = activeMarkdownView();
			if (!view) return false;
			if (!checking) controller.start(view, 'beginning');
			return true;
		},
	});

	plugin.addCommand({
		id: 'start-from-cursor',
		name: 'Start from cursor',
		checkCallback: (checking) => {
			const view = activeMarkdownView();
			if (!view) return false;
			if (!checking) controller.start(view, 'cursor');
			return true;
		},
	});

	plugin.addCommand({
		id: 'resume',
		name: 'Resume where you left off',
		checkCallback: (checking) => {
			const view = activeMarkdownView();
			if (!view?.file || !plugin.getPosition(view.file.path)) return false;
			if (!checking) controller.start(view, 'saved');
			return true;
		},
	});

	plugin.addCommand({
		id: 'next-word',
		name: 'Next word',
		checkCallback: (checking) => {
			if (controller.isActive) {
				if (!checking) controller.next();
				return true;
			}
			// With no session running, the first press starts one, so a single
			// pedal or clicker button is enough to begin.
			const view = activeMarkdownView();
			if (!view) return false;
			if (!checking) controller.start(view, 'cursor');
			return true;
		},
	});

	plugin.addCommand({
		id: 'repeat-word',
		name: 'Repeat current word',
		checkCallback: (checking) => {
			if (!controller.isActive) return false;
			if (!checking) controller.repeat();
			return true;
		},
	});

	plugin.addCommand({
		id: 'previous-word',
		name: 'Previous word',
		checkCallback: (checking) => {
			if (!controller.isActive) return false;
			if (!checking) controller.previous();
			return true;
		},
	});

	plugin.addCommand({
		id: 'spell-word',
		name: 'Spell current word',
		checkCallback: (checking) => {
			if (!controller.isActive) return false;
			if (!checking) controller.spell();
			return true;
		},
	});

	plugin.addCommand({
		id: 'toggle-auto-advance',
		name: 'Pause or resume auto-advance',
		checkCallback: (checking) => {
			if (!controller.isActive || controller.autoAdvanceState === 'off') return false;
			if (!checking) controller.toggleAutoAdvance();
			return true;
		},
	});

	plugin.addCommand({
		id: 'stop',
		name: 'Stop and close',
		checkCallback: (checking) => {
			if (!controller.isActive) return false;
			if (!checking) controller.stop();
			return true;
		},
	});
}
