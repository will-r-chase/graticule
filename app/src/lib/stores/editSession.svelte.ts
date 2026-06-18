import type { Topology } from 'topojson-specification';
import { layers, workingTopologyData, bakeLayerForEdit, commitEditedLayer } from './layers.svelte';
import { selectFeature, clearSelection } from './selection.svelte';
import { pushSnapshot } from './history.svelte';
import { showToast } from './toast.svelte';
import { topologyToAbsolute, buildNodeMap, buildArcToFeatures, coordKey, type NodeRef } from '$lib/utils/topology';

// Edit-session state for the vertex-editing tool.
//
// Two sub-states inside the edit tool:
//   - Targeting: activeLayerId === null. Hover/click to pick a feature to edit.
//   - Active draft: activeLayerId set. Editing one layer's draft geometry.
//
// The draft topology and node map are HEAVY (every coordinate) and must NOT live in
// $state — Svelte would deep-proxy and traverse them on every reactive read, exactly
// like the topology caches in layers.svelte.ts. So they're plain module variables;
// only small flags are reactive.

// Reactive, lightweight session flags.
export const editSession = $state<{
	activeLayerId: string | null;
	featureIndex: number;
	edited: boolean;
	// Bumped on every draft mutation so the (non-reactive) draft's repaint can be
	// triggered — the draw loop reads this to know it must redraw from the draft.
	version: number;
	// When set, a bake-confirmation dialog is open for a processed layer.
	pendingBake: { layerId: string; featureIndex: number } | null;
}>({ activeLayerId: null, featureIndex: -1, edited: false, version: 0, pendingBake: null });

// Heavy data — kept outside $state on purpose.
let draft: Topology | null = null;
let nodeMap: Map<string, NodeRef[]> | null = null;
// arc index → feature indices referencing it, and the set of features edited so far.
// Only "dirty" features need live re-rendering from the draft; the rest of the edit
// layer can be drawn from its (still-valid) path cache.
let arcToFeatures: Map<number, number[]> | null = null;
let dirtyFeatures = new Set<number>();

// Session-local undo/redo of individual vertex operations, independent of the global
// history. On commit the whole session collapses into one global snapshot.
// A move op carries one sub-move per dragged vertex (a group drag moves several at once).
interface SubMove { targets: VertexPos[]; from: [number, number]; to: [number, number] }
interface RemovedVertex { arcIndex: number; atIndex: number; coord: [number, number] }
type EditOp =
	| { type: 'move'; moves: SubMove[] }
	| { type: 'insert'; arcIndex: number; atIndex: number; coord: [number, number] }
	| { type: 'delete'; removed: RemovedVertex[] };
let undoStack: EditOp[] = [];
let redoStack: EditOp[] = [];

// Session-local vertex selection — a set of "arcIndex:vertexIndex" representative keys.
// Cleared on feature swap, structural edits (insert/delete), and undo/redo, since those
// shift indices. Kept outside $state; selection changes bump editSession.version to repaint.
let vertexSelection = new Set<string>();
const vKey = (arcIndex: number, vertexIndex: number) => `${arcIndex}:${vertexIndex}`;

export function getDraft(): Topology | null {
	return draft;
}
export function getNodeMap(): Map<string, NodeRef[]> | null {
	return nodeMap;
}

export function getDirtyFeatures(): Set<number> {
	return dirtyFeatures;
}

// Marks every feature touched by the given vertex targets dirty (the targeted feature
// plus any neighbour sharing a moved arc), so they re-render from the draft.
function markDirty(targets: VertexPos[]): void {
	if (!arcToFeatures) return;
	for (const { arcIndex } of targets) {
		const fs = arcToFeatures.get(arcIndex);
		if (fs) for (const f of fs) dirtyFeatures.add(f);
	}
}

export interface VertexPos {
	arcIndex: number;
	vertexIndex: number;
}

