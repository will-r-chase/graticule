// Draw-session state for the drawing tool.
//
// Holds the in-progress geometry being drawn before it's committed to a layer. Like the
// edit session, the heavy/growable data (the placed points) lives OUTSIDE $state as a plain
// module variable so Svelte never deep-proxies it; only small reactive flags live in $state,
// and a `version` counter is bumped on every mutation so the draw loop knows to repaint.
//
// Points-only for now (each click drops one point). Lines/polygons will extend this.

import type { Layer } from '$lib/types';
import { layers, commitDrawnPoints } from './layers.svelte';
import { pushSnapshot } from './history.svelte';

// Whether a layer can receive what's currently being drawn. Points-only for now: an empty
// layer (type set on first draw) or a point-only layer qualifies; line/polygon layers don't.
// Generalizes to a draw-type check when lines/polygons land.
export function canDrawToLayer(layer: Layer): boolean {
	return (
		layer.geometryTypes.length === 0 ||
		layer.geometryTypes.every((t) => t === 'Point' || t === 'MultiPoint')
	);
}

// Placed points for the current session, in absolute [lon, lat]. Plain array, not $state.
let points: [number, number][] = [];

export const drawSession = $state<{
	// Bumped on every mutation so MapCanvas repaints the ghost points from the (non-reactive)
	// points list.
	version: number;
	// Count of points placed so far — a reactive convenience for guards / future UI.
	count: number;
	// Where a committed session's points land. null = a new layer (created on commit). This is
	// explicit, set via the draw action bar — deliberately decoupled from layer selection.
	targetLayerId: string | null;
	// True while the "draw to layer" picker is armed: the next layers-panel row click sets the
	// target instead of doing normal selection.
	picking: boolean;
}>({ version: 0, count: 0, targetLayerId: null, picking: false });

export function getDrawPoints(): readonly [number, number][] {
	return points;
}

// Places one point at an absolute geographic coordinate and triggers a repaint.
export function placePoint(lon: number, lat: number): void {
	points.push([lon, lat]);
	drawSession.count = points.length;
	drawSession.version++;
}

// Removes the most recently placed point (session-local undo). No-op when empty.
export function undoLastPoint(): void {
	if (points.length === 0) return;
	points.pop();
	drawSession.count = points.length;
	drawSession.version++;
}

// Discards the entire uncommitted session.
export function cancelDraw(): void {
	if (points.length === 0) return;
	points = [];
	drawSession.count = 0;
	drawSession.version++;
}

// Commits the session's points to the target layer (explicit, or a new layer when null),
// pushing one history snapshot once the pipeline settles. The session resets immediately so
// the next click starts fresh; the draw tool stays active. No-op when nothing has been drawn.
export function commitDraw(): void {
	if (points.length === 0) return;
	const pts = points;
	points = [];
	drawSession.count = 0;
	drawSession.version++;

	// Fall back to a new layer if the target was deleted out from under us.
	let target = drawSession.targetLayerId;
	if (target !== null && !layers.find((l) => l.id === target)) target = null;

	const id = commitDrawnPoints(target, pts, () => pushSnapshot());
	// Flip the target to the just-created layer so continued drawing keeps adding there.
	if (target === null) drawSession.targetLayerId = id;
}

// Sets the explicit draw target. null → a new layer is created on commit.
export function setDrawTarget(layerId: string | null): void {
	drawSession.targetLayerId = layerId;
}

// Arms the "draw to layer" picker — the next layers-panel row click calls pickLayer().
export function startPicking(): void {
	drawSession.picking = true;
}

export function cancelPicking(): void {
	drawSession.picking = false;
}

// Called by a layers-panel row click while picking: sets the target and disarms the picker.
// Ignores incompatible layers (the panel disables them, but guard here too).
export function pickLayer(layerId: string): void {
	const layer = layers.find((l) => l.id === layerId);
	if (!layer || !canDrawToLayer(layer)) return;
	drawSession.targetLayerId = layerId;
	drawSession.picking = false;
}

// Resets target + picker — called when the draw tool is left so a later re-entry starts on a
// fresh new layer rather than appending to a stale target.
export function resetDrawTarget(): void {
	drawSession.targetLayerId = null;
	drawSession.picking = false;
}
