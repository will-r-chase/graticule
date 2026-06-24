import { layers, runLayerPipeline, pruneRawTopology } from './layers.svelte';
import { pruneUploadedDatasets } from './uploadedDatasets.svelte';
import { projection } from './projection.svelte';
import { canvasStyles } from './canvasStyles.svelte';
import type { LayerStyle, LayerProcessing } from '$lib/types';

const MAX_HISTORY = 50;

// ---------------------------------------------------------------------------
// Snapshot types
// ---------------------------------------------------------------------------

interface SnapshotLayer {
	id: string;
	geometryId: string;
	geometryEdited: boolean;
	datasetId: string;
	name: string;
	visible: boolean;
	style: LayerStyle;
	processing: LayerProcessing;
	geometryTypes: string[];
	hasTopology: boolean;
	error: string | null;
	bezierCacheKey: number;
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
			geometryId: l.geometryId,
			geometryEdited: l.geometryEdited,
			datasetId: l.datasetId,
			name: l.name,
			visible: l.visible,
			style: { ...l.style },
			processing: { ...l.processing },
			geometryTypes: [...l.geometryTypes],
			hasTopology: l.hasTopology,
			error: l.error,
			bezierCacheKey: l.bezierCacheKey,
		})),
		projectionId: projection.id,
		bgHex: canvasStyles.background.hex,
		bgAlpha: canvasStyles.background.alpha,
	};
}

// Bezier is a live render from working geometry (rebuilt by the path cache on bezierCacheKey
// change), not part of the topology pipeline — so bezier-only changes never need a re-derive.
const BEZIER_KEYS = [
	'bezierEnabled', 'bezierCurveType', 'bezierTension', 'bezierAlpha', 'bezierContinuity', 'bezierBias',
] as const;

// Signature of the pipeline-affecting (simplification + Chaikin) processing fields. Two
// layers with the same geometryId and the same signature already share working geometry.
function pipelineSig(p: LayerProcessing): string {
	const o: Record<string, unknown> = { ...p };
	for (const k of BEZIER_KEYS) delete o[k];
	return JSON.stringify(o);
}

function restore(snapshot: Snapshot): void {
	// A restored layer can keep its on-screen geometry — no hasTopology blank, no pipeline
	// re-run — when it still exists with the same geometry version and the same pipeline
	// processing. This makes undo/redo of pure metadata (and bezier-only) changes instant
	// instead of re-deriving every layer. Geometry-affecting changes still re-derive.
	const currentById = new Map(layers.map((l) => [l.id, l]));
	const plans = snapshot.layers.map((sl) => {
		const cur = currentById.get(sl.id);
		const keepGeometry =
			!!cur &&
			cur.hasTopology &&
			cur.geometryId === sl.geometryId &&
			pipelineSig(cur.processing) === pipelineSig(sl.processing);
		return { sl, keepGeometry };
	});

	// Splice layers in place to keep the reactive reference intact. processing is spread
	// explicitly so later Object.assign calls in updateLayerProcessing don't mutate the
	// snapshot through a shared reference. For re-derived layers hasTopology is forced false
	// so the pathCache drops the stale entry; runLayerPipeline below restores it.
	layers.splice(
		0,
		layers.length,
		...plans.map(({ sl, keepGeometry }) => ({
			...sl,
			style: { ...sl.style },
			processing: { ...sl.processing },
			geometryTypes: [...sl.geometryTypes],
			hasTopology: keepGeometry,
			loading: keepGeometry ? false : sl.hasTopology,
			bezierCacheKey: sl.bezierCacheKey ?? 0,
		}))
	);
	projection.id = snapshot.projectionId;
	canvasStyles.background.hex = snapshot.bgHex;
	canvasStyles.background.alpha = snapshot.bgAlpha;

	// Re-derive only the layers whose geometry actually changed (and that had data).
	for (const { sl, keepGeometry } of plans) {
		if (!keepGeometry && sl.hasTopology) {
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

// Every geometryId referenced by a live layer or any stacked snapshot. Raw geometry outside
// this set is orphaned and can be freed — see pruneRawTopology.
function liveGeometryIds(): Set<string> {
	const ids = new Set<string>();
	for (const l of layers) ids.add(l.geometryId);
	for (const snap of stack) for (const sl of snap.layers) ids.add(sl.geometryId);
	return ids;
}

// Call this AFTER each committed action with the resulting state.
// Clears the redo tail, deduplicates, and caps the stack at MAX_HISTORY.
export function pushSnapshot(): void {
	const snap = capture();

	// Clear redo tail — any future that existed is now abandoned.
	if (pointer < stack.length - 1) {
		stack.splice(pointer + 1);
	}

	// Deduplicate — skip pushing if nothing actually changed (but the redo tail was still
	// cleared above, so we always GC below).
	const isDuplicate = pointer >= 0 && JSON.stringify(snap) === JSON.stringify(stack[pointer]);
	if (!isDuplicate) {
		stack.push(snap);

		// Keep the stack capped, dropping the oldest entries first.
		if (stack.length > MAX_HISTORY) {
			stack.splice(0, stack.length - MAX_HISTORY);
		}

		pointer = stack.length - 1;
	}

	// Dropping the redo tail and/or capping the stack can orphan raw geometry versions.
	pruneRawTopology(liveGeometryIds());
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
	pruneUploadedDatasets(new Set(layers.map((l) => l.datasetId)));
	version++;
}

export function redo(): void {
	if (pointer >= stack.length - 1) return;
	pointer++;
	restore(stack[pointer]);
	pruneUploadedDatasets(new Set(layers.map((l) => l.datasetId)));
	version++;
}

// Call on New / Open to reset the stack for the new session.
export function clearHistory(): void {
	stack.splice(0, stack.length);
	pointer = -1;
	// No snapshots left — keep only raw still referenced by current layers.
	pruneRawTopology(liveGeometryIds());
}
