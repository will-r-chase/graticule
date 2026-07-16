// Text-session state for the text tool (docs/labels-plan.md, step 3).
//
// Mirrors drawSession's shape: growable data lives OUTSIDE $state as plain module
// variables, small reactive flags live in $state, and `version` bumps on every
// mutation so MapCanvas repaints. The session holds two kinds of work, committed
// together as one undoable batch:
//   - NEW text boxes headed for the target text layer (ghosts until commit)
//   - EDITS to existing labels: per-layer move/delete maps that the label painter
//     consults live, applied via replaceLayerGeometry on commit (one mint per layer)

import { feature as topoFeature } from 'topojson-client';
import { layers, workingTopologyData, commitTextFeatures, applyLabelEdits } from './layers.svelte';
import { selectLayer } from './layerSelection.svelte';
import { pushSnapshot } from './history.svelte';
import { sampleCubic, type CubicBezier } from '$lib/utils/curvedText';

export interface NewTextFeature {
	coord: [number, number]; // lon/lat; for path text, kept at the anchors' midpoint
	text: string;
	rotation?: number; // degrees clockwise; absent = 0
	wrapWidth?: number; // px; absent = no auto-wrap
	// Text-on-path box (D10): the cubic in lon/lat. When present, rotation/wrapWidth
	// don't apply and commit bakes a LineString instead of a Point.
	path?: CubicBezier;
	// Where along the path the text centers, as an arc-length fraction (D12);
	// absent = 0.5. Only meaningful with `path`.
	pathOffset?: number;
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
// Curved labels whose path is being resculpted (D10): the cubic's control points
// in lon/lat. Present once a handle has been dragged, or when a straight label is
// toggled onto a path (the cubic on a stored-Point feature = pending conversion).
// Supersedes the stored geometry (and any lineMove) for painting and commit.
let pathEdits = new Map<string, Map<number, CubicBezier>>();
// Curved labels toggled OFF their path: the lon/lat anchor where the straight
// label lands (the curve's midpoint at toggle time). Mutually exclusive with a
// pathEdit on the same feature. Commit converts the LineString to a Point.
let straightens = new Map<string, Map<number, [number, number]>>();
// Where along its path a curved label's text centers (D12): arc-length fraction,
// written to the reserved `__pathOffset` property on commit.
let pathOffsets = new Map<string, Map<number, number>>();
let deletes = new Map<string, Set<number>>();
let textEdits = new Map<string, Map<number, string>>();
let rotations = new Map<string, Map<number, number>>();
let wrapWidths = new Map<string, Map<number, number>>();

// Bakes a lon/lat cubic into a lon/lat polyline for commit. Registered by
// MapCanvas (it owns the live projection): project the control points, sample the
// on-screen curve, unproject the samples — D10's "what you sculpted is what you
// get". The fallback (no baker registered, or projection failure) evaluates the
// cubic directly in lon/lat, which can deviate slightly from the on-screen shape.
export type PathBaker = (cubic: CubicBezier) => [number, number][] | null;
let pathBaker: PathBaker | null = null;
export function setPathBaker(fn: PathBaker): void {
	pathBaker = fn;
}
// Builds the default path for a label toggled onto a path: a gentle arc centered
// on the given lon/lat, sized in screen px. Registered by MapCanvas (it owns the
// projection). Null = the position doesn't project (off-globe).
export type DefaultPathMaker = (coord: [number, number]) => CubicBezier | null;
let defaultPathMaker: DefaultPathMaker | null = null;
export function setDefaultPathMaker(fn: DefaultPathMaker): void {
	defaultPathMaker = fn;
}

// The stored topology geometry of an existing label feature (or null).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function storedGeometry(layerId: string, featureIndex: number): any {
	const topo = workingTopologyData.get(layerId);
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const anyTopo = topo as any;
	const objName = anyTopo ? Object.keys(anyTopo.objects)[0] : null;
	return objName ? anyTopo.objects[objName]?.geometries?.[featureIndex] ?? null : null;
}

