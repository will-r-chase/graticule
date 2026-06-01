<script lang="ts">
	import ColorPickerPopup from '$lib/components/ui/ColorPickerPopup.svelte';
	import { background } from '$lib/stores/background.svelte';
	import { pushSnapshot } from '$lib/stores/history.svelte';

	let open = $state(false);
	let containerEl = $state<HTMLDivElement | null>(null);

	// Close when clicking outside.
	$effect(() => {
		if (!open) return;
		function handleOutsideClick(e: MouseEvent) {
			if (!containerEl?.contains(e.target as Node)) {
				open = false;
			}
		}
		document.addEventListener('click', handleOutsideClick);
		return () => document.removeEventListener('click', handleOutsideClick);
	});

	// Push a history snapshot when the picker closes (open transitions true → false).
	let _pickerWasOpen = false;
	$effect(() => {
		if (!open && _pickerWasOpen) pushSnapshot();
		_pickerWasOpen = open;
	});

	// Convert hex + alpha to an rgba() string for the swatch preview.
	function toRgba(hex: string, alpha: number): string {
		const m = hex.replace('#', '').match(/^([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i);
		if (!m) return 'transparent';
		return `rgba(${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)}, ${alpha})`;
	}

	let swatchColor = $derived(toRgba(background.hex, background.alpha));
</script>

<div class="background-control" bind:this={containerEl}>
	<button class="trigger" onclick={() => (open = !open)}>
		<span class="swatch" style="background: {swatchColor}"></span>
		<span class="mono-small">Background</span>
	</button>

	{#if open}
		<div class="popover">
			<ColorPickerPopup
				bind:hex={background.hex}
				bind:alpha={background.alpha}
				title="Canvas background"
				onclose={() => { open = false; }}
			/>
		</div>
	{/if}
</div>

<style>
	.background-control {
		position: relative;
	}

	.trigger {
		display: flex;
		align-items: center;
		gap: var(--space-s);
		height: 32px;
		padding: 0 var(--space-m);
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
		background: var(--color-surface-primary);
		color: var(--color-text-primary);
		cursor: pointer;
	}

	.trigger:hover {
		background: var(--color-surface-secondary);
	}

	.swatch {
		width: 14px;
		height: 14px;
		border-radius: 2px;
		flex-shrink: 0;
		/* Checkerboard shows through when alpha < 1 */
		background-color: white;
		background-image:
			linear-gradient(45deg, #ccc 25%, transparent 25%),
			linear-gradient(-45deg, #ccc 25%, transparent 25%),
			linear-gradient(45deg, transparent 75%, #ccc 75%),
			linear-gradient(-45deg, transparent 75%, #ccc 75%);
		background-size: 6px 6px;
		background-position: 0 0, 0 3px, 3px -3px, -3px 0px;
		position: relative;
	}

	.swatch::after {
		content: '';
		position: absolute;
		inset: 0;
		border-radius: 2px;
		background: v-bind(swatchColor);
		outline: 1px solid rgba(0, 0, 0, 0.1);
		outline-offset: -1px;
	}

	/* Positioned wrapper; card styling is in ColorPickerPopup */
	.popover {
		position: absolute;
		bottom: calc(100% + var(--space-s));
		right: 0;
		z-index: 50;
	}
</style>
