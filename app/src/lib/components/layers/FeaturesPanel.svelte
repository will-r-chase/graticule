<script lang="ts">
	import { hoveredFeature } from '$lib/stores/hoveredFeature.svelte';
	import { tooltip } from '$lib/actions/tooltip';
	import { selection } from '$lib/stores/selection.svelte';
	import { layers, workingTopologyData } from '$lib/stores/layers.svelte';
	import { X } from 'phosphor-svelte';

	function clearLayerSelection(layerId: string): void {
		const next = new Map(selection.features);
		next.delete(layerId);
		selection.features = next;
	}

	const MAX_HOVERED_PROPS = 3;

	// Common name-like property keys, checked in priority order.
	const NAME_KEYS = [
		'name', 'NAME', 'Name',
		'SOVEREIGNT', 'ADMIN', 'Admin', 'admin',
		'COUNTRY', 'Country', 'country',
		'REGION', 'Region', 'region',
		'title', 'TITLE', 'Title',
	];

	function findNameKey(props: Record<string, unknown>): string | null {
		for (const key of NAME_KEYS) {
			const val = props[key];
			if (typeof val === 'string' && val.trim()) return key;
		}
		return null;
	}

	function formatValue(val: unknown): string {
		if (val === null || val === undefined) return '—';
		if (typeof val === 'object') return JSON.stringify(val);
		return String(val);
	}

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	function getDisplayName(topo: any, featureIndex: number): string {
		const objectName = Object.keys(topo.objects)[0];
		const geom = topo.objects[objectName]?.geometries?.[featureIndex];
		const props: Record<string, unknown> | null = geom?.properties ?? null;
		const nameKey = props ? findNameKey(props) : null;
		return nameKey ? String(props![nameKey]) : `Feature ${featureIndex + 1}`;
	}

	interface HoveredInfo {
		layerName: string;
		displayName: string;
		shownProps: [string, string][];
		remainingProps: number;
		hasProperties: boolean;
	}

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	function getHoveredInfo(layerId: string, featureIndex: number): HoveredInfo | null {
		const layer = layers.find((l) => l.id === layerId);
		if (!layer) return null;
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const topo = workingTopologyData.get(layerId) as any;
		if (!topo) return null;
		const objectName = Object.keys(topo.objects)[0];
		const geom = topo.objects[objectName]?.geometries?.[featureIndex];
		const props: Record<string, unknown> | null = geom?.properties ?? null;

		const nameKey = props ? findNameKey(props) : null;
		const displayName = nameKey ? String(props![nameKey]) : `Feature ${featureIndex + 1}`;

		const allEntries: [string, string][] = props
			? Object.entries(props)
				.filter(([k]) => k !== nameKey)
				.map(([k, v]) => [k, formatValue(v)])
			: [];

		return {
			layerName: layer.name,
			displayName,
			shownProps: allEntries.slice(0, MAX_HOVERED_PROPS),
			remainingProps: Math.max(0, allEntries.length - MAX_HOVERED_PROPS),
			hasProperties: props !== null && Object.keys(props).length > 0,
		};
	}

	interface LayerGroup {
		layerId: string;
		layerName: string;
		featureNames: string[];
	}

	const totalSelected = $derived(
		[...selection.features.values()].reduce((sum, s) => sum + s.size, 0)
	);

	const layerGroups = $derived.by((): LayerGroup[] => {
		const groups: LayerGroup[] = [];
		for (const [layerId, indices] of selection.features) {
			const layer = layers.find((l) => l.id === layerId);
			if (!layer) continue;
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const topo = workingTopologyData.get(layerId) as any;
			const featureNames = topo
				? [...indices].map((i) => getDisplayName(topo, i))
				: [...indices].map((i) => `Feature ${i + 1}`);
			groups.push({ layerId, layerName: layer.name, featureNames });
		}
		return groups;
	});

	const hoveredInfo = $derived(
		hoveredFeature.value
			? getHoveredInfo(hoveredFeature.value.layerId, hoveredFeature.value.featureIndex)
			: null
	);
