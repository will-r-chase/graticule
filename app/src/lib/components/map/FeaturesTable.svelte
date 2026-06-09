<script lang="ts">
	import { featuresTable, closeFeaturesTable } from '$lib/stores/featuresTable.svelte';
	import { layers, workingTopologyData } from '$lib/stores/layers.svelte';
	import { selection, selectFeature } from '$lib/stores/selection.svelte';
	import { X, HashStraight, TextT, CircleHalf, Empty, Question } from 'phosphor-svelte';
	import Checkbox from '$lib/components/ui/Checkbox.svelte';

	// Scroll shadow state — tracks whether there's more content to scroll to.
	let tableScrollEl = $state<HTMLDivElement | null>(null);
	let hasRightScroll = $state(false);
	let hasBottomScroll = $state(false);

	$effect(() => {
		const el = tableScrollEl;
		if (!el) return;

		function update() {
			hasRightScroll = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
			hasBottomScroll = el.scrollTop + el.clientHeight < el.scrollHeight - 1;
		}

		update();
		el.addEventListener('scroll', update, { passive: true });
		const ro = new ResizeObserver(update);
		ro.observe(el);
		return () => {
			el.removeEventListener('scroll', update);
			ro.disconnect();
		};
	});

	type ColType = 'number' | 'string' | 'boolean' | 'null' | 'mixed';

	function inferType(values: unknown[]): ColType {
		const types = new Set<string>();
		for (const v of values) {
			if (v === null || v === undefined) continue;
			if (typeof v === 'number') types.add('number');
			else if (typeof v === 'boolean') types.add('boolean');
			else types.add('string');
		}
		if (types.size === 0) return 'null';
		if (types.size === 1) return [...types][0] as ColType;
		return 'mixed';
	}

	interface Column { key: string; type: ColType; }
	interface Row { index: number; properties: Record<string, unknown>; }

	// All layers — no hasTopology filter so tabs never flash when a layer's
	// topology temporarily becomes unavailable during pipeline runs.
	const tabLayers = $derived(layers);

	// Keep activeLayerId pointing at a valid layer.
	$effect(() => {
		if (tabLayers.length === 0) {
			featuresTable.activeLayerId = null;
		} else if (!tabLayers.find(l => l.id === featuresTable.activeLayerId)) {
			featuresTable.activeLayerId = tabLayers[0].id;
		}
	});

	// Derive table data from the active layer. Reads activeLayerId (reactive) and
	// activeLayer.hasTopology (reactive) so it re-runs when topology becomes ready,
	// but NOT on unrelated layer mutations like bezierCacheKey or loading state.
	const tableData = $derived.by((): { columns: Column[]; rows: Row[] } => {
		const layerId = featuresTable.activeLayerId;
		if (!layerId) return { columns: [], rows: [] };

		const activeLayer = layers.find(l => l.id === layerId);
		if (!activeLayer?.hasTopology) return { columns: [], rows: [] };

		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const topo = workingTopologyData.get(layerId) as any;
		if (!topo) return { columns: [], rows: [] };

		const objectName = Object.keys(topo.objects)[0];
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const geometries: any[] = topo.objects[objectName]?.geometries ?? [];

		const keySet = new Set<string>();
		for (const geom of geometries) {
			if (geom.properties) {
				for (const key of Object.keys(geom.properties)) keySet.add(key);
			}
		}
		const keys = [...keySet];

		const columns: Column[] = keys.map(key => {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const values = geometries.map((g: any) => g.properties?.[key] ?? null);
			return { key, type: inferType(values) };
		});

		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const rows: Row[] = geometries.map((geom: any, i: number) => ({
			index: i,
			properties: { ...(geom.properties ?? {}) },
		}));

		return { columns, rows };
	});

	// Local mutable copies so edits don't collide with the derived.
	let columns = $state<Column[]>([]);
	let rows = $state<Row[]>([]);

	$effect(() => {
		columns = tableData.columns.map(c => ({ ...c }));
		rows = tableData.rows.map(r => ({ index: r.index, properties: { ...r.properties } }));
	});

	// ── Cell editing ───────────────────────────────────────────────────────────

	function saveCell(featureIndex: number, key: string, rawValue: string): void {
		const col = columns.find(c => c.key === key);
		let parsed: unknown = rawValue;
		if (col?.type === 'number') {
			const n = Number(rawValue);
			parsed = isNaN(n) ? rawValue : n;
		} else if (col?.type === 'boolean') {
			if (rawValue.toLowerCase() === 'true') parsed = true;
			else if (rawValue.toLowerCase() === 'false') parsed = false;
		}

		const row = rows.find(r => r.index === featureIndex);
		if (row) row.properties[key] = parsed;

		const layerId = featuresTable.activeLayerId;
		if (!layerId) return;
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const topo = workingTopologyData.get(layerId) as any;
		if (!topo) return;
		const objectName = Object.keys(topo.objects)[0];
		const geom = topo.objects[objectName]?.geometries?.[featureIndex];
		if (geom?.properties) geom.properties[key] = parsed;
	}

	// ── Column name editing ────────────────────────────────────────────────────

	function saveColumnName(colIndex: number, newKey: string): void {
		const trimmed = newKey.trim();
		const oldKey = columns[colIndex].key;
		if (!trimmed || trimmed === oldKey) return;
		if (columns.some((c, i) => i !== colIndex && c.key === trimmed)) return;

		columns[colIndex] = { ...columns[colIndex], key: trimmed };

		for (const row of rows) {
			if (Object.prototype.hasOwnProperty.call(row.properties, oldKey)) {
				row.properties[trimmed] = row.properties[oldKey];
				delete row.properties[oldKey];
			}
		}

		const layerId = featuresTable.activeLayerId;
		if (!layerId) return;
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const topo = workingTopologyData.get(layerId) as any;
		if (!topo) return;
		const objectName = Object.keys(topo.objects)[0];
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		for (const geom of topo.objects[objectName]?.geometries ?? [] as any[]) {
			if (geom.properties && Object.prototype.hasOwnProperty.call(geom.properties, oldKey)) {
				geom.properties[trimmed] = geom.properties[oldKey];
				delete geom.properties[oldKey];
			}
		}
	}

	// ── Selection ──────────────────────────────────────────────────────────────

	function isSelected(featureIndex: number): boolean {
		const layerId = featuresTable.activeLayerId;
		if (!layerId) return false;
		return selection.features.get(layerId)?.has(featureIndex) ?? false;
	}

	function toggleSelected(featureIndex: number): void {
		const layerId = featuresTable.activeLayerId;
		if (!layerId) return;
		selectFeature(layerId, featureIndex, true);
	}

	const selectedCount = $derived.by(() => {
		const layerId = featuresTable.activeLayerId;
		if (!layerId) return 0;
		return selection.features.get(layerId)?.size ?? 0;
	});

	const allSelected = $derived(rows.length > 0 && selectedCount === rows.length);
	const someSelected = $derived(selectedCount > 0 && selectedCount < rows.length);

	function toggleSelectAll(): void {
		const layerId = featuresTable.activeLayerId;
		if (!layerId) return;
		if (allSelected) {
			const next = new Map(selection.features);
			next.delete(layerId);
			selection.features = next;
		} else {
			const next = new Map(selection.features);
			next.set(layerId, new Set(rows.map(r => r.index)));
			selection.features = next;
		}
	}
