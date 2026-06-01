<script lang="ts">
	let el = $state<SVGGElement | undefined>(undefined);
	let busy = $state(false); // prevents re-triggering mid-animation

	function handleClick() {
		if (busy) return;
		busy = true;
		snapRigid();
	}

	function snapRigid() {
		if (!el) return;

		// ---- Phase 1: anticipation squish (both axes, decelerates to a held pause) ----
		el.style.animation = 'none';
		el.style.transition = 'transform 0.52s cubic-bezier(0.5, 0, 0.08, 1)';

		requestAnimationFrame(() => {
			requestAnimationFrame(() => {
				if (!el) return;
				el.style.transform = 'scaleX(0.60) scaleY(0.84)';
			});
		});

		// 760ms = 520ms transition + 240ms hold at the squished pose
		setTimeout(() => {
			if (!el) return;

			// ---- Snap: apply rigid class (triggers CSS d morph + face swap) ----
			el.classList.add('rigid');
			el.style.transition = 'none';
			el.style.transform = 'translateY(0)';

			requestAnimationFrame(() => {
				requestAnimationFrame(() => {
					if (!el) return;

					// Clunk down
					el.style.transition = 'transform 0.15s ease-in';
					el.style.transform = 'translateY(26px)';

					setTimeout(() => {
						if (!el) return;
						// 1st bounce — starts tilting right
						el.style.transition = 'transform 0.30s ease-out';
						el.style.transform = 'translateY(-24px) rotate(4deg)';

						setTimeout(() => {
							if (!el) return;
							// 2nd fall — tilts further right
							el.style.transition = 'transform 0.20s ease-in';
							el.style.transform = 'translateY(14px) rotate(7deg)';

							setTimeout(() => {
								if (!el) return;
								// 2nd bounce — smaller, stays tilted
								el.style.transition = 'transform 0.18s ease-out';
								el.style.transform = 'translateY(-10px) rotate(7deg)';

								setTimeout(() => {
									if (!el) return;
									// Settle — stays tilted (CSS class holds rotate(7deg))
									el.style.transition = 'transform 0.20s ease-in-out';
									el.style.transform = 'translateY(0) rotate(7deg)';

									setTimeout(() => {
										if (!el) return;
										el.style.cssText = ''; // falls back to .rigid rule: rotate(7deg)

										// Dwell rigid for 3 s, then melt back
										setTimeout(returnToIdle, 3000);
									}, 200);
								}, 180);
							}, 200);
						}, 300);
					}, 150);
				});
			});
		}, 760);
	}

	function returnToIdle() {
		if (!el) return;

		// Pin the current tilt as an inline style BEFORE removing .rigid.
		// Without this, removing the class drops the CSS rotate(7deg) rule instantly,
		// causing a snap. With it pinned inline, the element holds the same visual state.
		el.style.animation = 'none';
		el.style.transform = 'rotate(7deg)';

		// Remove .rigid — this triggers the CSS d transition (0.85s melt back to blob)
		// and the face swaps back, while the inline transform holds the tilt in place.
		el.classList.remove('rigid');

		// Double rAF so the browser commits the pinned rotation as the "before" state,
		// then ease the tilt back to 0° over the same duration as the body morph.
		requestAnimationFrame(() => {
			requestAnimationFrame(() => {
				if (!el) return;
				el.style.transition = 'transform 0.85s ease-out';
				el.style.transform = 'rotate(0deg)';

				setTimeout(() => {
					if (!el) return;
					el.style.cssText = ''; // clear everything — bob animation resumes
					busy = false;
				}, 850);
			});
		});
	}
</script>

