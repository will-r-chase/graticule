<script lang="ts">
	import favicon from '$lib/assets/favicon.svg';
	import '../app.css';
	import TopChrome from '$lib/components/top-chrome/TopChrome.svelte';
	import { onMount } from 'svelte';

	let { children } = $props();

	// Load Mapshaper for use in the processing pipeline (simplification, GeoJSON→TopoJSON conversion).
	// modules.js must load first — it sets up window.modules (flatbush, mproj, buffer) that
	// mapshaper.js depends on. Both files are copied from node_modules/mapshaper/www/ into static/.
	function loadScript(src: string): Promise<void> {
		return new Promise((resolve, reject) => {
			const el = document.createElement('script');
			el.src = src;
			el.onload = () => resolve();
			el.onerror = () => reject(new Error(`Failed to load ${src}`));
			document.head.appendChild(el);
		});
	}

	onMount(async () => {
		try {
			await loadScript('/mapshaper-modules.js');
			await loadScript('/mapshaper.js');
		} catch (e) {
			console.error('Failed to load Mapshaper:', e);
		}
	});
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

<div class="app">
	<TopChrome />
	<main>
		{@render children()}
	</main>
</div>

<style>
	.app {
		display: flex;
		flex-direction: column;
		height: 100vh;
	}

	main {
		flex: 1;
		overflow: hidden;
	}
</style>
