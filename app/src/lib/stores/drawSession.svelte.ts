// Draw-session state for the drawing tool.
//
// Holds the in-progress geometry being drawn before it's committed to a layer. Like the
// edit session, the heavy/growable data (placed vertices) lives OUTSIDE $state as plain
// module variables so Svelte never deep-proxies it; only small reactive flags live in
// $state, and a `version` counter is bumped on every mutation so the draw loop repaints.
//
// Two levels of state:
//   - committed: features finished this session (points always land here; a finished
//     line/polygon lands here). They render as ghosts until the session is committed.
//   - activePath: the line/polygon currently being drawn (empty for points).
// The whole session commits to one layer as a single undoable batch.

import { layers, commitDrawnFeatures, type DrawnFeature } from './layers.svelte';
import { pushSnapshot } from './history.svelte';
import { showToast } from './toast.svelte';
import { ringSelfIntersects } from '$lib/utils/selfIntersect';

const SELF_INTERSECT_MSG = 'Polygons cannot cross over themselves, use Cmd+Z to undo the self-intersection.';

export type { DrawnFeature };
export type DrawType = 'point' | 'line' | 'polygon';

// Densifies a polyline (lon/lat) so its edges stay straight on the CURRENT projection —
// registered by MapCanvas, which owns the projection. Samples each edge in screen space and
// inverts back to lon/lat. Null until registered. This bakes the current projection into the
// drawn geometry (WYSIWYG); switching projection afterward will re-curve it.
type Densifier = (coords: readonly [number, number][]) => [number, number][];
let densifier: Densifier | null = null;
export function setDrawDensifier(fn: Densifier): void {
	densifier = fn;
}

// Features finished this session, in absolute coords. Plain arrays, not $state.
let committed: DrawnFeature[] = [];
// The line/polygon being drawn (open vertex list — the polygon's closing edge is implicit).
let activePath: [number, number][] = [];

export const drawSession = $state<{
	// Bumped on every mutation so MapCanvas repaints from the (non-reactive) geometry.
	version: number;
	// Which geometry the tool is placing.
	drawType: DrawType;
	// Reactive counts for guards / bar state.
	committedCount: number;
	activeCount: number;
	// Explicit draw target. null = a new layer, created on commit. Decoupled from selection.
	targetLayerId: string | null;
	// True while the "target layer" picker is armed.
	picking: boolean;
}>({ version: 0, drawType: 'polygon', committedCount: 0, activeCount: 0, targetLayerId: null, picking: false });

export function getCommitted(): readonly DrawnFeature[] {
	return committed;
}
export function getActivePath(): readonly [number, number][] {
	return activePath;
}

function bump(): void {
	drawSession.committedCount = committed.length;
	drawSession.activeCount = activePath.length;
	drawSession.version++;
}

// Minimum vertices for the active path to form a valid feature of the current type.
function minVertices(): number {
	return drawSession.drawType === 'polygon' ? 3 : 2;
}

// Maps a layer's geometry types to the draw type that produces them, or null if mixed.
function drawTypeOf(geometryTypes: readonly string[]): DrawType | null {
	if (geometryTypes.length === 0) return null;
	if (geometryTypes.every((t) => t === 'Point' || t === 'MultiPoint')) return 'point';
	if (geometryTypes.every((t) => t === 'LineString' || t === 'MultiLineString')) return 'line';
	if (geometryTypes.every((t) => t === 'Polygon' || t === 'MultiPolygon')) return 'polygon';
	return null;
}

// The draw type is locked once it's been committed to: a target layer with an established
// type pins it, and an in-progress session (any drawn geometry) pins it to what's being
// drawn. Null means free to choose. The segmented control disables the other options.
export function lockedDrawType(): DrawType | null {
	if (drawSession.targetLayerId) {
		const l = layers.find((x) => x.id === drawSession.targetLayerId);
		const t = l && drawTypeOf(l.geometryTypes);
		if (t) return t;
	}
	if (drawSession.committedCount > 0 || drawSession.activeCount > 0) return drawSession.drawType;
	return null;
}

// Whether the active polygon, closed as it would commit, crosses itself. Only meaningful for
// polygons (a self-crossing line is valid geometry). Used for the live warning + commit block.
export function activeSelfIntersects(): boolean {
	return drawSession.drawType === 'polygon' && activePath.length >= 4 && ringSelfIntersects(activePath);
}

// Finishes the active line/polygon into a committed feature if it has enough vertices.
// Returns true if it finished one. Refuses (with a toast) to close a self-intersecting polygon.
export function finishActive(): boolean {
	if (drawSession.drawType === 'point') return false;
	if (activePath.length < minVertices()) return false;
	if (activeSelfIntersects()) {
		showToast(SELF_INTERSECT_MSG);
		return false;
	}
	committed.push({
		type: drawSession.drawType === 'polygon' ? 'Polygon' : 'LineString',
		coords: [...activePath],
	});
	activePath = [];
	bump();
	return true;
}

// Finishes an active path, else drops it (used when committing / switching type).
function flushOrDiscardActive(): void {
	if (!finishActive()) {
		if (activePath.length > 0) {
			activePath = [];
			bump();
		}
	}
}

