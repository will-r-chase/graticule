<script lang="ts">
	import ConfirmModal from '$lib/components/ui/ConfirmModal.svelte';
	import Modal from '$lib/components/ui/Modal.svelte';
	import ExportModal from './ExportModal.svelte';
	import MappyMascot from './MappyMascot.svelte';
	import { Warning } from 'phosphor-svelte';
	import { prepareProject, downloadProject, loadProject, validateProject, formatBytes } from '$lib/utils/project';
	import { clearLayers } from '$lib/stores/layers.svelte';
	import { clearUploadedDatasets } from '$lib/stores/uploadedDatasets.svelte';
	import { projection } from '$lib/stores/projection.svelte';
	import { clearHistory, pushSnapshot, undo, redo, canUndo, canRedo } from '$lib/stores/history.svelte';
	import { debug } from '$lib/stores/debug.svelte';

	let fileInputEl = $state<HTMLInputElement | null>(null);

	// Modal state
	type ModalKind = 'confirm-new' | 'confirm-open' | 'size-warning' | 'open-error' | 'export' | null;
	let activeModal = $state<ModalKind>(null);
	let pendingJson = $state<string | null>(null);      // file content waiting for confirm-open
	let pendingSaveJson = $state<string | null>(null);  // serialized project waiting past size warning
	let pendingSaveSize = $state(0);

	// --- New ---

	function handleNew() {
		activeModal = 'confirm-new';
	}

	function confirmNew() {
		clearLayers();
		clearUploadedDatasets();
		projection.id = 'geoMercator';
		clearHistory();
		pushSnapshot(); // baseline so first action after New is undoable
		activeModal = null;
	}

	// --- Open ---

	function handleOpen() {
		activeModal = 'confirm-open';
	}

	function confirmOpen() {
		activeModal = null;
		fileInputEl?.click();
	}

	function handleFileChange(e: Event) {
		const file = (e.target as HTMLInputElement).files?.[0];
		if (!file) return;

		const reader = new FileReader();
		reader.onload = () => {
			try {
				const json = reader.result as string;
				validateProject(json);
				loadProject(json);
				clearHistory();
				pushSnapshot(); // baseline so first action after Open is undoable
			} catch {
				activeModal = 'open-error';
			}
		};
		reader.readAsText(file);

		// Reset input so the same file can be re-opened
		(e.target as HTMLInputElement).value = '';
	}

	// --- Save ---

	function handleSave() {
		const result = prepareProject();
		if (result.overLimit) {
			pendingSaveJson = result.json;
			pendingSaveSize = result.sizeBytes;
			activeModal = 'size-warning';
		} else {
			downloadProject(result.json);
		}
	}

	function confirmSave() {
		if (pendingSaveJson) downloadProject(pendingSaveJson);
		pendingSaveJson = null;
		pendingSaveSize = 0;
		activeModal = null;
	}
</script>

<header class="top-chrome">
	<div class="brand-group">
		<MappyMascot />
		<h2 class="brand">Mappy</h2>
	</div>

	<div class="actions">
		<a class="mono-regular experiments-link" href="/experiments">Experiments</a>
		<button class="mono-regular debug-btn" class:active={debug.enabled} onclick={() => debug.enabled = !debug.enabled}>Debug</button>
		<div class="separator"></div>
		<button class="mono-regular" disabled={!canUndo()} onclick={undo}>Undo</button>
		<button class="mono-regular" disabled={!canRedo()} onclick={redo}>Redo</button>
		<div class="separator"></div>
		<button class="mono-regular" onclick={handleNew}>New</button>
		<button class="mono-regular" onclick={handleOpen}>Open</button>
		<button class="mono-regular" onclick={handleSave}>Save</button>
		<button class="mono-regular" onclick={() => activeModal = 'export'}>Export</button>
	</div>
</header>

<!-- Hidden file input for Open -->
<input
	bind:this={fileInputEl}
	type="file"
	accept=".json"
	onchange={handleFileChange}
	style="display: none"
	aria-hidden="true"
/>

