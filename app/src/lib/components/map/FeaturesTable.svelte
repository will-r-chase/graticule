<script lang="ts">
	import { featuresTable, closeFeaturesTable } from '$lib/stores/featuresTable.svelte';
	import { layers, workingTopologyData } from '$lib/stores/layers.svelte';
	import { selection, selectFeature } from '$lib/stores/selection.svelte';
	import { X, HashStraight, TextT, CircleHalf, Empty, Question, Plus } from 'phosphor-svelte';
	import { tick } from 'svelte';
	import Checkbox from '$lib/components/ui/Checkbox.svelte';
	import DropdownMenu from '$lib/components/ui/DropdownMenu.svelte';

	// Scroll shadow state — tracks whether there's more content to scroll to.
	let tableScrollEl = $state<HTMLDivElement | null>(null);
	let hasRightScroll = $state(false);
	let hasBottomScroll = $state(false);

	const ROW_HEIGHT = 32;
	const BUFFER = 40;
	let scrollTop = $state(0);
	let containerHeight = $state(0);

	$effect(() => {
		const el = tableScrollEl;
		if (!el) return;

		function update() {
			hasRightScroll = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
			hasBottomScroll = el.scrollTop + el.clientHeight < el.scrollHeight - 1;
			scrollTop = el.scrollTop;
			containerHeight = el.clientHeight;
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

	// Virtual scrolling — only render rows in the visible window + buffer.
	let virtualStart = $derived(Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - BUFFER));
	let virtualEnd = $derived(Math.min(rows.length, Math.ceil((scrollTop + containerHeight) / ROW_HEIGHT) + BUFFER));
	let visibleRows = $derived(rows.slice(virtualStart, virtualEnd));
	let topSpacerHeight = $derived(virtualStart * ROW_HEIGHT);
	let bottomSpacerHeight = $derived(Math.max(0, rows.length - virtualEnd) * ROW_HEIGHT);

	// Which insert zone is currently hovered (index = insert before that column index;
	// columns.length = insert at end).
	let hoveredInsert = $state<number | null>(null);

	// Which cell / column header is currently in edit mode (double-click to enter).
	let editingCell = $state<{ rowIndex: number; key: string } | null>(null);
	let editingColIdx = $state<number | null>(null);

	// Column selection, hover, + context menu.
	let selectedColKey = $state<string | null>(null);
	let hoveredColKey = $state<string | null>(null);
	let contextMenu = $state<{ x: number; y: number; colKey: string } | null>(null);

	// Close context menu on any document click while it's open.
	$effect(() => {
		if (!contextMenu) return;
		function close() { contextMenu = null; }
		document.addEventListener('click', close);
		document.addEventListener('contextmenu', close);
		return () => {
			document.removeEventListener('click', close);
			document.removeEventListener('contextmenu', close);
		};
	});

	$effect(() => {
		columns = tableData.columns.map(c => ({ ...c }));
		rows = tableData.rows.map(r => ({ index: r.index, properties: { ...r.properties } }));
	});

	// ── Cell editing ───────────────────────────────────────────────────────────

	function saveCell(featureIndex: number, key: string, rawValue: string): void {
		// Parse liberally — try number, boolean, then fall back to string / null.
		let parsed: unknown;
		if (rawValue === '') {
			parsed = null;
		} else {
			const asNum = Number(rawValue);
			if (!isNaN(asNum)) {
				parsed = asNum;
			} else if (rawValue.toLowerCase() === 'true') {
				parsed = true;
			} else if (rawValue.toLowerCase() === 'false') {
				parsed = false;
			} else {
				parsed = rawValue;
			}
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
		if (geom) {
			if (!geom.properties) geom.properties = {};
			geom.properties[key] = parsed;
		}

		// Re-infer column type from all row values now that one cell changed.
		const colIdx = columns.findIndex(c => c.key === key);
		if (colIdx >= 0) {
			const values = rows.map(r => r.properties[key] ?? null);
			columns[colIdx] = { ...columns[colIdx], type: inferType(values) };
		}
	}

	// ── Column paste (TSV from spreadsheet) ───────────────────────────────────

	function handleCellPaste(e: ClipboardEvent, startFeatureIndex: number, key: string): void {
		const text = e.clipboardData?.getData('text');
		if (!text) return;
		const lines = text.split(/\r?\n/).filter(l => l !== '');
		if (lines.length <= 1) return; // single value — let browser handle it
		e.preventDefault();
		const startIdx = rows.findIndex(r => r.index === startFeatureIndex);
		if (startIdx === -1) return;
		for (let i = 0; i < lines.length; i++) {
			const rowIdx = startIdx + i;
			if (rowIdx >= rows.length) break;
			// For TSV rows take only the first tab-separated column.
			const cellValue = lines[i].split('\t')[0];
			saveCell(rows[rowIdx].index, key, cellValue);
		}
	}

	// ── Insert column ──────────────────────────────────────────────────────────

	async function insertColumn(beforeIndex: number): Promise<void> {
		// Find a unique default name.
		let n = 1;
		while (columns.some(c => c.key === `property_${n}`)) n++;
		const newKey = `property_${n}`;

		// Insert into local columns array.
		const newCol: Column = { key: newKey, type: 'null' };
		columns = [...columns.slice(0, beforeIndex), newCol, ...columns.slice(beforeIndex)];

		// Add null value to every local row.
		for (const row of rows) {
			row.properties[newKey] = null;
		}

		// Write through to the working topology.
		const layerId = featuresTable.activeLayerId;
		if (layerId) {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const topo = workingTopologyData.get(layerId) as any;
			if (topo) {
				const objectName = Object.keys(topo.objects)[0];
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				for (const geom of topo.objects[objectName]?.geometries ?? [] as any[]) {
					if (!geom.properties) geom.properties = {};
					geom.properties[newKey] = null;
				}
			}
		}

		// Set edit mode before tick so the input renders without readonly, then focus.
		editingColIdx = beforeIndex;
		await tick();
		const input = document.querySelector<HTMLInputElement>(`input[data-col-key="${newKey}"]`);
		if (input) { input.focus(); input.select(); }
	}

	// ── Column operations (context menu) ─────────────────────────────────────

	function deleteColumn(key: string): void {
		columns = columns.filter(c => c.key !== key);
		for (const row of rows) delete row.properties[key];

		const layerId = featuresTable.activeLayerId;
		if (layerId) {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const topo = workingTopologyData.get(layerId) as any;
			if (topo) {
				const objectName = Object.keys(topo.objects)[0];
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				for (const geom of topo.objects[objectName]?.geometries ?? [] as any[]) {
					if (geom.properties) delete geom.properties[key];
				}
			}
		}
		if (selectedColKey === key) selectedColKey = null;
		contextMenu = null;
	}

	function duplicateColumn(key: string): void {
		const sourceCol = columns.find(c => c.key === key);
		if (!sourceCol) return;
		let newKey = `${key}_copy`;
		let n = 2;
		while (columns.some(c => c.key === newKey)) newKey = `${key}_copy_${n++}`;

		const sourceIdx = columns.findIndex(c => c.key === key);
		columns = [
			...columns.slice(0, sourceIdx + 1),
			{ key: newKey, type: sourceCol.type },
			...columns.slice(sourceIdx + 1),
		];
		for (const row of rows) row.properties[newKey] = row.properties[key] ?? null;

		const layerId = featuresTable.activeLayerId;
		if (layerId) {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const topo = workingTopologyData.get(layerId) as any;
			if (topo) {
				const objectName = Object.keys(topo.objects)[0];
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				for (const geom of topo.objects[objectName]?.geometries ?? [] as any[]) {
					if (geom.properties) geom.properties[newKey] = geom.properties[key] ?? null;
				}
			}
		}
		contextMenu = null;
	}

	function copyColumnData(key: string): void {
		const values = rows.map(r => String(r.properties[key] ?? ''));
		navigator.clipboard.writeText(values.join('\n'));
		contextMenu = null;
	}

	async function renameColumn(key: string): Promise<void> {
		contextMenu = null;
		const idx = columns.findIndex(c => c.key === key);
		if (idx === -1) return;
		editingColIdx = idx;
		await tick();
		const input = document.querySelector<HTMLInputElement>(`input[data-col-key="${key}"]`);
		if (input) { input.focus(); input.select(); }
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

<div class="features-table" onclick={() => { selectedColKey = null; contextMenu = null; }}>
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

	<!-- Column context menu -->
	{#if contextMenu}
		<DropdownMenu top={contextMenu.y} left={contextMenu.x}>
			<button class="dropdown-item body-small" onclick={() => renameColumn(contextMenu!.colKey)}>Rename</button>
			<button class="dropdown-item body-small" onclick={() => duplicateColumn(contextMenu!.colKey)}>Duplicate</button>
			<button class="dropdown-item body-small" onclick={() => copyColumnData(contextMenu!.colKey)}>Copy column data</button>
			<div class="dropdown-divider"></div>
			<button class="dropdown-item body-small danger" onclick={() => deleteColumn(contextMenu!.colKey)}>Delete column</button>
		</DropdownMenu>
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
							<!-- Thin insert zone — hover reveals the + button -->
							<th
								class="col-insert-zone"
								class:hovered={hoveredInsert === i}
								onmouseenter={() => { hoveredInsert = i; }}
								onmouseleave={() => { hoveredInsert = null; }}
							>
								<button
									class="insert-col-btn"
									onclick={() => insertColumn(i)}
									tabindex="-1"
									aria-label="Insert column"
								>
									<Plus size={12} />
								</button>
							</th>
							<th
								class:col-selected={selectedColKey === col.key}
								onclick={(e) => {
									e.stopPropagation();
									selectedColKey = selectedColKey === col.key ? null : col.key;
									contextMenu = null;
								}}
								oncontextmenu={(e) => {
									e.preventDefault();
									e.stopPropagation();
									selectedColKey = col.key;
									contextMenu = { x: e.clientX, y: e.clientY, colKey: col.key };
								}}
								onmouseenter={() => { hoveredColKey = col.key; }}
								onmouseleave={() => { hoveredColKey = null; }}
							>
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
										data-col-key={col.key}
										value={col.key}
										readonly={editingColIdx !== i}
										ondblclick={(e) => {
											editingColIdx = i;
											(e.target as HTMLInputElement).select();
										}}
										onblur={(e) => {
											saveColumnName(i, (e.target as HTMLInputElement).value);
											editingColIdx = null;
										}}
										onkeydown={(e) => {
											if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
											if (e.key === 'Escape') {
												(e.target as HTMLInputElement).value = col.key;
												editingColIdx = null;
												(e.target as HTMLInputElement).blur();
											}
										}}
										aria-label="Column name"
									/>
								</div>
							</th>
						{/each}
						<!-- Persistent add-column button at the end -->
						<th class="col-add-end">
							<button
								class="add-col-btn"
								onclick={() => insertColumn(columns.length)}
								aria-label="Add column"
								title="Add column"
							>
								<Plus size={11} weight="bold" />
							</button>
						</th>
					</tr>
				</thead>
				<tbody>
					{#if topSpacerHeight > 0}
						<tr class="virtual-spacer" style="height: {topSpacerHeight}px"><td colspan="999"></td></tr>
					{/if}
					{#each visibleRows as row (row.index)}
						<tr class:selected={isSelected(row.index)}>
							<td class="col-checkbox">
								<Checkbox
									checked={isSelected(row.index)}
									onchange={() => toggleSelected(row.index)}
								/>
							</td>
							{#each columns as col (col.key)}
								<td class="col-insert-zone"></td>
								<td
									class:col-hovered={hoveredColKey === col.key}
									class:col-selected={selectedColKey === col.key}
								>
									<input
										type="text"
										class="cell-input body-small"
										value={String(row.properties[col.key] ?? '')}
										readonly={!(editingCell?.rowIndex === row.index && editingCell?.key === col.key)}
										ondblclick={(e) => {
											editingCell = { rowIndex: row.index, key: col.key };
											(e.target as HTMLInputElement).select();
										}}
										onblur={(e) => {
											saveCell(row.index, col.key, (e.target as HTMLInputElement).value);
											editingCell = null;
										}}
										onkeydown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
										onpaste={(e) => handleCellPaste(e, row.index, col.key)}
									/>
								</td>
							{/each}
							<td class="col-add-end"></td>
						</tr>
					{/each}
					{#if bottomSpacerHeight > 0}
						<tr class="virtual-spacer" style="height: {bottomSpacerHeight}px"><td colspan="999"></td></tr>
					{/if}
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

	/* Column header hover + selected states */
	thead th:not(.col-checkbox):not(.col-insert-zone):not(.col-add-end) {
		cursor: pointer;
	}

	thead th:not(.col-checkbox):not(.col-insert-zone):not(.col-add-end):not(.col-selected):hover {
		background: var(--color-surface-secondary);
	}

	thead th.col-selected {
		background: color-mix(in srgb, var(--color-accent) 8%, var(--color-surface-primary));
	}

	thead th.col-selected:hover {
		background: color-mix(in srgb, var(--color-accent) 14%, var(--color-surface-primary));
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
		cursor: pointer;
		width: 100%;
		min-width: 0;
		font-family: var(--font-mono);
		font-size: 12px;
		font-weight: 400;
		letter-spacing: 0.05em;
		color: var(--color-text-secondary);
		line-height: 18px;
	}

	.col-name-input:not([readonly]) {
		cursor: text;
	}

	.col-name-input:not([readonly]):focus {
		cursor: text;
		background: color-mix(in srgb, var(--color-accent) 10%, var(--color-surface-primary));
		outline: 1px solid var(--color-accent);
		outline-offset: 1px;
		border-radius: 2px;
	}

	tr.virtual-spacer td {
		border: none;
		padding: 0;
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

	.cell-input:not([readonly]):focus {
		cursor: text;
		background: color-mix(in srgb, var(--color-accent) 10%, var(--color-surface-primary));
		outline: 1px solid var(--color-accent);
		outline-offset: -1px;
	}

	/* ── Column insert zones ──────────────────────────────────────────── */

	th.col-insert-zone,
	td.col-insert-zone {
		width: 20px;
		min-width: 20px;
		padding: 0;
		position: relative;
	}

	th.col-insert-zone {
		overflow: visible;
		z-index: 2;
	}

	/* Vertical line: starts just below the + icon, extends down into the table body.
	   Anchored to the sticky th so it always covers the visible rows below the header. */
	th.col-insert-zone.hovered::before {
		content: '';
		position: absolute;
		left: 50%;
		top: calc(50% + 9px); /* bottom edge of the 18px + button */
		height: 300px;
		width: 1px;
		background: var(--color-text-tertiary);
		transform: translateX(-50%);
		pointer-events: none;
	}

	/* The hoverable + icon that sits centred in the header zone — no circle */
	.insert-col-btn {
		position: absolute;
		top: 50%;
		left: 50%;
		transform: translate(-50%, -50%);
		width: 18px;
		height: 18px;
		border: none;
		background: none;
		color: var(--color-text-tertiary);
		display: flex;
		align-items: center;
		justify-content: center;
		cursor: pointer;
		padding: 0;
		opacity: 0;
		pointer-events: none;
		transition: opacity 100ms ease;
		z-index: 20;
	}

	th.col-insert-zone.hovered .insert-col-btn {
		opacity: 1;
		pointer-events: auto;
	}

	/* ── Add-column button at the end of the header ───────────────────── */

	th.col-add-end,
	td.col-add-end {
		width: 40px;
		min-width: 40px;
		padding: 0;
		text-align: center;
		vertical-align: middle;
	}

	.add-col-btn {
		width: 24px;
		height: 24px;
		border-radius: var(--radius);
		border: none;
		background: none;
		color: var(--color-text-tertiary);
		cursor: pointer;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 0;
		transition: background 80ms ease, color 80ms ease;
	}

	.add-col-btn:hover {
		background: var(--color-surface-secondary);
		color: var(--color-text-primary);
	}

	/* ── Column body cell: hover + selected states ────────────────────── */
	/* These come after the row rules intentionally — same specificity,
	   source order ensures column state wins when both apply. */

	tbody td.col-hovered {
		background: var(--color-surface-secondary);
	}

	tbody td.col-selected {
		background: color-mix(in srgb, var(--color-accent) 8%, var(--color-surface-primary));
	}

	tbody td.col-selected.col-hovered {
		background: color-mix(in srgb, var(--color-accent) 14%, var(--color-surface-primary));
	}
</style>