</script>

<div class="features-table">
	<!-- Header: layer tabs + dismiss button -->
	<div class="table-header">
		<div class="tabs">
			{#each tabLayers as layer (layer.id)}
				<button
					class="tab"
					class:active={featuresTable.activeLayerId === layer.id}
					onclick={() => { featuresTable.activeLayerId = layer.id; }}
				>
					{layer.name}
					{#if featuresTable.activeLayerId === layer.id && rows.length > 0}
						<span class="tab-meta">{rows.length} × {columns.length}</span>
					{/if}
				</button>
			{/each}
		</div>
		<button class="dismiss-btn" onclick={closeFeaturesTable} aria-label="Close features table">
			<X size={14} />
		</button>
	</div>

	<!-- Scroll fade indicators (shown when there's more content in that direction) -->
	{#if hasRightScroll}
		<div class="scroll-fade-right" aria-hidden="true"></div>
	{/if}
	{#if hasBottomScroll}
		<div class="scroll-fade-bottom" aria-hidden="true"></div>
	{/if}

	<!-- Table body -->
	<div class="table-scroll" bind:this={tableScrollEl}>
		{#if columns.length === 0}
			<p class="empty-hint body-small">No properties</p>
		{:else}
			<table>
				<thead>
					<tr>
						<th class="col-checkbox">
							<Checkbox
								checked={allSelected}
								indeterminate={someSelected}
								onchange={toggleSelectAll}
								aria-label="Select all features"
							/>
						</th>
						{#each columns as col, i (col.key)}
							<th>
								<div class="col-header">
									<span class="col-icon">
										{#if col.type === 'number'}
											<HashStraight size={11} weight="bold" />
										{:else if col.type === 'string'}
											<TextT size={11} weight="bold" />
										{:else if col.type === 'boolean'}
											<CircleHalf size={11} weight="bold" />
										{:else if col.type === 'null'}
											<Empty size={11} weight="bold" />
										{:else}
											<Question size={11} weight="bold" />
										{/if}
									</span>
									<input
										class="col-name-input"
										type="text"
										value={col.key}
										onblur={(e) => saveColumnName(i, (e.target as HTMLInputElement).value)}
										onkeydown={(e) => {
											if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
											if (e.key === 'Escape') {
												(e.target as HTMLInputElement).value = col.key;
												(e.target as HTMLInputElement).blur();
											}
										}}
										aria-label="Column name"
									/>
								</div>
							</th>
						{/each}
					</tr>
				</thead>
				<tbody>
					{#each rows as row (row.index)}
						<tr class:selected={isSelected(row.index)}>
							<td class="col-checkbox">
								<Checkbox
									checked={isSelected(row.index)}
									onchange={() => toggleSelected(row.index)}
								/>
							</td>
							{#each columns as col (col.key)}
								<td>
									<input
										type="text"
										class="cell-input body-small"
										value={String(row.properties[col.key] ?? '')}
										onblur={(e) => saveCell(row.index, col.key, (e.target as HTMLInputElement).value)}
										onkeydown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
									/>
								</td>
							{/each}
						</tr>
					{/each}
				</tbody>
			</table>
		{/if}
	</div>
</div>

<style>
	.features-table {
		position: absolute;
		bottom: 0;
		left: 0;
		right: 0;
		height: 260px;
		background: var(--color-surface-primary);
		border-top: 1px solid var(--color-border);
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}

	/* ── Header bar ────────────────────────────────────────────────── */

	.table-header {
		display: flex;
		align-items: stretch;
		height: 36px;
		flex-shrink: 0;
		border-bottom: 1px solid var(--color-border);
	}

	.tabs {
		flex: 1;
		display: flex;
		align-items: stretch;
		overflow-x: auto;
		scrollbar-width: none;
	}

	.tabs::-webkit-scrollbar { display: none; }

	.tab {
		display: flex;
		align-items: center;
		padding: 0 var(--space-m);
		border: none;
		border-right: 1px solid var(--color-border);
		background: none;
		cursor: pointer;
		white-space: nowrap;
		flex-shrink: 0;
		font-size: 12px;
		font-weight: 500;
		color: var(--color-text-tertiary);
	}

	.tab.active {
		color: var(--color-text-primary);
		box-shadow: inset 0 -2px 0 var(--color-accent);
	}

	.tab-meta {
		font-size: 11px;
		font-weight: 400;
		color: var(--color-text-tertiary);
		margin-left: var(--space-s);
	}

	.tab:not(.active):hover {
		color: var(--color-text-secondary);
	}

	.dismiss-btn {
		flex-shrink: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 36px;
		background: none;
		border: none;
		border-left: 1px solid var(--color-border);
		cursor: pointer;
		color: var(--color-text-secondary);
	}

	.dismiss-btn:hover {
		background: var(--color-surface-secondary);
		color: var(--color-text-primary);
	}

	/* ── Table ─────────────────────────────────────────────────────── */

	.table-scroll {
		flex: 1;
		overflow: auto;
	}

	.empty-hint {
		padding: var(--space-l);
		color: var(--color-text-tertiary);
	}

	table {
		border-collapse: collapse;
		width: max-content;
		min-width: 100%;
	}

	/* Sticky header row */
	thead {
		position: sticky;
		top: 0;
		z-index: 2;
		background: var(--color-surface-primary);
	}

	th {
		padding: 0 var(--space-m);
		height: 32px;
		text-align: left;
		vertical-align: middle;
		border-bottom: 1px solid var(--color-border);
		white-space: nowrap;
		min-width: 140px;
	}

	/* Sticky checkbox column — header */
	th.col-checkbox {
		position: sticky;
		left: 0;
		z-index: 3;
		min-width: unset;
		width: 40px;
		text-align: center;
		vertical-align: middle;
		padding: 0 var(--space-m);
		border-right: 1px solid var(--color-border);
		background: var(--color-surface-primary);
	}

	.col-header {
		display: flex;
		align-items: center;
		gap: var(--space-xs);
		height: 100%;
	}

	.col-icon {
		color: var(--color-text-tertiary);
		display: flex;
		align-items: center;
		flex-shrink: 0;
		line-height: 0;
		margin-bottom: 2px;
	}

	/* ── Scroll fade indicators ────────────────────────────────────── */

	.scroll-fade-right {
		position: absolute;
		top: 36px; /* below header bar */
		right: 0;
		bottom: 0;
		width: 48px;
		pointer-events: none;
		z-index: 10;
		background: linear-gradient(to left, var(--color-surface-primary) 0%, transparent 100%);
	}

	.scroll-fade-bottom {
		position: absolute;
		left: 0;
		right: 0;
		bottom: 0;
		height: 32px;
		pointer-events: none;
		z-index: 10;
		background: linear-gradient(to top, var(--color-surface-primary) 0%, transparent 100%);
	}

	/* Column name — editable input styled like h4 */
	.col-name-input {
		background: none;
		border: none;
		outline: none;
		padding: 2px 0;
		margin: 0;
		cursor: default;
		width: 100%;
		min-width: 0;
		font-family: var(--font-mono);
		font-size: 12px;
		font-weight: 400;
		letter-spacing: 0.05em;
		color: var(--color-text-secondary);
		line-height: 18px;
	}

	.col-name-input:focus {
		cursor: text;
		background: color-mix(in srgb, var(--color-accent) 10%, var(--color-surface-primary));
		outline: 1px solid var(--color-accent);
		outline-offset: 1px;
		border-radius: 2px;
	}

	td {
		padding: 0;
		height: 32px;
		vertical-align: middle;
		border-bottom: 1px solid var(--color-border);
	}

	/* Sticky checkbox column — body */
	td.col-checkbox {
		position: sticky;
		left: 0;
		z-index: 1;
		text-align: center;
		vertical-align: middle;
		padding: 0 var(--space-m);
		border-right: 1px solid var(--color-border);
		background: var(--color-surface-primary);
	}

	tr:hover td {
		background: var(--color-surface-secondary);
	}

	tr:hover td.col-checkbox {
		background: var(--color-surface-secondary);
	}

	tr.selected td {
		background: color-mix(in srgb, var(--color-accent) 8%, var(--color-surface-primary));
	}

	tr.selected td.col-checkbox {
		background: color-mix(in srgb, var(--color-accent) 8%, var(--color-surface-primary));
	}

	tr.selected:hover td {
		background: color-mix(in srgb, var(--color-accent) 14%, var(--color-surface-primary));
	}

	tr.selected:hover td.col-checkbox {
		background: color-mix(in srgb, var(--color-accent) 14%, var(--color-surface-primary));
	}

	.cell-input {
		display: block;
		width: 100%;
		height: 100%;
		padding: 0 var(--space-m);
		background: none;
		border: none;
		outline: none;
		color: var(--color-text-primary);
		font-family: inherit;
		cursor: default;
	}

	.cell-input:focus {
		cursor: text;
		background: color-mix(in srgb, var(--color-accent) 10%, var(--color-surface-primary));
		outline: 1px solid var(--color-accent);
		outline-offset: -1px;
	}
</style>
