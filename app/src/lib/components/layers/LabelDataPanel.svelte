<script lang="ts">
	import { workingTopologyData, setLabelAttribute } from '$lib/stores/layers.svelte';
	import { pushSnapshot } from '$lib/stores/history.svelte';
	import Combobox from '$lib/components/ui/Combobox.svelte';
	import type { Layer } from '$lib/types';

	let { layer }: { layer: Layer } = $props();

	// Attribute options come from the layer's own topology — all source properties
	// were copied at creation (D2), so this is the full menu.
	const attrOptions = $derived.by(() => {
		void layer.hasTopology;
		const topo = workingTopologyData.get(layer.id);
		const keys = new Set<string>();
		if (topo) {
			for (const name of Object.keys(topo.objects)) {
				const obj = topo.objects[name] as { geometries?: { properties?: Record<string, unknown> }[] };
				for (const g of obj.geometries ?? []) {
					for (const k of Object.keys(g.properties ?? {})) keys.add(k);
				}
			}
		}
		return [...keys].sort().map((k) => ({ id: k, label: k }));
	});

	const featureCount = $derived.by(() => {
		void layer.hasTopology;
		const topo = workingTopologyData.get(layer.id);
		if (!topo) return 0;
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const anyTopo = topo as any;
		const objName = Object.keys(anyTopo.objects)[0];
		return anyTopo.objects[objName]?.geometries?.length ?? 0;
	});
</script>

<div class="data-panel">
	<div class="row">
		<span class="label mono-small">Source</span>
		<div class="controls">
			<span class="value mono-regular">
				{layer.derivedFrom ? `Derived from ${layer.derivedFrom}` : 'Derived dataset'}
			</span>
		</div>
	</div>
	<div class="row">
		<span class="label mono-small">Text</span>
		<div class="controls">
			<Combobox
				options={attrOptions}
				value={layer.labelAttribute ?? ''}
				placeholder="Pick attribute"
				onchange={(id) => { setLabelAttribute(layer.id, id); pushSnapshot(); }}
			/>
		</div>
	</div>
	<div class="row">
		<span class="label mono-small">Labels</span>
		<div class="controls">
			<span class="value mono-regular">{featureCount}</span>
		</div>
	</div>
</div>

<style>
	.data-panel {
		padding: var(--space-m) var(--space-m) var(--space-m);
		background: var(--color-surface-primary);
		display: flex;
		flex-direction: column;
		gap: var(--space-m);
	}

	.row {
		display: flex;
		align-items: center;
		gap: var(--space-s);
		height: 28px;
	}

	.label {
		width: 60px;
		flex-shrink: 0;
		color: var(--color-text-primary);
	}

	.controls {
		display: flex;
		align-items: center;
		flex: 1;
		min-width: 0;
	}

	.value {
		color: var(--color-text-primary);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
</style>
