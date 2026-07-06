# Bezier Smoothing Pipeline — Internal Reference

How mappy's screen-space bezier smoothing works: the rendering pipeline, the
ring-reconstruction ("rejoin") system, every artifact class we found and how
each is handled, and the offline verification harness used to prove the fixes.

**Two competing implementations exist:**

| | Geo-space (`fix/bezier-smoothing`) | Screen-space (this document) |
|---|---|---|
| Where smoothing happens | lon/lat, like Chaikin (`bezierTopology.ts`) | projected screen coords (`bezier.ts` + `rejoin.ts`) |
| Clipping | plain `d3.geoPath` — correct by construction | reimplemented (the rejoin system below) |
| Zoom fidelity | point-to-point; faceting visible at high zoom | true `bezierCurveTo` primitives; crisp at any zoom |
| Toggle | `GEO_SPACE_BEZIER` flag in `geo.worker.ts` | same flag, `false` |

---

## 1. Pipeline overview (screen-space)

```
topology arcs ──► buildBezierArcs (bezier.ts)
                   1. decode quantized arc → geographic coords
                   2. densifyArc: geodesic subdivision of long segments
                   3. stream through D3 at precision(0) → clipped sub-paths
                      with exact boundary crossing points
                   4. classify splits (antimeridian / hemisphere)
                   5. detect trimmed/empty arcs (hemisphere clips only)
                   6. Catmull-Rom / B-spline / KB control points per run
                   ──► { bezierArcs, geoArcs }

per polygon ring ──► arcRingToPath (bezier.ts)
                      quick scan: count break types, trims, empties
                      route:
                        antimeridian breaks ──► rejoinRing + antimeridian boundary
                        hemisphere breaks/trims/empty/antipode ──► rejoinRing + hemisphere boundary
                        clean ──► plain streaming path
                      (legacy arcRingReconstruct* remain only as fallbacks for
                       callers that don't pass geoArcs)

rejoinRing (rejoin.ts) ──► closed sub-polygons into a PathRecorder
                            (Path2D on the main thread, CommandRecorder in the worker)
```

Key architectural invariants:

- **Arcs are the shared topological unit.** A border between two countries is
  one arc, smoothed once; both rings reference the same `BezierArc` (negative
  index = reversed traversal). This is what guarantees adjacent polygons have
  identical borders with no gaps — and it is why smoothing cannot simply be
  applied per-polygon-outline.
- **Rings render independently under the evenodd fill rule.** A hole is just
  another ring drawn into the same path. Consequence: every ring must be
  rendered as its *small patch* interpretation (see winding normalization, §4).
- **mappy never sets `clipExtent`**, so there is no viewport postclip. The only
  things that can split an arc are the antimeridian preclip (conic/cylindrical
  projections, `clipAngle() === 0` sentinel) or the small-circle preclip (the
  azimuthal family, `clipAngle() > 0`). Never both.
- The **antimeridian clip splits but never deletes** geometry. The
  **small-circle clip deletes** (trimmed and empty arcs exist only there).
- A ring crosses the horizon circle an **even** number of times, but may cross
  the antimeridian an **odd** number of times — iff it encloses a pole of the
  rotated frame (picture a circle around the pole: it hits lon 180 once).

---

## 2. buildBezierArcs stages and the artifacts they prevent

### 2.1 `densifyArc` — geodesic densification

*Artifact prevented: "sail"/"lens" fills near projection poles.*

Smoothing needs raw vertices, so the D3 stream runs at `precision(0)`, which
disables D3's adaptive resampling. Near a projection pole (a conic's apex, an
azimuthal center) tiny geographic steps sweep huge screen angles, so a coarse
110m segment that should curve tightly around the apex renders as a straight
chord across it — the area between chord and true path filled as a giant sail.
Fix: before streaming, any vertex pair projecting farther apart than ~2% of the
canvas gets great-circle midpoints (`d3.geoInterpolate`) inserted recursively.
Same arc → same densification on both sides of a shared border.

### 2.2 Stream capture

Each arc's vertices are fed through `proj.stream()`. D3's preclip splits the
arc into sub-paths and inserts *exact* crossing points at the boundary — those
become our exit/entry coordinates for free. `subPathGeoStarts` records which
original vertex each sub-path started at (used by the fallback classifier).

### 2.3 Break classification

*Artifact prevented: chords across the map from misclassified breaks.*

For small-circle projections every split is a `hemisphere` break. Otherwise a
split is an antimeridian crossing, classified by **inverting the D3-inserted
exit point**: `rotFn(proj.invert(exit))` lands at rotated lon ≈ ±180 for a true
crossing. This replaced a neighbor-vertex straddle test that broke down when a
vertex sat at a pole (longitude is meaningless at lat ±90 — Antarctica's pole
stitch triggered this at near-polar rotations, leaving breaks typed `viewport`
that the rejoin skipped and bridged with a full-width chord).