// The "On path" toggle for the selected text mark (D10). Position and on-path
// status are INDEPENDENT properties: toggling never moves the text. ON threads
// the default arc through the label's current position (or, for a straightened
// line, restores its original curve translated to where the label now sits);
// OFF lands the label at the curve's current on-screen midpoint. Commit bakes
// conversions into the geometry type.
export function setSelectedOnPath(on: boolean): void {
	const sel = textSession.selected;
	if (!sel || on === selectedIsCurved()) return;

	if (sel.kind === 'new') {
		const f = newFeatures[sel.index];
		if (!f) return;
		if (on) {
			const cubic = defaultPathMaker?.(f.coord);
			if (!cubic) return;
			f.path = cubic;
			f.pathOffset = undefined; // fresh default arc centers the text at coord
		} else {
			// coord already tracks the text's on-path center (pathBoxCoord).
			f.path = undefined;
			f.pathOffset = undefined;
		}
		bump();
		return;
	}

	const { layerId, featureIndex } = sel;
	const geom = storedGeometry(layerId, featureIndex);
	if (!geom) return;

	if (on) {
		const st = straightens.get(layerId);
		const anchor = st?.get(featureIndex);
		if (anchor && geom.type === 'LineString') {
			// Straightened line: bring the original curve back where the label now
			// sits — a drag in the straight state survives as a whole-line translate.
			st!.delete(featureIndex);
			const line = lineCoords(layerId, featureIndex);
			const mid = line[Math.floor(line.length / 2)];
			if (mid && Math.hypot(anchor[0] - mid[0], anchor[1] - mid[1]) > 1e-9) {
				let lm = lineMoves.get(layerId);
				if (!lm) { lm = new Map(); lineMoves.set(layerId, lm); }
				lm.set(featureIndex, [anchor[0] - mid[0], anchor[1] - mid[1]]);
			}
			bump();
			return;
		}
		if (geom.type !== 'Point') return;
		const coord = sessionMovedCoord(layerId, featureIndex) ?? (geom.coordinates as [number, number]);
		const cubic = defaultPathMaker?.(coord);
		if (!cubic) return;
		moves.get(layerId)?.delete(featureIndex); // the cubic carries position now
		// A dormant slide offset from an earlier on-path life would shove the text
		// away from coord on the fresh default arc — recenter it (D12 no-jump).
		if ((sessionPathOffset(layerId, featureIndex) ?? storedPathOffset(geom)) !== null) {
			setPathOffset(layerId, featureIndex, 0.5);
		}
		setPathEdit(layerId, featureIndex, cubic);
		return; // setPathEdit bumps
	}

	// OFF: the label flattens wherever its curve's midpoint currently is.
	const pe = pathEdits.get(layerId);
	const pending = pe?.get(featureIndex) ?? null;
	if (pending) pe!.delete(featureIndex);
	if (geom.type === 'Point') {
		// Converted-then-unconverted point: keep the text's on-path center (its
		// slide offset included) as a move — skip the no-op when it never moved.
		if (pending) {
			const t = sessionPathOffset(layerId, featureIndex) ?? 0.5;
			const coord = walkFraction(sampleCubic(pending, 32), t);
			const orig = geom.coordinates as [number, number];
			if (Math.hypot(coord[0] - orig[0], coord[1] - orig[1]) > 1e-9) {
				let m = moves.get(layerId);
				if (!m) { m = new Map(); moves.set(layerId, m); }
				m.set(featureIndex, coord);
			} else {
				moves.get(layerId)?.delete(featureIndex);
			}
		}
		bump();
		return;
	}
	if (geom.type === 'LineString') {
		// Land at the TEXT's current center: its slide offset walked along the
		// curve (raw fraction — the render-time clamp can deviate slightly for
		// text near the ends; accepted).
		const t = sessionPathOffset(layerId, featureIndex) ?? storedPathOffset(geom) ?? 0.5;
		let coord: [number, number];
		if (pending) {
			coord = walkFraction(sampleCubic(pending, 32), t);
		} else {
			const line = lineCoords(layerId, featureIndex);
			if (line.length === 0) return;
			const delta = sessionLineDelta(layerId, featureIndex) ?? [0, 0];
			const p = walkFraction(line, t);
			coord = [p[0] + delta[0], p[1] + delta[1]];
		}
		lineMoves.get(layerId)?.delete(featureIndex); // the straighten carries position
		let st = straightens.get(layerId);
		if (!st) { st = new Map(); straightens.set(layerId, st); }
		st.set(featureIndex, coord);
		bump();
	}
}