<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
<div class="mascot-wrap" onclick={handleClick} title="Click me" role="button" tabindex="0">
	<svg class="mascot" viewBox="0 0 544 361" overflow="visible" aria-label="Mappy mascot">
		<g id="mm" bind:this={el}>

			<!-- body — morphs between blob and rigid polygon -->
			<g id="mm-body">
				<path id="mm-body-path"
					d="M47.3821 20.1406C65.3453 10.9984 113.67 40.1412 146.911 40.3256C180.152 40.51 221.811 49.8263 246.612 52.9722C271.413 56.1181 283.451 52.605 294.727 59.0753C306.002 65.5456 306.187 72.4536 314.703 74.2093C323.22 75.965 328.294 59.805 346.982 58.1434C365.669 56.4818 411.119 95.5113 434.601 98.4898C458.083 101.468 487.75 52.9863 502.085 59.1694C516.421 65.3525 538.55 63.9659 539.485 72.4814C541.171 87.8153 498.238 115.967 493.466 127.125C488.694 138.283 475.879 159.842 471.553 172.73C467.227 185.618 473.13 192.082 467.526 204.475C461.922 216.869 449.104 232.712 442.787 250.73C439.326 278.012 447.614 311.148 441.528 314.075C420.893 323.999 416.704 268.257 408.035 262.45C399.367 256.643 379.237 274.926 367.317 281.478C355.398 288.03 354.147 293.919 342.102 301.464C330.057 309.008 316.962 336.751 304.024 335.442C291.085 334.134 274.837 297.971 256.29 290.579C237.742 283.186 220.476 282.004 194.018 278.648C167.56 275.292 133.185 269.087 110.906 264.577C88.626 260.068 57.3012 242.154 57.3012 242.154C47.2353 231.472 40.013 212.916 36.6116 194.673C33.2102 176.43 32.1059 169.738 31.0233 149.107C29.9408 128.477 27.3555 100.762 28.6286 82.7788C29.9016 64.796 29.4189 29.2829 47.3821 20.1406Z"
				/>
			</g>

			<!-- face -->
			<g id="mm-face">

				<!-- blob face: soft eyes, brows, smile -->
				<g id="mm-blob-face">
					<g id="mm-eye-left">
						<path d="M199.978 143.097C212.033 143.989 222.547 148.137 229.809 153.941C237.087 159.758 240.828 166.967 240.297 174.155C239.765 181.343 235.004 187.924 226.95 192.607C218.913 197.28 207.903 199.836 195.848 198.945C183.792 198.053 173.278 193.905 166.016 188.101C158.739 182.284 154.997 175.075 155.528 167.887C156.06 160.699 160.822 154.118 168.876 149.435C176.913 144.762 187.922 142.206 199.978 143.097Z"/>
						<ellipse id="mm-pupil-left" cx="200.9" cy="171.1" rx="21" ry="15.8"/>
					</g>
					<g id="mm-eye-right">
						<path d="M350.721 153.893C362.72 155.365 373.021 160.015 379.995 166.163C386.984 172.323 390.374 179.705 389.496 186.859C388.619 194.013 383.545 200.357 375.275 204.646C367.022 208.925 355.902 210.948 343.903 209.477C331.905 208.005 321.604 203.354 314.63 197.207C307.641 191.047 304.251 183.665 305.128 176.511C306.006 169.357 311.08 163.013 319.35 158.724C327.603 154.444 338.722 152.421 350.721 153.893Z"/>
						<ellipse id="mm-pupil-right" cx="347.4" cy="182.2" rx="21" ry="15.8"/>
					</g>
					<g id="mm-eyebrows">
						<path id="mm-brow-left"  d="M236.436 123.66C226.98 115.177 192.072 97.6435 144.773 123.045"/>
						<path id="mm-brow-right" d="M314.622 131.081C330.261 121.914 356.603 117.662 393.051 142.148"/>
					</g>
					<path id="mm-mouth" d="M234 242C256.667 259.333 280.667 260.667 306 246"/>
				</g>

				<!-- rigid face: angular > < eyes, zigzag mouth -->
				<g id="mm-rigid-face">
					<path d="M199.027 129.607L241.527 169.107L199.027 186.107"/>
					<path d="M338.027 182.607L294.777 169.513L338.027 128.607"/>
					<path d="M329.527 218.107L319.027 229.107L298.027 206.607L273.027 229.107L247.527 206.607L225.527 229.107L209.027 218.107"/>
				</g>

			</g>
		</g>
	</svg>
</div>