<!-- New: confirm replacing session -->
{#if activeModal === 'confirm-new'}
	<ConfirmModal
		title="New project"
		message="This will clear your current session. Any unsaved work will be lost."
		confirmLabel="Start new"
		onconfirm={confirmNew}
		oncancel={() => activeModal = null}
	/>
{/if}

<!-- Open: confirm replacing session before picking file -->
{#if activeModal === 'confirm-open'}
	<ConfirmModal
		title="Open project"
		message="Opening a file will replace your current session. Any unsaved work will be lost."
		confirmLabel="Choose file"
		onconfirm={confirmOpen}
		oncancel={() => activeModal = null}
	/>
{/if}

<!-- Open: file is not a valid project -->
{#if activeModal === 'open-error'}
	<Modal title="Couldn't open file" onclose={() => activeModal = null} width="400px">
		{#snippet children()}
			<div class="error-message body-regular">
				<Warning size={16} weight="fill" class="error-icon" />
				<span>This file doesn't appear to be a valid Mappy project. Please choose a .json file saved from Mappy.</span>
			</div>
		{/snippet}
		{#snippet footer()}
			<button class="primary-btn mono-regular" onclick={() => activeModal = null}>OK</button>
		{/snippet}
	</Modal>
{/if}

<!-- Export -->
{#if activeModal === 'export'}
	<ExportModal onclose={() => activeModal = null} />
{/if}

<!-- Save: file is large, warn before downloading -->
{#if activeModal === 'size-warning'}
	<Modal
		title="Large project file"
		onclose={() => { activeModal = null; pendingSaveJson = null; }}
		width="400px"
	>
		{#snippet children()}
			<p class="body-regular message">
				This project file will be <strong>{formatBytes(pendingSaveSize)}</strong> because it contains large uploaded datasets. Do you want to continue?
			</p>
		{/snippet}
		{#snippet footer()}
			<button class="text-btn mono-small" onclick={() => { activeModal = null; pendingSaveJson = null; }}>Cancel</button>
			<button class="primary-btn mono-small" onclick={confirmSave}>Save anyway</button>
		{/snippet}
	</Modal>
{/if}

<style>
	.top-chrome {
		height: var(--space-xxl);
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0 var(--space-l);
		border-bottom: 1px solid var(--color-border);
		background-color: var(--color-surface-primary);
	}

	.brand-group {
		display: flex;
		align-items: center;
		gap: var(--space-m);
	}

	/* Global h2 styles carry font-family, font-size, font-weight.
	   Only override what the global rule doesn't set. */
	.brand {
		margin: 0;
		color: var(--color-text-primary);
	}

	.actions {
		display: flex;
		align-items: center;
		gap: var(--space-l);
	}

	button {
		height: 28px;
		padding: 0 var(--space-m);
		border-radius: var(--radius);
		border: none;
		background: transparent;
		color: var(--color-text-primary);
		font-family: var(--font-mono);
		cursor: pointer;
	}

	button:hover:not(:disabled) {
		background-color: var(--color-surface-tertiary);
	}

	button:disabled {
		opacity: 0.35;
		cursor: default;
	}

	.experiments-link {
		text-decoration: none;
		color: var(--color-text-secondary);
		height: 28px;
		padding: 0 var(--space-m);
		border-radius: var(--radius);
		display: flex;
		align-items: center;
	}

	.experiments-link:hover {
		background-color: var(--color-surface-tertiary);
		color: var(--color-text-primary);
	}

	.debug-btn.active {
		background-color: var(--color-surface-tertiary);
		color: var(--color-accent);
	}

	.separator {
		width: 1px;
		height: 16px;
		background: var(--color-border);
		flex-shrink: 0;
	}

	.message {
		color: var(--color-text-secondary);
		margin: 0;
	}

	.error-message {
		display: flex;
		align-items: flex-start;
		gap: var(--space-s);
		color: var(--color-text-secondary);
	}

	.error-message :global(svg) {
		color: var(--color-error, #e53e3e);
		flex-shrink: 0;
		margin-top: 2px;
	}

	.text-btn {
		height: 32px;
		padding: 0 var(--space-m);
		border: none;
		background: transparent;
		color: var(--color-text-secondary);
		cursor: pointer;
		border-radius: var(--radius);
	}

	.text-btn:hover { background: var(--color-surface-secondary); }

	.primary-btn {
		height: 32px;
		padding: 0 var(--space-m);
		border-radius: var(--radius);
		border: none;
		background: var(--color-accent);
		color: white;
		cursor: pointer;
	}

	.primary-btn:hover { filter: brightness(1.1); }
</style>
