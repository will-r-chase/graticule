// Self-intersection test for a polygon ring.
//
// A polygon is invalid (and breaks fills, area, and most geometry ops) if its boundary
// crosses itself. We test the ring formed by an OPEN vertex list (the closing edge from the
// last vertex back to the first is implicit), checking every pair of non-adjacent edges for a
// proper crossing. O(n²) — fine for hand-drawn polygons, which have few vertices.

type Pt = readonly [number, number];

// Signed area of triangle (a, b, c) ×2 — its sign is the orientation of the turn a→b→c.
function cross(a: Pt, b: Pt, c: Pt): number {
	return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

// True if segments p1p2 and p3p4 properly cross (interiors intersect). Shared endpoints —
// as adjacent edges of a ring have — don't count; those are handled by skipping adjacency.
function segmentsCross(p1: Pt, p2: Pt, p3: Pt, p4: Pt): boolean {
	const d1 = cross(p3, p4, p1);
	const d2 = cross(p3, p4, p2);
	const d3 = cross(p1, p2, p3);
	const d4 = cross(p1, p2, p4);
	return (
		((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
		((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))
	);
}

// Whether the closed ring through `pts` (open list; edge n-1→0 is implicit) crosses itself.
export function ringSelfIntersects(pts: readonly Pt[]): boolean {
	const n = pts.length;
	if (n < 4) return false; // a triangle (or fewer) can't self-cross
	for (let i = 0; i < n; i++) {
		const a1 = pts[i];
		const a2 = pts[(i + 1) % n];
		for (let j = i + 1; j < n; j++) {
			// Skip the same edge and edges adjacent to edge i (they share a vertex).
			if (j === i + 1 || (i === 0 && j === n - 1)) continue;
			if (segmentsCross(a1, a2, pts[j], pts[(j + 1) % n])) return true;
		}
	}
	return false;
}