Because the inverted longitude sits numerically *on* ±180, its sign is
unreliable — the side is disambiguated by projecting a candidate point just
inside each side at the crossing latitude and taking the nearer one (Fiji at
rotation `[-180,-85]` produced two same-side exits without this). Breaks store
`crossLat` + `exitSide`, which parameterize the crossing on the boundary.

### 2.4 Trim/empty detection (hemisphere clips only)

*Artifact prevented: unpaired crossings → gaps and mispaired seals at the horizon.*

Break segments only exist where D3 split an arc *internally*. When an arc is
merely trimmed (starts inside the cap, ends outside — one sub-path, no split)
or wiped out entirely, the crossing falls at an arc seam and no break marker
exists — measurable as impossible odd per-ring break counts (`hemi=1`).
`trimmedStart`/`trimmedEnd` (first/last vertex beyond the clip radius, via
`geoDistance`) and `empty` flags record what the split machinery can't see;
`collectRing` turns them into synthesized seam breaks.

---

## 3. The rejoin (`rejoin.ts`)

Port of d3-geo's `clipRejoin` concept, generic over a `RejoinBoundary`
(antimeridian or horizon circle). Read the module docstring for the algorithm;
this section explains *why* each piece exists.

### 3.1 `collectRing`

Walks the ring's arc list, splitting the bezier commands into **runs** between
**breaks**. Structure invariant: run `i` ends at break `i`'s exit; run `i+1`
starts at break `i`'s entry; the final run wraps into run 0 (ring closure).
For hemisphere boundaries it synthesizes seam breaks between a trimmed arc end
and the next trimmed arc start (skipping empty arcs), plus a wrap seam when the
gap spans the ring closure. The wrap seam is appended *without* an extra run —
the walk's modulo indexing maps its entry onto run 0.

### 3.2 Node sort and alternation repair

Each break yields an exit node and an entry node, parameterized by boundary
position `t` and sorted. Interior/exterior stretches of the boundary alternate
between consecutive sorted nodes — a theorem for closed curves, so exits and
entries must alternate in the sorted order. Numerical noise in near-tied
crossings can swap two near-coincident nodes (grazing double-crossings); a
repair pass swaps adjacent same-kind near-ties when that restores alternation.

### 3.3 Parity by largest-gap probe

*Artifact prevented: the polar "goblet", and full-disk fill inversions for
rings hugging the boundary.*

Which alternating stretches are the *interior* ones (the seams to seal) is one
bit. D3 derives it from `polygonContains(polygon, fixedRefPoint)`; we probe
**the midpoint of the largest t-gap between crossings** with
`d3.geoContains(ring, boundary.pointAt(tProbe))`. Rationale: a fixed reference
is fragile precisely when crossings cluster around it (Brazil hugging the
western limb put all its crossings at the t-wrap where the old reference
lived); the largest-gap midpoint is maximally far from every crossing. The old
code's worst artifact — the goblet — was a "nearer pole by latitude" heuristic
answering this same question wrongly for pole-enclosing rings.

### 3.4 The alternating walk

Sub-polygons are emitted by walking: entry node → ring runs to the structural
next exit (`exitOfBreak[(breakIdx+1) % N]`) → boundary trace along the exit's
interior stretch to the entry at its far end → repeat until the walk closes.
One sub-polygon may alternate ring/boundary several times (a U-shaped ring cut
twice). A simple "pair adjacent sorted nodes and close" (the pre-port design)
draws chords across the map for those configurations.

Traces run from exit to entry along the stretch — in *either* t direction, and
through the t-wrap only for the (at most one) stretch that spans it.

### 3.5 Crossing-free rings (N=0)

*Artifact prevented: full-map fill inversions on wide-clip projections.*

Three cases, decided by `ringContainsRef` (does the ring contain the boundary
itself? — with no crossings, the entire boundary is on one side of the ring, so
probing any boundary point answers for all; majority-of-3 probes guard against
edge adjacency):

1. **Visible, doesn't contain the boundary** → plain closed ring (the common case).
2. **Visible, contains the boundary** → ring **plus** the full boundary circle.
   This is d3's `cleanInside` rule: on wide clips (stereographic 142°,
   azimuthal ~180°) a ring can contain the view's *antipode* — the excluded
   cap — and its clipped image covers the disk rim, rendering "inside-out"
   (China with the antipode in Inner Mongolia). Without the extra circle,
   evenodd inverts the entire map.
3. **Invisible, contains the boundary** → the boundary circle alone (a far-side
   ring enclosing the whole visible cap).

Routing for case 2 lives in `arcRingToPath`: clean rings on `clipAngle > 90`
projections get one antipode-containment test.

### 3.6 Boundary implementations

**Antimeridian** (`makeAntimeridianBoundary`): `t` maps (side, crossing
latitude) onto a loop with the north pole at `t=0` and the south pole at the
±π wrap. Traces sample the antimeridian in the rotated frame at ~0.1° steps and
project each sample; off-canvas points are kept (canvas clips natively — an
earlier "abort if off-canvas" guard was the direct cause of the original
full-width diagonal chords), only non-finite projections are skipped.
**Polar arcs:** on many projections a pole is an *arc*, not a point (a conic's
wedge rim). When a trace passes t=0 or the wrap, `polarArc` sweeps longitude at
constant pole latitude — drawing the rim on conics, degenerating to a point
elsewhere. (D3 does the same with its three points at pole latitude plus
resampling.) Skipping this drew chords across the wedge apex.