<style>
	.mascot-wrap {
		display: flex;
		align-items: center;
		cursor: pointer;
	}

	.mascot {
		height: 32px;
		width: auto;
		display: block;
	}

	/* ---- transform context ---- */
	:global(#mm),
	:global(#mm *) {
		transform-box: fill-box;
		transform-origin: center;
	}

	/* ---- idle animations ---- */
	:global(#mm) {
		animation: mm-bob 3.4s ease-in-out infinite;
	}

	@keyframes mm-bob {
		0%, 100% { transform: rotate(-0.6deg); }
		50%       { transform: rotate(0.6deg);  }
	}

	:global(#mm-eye-left),
	:global(#mm-eye-right) {
		animation: mm-blink 4.6s ease-in-out infinite;
	}

	@keyframes mm-blink {
		0%, 92%, 100% { transform: scaleY(1);   }
		95%            { transform: scaleY(.08); }
	}

	:global(#mm-pupil-left),
	:global(#mm-pupil-right) {
		animation: mm-glance 5.2s ease-in-out infinite;
	}

	@keyframes mm-glance {
		0%,  20% { transform: translate(0,    0);   }
		30%, 44% { transform: translate(6px, -2px); }
		56%, 72% { transform: translate(-7px, 1px); }
		84%,100% { transform: translate(0,    0);   }
	}

	:global(#mm-brow-left),
	:global(#mm-brow-right) {
		animation: mm-browraise 5.2s ease-in-out infinite;
	}

	@keyframes mm-browraise {
		0%,  55%, 100% { transform: translateY(0);    }
		62%, 78%        { transform: translateY(-5px); }
	}

	/* ---- strokes / fills — no fill, grey-900 stroke ---- */
	:global(#mm-body-path) {
		fill: none;
		stroke: var(--grey-900);
		stroke-width: 14;
		stroke-linejoin: round;
		transition: d 0.85s cubic-bezier(0.25, 0.46, 0.45, 0.94);
	}

	:global(#mm-eye-left path),
	:global(#mm-eye-right path) {
		fill: none;
		stroke: var(--grey-900);
		stroke-width: 10;
	}

	:global(#mm-pupil-left),
	:global(#mm-pupil-right) {
		fill: var(--grey-900);
	}

	:global(#mm-brow-left),
	:global(#mm-brow-right) {
		fill: none;
		stroke: var(--grey-900);
		stroke-width: 10;
		stroke-linecap: round;
	}

	:global(#mm-mouth) {
		fill: none;
		stroke: var(--grey-900);
		stroke-width: 10;
		stroke-linecap: round;
	}

	:global(#mm-rigid-face path) {
		fill: none;
		stroke: var(--grey-900);
		stroke-width: 10;
		stroke-linecap: butt;
		stroke-linejoin: miter;
		stroke-miterlimit: 3;
	}

	/* ---- face swap (instant on snap) ---- */
	:global(#mm-blob-face)  { opacity: 1; }
	:global(#mm-rigid-face) { opacity: 0; }

	/* ---- rigid state ---- */
	:global(#mm.rigid) {
		animation: none;
		transform: rotate(7deg);
	}

	:global(#mm.rigid #mm-body-path) {
		transition: d 0.2s cubic-bezier(0.55, 0, 1, 0.45);
		stroke-linejoin: miter;
		stroke-miterlimit: 3;
		d: path("M 38.4107,18.7478 C 137.94,38.9328 137.94,38.9328 137.94,38.9328 C 237.641,51.5794 237.641,51.5794 237.641,51.5794 C 285.755,57.6825 285.755,57.6825 285.755,57.6825 C 305.732,72.8164 305.732,72.8164 305.732,72.8164 C 339.027,55.6072 339.027,55.6072 339.027,55.6072 C 425.63,97.097 425.63,97.097 425.63,97.097 C 493.114,57.7765 493.114,57.7765 493.114,57.7765 C 530.514,71.0885 530.514,71.0885 530.514,71.0885 C 484.494,125.732 484.494,125.732 484.494,125.732 C 469.027,170.107 469.027,170.107 469.027,170.107 C 458.554,203.083 458.554,203.083 458.554,203.083 C 433.815,249.337 433.815,249.337 433.815,249.337 C 432.556,312.682 432.556,312.682 432.556,312.682 C 399.064,261.057 399.064,261.057 399.064,261.057 C 361.527,283.607 361.527,283.607 361.527,283.607 C 333.131,300.071 333.131,300.071 333.131,300.071 C 295.052,334.049 295.052,334.049 295.052,334.049 C 247.318,289.186 247.318,289.186 247.318,289.186 C 185.047,277.255 185.047,277.255 185.047,277.255 C 101.934,263.185 101.934,263.185 101.934,263.185 C 48.3297,240.761 48.3297,240.761 48.3297,240.761 C 40.0273,190.107 40.0273,190.107 40.0273,190.107 C 33.5273,143.107 33.5273,143.107 33.5273,143.107 C 27.5273,79.6072 27.5273,79.6072 27.5273,79.6072 C 38.4107,18.7478 38.4107,18.7478 38.4107,18.7478 Z");
	}

	:global(#mm.rigid #mm-blob-face)  { opacity: 0; }
	:global(#mm.rigid #mm-rigid-face) { opacity: 1; }
</style>
