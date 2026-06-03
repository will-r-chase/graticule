<script lang="ts">
	import ConfirmModal from '$lib/components/ui/ConfirmModal.svelte';
	import Modal from '$lib/components/ui/Modal.svelte';
	import ExportModal from './ExportModal.svelte';
	import MappyMascot from './MappyMascot.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import { Warning } from 'phosphor-svelte';
	import { prepareProject, downloadProject, loadProject, validateProject, formatBytes } from '$lib/utils/project';
	import { clearLayers } from '$lib/stores/layers.svelte';
	import { clearUploadedDatasets } from '$lib/stores/uploadedDatasets.svelte';
	import { projection } from '$lib/stores/projection.svelte';
	import { clearHistory, pushSnapshot, undo, redo, canUndo, canRedo } from '$lib/stores/history.svelte';

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
		<span class="beta-tag mono-small">Beta</span>
	</div>

	<div class="actions">
		<div class="separator"></div>
		<Button size="sm" disabled={!canUndo()} onclick={undo}>Undo</Button>
		<Button size="sm" disabled={!canRedo()} onclick={redo}>Redo</Button>
		<div class="separator"></div>
		<Button size="sm" onclick={handleNew}>New</Button>
		<Button size="sm" onclick={handleOpen}>Open</Button>
		<Button size="sm" onclick={handleSave}>Save</Button>
		<Button size="sm" onclick={() => activeModal = 'export'}>Export</Button>
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
			<Button variant="filled" onclick={() => activeModal = null}>OK</Button>
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
			<Button onclick={() => { activeModal = null; pendingSaveJson = null; }}>Cancel</Button>
			<Button variant="filled" onclick={confirmSave}>Save anyway</Button>
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

	.beta-tag {
		background-color: var(--blue-50);
		color: var(--blue-600);
		padding: 0 var(--space-s);
		border-radius: var(--radius);
		letter-spacing: 0.04em;
		margin-left: var(--space-s);
		font-size: 10px;
	}

	.actions {
		display: flex;
		align-items: center;
		gap: var(--space-l);
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


</style>