// Given a grabbed vertex, returns every (arcIndex, vertexIndex) that must move with it.
// Interior vertices move alone; a shared arc endpoint (node) moves all arcs meeting there
// so connected borders stay connected.
export function vertexDragTargets(arcIndex: number, vertexIndex: number): VertexPos[] {
	const solo = [{ arcIndex, vertexIndex }];
	if (!draft) return solo;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const arcs = (draft as any).arcs as number[][][];
	const arc = arcs[arcIndex];
	if (!arc) return solo;

	const isEndpoint = vertexIndex === 0 || vertexIndex === arc.length - 1;
	if (!isEndpoint || !nodeMap) return solo;

	const refs = nodeMap.get(coordKey(arc[vertexIndex]));
	if (!refs || refs.length <= 1) return solo;
	return refs.map((ref) => ({
		arcIndex: ref.arcIndex,
		vertexIndex: ref.end === 'start' ? 0 : arcs[ref.arcIndex].length - 1,
	}));
}

// Moves all given vertex positions to the same geographic coordinate (so a dragged node
// keeps its shared endpoints coincident). Marks the session edited and triggers a repaint.
export function moveVertices(targets: VertexPos[], lon: number, lat: number): void {
	if (!draft) return;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const arcs = (draft as any).arcs as number[][][];
	for (const { arcIndex, vertexIndex } of targets) {
		const arc = arcs[arcIndex];
		if (arc && arc[vertexIndex]) arc[vertexIndex] = [lon, lat];
	}
	markDirty(targets);
	editSession.edited = true;
	editSession.version++;
}

// Rebuilds the node map after a node move so its keys reflect the new endpoint coords.
export function rebuildNodeMap(): void {
	if (draft) nodeMap = buildNodeMap(draft);
}

// Writes one coordinate to every target position (used by undo/redo to replay a move).
function applyMove(targets: VertexPos[], coord: [number, number]): void {
	if (!draft) return;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const arcs = (draft as any).arcs as number[][][];
	for (const { arcIndex, vertexIndex } of targets) {
		const arc = arcs[arcIndex];
		if (arc && arc[vertexIndex]) arc[vertexIndex] = [coord[0], coord[1]];
	}
	markDirty(targets);
}

// A drag member: the targets to move (node fan-out) and the vertex's pre-drag coordinate.
export interface DragMember { targets: VertexPos[]; orig: [number, number] }

// Live drag: translates every member by the same geographic delta from its origin. The
// grabbed vertex's delta makes it follow the cursor; others keep their relative offsets.
export function translateGroup(group: DragMember[], dLon: number, dLat: number): void {
	for (const m of group) applyMove(m.targets, [m.orig[0] + dLon, m.orig[1] + dLat]);
	editSession.edited = true;
	editSession.version++;
}

// Records a completed (possibly group) drag as one undoable op. Members that didn't move
// are dropped; if nothing moved, no op is pushed.
export function recordMoves(group: DragMember[]): void {
	if (!draft || group.length === 0) return;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const arcs = (draft as any).arcs as number[][][];
	const moves: SubMove[] = [];
	for (const m of group) {
		const t0 = m.targets[0];
		const cur = arcs[t0.arcIndex]?.[t0.vertexIndex];
		if (!cur) continue;
		const to: [number, number] = [cur[0], cur[1]];
		if (m.orig[0] === to[0] && m.orig[1] === to[1]) continue;
		moves.push({ targets: m.targets, from: m.orig, to });
	}
	if (moves.length === 0) return;
	undoStack.push({ type: 'move', moves });
	redoStack.length = 0;
}

// --- Vertex selection -------------------------------------------------------
export function getSelectedVertexKeys(): Set<string> { return vertexSelection; }
export function getSelectedVertices(): VertexPos[] {
	return [...vertexSelection].map((k) => {
		const [a, v] = k.split(':');
		return { arcIndex: +a, vertexIndex: +v };
	});
}
export function isVertexSelected(arcIndex: number, vertexIndex: number): boolean {
	return vertexSelection.has(vKey(arcIndex, vertexIndex));
}
export function selectVertex(arcIndex: number, vertexIndex: number): void {
	vertexSelection = new Set([vKey(arcIndex, vertexIndex)]);
	editSession.version++;
}
export function toggleVertex(arcIndex: number, vertexIndex: number): void {
	const k = vKey(arcIndex, vertexIndex);
	if (vertexSelection.has(k)) vertexSelection.delete(k);
	else vertexSelection.add(k);
	editSession.version++;
}
export function clearVertexSelection(): void {
	if (vertexSelection.size === 0) return;
	vertexSelection = new Set();
	editSession.version++;
}

