<script lang="ts">
	import { layers, workingTopologyData, dissolveLayer, explodeLayer, clipByPolygon, clipByBbox, differenceLayers, unionLayers, mergeLayers, mosaicLayer } from '$lib/stores/layers.svelte';
	import { layerSelection, clearLayerSelection } from '$lib/stores/layerSelection.svelte';
	import { pushSnapshot } from '$lib/stores/history.svelte';
	import { tooltip } from '$lib/actions/tooltip';
	import { UniteSquare, DiamondsFour, Crop, SubtractSquare, Unite, GitMerge, X } from 'phosphor-svelte';
	import type { Topology } from 'topojson-specification';
	import Checkbox from '$lib/components/ui/Checkbox.svelte';

	let { getViewportBbox }: { getViewportBbox: () => [number, number, number, number] | null } = $props();

	const count = $derived(layerSelection.ids.length);
	const visible = $derived(count > 0 && layerSelection.enteredId === null);

	// Ordered selected layers (by stack position, top first).
	const selectedLayers = $derived(
		layers.filter(l => layerSelection.ids.includes(l.id))
	);

	// Single-layer context.
	const singleLayer = $derived(count === 1 ? selectedLayers[0] : null);
	const hasMultiTypes = $derived(
		singleLayer?.geometryTypes.some(t => t.startsWith('Multi')) ?? false
	);

	// Fields available for dissolve grouping.
	const dissolveFields = $derived.by(() => {
		if (!singleLayer) return [];
		const topo = workingTopologyData.get(singleLayer.id);
		if (!topo) return [];
		const objectName = Object.keys(topo.objects)[0];
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const geoms = (topo.objects[objectName] as any).geometries as any[] | undefined;
		const first = geoms?.find((g: any) => g.properties);
		return first ? Object.keys(first.properties) : [];
	});

	// Two-layer context: top layer is mask, bottom is target (by stack order).
	const twoLayerOps = $derived.by(() => {
		if (count !== 2) return null;
		const [a, b] = selectedLayers; // already ordered by stack position (top first)
		if (!a || !b) return null; // transient: layer removed but selection ids not yet cleared
		return { maskId: a.id, maskName: a.name, targetId: b.id, targetName: b.name };
	});

	function isPolygon(layer: { geometryTypes: string[] }): boolean {
		return layer.geometryTypes.some(t => t === 'Polygon' || t === 'MultiPolygon');
	}

	// Clip and Subtract require the mask (top layer) to be a polygon.
	const maskIsPolygon = $derived(selectedLayers.length >= 1 && isPolygon(selectedLayers[0]));
	// Mosaic requires all selected layers to be polygon.
	const allPolygon = $derived(selectedLayers.every(isPolygon));

	// Dissolve popover state.
	let dissolveOpen = $state(false);
	let dissolveField = $state('');
	let dissolveBtn = $state<HTMLButtonElement | null>(null);

	function openDissolve() {
		dissolveField = '';
		dissolveOpen = true;
	}

	function handleDissolve() {
		if (!singleLayer) return;
		dissolveOpen = false;
		dissolveLayer(singleLayer.id, dissolveField || null, () => {
			clearLayerSelection();
			pushSnapshot();
		});
	}

	function handleExplode() {
		if (!singleLayer) return;
		explodeLayer(singleLayer.id, () => {
			clearLayerSelection();
			pushSnapshot();
		});
	}

	function handleDifference() {
		if (!twoLayerOps) return;
		differenceLayers(twoLayerOps.targetId, twoLayerOps.maskId, () => {
			clearLayerSelection();
			pushSnapshot();
		});
	}

	function handleMosaic() {
		if (!singleLayer) return;
		mosaicLayer(singleLayer.id, () => {
			clearLayerSelection();
			pushSnapshot();
		});
	}

	function handleUnion() {
		unionLayers(layerSelection.ids, () => {
			clearLayerSelection();
			pushSnapshot();
		});
	}

	function handleMerge() {
		mergeLayers(layerSelection.ids, () => {
			clearLayerSelection();
			pushSnapshot();
		});
	}

	function handleDissolveKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter') handleDissolve();
		if (e.key === 'Escape') { dissolveOpen = false; }
	}

	// Clip popover state.
	let clipOpen = $state(false);
	let clipMode = $state<'layer' | 'bbox'>('layer');
	let bboxNorth = $state('');
	let bboxSouth = $state('');
	let bboxEast = $state('');
	let bboxWest = $state('');
	let viewportChecked = $state(false);

	const clipMask = $derived(selectedLayers[0] ?? null);
	const clipTargets = $derived(selectedLayers.slice(1));

	function computeDefaultBbox(): [number, number, number, number] {
		let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity;
		for (const layer of selectedLayers) {
			const topo = workingTopologyData.get(layer.id) as (Topology & { bbox?: number[] }) | undefined;
			if (!topo?.bbox) continue;
			const [w, s, e, n] = topo.bbox;
			minLon = Math.min(minLon, w);
			minLat = Math.min(minLat, s);
			maxLon = Math.max(maxLon, e);
			maxLat = Math.max(maxLat, n);
		}
		if (!isFinite(minLon)) return [-90, -45, 90, 45];
		const cx = (minLon + maxLon) / 2;
		const cy = (minLat + maxLat) / 2;
		const hw = Math.max((maxLon - minLon) * 0.125, 1);
		const hh = Math.max((maxLat - minLat) * 0.125, 1);
		return [
			Math.max(-180, cx - hw),
			Math.max(-90, cy - hh),
			Math.min(180, cx + hw),
			Math.min(90, cy + hh),
		];
	}

	function setBboxState([west, south, east, north]: [number, number, number, number]) {
		bboxWest = west.toFixed(4);
		bboxSouth = south.toFixed(4);
		bboxEast = east.toFixed(4);
		bboxNorth = north.toFixed(4);
	}

	function openClip() {
		clipMode = (count === 1 || !maskIsPolygon) ? 'bbox' : 'layer';
		setBboxState(computeDefaultBbox());
		viewportChecked = false;
		clipOpen = true;
	}

	function handleClipViewport() {
		viewportChecked = !viewportChecked;
		if (viewportChecked) {
			const vp = getViewportBbox();
			if (vp) setBboxState(vp);
		}
	}

	function handleClipConfirm() {
		clipOpen = false;
		if (clipMode === 'layer' && count > 1) {
			clipByPolygon(clipTargets.map(l => l.id), clipMask!.id, () => {
				clearLayerSelection();
				pushSnapshot();
			});
		} else {
			const bbox: [number, number, number, number] = [
				parseFloat(bboxWest),
				parseFloat(bboxSouth),
				parseFloat(bboxEast),
				parseFloat(bboxNorth),
			];
			clipByBbox(layerSelection.ids, bbox, () => {
				clearLayerSelection();
				pushSnapshot();
			});
		}
	}

	function handleClipKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter') handleClipConfirm();
		if (e.key === 'Escape') clipOpen = false;
	}
