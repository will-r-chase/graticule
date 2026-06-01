<script lang="ts">
	// ─── Color math ─────────────────────────────────────────────────────────────
	// Internal representation: HSV (maps directly to the 2D square).
	// The HSL sliders derive their values from HSV and write back via hslToHsv.

	function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
		s /= 100; v /= 100;
		const f = (n: number) => {
			const k = (n + h / 60) % 6;
			return v * (1 - s * Math.max(0, Math.min(k, 4 - k, 1)));
		};
		return [Math.round(f(5) * 255), Math.round(f(3) * 255), Math.round(f(1) * 255)];
	}

	function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
		r /= 255; g /= 255; b /= 255;
		const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
		let h = 0;
		if (d !== 0) {
			if (max === r)      h = ((g - b) / d) % 6;
			else if (max === g) h = (b - r) / d + 2;
			else                h = (r - g) / d + 4;
			h = (h * 60 + 360) % 360;
		}
		return [h, max === 0 ? 0 : (d / max) * 100, max * 100];
	}

	// HSV → HSL as numeric components [sl, l] (percentages 0–100)
	function hsvToHsl(s: number, v: number): [number, number] {
		const vv = v / 100, ss = s / 100;
		const l = vv * (1 - ss / 2);
		const sl = l === 0 || l === 1 ? 0 : (vv - l) / Math.min(l, 1 - l);
		return [sl * 100, l * 100];
	}

	// HSL → HSV (for writing HSL slider values back to internal HSV state)
	function hslToHsv(sl: number, l: number): [number, number] {
		sl /= 100; l /= 100;
		const v = l + sl * Math.min(l, 1 - l);
		const sv = v === 0 ? 0 : 2 * (1 - l / v);
		return [sv * 100, v * 100];
	}

	function hexToRgb(hex: string): [number, number, number] | null {
		const m = hex.replace('#', '').match(/^([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i);
		return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : null;
	}

	function rgbToHex(r: number, g: number, b: number): string {
		return '#' + [r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('');
	}

	function hsvToHex(h: number, s: number, v: number): string {
		return rgbToHex(...hsvToRgb(h, s, v));
	}

	function hsvToCss(h: number, s: number, v: number): string {
		const [sl, l] = hsvToHsl(s, v);
		return `hsl(${h.toFixed(1)}, ${sl.toFixed(1)}%, ${l.toFixed(1)}%)`;
	}

	// ─── Props ──────────────────────────────────────────────────────────────────

	let {
		hex = $bindable('#f4f4f5'),
		alpha = $bindable(1),
	}: {
		hex: string;
		alpha: number;
	} = $props();

	// ─── Internal HSV state (source of truth) ───────────────────────────────────

	const initRgb = hexToRgb(hex) ?? ([244, 244, 245] as [number, number, number]);
	const [initH, initS, initV] = rgbToHsv(initRgb[0], initRgb[1], initRgb[2]);

	let h = $state(initH);
	let s = $state(initS);
	let v = $state(initV);

	// ─── Derived HSL values (for slider positions and gradient tracks) ───────────

	let hslS = $derived(hsvToHsl(s, v)[0]);  // HSL saturation 0–100
	let hslL = $derived(hsvToHsl(s, v)[1]);  // HSL lightness 0–100

	// ─── Hex input state ────────────────────────────────────────────────────────

	let hexInput = $state(hex.replace('#', '').toUpperCase());
	let hexFocused = $state(false);
	let hexError = $state(false);

	// ─── Sync HSV → bound hex prop ──────────────────────────────────────────────

	$effect(() => {
		hex = hsvToHex(h, s, v);
		if (!hexFocused) {
			hexInput = hex.replace('#', '').toUpperCase();
			hexError = false;
		}
	});

	// ─── Derived CSS values ─────────────────────────────────────────────────────

	let cssColor = $derived(hsvToCss(h, s, v));
	let cssHue   = $derived(`hsl(${h.toFixed(1)}, 100%, 50%)`);
	let dotLeft  = $derived(s);        // 0–100 (%)
	let dotTop   = $derived(100 - v);  // 0–100 (%) — top = bright, bottom = dark

	// Gradient tracks for the S and L sliders — updated reactively.
	let cssSatGradient = $derived(
		`linear-gradient(to right, hsl(${h.toFixed(1)}, 0%, ${hslL.toFixed(1)}%), hsl(${h.toFixed(1)}, 100%, ${hslL.toFixed(1)}%))`
	);
	let cssLitGradient = $derived(
		`linear-gradient(to right, hsl(${h.toFixed(1)}, ${hslS.toFixed(1)}%, 0%), hsl(${h.toFixed(1)}, ${hslS.toFixed(1)}%, 50%), hsl(${h.toFixed(1)}, ${hslS.toFixed(1)}%, 100%))`
	);

	// ─── Generic slider helper ───────────────────────────────────────────────────

	function sliderFraction(e: PointerEvent, el: HTMLDivElement | null): number {
		if (!el) return 0;
		const rect = el.getBoundingClientRect();
		return Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
	}

	// ─── 2D square drag ─────────────────────────────────────────────────────────

	let squareEl = $state<HTMLDivElement | null>(null);

	function pickFromSquare(e: PointerEvent) {
		if (!squareEl) return;
		const rect = squareEl.getBoundingClientRect();
		s = Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100));
		v = Math.max(0, Math.min(100, (1 - (e.clientY - rect.top) / rect.height) * 100));
	}

	function onSquareDown(e: PointerEvent) {
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
		pickFromSquare(e);
	}

	function onSquareMove(e: PointerEvent) {
		if (!(e.buttons & 1)) return;
		pickFromSquare(e);
	}

	// ─── Hue slider ─────────────────────────────────────────────────────────────

	let hueEl = $state<HTMLDivElement | null>(null);

	function onHueDown(e: PointerEvent) {
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
		h = sliderFraction(e, hueEl) * 360;
	}
	function onHueMove(e: PointerEvent) {
		if (!(e.buttons & 1)) return;
		h = sliderFraction(e, hueEl) * 360;
	}

	// ─── Saturation slider (HSL) ─────────────────────────────────────────────────

	let satEl = $state<HTMLDivElement | null>(null);

	function onSatDown(e: PointerEvent) {
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
		const newSl = sliderFraction(e, satEl) * 100;
		[s, v] = hslToHsv(newSl, hslL);
	}
	function onSatMove(e: PointerEvent) {
		if (!(e.buttons & 1)) return;
		const newSl = sliderFraction(e, satEl) * 100;
		[s, v] = hslToHsv(newSl, hslL);
	}

	// ─── Lightness slider (HSL) ──────────────────────────────────────────────────

	let litEl = $state<HTMLDivElement | null>(null);

	function onLitDown(e: PointerEvent) {
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
		const newL = sliderFraction(e, litEl) * 100;
		[s, v] = hslToHsv(hslS, newL);
	}
	function onLitMove(e: PointerEvent) {
		if (!(e.buttons & 1)) return;
		const newL = sliderFraction(e, litEl) * 100;
		[s, v] = hslToHsv(hslS, newL);
	}

	// ─── Alpha slider ────────────────────────────────────────────────────────────

	let alphaEl = $state<HTMLDivElement | null>(null);

	function onAlphaDown(e: PointerEvent) {
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
		alpha = sliderFraction(e, alphaEl);
	}
	function onAlphaMove(e: PointerEvent) {
		if (!(e.buttons & 1)) return;
		alpha = sliderFraction(e, alphaEl);
	}

	// ─── Hex input handlers ─────────────────────────────────────────────────────

	function onHexInput(e: Event) {
		const input = e.target as HTMLInputElement;
		hexInput = input.value.replace(/[^a-fA-F0-9]/g, '').slice(0, 6).toUpperCase();
		input.value = hexInput;
	}

	function onHexCommit() {
		hexFocused = false;
		if (hexInput.length === 6) {
			const rgb = hexToRgb('#' + hexInput);
			if (rgb) {
				[h, s, v] = rgbToHsv(rgb[0], rgb[1], rgb[2]);
				hexError = false;
				return;
			}
		}
		hexInput = hex.replace('#', '').toUpperCase();
		hexError = hexInput.length > 0;
	}

	function onHexKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
	}

	// ─── Alpha input handler ────────────────────────────────────────────────────

	function onAlphaInput(e: Event) {
		const val = parseInt((e.target as HTMLInputElement).value);
		if (!isNaN(val)) alpha = Math.max(0, Math.min(100, val)) / 100;
	}