// Deletes the selected vertices. Only INTERIOR vertices can be removed — endpoints are
// shared nodes / junctions whose removal would require merging arcs (out of scope). Arcs
// are never reduced below MIN_ARC_POINTS so rings stay valid. One undo reverts the batch.
const MIN_ARC_POINTS = 4;
export function deleteSelectedVertices(): void {
	if (!draft) return;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const arcs = (draft as any).arcs as number[][][];
	const sel = getSelectedVertices();
	if (sel.length === 0) return;

	// Group selected indices per arc; an endpoint (index 0 or last) is a node — skip it.
	const byArc = new Map<number, number[]>();
	let nodeSkipped = 0;
	for (const v of sel) {
		const arc = arcs[v.arcIndex];
		if (!arc) continue;
		if (v.vertexIndex <= 0 || v.vertexIndex >= arc.length - 1) { nodeSkipped++; continue; }
		const list = byArc.get(v.arcIndex) ?? [];
		list.push(v.vertexIndex);
		byArc.set(v.arcIndex, list);
	}

	const removed: RemovedVertex[] = [];
	let degenerateSkipped = 0;
	for (const [arcIndex, idxs] of byArc) {
		const arc = arcs[arcIndex];
		if (!arc) continue;
		// Splice high-to-low so earlier indices stay valid as we remove.
		idxs.sort((a, b) => b - a);
		for (const vi of idxs) {
			if (arc.length <= MIN_ARC_POINTS) { degenerateSkipped++; continue; }
			const c = arc[vi];
			removed.push({ arcIndex, atIndex: vi, coord: [c[0], c[1]] });
			arc.splice(vi, 1);
			markDirty([{ arcIndex, vertexIndex: vi }]);
		}
	}

	if (removed.length > 0) {
		undoStack.push({ type: 'delete', removed });
		redoStack.length = 0;
		editSession.edited = true;
	}

	if (nodeSkipped > 0) {
		showToast('Junction vertices can’t be deleted — only interior points can be removed.', 5000);
	} else if (degenerateSkipped > 0 && removed.length === 0) {
		showToast('Can’t delete — a shape needs at least three points.', 5000);
	}

	vertexSelection = new Set();
	rebuildNodeMap();
	editSession.version++;
}

// Splices a new vertex into an arc (no history push — used live during an insert-drag
// and by redo). Inserting mid-arc only ever creates an interior vertex, never a node.
function spliceVertex(arcIndex: number, atIndex: number, coord: [number, number]): void {
	if (!draft) return;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const arc = ((draft as any).arcs as number[][][])[arcIndex];
	if (!arc) return;
	arc.splice(atIndex, 0, [coord[0], coord[1]]);
	markDirty([{ arcIndex, vertexIndex: atIndex }]);
}

function unspliceVertex(arcIndex: number, atIndex: number): void {
	if (!draft) return;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const arc = ((draft as any).arcs as number[][][])[arcIndex];
	if (!arc) return;
	arc.splice(atIndex, 1);
	markDirty([{ arcIndex, vertexIndex: atIndex }]);
}

// Inserts a vertex live (for an insert-drag preview). The op isn't recorded until
// commitInsert, so the insert + its placement collapse into one undo step.
export function beginInsert(arcIndex: number, atIndex: number, coord: [number, number]): void {
	clearVertexSelection(); // indices shift on insert
	spliceVertex(arcIndex, atIndex, coord);
	editSession.edited = true;
	editSession.version++;
}

// Records the just-inserted (and possibly dragged) vertex as a single insert op.
export function commitInsert(arcIndex: number, atIndex: number): void {
	if (!draft) return;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const cur = ((draft as any).arcs as number[][][])[arcIndex]?.[atIndex];
	if (!cur) return;
	undoStack.push({ type: 'insert', arcIndex, atIndex, coord: [cur[0], cur[1]] });
	redoStack.length = 0;
}

export function undoEdit(): void {
	const op = undoStack.pop();
	if (!op) return;
	if (op.type === 'move') for (const m of op.moves) applyMove(m.targets, m.from);
	else if (op.type === 'insert') unspliceVertex(op.arcIndex, op.atIndex);
	else {
		// Delete undo — re-insert ascending so each lands at its original index.
		for (const r of [...op.removed].sort((a, b) => a.atIndex - b.atIndex)) {
			spliceVertex(r.arcIndex, r.atIndex, r.coord);
		}
	}
	redoStack.push(op);
	clearVertexSelection();
	rebuildNodeMap();
	editSession.edited = undoStack.length > 0;
	editSession.version++;
}