// A feature's stored `__pathOffset` (D12), or null.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function storedPathOffset(geom: any): number | null {
	const raw = geom?.properties?.__pathOffset;
	return typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
}

// The lon/lat vertices of a LineString label feature, decoded via topojson-client
// so quantized/delta-encoded topologies come out absolute.
function lineCoords(layerId: string, featureIndex: number): [number, number][] {
	const topo = workingTopologyData.get(layerId);
	if (!topo) return [];
	const objName = Object.keys(topo.objects)[0];
	if (!objName) return [];
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const fc = topoFeature(topo, topo.objects[objName]) as any;
	const g = fc?.features?.[featureIndex]?.geometry;
	return g?.type === 'LineString' ? (g.coordinates as [number, number][]) : [];
}

function bakeCubic(cubic: CubicBezier): [number, number][] {
	const line = pathBaker?.(cubic);
	return line && line.length >= 2 ? line : sampleCubic(cubic, 64);
}
function bakePathEdits(m: Map<number, CubicBezier> | undefined): Map<number, [number, number][]> | undefined {
	if (!m || m.size === 0) return undefined;
	const out = new Map<number, [number, number][]>();
	for (const [i, cubic] of m) out.set(i, bakeCubic(cubic));
	return out;
}

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
export function sessionPathEdit(layerId: string, featureIndex: number): CubicBezier | null {
	return pathEdits.get(layerId)?.get(featureIndex) ?? null;
}
export function sessionStraighten(layerId: string, featureIndex: number): [number, number] | null {
	return straightens.get(layerId)?.get(featureIndex) ?? null;
}
export function sessionPathOffset(layerId: string, featureIndex: number): number | null {
	return pathOffsets.get(layerId)?.get(featureIndex) ?? null;
}
export function setPathOffset(layerId: string, featureIndex: number, t: number): void {
	if (!Number.isFinite(t)) return;
	let m = pathOffsets.get(layerId);
	if (!m) { m = new Map(); pathOffsets.set(layerId, m); }
	m.set(featureIndex, Math.min(Math.max(t, 0), 1));
	bump();
}
export function setNewPathOffset(index: number, t: number): void {
	const f = newFeatures[index];
	if (!f || !f.path || !Number.isFinite(t)) return;
	f.pathOffset = Math.min(Math.max(t, 0), 1);
	f.coord = pathBoxCoord(f);
	bump();
}
// Captures/updates a path resculpt. A path edit is absolute (whole cubic in lon/lat),
// so it also clears any pending whole-line translate for the feature — the cubic
// carries its own position.
export function setPathEdit(layerId: string, featureIndex: number, cubic: CubicBezier): void {
	let m = pathEdits.get(layerId);
	if (!m) { m = new Map(); pathEdits.set(layerId, m); }
	m.set(featureIndex, cubic);
	lineMoves.get(layerId)?.delete(featureIndex);
	bump();
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
	for (const m of pathEdits.values()) edits += m.size;
	for (const m of straightens.values()) edits += m.size;
	for (const m of pathOffsets.values()) edits += m.size;
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

// Reshapes an uncommitted path box (handle drag before commit).
export function setNewPath(index: number, cubic: CubicBezier): void {
	const f = newFeatures[index];
	if (!f || !f.path) return;
	f.path = cubic;
	f.coord = pathBoxCoord(f);
	bump();
}

// A path box's coord: the text's on-path center (its D12 offset walked along the
// sampled cubic) — where the editor opens and where the label lands when toggled
// off its path (position survives the toggle, D10).
function pathBoxCoord(f: NewTextFeature): [number, number] {
	return walkFraction(sampleCubic(f.path!, 32), f.pathOffset ?? 0.5);
}

// The point at arc-length fraction t of a polyline (planar walk over lon/lat —
// fine for anchor placement).
function walkFraction(pts: [number, number][], t: number): [number, number] {
	const cum = [0];
	for (let i = 1; i < pts.length; i++) {
		cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
	}
	const total = cum[cum.length - 1];
	if (total === 0) return [pts[0][0], pts[0][1]];
	const d = Math.min(Math.max(t, 0), 1) * total;
	let i = 0;
	while (i < pts.length - 2 && cum[i + 1] < d) i++;
	const seg = cum[i + 1] - cum[i];
	const u = seg > 0 ? (d - cum[i]) / seg : 0;
	return [
		pts[i][0] + (pts[i + 1][0] - pts[i][0]) * u,
		pts[i][1] + (pts[i + 1][1] - pts[i][1]) * u,
	];
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
	if (!sel) return false;
	if (sel.kind === 'new') return newFeatures[sel.index]?.path !== undefined;
	// Session conversions win over the stored geometry type.
	if (sessionPathEdit(sel.layerId, sel.featureIndex)) return true;
	if (sessionStraighten(sel.layerId, sel.featureIndex)) return false;
	return storedGeometry(sel.layerId, sel.featureIndex)?.type === 'LineString';
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
// A straightened line's position lives in its straighten anchor, not in moves —
// the painter (and the eventual Point conversion) read it from there.
export function moveLabel(layerId: string, featureIndex: number, lon: number, lat: number): void {
	const st = straightens.get(layerId);
	if (st?.has(featureIndex)) {
		st.set(featureIndex, [lon, lat]);
		bump();
		return;
	}
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

// Moves an uncommitted new box (drag before commit). A path box translates its
// whole cubic; coord rides along at the on-curve midpoint.
export function moveNewText(index: number, lon: number, lat: number): void {
	const f = newFeatures[index];
	if (!f) return;
	if (f.path) {
		const dlon = lon - f.coord[0];
		const dlat = lat - f.coord[1];
		const t = (p: [number, number]): [number, number] => [p[0] + dlon, p[1] + dlat];
		f.path = { p0: t(f.path.p0), p1: t(f.path.p1), p2: t(f.path.p2), p3: t(f.path.p3) };
	}
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
		pathEdits.get(sel.layerId)?.delete(sel.featureIndex);
		straightens.get(sel.layerId)?.delete(sel.featureIndex);
		pathOffsets.get(sel.layerId)?.delete(sel.featureIndex);
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
	if (newFeatures.length === 0 && moves.size === 0 && lineMoves.size === 0 && pathEdits.size === 0 && straightens.size === 0 && pathOffsets.size === 0 && deletes.size === 0 && textEdits.size === 0 && rotations.size === 0 && wrapWidths.size === 0) return;
	newFeatures = [];
	moves = new Map();
	lineMoves = new Map();
	pathEdits = new Map();
	straightens = new Map();
	pathOffsets = new Map();
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
	if (newFeatures.length === 0 && moves.size === 0 && lineMoves.size === 0 && pathEdits.size === 0 && straightens.size === 0 && pathOffsets.size === 0 && deletes.size === 0 && textEdits.size === 0 && rotations.size === 0 && wrapWidths.size === 0) return;

	const feats = newFeatures;
	const mv = moves;
	const lmv = lineMoves;
	const pe = pathEdits;
	const st = straightens;
	const po = pathOffsets;
	const del = deletes;
	const txt = textEdits;
	const rot = rotations;
	const wrap = wrapWidths;
	newFeatures = [];
	moves = new Map();
	lineMoves = new Map();
	pathEdits = new Map();
	straightens = new Map();
	pathOffsets = new Map();
	deletes = new Map();
	textEdits = new Map();
	rotations = new Map();
	wrapWidths = new Map();
	bump();

	const editedLayerIds = [...new Set([...mv.keys(), ...lmv.keys(), ...pe.keys(), ...st.keys(), ...po.keys(), ...del.keys(), ...txt.keys(), ...rot.keys(), ...wrap.keys()])]
		.filter((id) => layers.some((l) => l.id === id)); // skip layers deleted mid-session
	let pending = editedLayerIds.length + (feats.length > 0 ? 1 : 0);
	if (pending === 0) return;
	const done = () => { if (--pending === 0) pushSnapshot(); };

	for (const layerId of editedLayerIds) {
		applyLabelEdits(layerId, {
			moves: mv.get(layerId),
			lineMoves: lmv.get(layerId),
			pathReplaces: bakePathEdits(pe.get(layerId)),
			straightens: st.get(layerId),
			pathOffsets: po.get(layerId),
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
		// Path boxes bake their cubic into a line here; point boxes pass through.
		const baked = feats.map((f) =>
			f.path ? { coord: f.coord, text: f.text, line: bakeCubic(f.path), pathOffset: f.pathOffset } : f
		);
		const id = commitTextFeatures(target, baked, done);
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
