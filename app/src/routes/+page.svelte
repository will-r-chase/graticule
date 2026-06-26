<script lang="ts">
	import CatalogPanel from '$lib/components/catalog/CatalogPanel.svelte';
	import LayersPanel from '$lib/components/layers/LayersPanel.svelte';
	import MapCanvas from '$lib/components/map/MapCanvas.svelte';
	import UploadModal from '$lib/components/catalog/UploadModal.svelte';
	import { initCatalog } from '$lib/stores/catalog.svelte';
	import { parseFile, applyFixes, type UploadResult } from '$lib/utils/fileUpload';
	import { addUploadedDataset } from '$lib/stores/uploadedDatasets.svelte';
	import { undo, redo, canUndo, canRedo, pushSnapshot } from '$lib/stores/history.svelte';
	import { editSession, undoEdit, redoEdit } from '$lib/stores/editSession.svelte';
	import { toolState } from '$lib/stores/tool.svelte';
	import { drawSession, undoLastPoint } from '$lib/stores/drawSession.svelte';
	import { selection, clearSelection } from '$lib/stores/selection.svelte';
	import { layerSelection, clearLayerSelection, exitLayer } from '$lib/stores/layerSelection.svelte';
	import { layers, toggleVisibility, duplicateLayer, removeLayer, reorderLayers, addUploadedLayer } from '$lib/stores/layers.svelte';
	import { openFeaturesTable } from '$lib/stores/featuresTable.svelte';

	let { data } = $props();

	function moveSelectedLayersUp() {
		const newLayers = [...layers];
		const selectedIndices = layerSelection.ids
			.map(id => newLayers.findIndex(l => l.id === id))
			.filter(i => i !== -1)
			.sort((a, b) => a - b);
		if (selectedIndices.length === 0 || selectedIndices[0] === 0) return;
		for (const idx of selectedIndices) {
			[newLayers[idx], newLayers[idx - 1]] = [newLayers[idx - 1], newLayers[idx]];
		}
		reorderLayers(newLayers);
		pushSnapshot();
	}

	function moveSelectedLayersDown() {
		const newLayers = [...layers];
		const selectedIndices = layerSelection.ids
			.map(id => newLayers.findIndex(l => l.id === id))
			.filter(i => i !== -1)
			.sort((a, b) => b - a);
		if (selectedIndices.length === 0 || selectedIndices[0] === newLayers.length - 1) return;
		for (const idx of selectedIndices) {
			[newLayers[idx], newLayers[idx + 1]] = [newLayers[idx + 1], newLayers[idx]];
		}
		reorderLayers(newLayers);
		pushSnapshot();
	}

	function handleKeydown(e: KeyboardEvent) {
		const _t = e.target as HTMLInputElement;
		if (_t.closest('textarea') || (_t.closest('input') && _t.type !== 'range')) return;
		if (e.key === 'Escape') {
			if (selection.features.size > 0) {
				clearSelection();
			} else if (layerSelection.enteredId !== null) {
				exitLayer();
			} else if (layerSelection.ids.length > 0) {
				clearLayerSelection();
			}
			return;
		}
		if (layerSelection.ids.length > 0) {
			if (e.key === 't') {
				const firstId = layerSelection.ids[0];
				const layer = layers.find(l => l.id === firstId && l.hasTopology);
				if (layer) openFeaturesTable(layer.id);
				return;
			}
			if (e.key === 'h') {
				for (const id of layerSelection.ids) toggleVisibility(id);
				pushSnapshot();
				return;
			}
			if (e.key === '[') {
				moveSelectedLayersUp();
				return;
			}
			if (e.key === ']') {
				moveSelectedLayersDown();
				return;
			}
			if (e.key === 'd' && (e.metaKey || e.ctrlKey)) {
				e.preventDefault();
				for (const id of layerSelection.ids) duplicateLayer(id);
				pushSnapshot();
				return;
			}
			if (e.key === 'Backspace' && (e.metaKey || e.ctrlKey) && !editSession.activeLayerId) {
				e.preventDefault();
				for (const id of [...layerSelection.ids]) removeLayer(id);
				clearLayerSelection();
				pushSnapshot();
				return;
			}
		}
		if (e.key === 'z' && (e.metaKey || e.ctrlKey)) {
			e.preventDefault();
			// While editing, Ctrl/Cmd+Z drives the session-local per-vertex undo, leaving
			// the global history untouched until the session commits.
			if (editSession.activeLayerId) {
				if (e.shiftKey) redoEdit();
				else            undoEdit();
			} else if (toolState.active === 'draw' && drawSession.count > 0) {
				// While drawing, Cmd+Z removes the last placed point (session-local), leaving
				// global history untouched until the session commits.
				if (!e.shiftKey) undoLastPoint();
			} else if (e.shiftKey) { if (canRedo()) redo(); }
			else                   { if (canUndo()) undo(); }
		}
	}

	initCatalog(data.catalog.baseUrl, data.catalog.datasets);
	pushSnapshot(); // capture initial empty state so the first action is undoable

	// Upload modal state
	let uploadOpen = $state(false);
	let uploadInitialFile = $state<File | null>(null);
	let uploadInitialResult = $state<UploadResult | null>(null);

	function openUploadModal(file: File | null = null, result: UploadResult | null = null) {
		uploadInitialFile = file;
		uploadInitialResult = result;
		uploadOpen = true;
	}

	function closeUploadModal() {
		uploadOpen = false;
		uploadInitialFile = null;
		uploadInitialResult = null;
	}

	function needsModal(result: UploadResult): boolean {
		return !result.canProceed || result.issues.length > 0 || result.hasMixedGeometries || !!result.csvColumns;
	}

	// Drag-and-drop
	let dragDepth = $state(0);
	let isDragging = $derived(dragDepth > 0);

	function onDragEnter(e: DragEvent) {
		if (e.dataTransfer?.types.includes('Files')) dragDepth++;
	}

	function onDragLeave() {
		dragDepth = Math.max(0, dragDepth - 1);
	}

	function onDragOver(e: DragEvent) {
		e.preventDefault();
	}

	async function onDrop(e: DragEvent) {
		e.preventDefault();
		dragDepth = 0;

		const file = e.dataTransfer?.files[0];
		if (!file) return;

		const result = await parseFile(file);

		if (needsModal(result)) {
			openUploadModal(file, result);
		} else {
			const collections = applyFixes(result, {});
			for (const fc of collections) {
				const name = file.name.replace(/\.[^.]+$/, '');
				const dataset = addUploadedDataset(name, fc);
				addUploadedLayer(name, fc, dataset.id);
			}
		}
	}