</script>

{#snippet clipBtn()}
<div class="popover-anchor">
	<button
		class="bar-btn"
		onclick={openClip}
		use:tooltip={{ text: 'Clip layer to a polygon or bounding box', placement: 'up' }}
	>
		<Crop size={14} />
		Clip
	</button>

	{#if clipOpen}
	<div class="clip-popover" onkeydown={handleClipKeydown} role="dialog" aria-label="Clip options">
		{#if count > 1}
		<div class="clip-radios">
			<label class="clip-radio" class:clip-radio--disabled={!maskIsPolygon}>
				<input type="radio" bind:group={clipMode} value="layer" disabled={!maskIsPolygon} />
				Clip to layer
			</label>
			<label class="clip-radio">
				<input type="radio" bind:group={clipMode} value="bbox" />
				Clip to bounding box
			</label>
		</div>
		<div class="popover-divider"></div>
		{/if}

		{#if clipMode === 'layer' && count > 1}
		<div class="clip-layer-info">
			<span class="clip-layer-name clip-layer-name--mask">{clipMask?.name}</span>
			<div class="clip-targets-row">
				<div class="clip-arrow"></div>
				<div class="clip-targets-col">
					<span class="popover-label">Clipping</span>
					{#each clipTargets as layer}
						<span class="clip-layer-name">{layer.name}</span>
					{/each}
				</div>
			</div>
		</div>
		{:else}
		<div class="bbox-grid">
			<label class="bbox-label" for="clip-north">N</label>
			<input id="clip-north" class="bbox-input" type="number" bind:value={bboxNorth} step="1" />
			<label class="bbox-label" for="clip-west">W</label>
			<input id="clip-west" class="bbox-input" type="number" bind:value={bboxWest} step="1" />
			<label class="bbox-label" for="clip-east">E</label>
			<input id="clip-east" class="bbox-input" type="number" bind:value={bboxEast} step="1" />
			<label class="bbox-label" for="clip-south">S</label>
			<input id="clip-south" class="bbox-input" type="number" bind:value={bboxSouth} step="1" />
		</div>
		<label class="clip-viewport">
			<Checkbox checked={viewportChecked} onchange={handleClipViewport} />
			Clip to viewport
		</label>
		{/if}

		<div class="popover-actions">
			<button class="popover-cancel" onclick={() => clipOpen = false}>Cancel</button>
			<button class="popover-confirm" onclick={handleClipConfirm}>Clip</button>
		</div>
	</div>
	{/if}
</div>
{/snippet}

{#if visible}
<div class="layer-action-bar">
	{#if count === 1}
		<!-- Dissolve -->
		<div class="popover-anchor">
			<button
				class="bar-btn"
				bind:this={dissolveBtn}
				onclick={openDissolve}
				use:tooltip={{ text: 'Merge features into one', placement: 'up' }}
			>
				<UniteSquare size={14} />
				Dissolve
			</button>

			{#if dissolveOpen}
			<div class="dissolve-popover" onkeydown={handleDissolveKeydown} role="dialog" aria-label="Dissolve options">
				<label class="popover-label" for="dissolve-field">Group by field</label>
				<select id="dissolve-field" class="field-select" bind:value={dissolveField}>
					<option value="">All features (merge all)</option>
					{#each dissolveFields as field}
						<option value={field}>{field}</option>
					{/each}
				</select>
				<div class="popover-actions">
					<button class="popover-cancel" onclick={() => dissolveOpen = false}>Cancel</button>
					<button class="popover-confirm" onclick={handleDissolve}>Dissolve</button>
				</div>
			</div>
			{/if}
		</div>

		<!-- Clip -->
		{@render clipBtn()}

		<!-- Explode — only relevant when Multi- geometry types are present -->
		{#if hasMultiTypes}
		<button
			class="bar-btn"
			onclick={handleExplode}
			use:tooltip={{ text: 'Split multi-part features into individual features', placement: 'up' }}
		>
			<DiamondsFour size={14} />
			Explode
		</button>
		{/if}

		<!-- Mosaic — only relevant for polygon layers -->
		{#if allPolygon}
		<button
			class="bar-btn"
			onclick={handleMosaic}
			use:tooltip={{ text: 'Flatten overlapping polygons into a non-overlapping mosaic', placement: 'up' }}
		>
			<Unite size={14} />
			Mosaic
		</button>
		{/if}

	{:else if count === 2}
		<!-- Clip -->
		{@render clipBtn()}
		<button
			class="bar-btn"
			class:bar-btn--disabled={!maskIsPolygon}
			disabled={!maskIsPolygon}
			onclick={handleDifference}
			use:tooltip={{
				text: maskIsPolygon
					? `Subtract ${twoLayerOps?.maskName} from ${twoLayerOps?.targetName}`
					: `Subtract requires the mask layer (${twoLayerOps?.maskName}) to be a polygon layer`,
				placement: 'up'
			}}
		>
			<SubtractSquare size={14} />
			Subtract
		</button>
		<button
			class="bar-btn"
			class:bar-btn--disabled={!allPolygon}
			disabled={!allPolygon}
			onclick={handleUnion}
			use:tooltip={{
				text: allPolygon
					? 'Create a polygon mosaic from all selected layers'
					: 'Mosaic requires all selected layers to be polygon layers',
				placement: 'up'
			}}
		>
			<Unite size={14} />
			Mosaic
		</button>
		<button
			class="bar-btn"
			onclick={handleMerge}
			use:tooltip={{ text: 'Combine features from all selected layers into one layer', placement: 'up' }}
		>
			<GitMerge size={14} />
			Merge
		</button>

	{:else}
		<!-- Clip -->
		{@render clipBtn()}
		<button
			class="bar-btn"
			class:bar-btn--disabled={!allPolygon}
			disabled={!allPolygon}
			onclick={handleUnion}
			use:tooltip={{
				text: allPolygon
					? 'Create a polygon mosaic from all selected layers'
					: 'Mosaic requires all selected layers to be polygon layers',
				placement: 'up'
			}}
		>
			<Unite size={14} />
			Mosaic
		</button>
		<button
			class="bar-btn"
			onclick={handleMerge}
			use:tooltip={{ text: 'Combine features from all selected layers into one layer', placement: 'up' }}
		>
			<GitMerge size={14} />
			Merge
		</button>
	{/if}

	<div class="bar-divider"></div>
	<span class="count">{count} {count === 1 ? 'layer' : 'layers'}</span>
	<button
		class="bar-btn bar-btn--icon"
		onclick={clearLayerSelection}
		aria-label="Clear selection"
		use:tooltip={{ text: 'Clear selection', shortcut: 'Esc', placement: 'up' }}
	>
		<X size={14} />
	</button>
</div>
{/if}

<style>
	.layer-action-bar {
		display: flex;
		flex-direction: row;
		align-items: center;
		border: 1px solid var(--color-border);
		border-radius: 8px;
		background: var(--color-surface-primary);
		box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12), 0 1px 4px rgba(0, 0, 0, 0.08);
		overflow: visible;
		white-space: nowrap;
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

	.bar-btn:hover {
		background: var(--color-surface-secondary);
	}

	.bar-btn--icon {
		padding: 0 10px;
	}

	.bar-btn--disabled,
	.bar-btn:disabled {
		opacity: 0.35;
		cursor: not-allowed;
	}

	.bar-btn--disabled:hover,
	.bar-btn:disabled:hover {
		background: transparent;
	}

	.bar-divider {
		width: 1px;
		align-self: stretch;
		background: var(--color-border);
		flex-shrink: 0;
	}

	.count {
		padding: 0 10px;
		font-family: var(--font-mono);
		font-size: 12px;
		line-height: 18px;
		font-weight: 400;
		color: var(--color-text-secondary);
	}

	.popover-anchor {
		position: relative;
	}

	.dissolve-popover {
		position: absolute;
		bottom: calc(100% + 8px);
		left: 0;
		background: var(--color-surface-primary);
		border: 1px solid var(--color-border);
		border-radius: 6px;
		box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12), 0 1px 4px rgba(0, 0, 0, 0.08);
		padding: var(--space-m);
		display: flex;
		flex-direction: column;
		gap: var(--space-m);
		min-width: 220px;
		z-index: 20;
	}

	.popover-label {
		font-family: var(--font-mono);
		font-size: 11px;
		color: var(--color-text-tertiary);
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.field-select {
		height: 28px;
		padding: 0 var(--space-s);
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
		background: var(--color-surface-primary);
		color: var(--color-text-primary);
		font-family: var(--font-mono);
		font-size: 12px;
		cursor: pointer;
	}

	.popover-actions {
		display: flex;
		gap: var(--space-s);
		justify-content: flex-end;
	}

	.popover-cancel,
	.popover-confirm {
		height: 28px;
		padding: 0 var(--space-m);
		border-radius: var(--radius);
		border: 1px solid var(--color-border);
		font-family: var(--font-mono);
		font-size: 12px;
		cursor: pointer;
	}

	.popover-cancel {
		background: transparent;
		color: var(--color-text-secondary);
	}

	.popover-cancel:hover {
		background: var(--color-surface-secondary);
	}

	.popover-confirm {
		background: var(--color-accent);
		color: white;
		border-color: var(--color-accent);
	}

	.popover-confirm:hover {
		opacity: 0.9;
	}

	.clip-popover {
		position: absolute;
		bottom: calc(100% + 8px);
		left: 50%;
		transform: translateX(-50%);
		background: var(--color-surface-primary);
		border: 1px solid var(--color-border);
		border-radius: 6px;
		box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12), 0 1px 4px rgba(0, 0, 0, 0.08);
		padding: var(--space-m);
		display: flex;
		flex-direction: column;
		gap: var(--space-m);
		min-width: 240px;
		z-index: 20;
	}

	.popover-divider {
		height: 1px;
		background: var(--color-border);
		margin: 0 calc(-1 * var(--space-m));
	}

	.clip-radios {
		display: flex;
		flex-direction: column;
		gap: var(--space-s);
	}

	.clip-radio {
		display: flex;
		align-items: center;
		gap: var(--space-s);
		font-family: var(--font-mono);
		font-size: 12px;
		color: var(--color-text-primary);
		cursor: pointer;
	}

	.clip-radio--disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	.clip-radio input[type="radio"] {
		appearance: none;
		-webkit-appearance: none;
		width: 14px;
		height: 14px;
		border: 1.5px solid var(--color-border);
		border-radius: 50%;
		background: transparent;
		cursor: pointer;
		flex-shrink: 0;
		margin: 0;
		transition: border-color 100ms;
	}

	.clip-radio input[type="radio"]:not(:checked):hover {
		border-color: var(--color-accent);
	}

	.clip-radio input[type="radio"]:checked {
		border-color: var(--color-accent);
		background: radial-gradient(circle, var(--color-accent) 38%, transparent 38%);
	}

	.clip-radio--disabled input[type="radio"] {
		cursor: not-allowed;
	}

	.clip-layer-info {
		display: flex;
		flex-direction: column;
		gap: 0;
	}

	.clip-layer-name {
		font-family: var(--font-sans);
		font-size: 12px;
		line-height: 18px;
		color: var(--color-text-primary);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.clip-targets-row {
		display: flex;
		flex-direction: row;
		align-items: flex-start;
		gap: var(--space-m);
	}

	.clip-arrow {
		width: 12px;
		height: 9px;
		border-left: 1px solid var(--grey-300);
		border-bottom: 1px solid var(--grey-300);
		border-bottom-left-radius: 3px;
		flex-shrink: 0;
		position: relative;
		align-self: flex-start;
		margin-top: 9px;
	}

	.clip-arrow::after,
	.clip-arrow::before {
		content: '';
		position: absolute;
		right: 0;
		bottom: -0.75px;
		width: 5px;
		height: 1px;
		background: var(--grey-300);
		transform-origin: right center;
	}

	.clip-arrow::after {
		transform: rotate(40deg);
	}

	.clip-arrow::before {
		transform: rotate(-40deg);
	}

	.clip-targets-col {
		display: flex;
		flex-direction: column;
		gap: 0;
		min-width: 0;
		margin-top: 9px;
	}

	.clip-layer-name--mask {
		font-weight: 600;
	}

	.bbox-grid {
		display: grid;
		grid-template-columns: 16px 1fr 16px 1fr;
		align-items: center;
		gap: var(--space-s);
	}

	.bbox-label {
		font-family: var(--font-mono);
		font-size: 11px;
		color: var(--color-text-tertiary);
		text-align: center;
	}

	.bbox-input {
		height: 26px;
		padding: 0 var(--space-s);
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
		background: var(--color-surface-primary);
		color: var(--color-text-primary);
		font-family: var(--font-mono);
		font-size: 12px;
		width: 100%;
		min-width: 0;
	}

	.clip-viewport {
		display: flex;
		align-items: center;
		gap: var(--space-s);
		font-family: var(--font-mono);
		font-size: 12px;
		color: var(--color-text-secondary);
		cursor: pointer;
		user-select: none;
	}

	.clip-viewport :global(.checkbox-wrap) {
		margin-top: 0;
	}
</style>