export function redoEdit(): void {
	const op = redoStack.pop();
	if (!op) return;
	if (op.type === 'move') for (const m of op.moves) applyMove(m.targets, m.to);
	else if (op.type === 'insert') spliceVertex(op.arcIndex, op.atIndex, op.coord);
	else {
		// Delete redo — remove descending so indices stay valid.
		for (const r of [...op.removed].sort((a, b) => b.atIndex - a.atIndex)) {
			unspliceVertex(r.arcIndex, r.atIndex);
		}
	}
	undoStack.push(op);
	clearVertexSelection();
	rebuildNodeMap();
	editSession.edited = true;
	editSession.version++;
}

// Builds the absolute-coordinate draft + node map from the layer's working geometry
// (what's on screen) and enters the active-draft sub-state.
function enter(layerId: string, featureIndex: number): void {
	const working = workingTopologyData.get(layerId);
	if (!working) {
		console.warn('[editSession] enter() aborted: no working topology for layer', layerId);
		return;
	}
	draft = topologyToAbsolute(working);
	nodeMap = buildNodeMap(draft);
	arcToFeatures = buildArcToFeatures(draft);
	dirtyFeatures = new Set();
	vertexSelection = new Set();
	undoStack = [];
	redoStack = [];
	editSession.activeLayerId = layerId;
	editSession.featureIndex = featureIndex;
	editSession.edited = false;
}

// Entry point from the targeting sub-state (double-click or the Edit button).
export function startEditing(layerId: string, featureIndex: number): void {
	// Already editing this same layer — just retarget the feature (in-layer swap).
	if (editSession.activeLayerId === layerId) {
		if (editSession.featureIndex !== featureIndex) clearVertexSelection();
		editSession.featureIndex = featureIndex;
		return;
	}
	// Editing a different layer — leave that session first.
	if (editSession.activeLayerId !== null) exitEditing();

	const layer = layers.find((l) => l.id === layerId);
	if (!layer) return;

	// Processed layers (simplified/smoothed) must be baked before editing so the user
	// edits exactly what they see. Defer the bake to this first real edit action.
	const processed = layer.processing.simpEnabled || layer.processing.chaikinEnabled;
	if (processed) {
		editSession.pendingBake = { layerId, featureIndex };
	} else {
		enter(layerId, featureIndex);
	}
}

export function confirmBake(): void {
	const pending = editSession.pendingBake;
	if (!pending) return;
	editSession.pendingBake = null;
	const { featureIndex } = pending;
	// Bake duplicates the layer (geometry baked in, processing reset) and hands back the
	// new id once its pipeline is ready. The duplicate is a committed action, so it gets
	// its own history snapshot; we then edit the duplicate (now an unprocessed layer).
	bakeLayerForEdit(pending.layerId, (newId) => {
		selectFeature(newId, featureIndex, false);
		enter(newId, featureIndex);
		pushSnapshot();
	});
}

export function cancelBake(): void {
	editSession.pendingBake = null;
}

// Clears all session state (reactive flags + heavy draft/nodeMap) and the stale selection.
function clearSession(): void {
	draft = null;
	nodeMap = null;
	arcToFeatures = null;
	dirtyFeatures = new Set();
	vertexSelection = new Set();
	undoStack = [];
	redoStack = [];
	editSession.activeLayerId = null;
	editSession.featureIndex = -1;
	editSession.edited = false;
	clearSelection();
}

// Leaves the active-draft sub-state, COMMITTING the draft as a new layer (with a history
// snapshot) if any vertex was moved. An untouched session is just discarded — no new
// layer, no history. Used by Done, Esc, tool-switch, and double-click-to-empty.
export function exitEditing(): void {
	const layerId = editSession.activeLayerId;
	const wasEdited = editSession.edited;
	const committedDraft = draft;
	clearSession();
	if (layerId && wasEdited && committedDraft) {
		commitEditedLayer(layerId, committedDraft, () => pushSnapshot());
	}
}

// Discards the in-session vertex edits without committing — the layer reverts to its
// pre-edit geometry. (For a baked layer the duplicate itself remains; the bake was a
// separate committed action and is removed via undo.)
export function cancelEditing(): void {
	clearSession();
}