// Places a vertex. Points commit immediately into the session; line/polygon vertices extend
// the active path. Warns the moment a placement turns the polygon self-intersecting.
export function placeVertex(lon: number, lat: number): void {
	if (drawSession.drawType === 'point') {
		committed.push({ type: 'Point', coords: [[lon, lat]] });
		bump();
		return;
	}
	const before = activeSelfIntersects();
	activePath.push([lon, lat]);
	bump();
	if (!before && activeSelfIntersects()) showToast(SELF_INTERSECT_MSG);
}

// Double-click finish: the two clicks of the dblclick each placed a vertex, so drop the
// duplicate from the second click before finishing.
export function finishActiveFromDoubleClick(): boolean {
	if (drawSession.drawType === 'point') return false;
	if (activePath.length > 0) activePath.pop();
	return finishActive();
}

// Enter: finish the active path if one is in progress (stay drawing), else commit the session.
// Symmetric with Esc. For points (no active path) this always commits.
export function enterDraw(): void {
	// A self-intersecting active polygon blocks both finishing and committing (finishActive
	// already toasted); don't fall through to commit.
	if (activeSelfIntersects()) { showToast(SELF_INTERSECT_MSG); return; }
	if (finishActive()) return;
	commitDraw();
}

// Switches the geometry type, finishing or dropping any active path first. Refused while the
// type is locked (committed target / in-progress session) — guarded here as well as in the UI.
export function setDrawType(t: DrawType): void {
	if (drawSession.drawType === t) return;
	const locked = lockedDrawType();
	if (locked !== null && locked !== t) return;
	flushOrDiscardActive();
	drawSession.drawType = t;
	bump();
}

// Cmd+Z: remove the last placed vertex of the active path, else the last committed feature.
export function undoLastVertex(): void {
	if (activePath.length > 0) activePath.pop();
	else if (committed.length > 0) committed.pop();
	else return;
	bump();
}

// Esc (two-stage): cancel the active path first, then discard the rest of the session.
// Returns true if it consumed something.
export function escapeDraw(): boolean {
	if (activePath.length > 0) {
		activePath = [];
		bump();
		return true;
	}
	if (committed.length > 0) {
		committed = [];
		bump();
		return true;
	}
	return false;
}

// Cancel button: discard everything uncommitted.
export function discardDraw(): void {
	if (committed.length === 0 && activePath.length === 0) return;
	committed = [];
	activePath = [];
	bump();
}

// Commits the session (finishing any valid active path first) to the target layer, or a new
// layer when the target is null. Pushes one history snapshot once the pipeline settles. The
// session resets immediately; the draw tool stays active. No-op when nothing was drawn.
//
// A self-intersecting active polygon is never committed: a Done/Enter commit is BLOCKED (with
// a toast) so the user fixes it; a commit forced by leaving the tool (leaving=true) silently
// drops the invalid active polygon and commits the rest.
export function commitDraw(leaving = false): void {
	if (activeSelfIntersects()) {
		if (leaving) { activePath = []; bump(); }
		else { showToast(SELF_INTERSECT_MSG); return; }
	}
	flushOrDiscardActive();
	if (committed.length === 0) return;
	const feats = committed;
	committed = [];
	activePath = [];
	bump();

	// Densify line/polygon edges so they render straight on the current projection (WYSIWYG).
	// Polygons densify the CLOSED ring so the closing edge is straight too. Points pass through.
	const out = feats.map((f): DrawnFeature => {
		if (f.type === 'Point' || !densifier) return f;
		if (f.type === 'LineString') return { type: f.type, coords: densifier(f.coords) };
		const ring: [number, number][] = [...f.coords, f.coords[0]];
		return { type: 'Polygon', coords: densifier(ring) };
	});

	// Fall back to a new layer if the target was deleted out from under us.
	let target = drawSession.targetLayerId;
	if (target !== null && !layers.find((l) => l.id === target)) target = null;

	const id = commitDrawnFeatures(target, out, () => pushSnapshot());
	// Flip the target to the just-created layer so continued drawing keeps adding there.
	if (target === null) drawSession.targetLayerId = id;
}

// Sets the explicit draw target. null → a new layer is created on commit.
export function setDrawTarget(layerId: string | null): void {
	drawSession.targetLayerId = layerId;
}

// Arms the "target layer" picker — the next layers-panel row click calls pickLayer().
export function startPicking(): void {
	drawSession.picking = true;
}

export function cancelPicking(): void {
	drawSession.picking = false;
}

// Called by a layers-panel row click while picking: sets the target and disarms the picker.
// Any layer can be picked — the draw type adopts the picked layer's type. If that differs
// from an in-progress session, the session is discarded (its geometry doesn't belong in a
// different-type layer). Empty/mixed layers keep the current type and any session.
export function pickLayer(layerId: string): void {
	const layer = layers.find((l) => l.id === layerId);
	if (!layer) return;
	const t = drawTypeOf(layer.geometryTypes);
	if (t && t !== drawSession.drawType) {
		committed = [];
		activePath = [];
		drawSession.drawType = t;
	}
	drawSession.targetLayerId = layerId;
	drawSession.picking = false;
	bump();
}

// Resets target + picker — called when the draw tool is left so a later re-entry starts on a
// fresh new layer rather than appending to a stale target.
export function resetDrawTarget(): void {
	drawSession.targetLayerId = null;
	drawSession.picking = false;
}