</script>

<div class="color-picker">
	<!-- 2D saturation / value square -->
	<div
		class="square"
		bind:this={squareEl}
		style="--hue-color: {cssHue}"
		onpointerdown={onSquareDown}
		onpointermove={onSquareMove}
		role="presentation"
	>
		<div class="square-dot" style="left: {dotLeft}%; top: {dotTop}%"></div>
	</div>

	<!-- H / S / L / α sliders -->
	<div class="sliders">
		<!-- Hue -->
		<div class="slider-row">
			<span class="slider-label">H</span>
			<div
				class="slider hue-slider"
				bind:this={hueEl}
				onpointerdown={onHueDown}
				onpointermove={onHueMove}
				role="presentation"
			>
				<div class="thumb" style="left: {(h / 360) * 100}%; background: {cssHue}"></div>
			</div>
			<input class="slider-num" type="number" min="0" max="360" step="1"
				value={Math.round(h)}
				onchange={(e) => {
					h = Math.min(360, Math.max(0, Number((e.currentTarget as HTMLInputElement).value)));
					(e.currentTarget as HTMLInputElement).value = String(Math.round(h));
				}}
			/>
		</div>

		<!-- Saturation (HSL) -->
		<div class="slider-row">
			<span class="slider-label">S</span>
			<div
				class="slider sat-slider"
				bind:this={satEl}
				style="background: {cssSatGradient}"
				onpointerdown={onSatDown}
				onpointermove={onSatMove}
				role="presentation"
			>
				<div class="thumb" style="left: {hslS}%; background: {cssColor}"></div>
			</div>
			<input class="slider-num" type="number" min="0" max="100" step="1"
				value={Math.round(hslS)}
				onchange={(e) => {
					const newSl = Math.min(100, Math.max(0, Number((e.currentTarget as HTMLInputElement).value)));
					[s, v] = hslToHsv(newSl, hslL);
					(e.currentTarget as HTMLInputElement).value = String(Math.round(hslS));
				}}
			/>
		</div>

		<!-- Lightness (HSL) -->
		<div class="slider-row">
			<span class="slider-label">L</span>
			<div
				class="slider lit-slider"
				bind:this={litEl}
				style="background: {cssLitGradient}"
				onpointerdown={onLitDown}
				onpointermove={onLitMove}
				role="presentation"
			>
				<div class="thumb" style="left: {hslL}%; background: {cssColor}"></div>
			</div>
			<input class="slider-num" type="number" min="0" max="100" step="1"
				value={Math.round(hslL)}
				onchange={(e) => {
					const newL = Math.min(100, Math.max(0, Number((e.currentTarget as HTMLInputElement).value)));
					[s, v] = hslToHsv(hslS, newL);
					(e.currentTarget as HTMLInputElement).value = String(Math.round(hslL));
				}}
			/>
		</div>

		<!-- Alpha -->
		<div class="slider-row">
			<span class="slider-label">A</span>
			<div
				class="slider alpha-slider"
				bind:this={alphaEl}
				style="--current-color: {cssColor}"
				onpointerdown={onAlphaDown}
				onpointermove={onAlphaMove}
				role="presentation"
			>
				<div class="thumb" style="left: {alpha * 100}%; background: {cssColor}"></div>
			</div>
			<input class="slider-num" type="number" min="0" max="100" step="1"
				value={Math.round(alpha * 100)}
				onchange={(e) => {
					alpha = Math.min(100, Math.max(0, Number((e.currentTarget as HTMLInputElement).value))) / 100;
					(e.currentTarget as HTMLInputElement).value = String(Math.round(alpha * 100));
				}}
			/>
		</div>
	</div>

	<!-- Hex + alpha inputs -->
	<div class="inputs">
		<div class="hex-wrapper" class:error={hexError}>
			<span class="affix mono-small">#</span>
			<input
				class="mono-small"
				type="text"
				value={hexInput}
				oninput={onHexInput}
				onblur={onHexCommit}
				onkeydown={onHexKeydown}
				onfocus={() => (hexFocused = true)}
				maxlength={6}
				spellcheck={false}
				aria-label="Hex color"
			/>
		</div>

		<div class="alpha-wrapper">
			<input
				class="mono-small"
				type="number"
				min={0}
				max={100}
				value={Math.round(alpha * 100)}
				oninput={onAlphaInput}
				aria-label="Opacity percentage"
			/>
			<span class="affix mono-small">%</span>
		</div>
	</div>
