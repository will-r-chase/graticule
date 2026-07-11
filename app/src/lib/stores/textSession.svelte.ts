// Text-session state for the text tool (docs/labels-plan.md, step 3).
//
// Mirrors drawSession's shape: growable data lives OUTSIDE $state as plain module
// variables, small reactive flags live in $state, and `version` bumps on every
// mutation so MapCanvas repaints. The session holds two kinds of work, committed
// together as one undoable batch:
//   - NEW text boxes headed for the target text layer (ghosts until commit)
//   - EDITS to existing labels: per-layer move/delete maps that the label painter
//     consults live, applied via replaceLayerGeometry on commit (one mint per layer)

import { layers, workingTopologyData, commitTextFeatures, applyLabelEdits } from './layers.svelte';
import { selectLayer } from './layerSelection.svelte';
import { pushSnapshot } from './history.svelte';

export interface NewTextFeature {
	coord: [number, number]; // lon/lat
	text: string;
	rotation?: number; // degrees clockwise; absent = 0
	wrapWidth?: number; // px; absent = no auto-wrap
}

// What the text tool has selected: an existing label (by layer + feature index) or an
// uncommitted new box (by index into newFeatures).
export type TextSelection =
	| { kind: 'existing'; layerId: string; featureIndex: number }
	| { kind: 'new'; index: number };

// New boxes placed this session, in placement order. Plain array, not $state.
let newFeatures: NewTextFeature[] = [];

// Edits to existing labels, keyed by layer id then feature index (indices are into the
// layer's CURRENT working topology — stable during the session; commit re-indexes).
let moves = new Map<string, Map<number, [number, number]>>();
// Curved (line-geometry) labels move by a lon/lat DELTA applied to every vertex,
// not an absolute coord — the whole line translates, keeping its shape.
let lineMoves = new Map<string, Map<number, [number, number]>>();
let deletes = new Map<string, Set<number>>();
let textEdits = new Map<string, Map<number, string>>();
let rotations = new Map<string, Map<number, number>>();
let wrapWidths = new Map<string, Map<number, number>>();

// When the inline editor closes it records the time; MapCanvas uses this so the
// canvas click that dismissed the editor doesn't also place a new box.
let editorClosedAt = 0;
export function editorJustClosed(): boolean {
	return Date.now() - editorClosedAt < 250;
}

export const textSession = $state<{
	// Bumped on every mutation so MapCanvas repaints from the (non-reactive) data.
	version: number;
	// Reactive counts for guards / bar state.
	newCount: number;
	editCount: number;
	// Index into newFeatures currently in the inline editor, or null.
	editingNew: number | null;
	// Existing label currently in the inline editor, or null. coord/initialText are
	// captured when editing begins (the painter skips this label; the editor shows it).
	editingExisting: { layerId: string; featureIndex: number; coord: [number, number]; initialText: string } | null;
	// Current selection (click target for drag/delete), or null.
	selected: TextSelection | null;
	// Target for NEW boxes. Follows the layers-panel selection (a selected label layer
	// is the target — synced by MapCanvas); null = a new "Text" layer, created on commit.
	targetLayerId: string | null;
}>({ version: 0, newCount: 0, editCount: 0, editingNew: null, editingExisting: null, selected: null, targetLayerId: null });

export function getNewTextFeatures(): readonly NewTextFeature[] {
	return newFeatures;
}

// Live overrides for the label painter: a session-moved coordinate, or deletion.
export function sessionMovedCoord(layerId: string, featureIndex: number): [number, number] | null {
	return moves.get(layerId)?.get(featureIndex) ?? null;
}
export function sessionLineDelta(layerId: string, featureIndex: number): [number, number] | null {
	return lineMoves.get(layerId)?.get(featureIndex) ?? null;
}
export function sessionDeleted(layerId: string, featureIndex: number): boolean {
	return deletes.get(layerId)?.has(featureIndex) ?? false;
}
export function sessionTextOverride(layerId: string, featureIndex: number): string | null {
	return textEdits.get(layerId)?.get(featureIndex) ?? null;
}
export function sessionRotationOverride(layerId: string, featureIndex: number): number | null {
	return rotations.get(layerId)?.get(featureIndex) ?? null;
}
export function sessionWrapOverride(layerId: string, featureIndex: number): number | null {
	return wrapWidths.get(layerId)?.get(featureIndex) ?? null;
}

function bump(): void {
	textSession.newCount = newFeatures.length;
	let edits = 0;
	for (const m of moves.values()) edits += m.size;
	for (const m of lineMoves.values()) edits += m.size;
	for (const s of deletes.values()) edits += s.size;
	for (const t of textEdits.values()) edits += t.size;
	for (const r of rotations.values()) edits += r.size;
	for (const w of wrapWidths.values()) edits += w.size;
	textSession.editCount = edits;
	textSession.version++;
}

// Places a new text box and opens it in the inline editor.
export function placeText(lon: number, lat: number): void {
	newFeatures.push({ coord: [lon, lat], text: '' });
	textSession.editingNew = newFeatures.length - 1;
	bump();
}