**Hemisphere** (`makeHemisphereBoundary`): the azimuthal family projects the
horizon to a screen circle; `t` = screen angle about its center, traces are
circle arcs, `fullBoundary` is the whole circle. `pointAt` converts screen
angle → spherical bearing (assumes gamma rotation = 0, which holds for mappy's
`[λ, φ, 0]` rotations).

### 3.7 Winding normalization (`ringGeoCoords`)

*Artifact prevented: full-disk inversion whenever a hole ring drifts behind the horizon.*

All spherical tests run on the ring assembled from `geoArcs`. Hole rings are
wound opposite to exteriors, and d3's spherical containment reads an
opposite-wound ring as the *complement of the sphere* — it "contains" nearly
everything (a far-side Lesotho "contained" the cap center and emitted the full
disk). Under per-ring evenodd rendering the small-patch interpretation is
always correct, so any ring measuring `d3.geoArea > 2π` is reversed before
testing.

### 3.8 Degenerate cases worth knowing about

- **Tangencies** (exit ≈ entry at the same t) occur when a ring grazes the
  boundary — and also when a ring *pierces a microscopic excluded cap* (the
  Antarctica pole stitch dips 0.001° into azimuthal-equal-area's antipodal
  cap). Do **not** special-case-drop them: the two are indistinguishable
  locally, and the parity probe + zero/full-length stretch handle both
  correctly. (A tangent-dropping "fix" was added and later reverted for
  exactly this reason.)
- **Pole-stitch spikes**: Natural Earth closes Antarctica with
  `(180,−84.7) → (180,−90) → (−180,−90) → (−180,−84.7)`. Both pairs are
  identical sphere points, so under rotation this projects as a zero-width
  out-and-back spike. Plain `d3.geoPath` draws it too; it is data geometry,
  not a pipeline bug.

---

## 4. Verification harness

All of the above was validated offline against Natural Earth 110m with a
node script (scratchpad `sim.mjs` pattern — not checked in; rebuild as needed).
It mirrors `buildBezierArcs` + `rejoin.ts` exactly, imports `d3-geo` from
`app/node_modules`, and fetches `ne_110m.topojson` from the R2 catalog. Three
oracles, in increasing order of strength:

1. **Jump detector**: flag any single path command moving >300px — catches
   chord artifacts. Filter out-and-back pole-stitch spikes (jump whose origin
   or landing reappears within a few commands).
2. **Per-ring area oracle**: compare the shoelace area of the emitted
   sub-polygons against `d3.geoPath().area()` of the same single ring
   (winding-normalized on *both* sides — d3's `.area()` is winding-sensitive
   too). Catches wrong seals and mispairing. Caveat: for nested-seal
   geometries d3's signed-sum area can legitimately differ from evenodd pixel
   coverage — confirm suspected failures with oracle 3 before "fixing".
3. **Feature-level Monte Carlo fill oracle** (the strongest — the only one
   that catches evenodd inversions): render whole features (all rings,
   including holes) through our routing into point loops, render the same
   feature through `d3.geoPath` with a capture context, and compare evenodd
   point-in-polygon at tens of thousands of random screen points. Zero
   mismatched pixels = the user-visible fill is identical to d3's.

Final state at migration: 0/411 antimeridian rings and 12,884 hemisphere ring
checks clean across ~75 rotations and 5 projections (one hemisphere "failure"
proven pixel-identical via oracle 3), 0 feature-level fill differences across
4 azimuthal-family projections × 6 rotations.

---

## 5. Known limitations / future notes

- **Gamma rotations**: `makeHemisphereBoundary.pointAt` assumes `rot[2] === 0`.
- **Composite projections** (`geoAlbersUsa`): no `rotate`/single clip geometry;
  rings fall through to the plain streaming path (moveTo at breaks, no seals).
- **Legacy fallbacks**: `arcRingReconstructAntimeridian/Hemisphere/Viewport`
  in bezier.ts survive only for callers that don't pass `geoArcs`
  (`buildTopoPath`, stale experiment pages). New code should always pass
  `geoArcs`.
- **Viewport breaks** effectively no longer occur (no `clipExtent`); the
  `'viewport'` break type remains only as the classifier's "couldn't confirm
  antimeridian" bucket via the no-invert fallback path.
- **Probe fragility**: containment probes can land within ~0.5° of a ring
  edge in adversarial configurations. Mitigations: largest-gap placement
  (parity), majority-of-3 (N=0). If a new inversion appears, suspect these
  first and reproduce with oracle 3.
- The main-thread edit-session path (`MapCanvas.getEditBezierPath`) and the
  worker path share all of this code via `arcRingToPath`.
