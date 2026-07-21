<script lang="ts">
	import { Plus, Check, X, Angle, BezierCurve, ArrowsInLineHorizontal } from 'phosphor-svelte';
	import { textSession, commitText, discardText, selectedRotation, setSelectedRotation, selectedIsCurved, setSelectedOnPath, selectedWrapWidth, clearSelectedWrapWidth } from '$lib/stores/textSession.svelte';
	import { layerSelection, clearLayerSelection, selectLayer } from '$lib/stores/layerSelection.svelte';
	import { layers, createLabelLayer } from '$lib/stores/layers.svelte';
	import { pushSnapshot } from '$lib/stores/history.svelte';
	import { tooltip } from '$lib/actions/tooltip';

	const targetName = $derived(
		textSession.targetLayerId
			? layers.find((l) => l.id === textSession.targetLayerId)?.name ?? null
			: null
	);

	const statusText = $derived(targetName ? `Editing ${targetName}` : 'Editing new layer');
	const hasWork = $derived(textSession.newCount > 0 || textSession.editCount > 0);

	// A single selected GEOMETRY layer in text mode isn't a text target — offer to
	// derive labels from it instead.
	const selectedGeomLayer = $derived.by(() => {
		if (layerSelection.ids.length !== 1) return null;
		const l = layers.find((x) => x.id === layerSelection.ids[0]);
		return l && l.kind === 'geometry' && l.hasTopology ? l : null;
	});

	function handleCreateLabels() {
		if (!selectedGeomLayer) return;
		const id = createLabelLayer(selectedGeomLayer.id, pushSnapshot);
		// Select the new label layer so it becomes the text target immediately.
		if (id) selectLayer(id);
	}

	// Rotation of the selected label. version subscribes to session mutations so the
	// field tracks external changes; selection identity re-reads it too.
	const rotation = $derived.by(() => {
		void textSession.version;
		void textSession.selected;
		return selectedRotation();
	});

	// Curved labels get their orientation from the path — no rotation control.
	const curved = $derived.by(() => {
		void textSession.version;
		void textSession.selected;
		return selectedIsCurved();
	});

	// Wrap width of the selected label: null = auto-width (grows with typed text),
	// a number = a fixed width from dragging the box (auto-height — wraps and
	// grows down instead). Figma-style: dragging is the only way IN to auto-height;
	// this button is the only way back out.
	const wrapWidth = $derived.by(() => {
		void textSession.version;
		void textSession.selected;
		return selectedWrapWidth();
	});
</script>

<div class="text-bar">
	{#if selectedGeomLayer}
		<button
			class="bar-btn"
			onclick={handleCreateLabels}
			aria-label="Create labels from the selected layer"
			use:tooltip={{ text: 'Derive a label layer from the selected layer', placement: 'up' }}
		>
			<Plus size={14} />
			<span>Create labels from layer</span>
		</button>
	{:else}
		{#if textSession.targetLayerId !== null}
			<button
				class="bar-btn"
				onclick={clearLayerSelection}
				aria-label="Add text to a new layer"
				use:tooltip={{ text: 'Deselect — new boxes start a new text layer', placement: 'up' }}
			>
				<Plus size={16} weight="regular" />
				<span>New layer</span>
			</button>
			<div class="bar-divider"></div>
		{/if}
		{#if textSession.selected}
			<button
				class="bar-btn"
				class:toggled={curved}
				onclick={() => setSelectedOnPath(!curved)}
				aria-label="Toggle text on path for the selected label"
				aria-pressed={curved}
				use:tooltip={{ text: curved ? 'Straighten this label' : 'Put this label on a curved path', placement: 'up' }}
			>
				<BezierCurve size={14} />
				<span>On path</span>
			</button>
			{#if !curved}
				<span class="rotate-field" use:tooltip={{ text: 'Rotate the selected label', placement: 'up' }}>
					<Angle size={14} />
					<input
						class="rotate-input"
						type="number"
						step="1"
						value={rotation}
						oninput={(e) => setSelectedRotation(Number((e.currentTarget as HTMLInputElement).value))}
						aria-label="Rotation in degrees"
					/>
					<span class="deg">°</span>
				</span>
				{#if wrapWidth !== null}
					<button
						class="bar-btn"
						onclick={() => clearSelectedWrapWidth()}
						aria-label="Reset to auto width"
						use:tooltip={{ text: 'Reset to auto width (currently fixed from dragging)', placement: 'up' }}
					>
						<ArrowsInLineHorizontal size={14} />
						<span>Reset width</span>
					</button>
				{/if}
			{/if}
			<div class="bar-divider"></div>
		{/if}
		<span class="status status--strong">{statusText}</span>
	{/if}
	{#if hasWork}
		{#if selectedGeomLayer}<div class="bar-divider"></div>{/if}
		<button
			class="bar-btn"
			onclick={() => commitText()}
			aria-label="Apply text changes"
			use:tooltip={{ text: 'Apply the text changes', shortcut: 'Enter', placement: 'up' }}
		>
			<Check size={16} weight="regular" />
			<span>Done</span>
		</button>
		<button
			class="bar-btn"
			onclick={discardText}
			aria-label="Discard text changes"
			use:tooltip={{ text: 'Discard the text changes', placement: 'up' }}
		>
			<X size={14} weight="regular" />
			<span>Cancel</span>
		</button>
	{/if}
</div>

<style>
	.text-bar {
		display: flex;
		flex-direction: row;
		align-items: center;
		/* Reserve the buttons' height so the bar doesn't collapse when only the
		   status text is showing (fresh new-layer state). */
		min-height: 38px;
		border: 1px solid var(--color-border);
		border-radius: 8px;
		background: var(--color-surface-primary);
		box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12), 0 1px 4px rgba(0, 0, 0, 0.08);
		overflow: hidden;
		white-space: nowrap;
	}

	.status {
		padding: 0 12px;
		font-family: var(--font-mono);
		font-size: 12px;
		line-height: 18px;
		font-weight: 400;
		color: var(--color-text-secondary);
	}

	.status--strong {
		font-style: italic;
		color: var(--color-text-primary);
	}

	.bar-btn {
		display: flex;
		align-items: center;
		gap: 6px;
		height: 36px;
		padding: 0 12px;
		border: none;
		background: transparent;
		color: var(--color-text-primary);
		font-family: var(--font-mono);
		font-size: 12px;
		line-height: 18px;
		font-weight: 400;
		cursor: pointer;
	}

	.bar-btn :global(svg) {
		color: var(--color-icon-primary);
		flex-shrink: 0;
	}

	.bar-btn:hover {
		background: var(--color-surface-secondary);
	}

	.bar-btn.toggled {
		background: var(--color-surface-secondary);
		color: var(--color-accent);
	}

	.bar-btn.toggled :global(svg) {
		color: var(--color-accent);
	}

	.bar-divider {
		width: 1px;
		align-self: stretch;
		background: var(--color-border);
		flex-shrink: 0;
	}

	.rotate-field {
		display: flex;
		align-items: center;
		gap: 4px;
		padding: 0 10px;
		color: var(--color-icon-primary);
	}

	.rotate-input {
		width: 48px;
		height: 22px;
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
		background: var(--color-surface-primary);
		color: var(--color-text-primary);
		font-family: var(--font-mono);
		font-size: 12px;
		padding: 0 4px;
	}

	.deg {
		font-family: var(--font-mono);
		font-size: 12px;
		color: var(--color-text-secondary);
	}
</style>