// Live text updates from the inline editor.
export function updateNewText(index: number, text: string): void {
	const f = newFeatures[index];
	if (!f) return;
	f.text = text;
	bump();
}

// Closes the inline editor; a box that ends empty is discarded (never committed).
export function finishEditingNew(): void {
	const i = textSession.editingNew;
	if (i === null) return;
	textSession.editingNew = null;
	editorClosedAt = Date.now();
	if (newFeatures[i] && newFeatures[i].text.trim() === '') {
		newFeatures.splice(i, 1);
		// Keep a selection that points into newFeatures aligned with the splice.
		const sel = textSession.selected;
		if (sel?.kind === 'new') {
			if (sel.index === i) textSession.selected = null;
			else if (sel.index > i) textSession.selected = { kind: 'new', index: sel.index - 1 };
		}
	}
	bump();
}

// Opens the inline editor on an existing label. coord and the label's current text are
// captured by the caller (which has the projected anchor + properties at hand).
export function beginEditingExisting(layerId: string, featureIndex: number, coord: [number, number], initialText: string): void {
	finishEditingNew();
	textSession.editingExisting = { layerId, featureIndex, coord, initialText };
	bump(); // the painter skips this label while it's in the editor
}

export function finishEditingExisting(): void {
	if (!textSession.editingExisting) return;
	textSession.editingExisting = null;
	editorClosedAt = Date.now();
	bump();
}

// What the inline editor should display for the current edit target.
export function currentEditingText(): string {
	if (textSession.editingNew !== null) return newFeatures[textSession.editingNew]?.text ?? '';
	const ex = textSession.editingExisting;
	if (ex) return sessionTextOverride(ex.layerId, ex.featureIndex) ?? ex.initialText;
	return '';
}

// Live text updates for an existing label (applied to its attribute on commit).
export function setLabelText(layerId: string, featureIndex: number, text: string): void {
	let m = textEdits.get(layerId);
	if (!m) { m = new Map(); textEdits.set(layerId, m); }
	m.set(featureIndex, text);
	bump();
}

// Rotation/wrap width of the current selection, for the bar's controls. Reads the
// session override first, then the feature's stored reserved property.
function selectedProp(sel: TextSelection, key: '__rotation' | '__wrapWidth'): number | null {
	if (sel.kind === 'new') {
		const f = newFeatures[sel.index];
		return (key === '__rotation' ? f?.rotation : f?.wrapWidth) ?? null;
	}
	const override = key === '__rotation'
		? sessionRotationOverride(sel.layerId, sel.featureIndex)
		: sessionWrapOverride(sel.layerId, sel.featureIndex);
	if (override !== null) return override;
	const topo = workingTopologyData.get(sel.layerId);
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const anyTopo = topo as any;
	const objName = anyTopo ? Object.keys(anyTopo.objects)[0] : null;
	const raw = objName ? anyTopo.objects[objName]?.geometries?.[sel.featureIndex]?.properties?.[key] : null;
	return typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
}

// Whether the current selection is a curved (line-geometry) label — rotation and
// wrap width don't apply to text-on-a-path, so the bar hides those controls.
export function selectedIsCurved(): boolean {
	const sel = textSession.selected;
	if (!sel || sel.kind !== 'existing') return false;
	const topo = workingTopologyData.get(sel.layerId);
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const anyTopo = topo as any;
	const objName = anyTopo ? Object.keys(anyTopo.objects)[0] : null;
	return objName ? anyTopo.objects[objName]?.geometries?.[sel.featureIndex]?.type === 'LineString' : false;
}

export function selectedRotation(): number {
	const sel = textSession.selected;
	return sel ? (selectedProp(sel, '__rotation') ?? 0) : 0;
}
export function selectedWrapWidth(): number | null {
	const sel = textSession.selected;
	return sel ? selectedProp(sel, '__wrapWidth') : null;
}

export function setSelectedRotation(deg: number): void {
	const sel = textSession.selected;
	if (!sel || !Number.isFinite(deg)) return;
	if (sel.kind === 'new') {
		const f = newFeatures[sel.index];
		if (f) f.rotation = deg;
	} else {
		let m = rotations.get(sel.layerId);
		if (!m) { m = new Map(); rotations.set(sel.layerId, m); }
		m.set(sel.featureIndex, deg);
	}
	bump();
}

export function setSelectedWrapWidth(px: number): void {
	const sel = textSession.selected;
	if (!sel || !Number.isFinite(px)) return;
	const width = Math.max(24, px);
	if (sel.kind === 'new') {
		const f = newFeatures[sel.index];
		if (f) f.wrapWidth = width;
	} else {
		let m = wrapWidths.get(sel.layerId);
		if (!m) { m = new Map(); wrapWidths.set(sel.layerId, m); }
		m.set(sel.featureIndex, width);
	}
	bump();
}

// Moves an existing label (live during drag; applied to the layer on commit).
export function moveLabel(layerId: string, featureIndex: number, lon: number, lat: number): void {
	let m = moves.get(layerId);
	if (!m) { m = new Map(); moves.set(layerId, m); }
	m.set(featureIndex, [lon, lat]);
	bump();
}

