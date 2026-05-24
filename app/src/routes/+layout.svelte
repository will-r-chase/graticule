<script lang="ts">
	import favicon from '$lib/assets/favicon.svg';
	import '../app.css';
	import TopChrome from '$lib/components/top-chrome/TopChrome.svelte';

	let { children } = $props();
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