</script>

<div class="features-panel">

	<div class="section">
		<h4 class="section-heading">
			Selected{totalSelected > 0 ? ` (${totalSelected})` : ''}
		</h4>

		{#if totalSelected === 0}
			<p class="empty-hint">No features selected</p>
		{:else}
			<div class="feature-list">
				{#each layerGroups as group}
					<div class="feature-card">
						<div class="card-info" use:tooltip={{ text: group.featureNames.join(', '), placement: 'left' }}>
							<span class="feature-layer">{group.layerName}</span>
							<span class="feature-name">{group.featureNames.join(', ')}</span>
						</div>
						<button
							class="clear-btn"
							onclick={() => clearLayerSelection(group.layerId)}
							aria-label="Clear selection for {group.layerName}"
						>
							<X size={11} weight="bold" />
						</button>
					</div>
				{/each}
			</div>
		{/if}
	</div>

	{#if hoveredInfo}
		<div class="section">
			<h4 class="section-heading">Hovered</h4>
			<div class="feature-card hovered">
				<span class="feature-layer">{hoveredInfo.layerName}</span>
				<span class="feature-name">{hoveredInfo.displayName}</span>
				{#if hoveredInfo.shownProps.length > 0}
					<div class="prop-list">
						{#each hoveredInfo.shownProps as [key, val]}
							<div class="prop-row">
								<span class="prop-key">{key}</span>
								<span class="prop-val">{val}</span>
							</div>
						{/each}
						{#if hoveredInfo.remainingProps > 0}
							<p class="more-props">{hoveredInfo.remainingProps} more properties</p>
						{/if}
					</div>
				{:else if !hoveredInfo.hasProperties}
					<span class="no-props">No properties</span>
				{/if}
			</div>
		</div>
	{/if}

</div>

<style>
	.features-panel {
		display: flex;
		flex-direction: column;
		height: 100%;
		overflow-y: auto;
	}

	.section {
		padding: var(--space-m) var(--space-l);
	}

	.section-heading {
		margin-bottom: var(--space-s);
		color: var(--color-text-primary);
	}

	.empty-hint {
		font-size: 12px;
		color: var(--color-text-tertiary);
	}

	.feature-list {
		display: flex;
		flex-direction: column;
		gap: var(--space-s);
	}

	.feature-card {
		display: flex;
		flex-direction: row;
		align-items: center;
		gap: 0;
		background: var(--color-surface-secondary);
		border-radius: var(--radius);
		overflow: hidden;
	}

	.feature-card.hovered {
		flex-direction: column;
		align-items: stretch;
		padding: var(--space-s) var(--space-m);
	}

	.card-info {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		padding: var(--space-s) var(--space-m);
	}

	.clear-btn {
		flex-shrink: 0;
		align-self: stretch;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		background: none;
		border: none;
		border-left: 1px solid var(--color-border);
		cursor: pointer;
		color: var(--color-text-tertiary);
	}

	.clear-btn:hover {
		background: var(--color-surface-tertiary);
		color: var(--color-text-primary);
	}

	.feature-layer {
		font-family: var(--font-mono);
		font-size: 10px;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--color-text-tertiary);
	}

	.feature-name {
		font-size: 12px;
		font-weight: 500;
		color: var(--color-text-primary);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.prop-list {
		display: flex;
		flex-direction: column;
		gap: 2px;
		margin-top: var(--space-s);
	}

	.prop-row {
		display: flex;
		justify-content: space-between;
		gap: var(--space-m);
	}

	.prop-key {
		font-family: var(--font-mono);
		font-size: 10px;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--color-text-tertiary);
		white-space: nowrap;
	}

	.prop-val {
		font-size: 11px;
		color: var(--color-text-primary);
		text-align: right;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		max-width: 120px;
	}

	.more-props {
		font-size: 11px;
		color: var(--color-text-tertiary);
	}

	.no-props {
		font-size: 11px;
		color: var(--color-text-tertiary);
		margin-top: var(--space-s);
	}
</style>