// Translates a curved label's whole line (live during drag; applied on commit).
// The delta is the TOTAL offset from the feature's stored geometry — a new drag
// gesture starts from the previous total (the caller adds it), not from zero.
export function moveLine(layerId: string, featureIndex: number, dlon: number, dlat: number): void {
	let m = lineMoves.get(layerId);
	if (!m) { m = new Map(); lineMoves.set(layerId, m); }
	m.set(featureIndex, [dlon, dlat]);
	bump();
}

// Moves an uncommitted new box (drag before commit).
export function moveNewText(index: number, lon: number, lat: number): void {
	const f = newFeatures[index];
	if (!f) return;
	f.coord = [lon, lat];
	bump();
}

// Deletes whatever is selected (existing label → pending delete applied on commit;
// new box → dropped from the session immediately).
export function deleteSelected(): void {
	const sel = textSession.selected;
	if (!sel) return;
	textSession.selected = null;
	if (sel.kind === 'existing') {
		let s = deletes.get(sel.layerId);
		if (!s) { s = new Set(); deletes.set(sel.layerId, s); }
		s.add(sel.featureIndex);
		// Pending edits on a deleted label are moot.
		moves.get(sel.layerId)?.delete(sel.featureIndex);
		lineMoves.get(sel.layerId)?.delete(sel.featureIndex);
		textEdits.get(sel.layerId)?.delete(sel.featureIndex);
		rotations.get(sel.layerId)?.delete(sel.featureIndex);
		wrapWidths.get(sel.layerId)?.delete(sel.featureIndex);
	} else {
		if (textSession.editingNew === sel.index) textSession.editingNew = null;
		newFeatures.splice(sel.index, 1);
		// Shift indices in the selection-free structures that reference newFeatures.
		if (textSession.editingNew !== null && textSession.editingNew > sel.index) textSession.editingNew--;
	}
	bump();
}

// Cancel button: discard everything uncommitted.
export function discardText(): void {
	textSession.editingNew = null;
	textSession.editingExisting = null;
	textSession.selected = null;
	if (newFeatures.length === 0 && moves.size === 0 && lineMoves.size === 0 && deletes.size === 0 && textEdits.size === 0 && rotations.size === 0 && wrapWidths.size === 0) return;
	newFeatures = [];
	moves = new Map();
	lineMoves = new Map();
	deletes = new Map();
	textEdits = new Map();
	rotations = new Map();
	wrapWidths = new Map();
	bump();
}


// Commits the session — new boxes to the target layer (a new "Text" layer when null),
// moves/deletes applied per touched layer — pushing ONE history snapshot once every
// pipeline settles. The session resets immediately; the text tool stays active and
// keeps targeting the (possibly just-created) layer.
export function commitText(): void {
	finishEditingNew();
	finishEditingExisting();
	textSession.selected = null;
	if (newFeatures.length === 0 && moves.size === 0 && lineMoves.size === 0 && deletes.size === 0 && textEdits.size === 0 && rotations.size === 0 && wrapWidths.size === 0) return;

	const feats = newFeatures;
	const mv = moves;
	const lmv = lineMoves;
	const del = deletes;
	const txt = textEdits;
	const rot = rotations;
	const wrap = wrapWidths;
	newFeatures = [];
	moves = new Map();
	lineMoves = new Map();
	deletes = new Map();
	textEdits = new Map();
	rotations = new Map();
	wrapWidths = new Map();
	bump();

	const editedLayerIds = [...new Set([...mv.keys(), ...lmv.keys(), ...del.keys(), ...txt.keys(), ...rot.keys(), ...wrap.keys()])]
		.filter((id) => layers.some((l) => l.id === id)); // skip layers deleted mid-session
	let pending = editedLayerIds.length + (feats.length > 0 ? 1 : 0);
	if (pending === 0) return;
	const done = () => { if (--pending === 0) pushSnapshot(); };

	for (const layerId of editedLayerIds) {
		applyLabelEdits(layerId, {
			moves: mv.get(layerId),
			lineMoves: lmv.get(layerId),
			deletes: del.get(layerId),
			texts: txt.get(layerId),
			rotations: rot.get(layerId),
			wrapWidths: wrap.get(layerId),
		}, done);
	}

	if (feats.length > 0) {
		// Fall back to a new layer if the target was deleted out from under us.
		let target = textSession.targetLayerId;
		if (target !== null && !layers.find((l) => l.id === target)) target = null;
		const id = commitTextFeatures(target, feats, done);
		textSession.targetLayerId = id;
		// Targeting follows the layers-panel selection, so select the layer new boxes
		// just landed in — continued placement keeps adding there.
		selectLayer(id);
	}
}

// Sets the target for new boxes. null → a new layer is created on commit.
export function setTextTarget(layerId: string | null): void {
	textSession.targetLayerId = layerId;
}

// Resets the target — called when the text tool is left so a later re-entry
// starts fresh rather than appending to a stale target.
export function resetTextTarget(): void {
	textSession.targetLayerId = null;
}