</script>

<svelte:window onkeydown={handleKeydown} />

<div
	class="workspace"
	class:dragging={isDragging}
	ondragenter={onDragEnter}
	ondragleave={onDragLeave}
	ondragover={onDragOver}
	ondrop={onDrop}
	role="region"
	aria-label="Map workspace"
>
	<CatalogPanel datasets={data.catalog.datasets} onOpenUpload={() => openUploadModal()} />
	<MapCanvas />
	<LayersPanel />

	{#if isDragging}
		<div class="drop-overlay">
			<span class="drop-label mono-small">Drop to import</span>
		</div>
	{/if}

	{#if uploadOpen}
		<UploadModal
			onclose={closeUploadModal}
			initialFile={uploadInitialFile}
			initialResult={uploadInitialResult}
		/>
	{/if}
</div>

<style>
	.workspace {
		display: flex;
		height: 100%;
		position: relative;
	}

	.drop-overlay {
		position: absolute;
		inset: 0;
		background: color-mix(in srgb, var(--color-accent) 12%, transparent);
		border: 2px dashed var(--color-accent);
		border-radius: var(--radius);
		display: flex;
		align-items: center;
		justify-content: center;
		pointer-events: none;
		z-index: 50;
	}

	.drop-label {
		color: var(--color-accent);
		background: var(--color-surface-primary);
		padding: var(--space-s) var(--space-l);
		border-radius: var(--radius);
		border: 1px solid var(--color-accent);
	}
</style>
