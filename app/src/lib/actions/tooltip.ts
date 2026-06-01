import { tooltipState } from '$lib/utils/tooltipState';

const OFFSET = 10;
const MAX_WIDTH = 220;

export function tooltip(node: HTMLElement, text: string) {
	let el: HTMLDivElement | null = null;
	let showTimer: ReturnType<typeof setTimeout> | null = null;

	function create() {
		el = document.createElement('div');
		el.className = 'tooltip-popup body-small';
		el.textContent = text;
		document.body.appendChild(el);
		position();
		tooltipState.onShow();
	}

	function position() {
		if (!el) return;
		const rect = node.getBoundingClientRect();

		// Horizontally: to the left of the element.
		// We don't know the tooltip width until it's rendered, so read it.
		const w = el.offsetWidth || MAX_WIDTH;
		const left = rect.left - w - OFFSET;

		// Vertically: centred on the element, clamped to viewport.
		const top = rect.top + rect.height / 2;

		el.style.left = `${Math.max(8, left)}px`;
		el.style.top = `${top}px`;
		el.style.transform = 'translateY(-50%)';
	}

	function hide() {
		if (el) { el.remove(); el = null; }
		tooltipState.onHide();
	}

	function handleEnter() {
		tooltipState.onEnter();
		const delay = tooltipState.delay;
		showTimer = setTimeout(create, delay);
	}

	function handleLeave() {
		if (showTimer) { clearTimeout(showTimer); showTimer = null; }
		hide();
	}

	node.addEventListener('mouseenter', handleEnter);
	node.addEventListener('mouseleave', handleLeave);

	return {
		update(newText: string) {
			text = newText;
			if (el) el.textContent = newText;
		},
		destroy() {
			node.removeEventListener('mouseenter', handleEnter);
			node.removeEventListener('mouseleave', handleLeave);
			if (showTimer) clearTimeout(showTimer);
			if (el) el.remove();
		},
	};
}