</div>

<style>
	.color-picker {
		width: 220px;
		display: flex;
		flex-direction: column;
		gap: var(--space-m);
		padding: var(--space-m);
		background: var(--color-surface-primary);
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
	}

	/* ── Square ── */

	.square {
		width: 100%;
		aspect-ratio: 1;
		border-radius: var(--radius);
		position: relative;
		cursor: crosshair;
		user-select: none;
		background:
			linear-gradient(to bottom, transparent, black),
			linear-gradient(to right, white, var(--hue-color));
	}

	.square-dot {
		position: absolute;
		width: 12px;
		height: 12px;
		border-radius: 50%;
		border: 2px solid white;
		box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.25);
		transform: translate(-50%, -50%);
		pointer-events: none;
	}

	/* ── Sliders ── */

	.sliders {
		display: flex;
		flex-direction: column;
		gap: var(--space-s);
	}

	.slider-row {
		display: flex;
		align-items: center;
		gap: var(--space-s);
	}

	.slider-label {
		font-family: var(--font-mono);
		font-size: 11px;
		color: var(--color-text-tertiary);
		width: 10px;
		flex-shrink: 0;
		user-select: none;
	}

	.slider {
		flex: 1;
		position: relative;
		height: 12px;
		border-radius: 6px;
		cursor: pointer;
		user-select: none;
	}

	.hue-slider {
		background: linear-gradient(
			to right,
			hsl(0, 100%, 50%),
			hsl(30, 100%, 50%),
			hsl(60, 100%, 50%),
			hsl(90, 100%, 50%),
			hsl(120, 100%, 50%),
			hsl(150, 100%, 50%),
			hsl(180, 100%, 50%),
			hsl(210, 100%, 50%),
			hsl(240, 100%, 50%),
			hsl(270, 100%, 50%),
			hsl(300, 100%, 50%),
			hsl(330, 100%, 50%),
			hsl(360, 100%, 50%)
		);
	}

	/* sat-slider and lit-slider gradients are set via inline style (reactive) */

	.alpha-slider {
		background-color: white;
		background-image:
			linear-gradient(to right, transparent, var(--current-color)),
			linear-gradient(45deg, #ccc 25%, transparent 25%),
			linear-gradient(-45deg, #ccc 25%, transparent 25%),
			linear-gradient(45deg, transparent 75%, #ccc 75%),
			linear-gradient(-45deg, transparent 75%, #ccc 75%);
		background-size:
			100%,
			8px 8px,
			8px 8px,
			8px 8px,
			8px 8px;
		background-position:
			0 0,
			0 0,
			0 4px,
			4px -4px,
			-4px 0px;
	}

	.thumb {
		position: absolute;
		top: 50%;
		width: 16px;
		height: 16px;
		border-radius: 50%;
		border: 2px solid white;
		box-shadow:
			0 0 0 1px rgba(0, 0, 0, 0.15),
			0 1px 3px rgba(0, 0, 0, 0.2);
		transform: translate(-50%, -50%);
		pointer-events: none;
	}

	/* ── Inputs ── */

	.inputs {
		display: flex;
		gap: var(--space-s);
	}

	.hex-wrapper,
	.alpha-wrapper {
		display: flex;
		align-items: center;
		height: 28px;
		padding: 0 var(--space-s);
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
		gap: var(--space-xs);
	}

	.hex-wrapper {
		flex: 1;
	}

	.hex-wrapper.error {
		border-color: var(--color-error);
	}

	.alpha-wrapper {
		width: 64px;
	}

	.hex-wrapper input,
	.alpha-wrapper input {
		flex: 1;
		border: none;
		outline: none;
		background: transparent;
		min-width: 0;
		color: var(--color-text-primary);
	}

	.alpha-wrapper input {
		text-align: right;
		-moz-appearance: textfield;
	}

	.alpha-wrapper input::-webkit-outer-spin-button,
	.alpha-wrapper input::-webkit-inner-spin-button {
		-webkit-appearance: none;
	}

	.affix {
		color: var(--color-text-tertiary);
		user-select: none;
		flex-shrink: 0;
	}

	.slider-num {
		width: 36px;
		flex-shrink: 0;
		text-align: right;
		font-family: var(--font-mono);
		font-size: 11px;
		color: var(--color-text-secondary);
		background: transparent;
		border: 1px solid transparent;
		border-radius: var(--radius);
		padding: 0 2px;
		-moz-appearance: textfield;
	}

	.slider-num:hover {
		border-color: var(--color-border);
	}

	.slider-num::-webkit-outer-spin-button,
	.slider-num::-webkit-inner-spin-button {
		-webkit-appearance: none;
		margin: 0;
	}
</style>
