import { layers, runLayerPipeline } from './layers.svelte';
import { projection } from './projection.svelte';
import { background } from './background.svelte';
import type { LayerStyle, LayerProcessing } from '$lib/types';

const MAX_HISTORY = 50;

// ---------------------------------------------------------------------------
// Snapshot types
// ---------------------------------------------------------------------------

interface SnapshotLayer {
	id: string;
	datasetId: string;
	name: string;
	visible: boolean;
	style: LayerStyle;
	processing: LayerProcessing;
	geometryTypes: string[];
	hasTopology: boolean;
	loading: boolean;
	error: string | null;
}

interface Snapshot {
	layers: SnapshotLayer[];
	projectionId: string;
	bgHex: string;
	bgAlpha: number;
}

// ---------------------------------------------------------------------------
// Capture / restore helpers
// ---------------------------------------------------------------------------

function capture(): Snapshot {
	return {
		layers: layers.map((l) => ({
			id: l.id,
			datasetId: l.datasetId,
			name: l.name,
			visible: l.visible,
			style: { ...l.style },
			processing: { ...l.processing },
			geometryTypes: [...l.geometryTypes],
			hasTopology: l.hasTopology,
			loading: l.loading,
			error: l.error,
		})),
		projectionId: projection.id,
		bgHex: background.hex,
		bgAlpha: background.alpha,
	};
}

function restore(snapshot: Snapshot): void {
	// Splice layers in place to keep the reactive reference intact.
	// processing is spread explicitly so later Object.assign calls in
	// updateLayerProcessing don't mutate the snapshot through a shared reference.
	// hasTopology is forced to false so the pathCache effect drops the stale
	// entry; runLayerPipeline below will set it back to true once the working
	// topology is rebuilt from the restored processing settings.
	layers.splice(
		0,
		layers.length,
		...snapshot.layers.map((sl) => ({
			...sl,
			style: { ...sl.style },
			processing: { ...sl.processing },
			geometryTypes: [...sl.geometryTypes],
			hasTopology: false,
			loading: sl.hasTopology,
		}))
	);
	projection.id = snapshot.projectionId;
	background.hex = snapshot.bgHex;
	background.alpha = snapshot.bgAlpha;

	// Re-run the pipeline for every layer that had data in the snapshot so
	// workingTopologyData reflects the restored processing settings.
	for (const sl of snapshot.layers) {
		if (sl.hasTopology) {
			runLayerPipeline(sl.id, false);
		}
	}
}

// ---------------------------------------------------------------------------
// Stack state
// ---------------------------------------------------------------------------

let stack = $state<Snapshot[]>([]);
let pointer = $state(-1);
let version = $state(0); // incremented on every undo/redo so consumers can key off it

export function canUndo() { return pointer > 0; }
export function canRedo() { return pointer < stack.length - 1; }
export function historyVersion() { return version; }

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

// Call this AFTER each committed action with the resulting state.
// Clears the redo tail, deduplicates, and caps the stack at MAX_HISTORY.
export function pushSnapshot(): void {
	const snap = capture();

	// Clear redo tail — any future that existed is now abandoned.
	if (pointer < stack.length - 1) {
		stack.splice(pointer + 1);
	}

	// Deduplicate — skip if nothing actually changed.
	if (pointer >= 0 && JSON.stringify(snap) === JSON.stringify(stack[pointer])) return;

	stack.push(snap);

	// Keep the stack capped, dropping the oldest entries first.
	if (stack.length > MAX_HISTORY) {
		stack.splice(0, stack.length - MAX_HISTORY);
	}

	pointer = stack.length - 1;
}

export function undo(): void {
	if (pointer <= 0) return;
	// If there are uncommitted changes (e.g. color picker mid-drag), capture them first.
	// We check manually rather than calling pushSnapshot() unconditionally because
	// pushSnapshot clears the redo tail before deduplicating — which would wipe future
	// snapshots on every sequential undo even when nothing changed.
	// Skip this check while any layer is loading: restore() temporarily sets
	// hasTopology=false while the pipeline re-runs, and capturing that transient
	// state would push a ghost snapshot with broken layer data.
	const anyLoading = layers.some((l) => l.loading);
	if (!anyLoading) {
		const current = capture();
		if (JSON.stringify(current) !== JSON.stringify(stack[pointer])) {
			pushSnapshot();
		}
	}
	pointer--;
	restore(stack[pointer]);
	version++;
}

export function redo(): void {
	if (pointer >= stack.length - 1) return;
	pointer++;
	restore(stack[pointer]);
	version++;
}

// Call on New / Open to reset the stack for the new session.
export function clearHistory(): void {
	stack.splice(0, stack.length);
	pointer = -1;
}
