import { mount, unmount } from 'svelte';
import type { Component } from 'svelte';
import { tooltipState } from '$lib/utils/tooltipState';

const OFFSET = 10;
const MAX_WIDTH = 220;

type Placement = 'left' | 'right' | 'up' | 'down';

export type TooltipParam =
	| string
	| { text: string; shortcut?: string; placement?: Placement }
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	| { component: Component<any>; props?: Record<string, unknown>; placement?: Placement };

type TextResolved   = { kind: 'text'; text: string; shortcut: string | undefined; placement: Placement };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CompResolved   = { kind: 'component'; component: Component<any>; props: Record<string, unknown>; placement: Placement };
type Resolved = TextResolved | CompResolved;

function resolve(param: TooltipParam): Resolved {
	if (typeof param === 'string') {
		return { kind: 'text', text: param, shortcut: undefined, placement: 'left' };
	}
	if ('component' in param) {
		return { kind: 'component', component: param.component, props: param.props ?? {}, placement: param.placement ?? 'left' };
	}
	return { kind: 'text', text: param.text, shortcut: param.shortcut, placement: param.placement ?? 'left' };
}

export function tooltip(node: HTMLElement, param: TooltipParam) {
	let resolved = resolve(param);
	let el: HTMLDivElement | null = null;
	let showTimer: ReturnType<typeof setTimeout> | null = null;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	let mountedInstance: any = null;

	function buildContent() {
		if (!el) return;
		if (resolved.kind === 'component') {
			el.style.maxWidth = 'none';
			mountedInstance = mount(resolved.component, { target: el, props: resolved.props });
		} else {
			el.style.maxWidth = '';
			el.innerHTML = '';
			if (resolved.shortcut) {
				const textSpan = document.createElement('span');
				textSpan.textContent = resolved.text;
				el.appendChild(textSpan);
				const shortcutSpan = document.createElement('span');
				shortcutSpan.className = 'tooltip-shortcut';
				shortcutSpan.textContent = resolved.shortcut;
				el.appendChild(shortcutSpan);
			} else {
				el.textContent = resolved.text;
			}
		}
	}

	function create() {
		el = document.createElement('div');
		el.className = 'tooltip-popup body-small';
		buildContent();
		document.body.appendChild(el);
		position();
		tooltipState.onShow();
	}

	function position() {
		if (!el) return;
		const rect = node.getBoundingClientRect();
		const w = el.offsetWidth || MAX_WIDTH;
		const h = el.offsetHeight;
		const vw = window.innerWidth;
		const vh = window.innerHeight;

		let left: number;
		let top: number;
		let transform: string;

		switch (resolved.placement) {
			case 'right': {
				const flipX = rect.right + OFFSET + w > vw;
				left = flipX ? rect.left - w - OFFSET : rect.right + OFFSET;
				top = Math.max(8, Math.min(rect.top, vh - h - 8));
				transform = 'none';
				break;
			}
			case 'up':
				left = rect.left + rect.width / 2;
				top = rect.top - OFFSET;
				transform = 'translate(-50%, -100%)';
				break;
			case 'down':
				left = rect.left + rect.width / 2;
				top = rect.bottom + OFFSET;
				transform = 'translateX(-50%)';
				break;
			case 'left':
			default:
				left = rect.left - w - OFFSET;
				top = rect.top + rect.height / 2;
				transform = 'translateY(-50%)';
				break;
		}

		el.style.left = `${Math.max(8, left)}px`;
		el.style.top = `${Math.max(8, top)}px`;
		el.style.transform = transform;
	}

	function hide() {
		if (el) {
			if (mountedInstance) { unmount(mountedInstance); mountedInstance = null; }
			el.remove();
			el = null;
		}
		tooltipState.onHide();
	}

	function handleEnter() {
		tooltipState.onEnter();
		showTimer = setTimeout(create, tooltipState.delay);
	}

	function handleLeave() {
		if (showTimer) { clearTimeout(showTimer); showTimer = null; }
		hide();
	}

	node.addEventListener('mouseenter', handleEnter);
	node.addEventListener('mouseleave', handleLeave);

	return {
		update(newParam: TooltipParam) {
			resolved = resolve(newParam);
			if (el) {
				if (mountedInstance) { unmount(mountedInstance); mountedInstance = null; }
				buildContent();
				position();
			}
		},
		destroy() {
			node.removeEventListener('mouseenter', handleEnter);
			node.removeEventListener('mouseleave', handleLeave);
			if (showTimer) clearTimeout(showTimer);
			hide();
		},
	};
}
