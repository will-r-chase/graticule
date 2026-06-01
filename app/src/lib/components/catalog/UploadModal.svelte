<script lang="ts">
	import { UploadSimple, SpinnerGap, Warning, Check, Info } from 'phosphor-svelte';
	import Modal from '$lib/components/ui/Modal.svelte';
	import { parseFile, applyFixes, type UploadResult, type UploadIssue } from '$lib/utils/fileUpload';
	import { addUploadedDataset } from '$lib/stores/uploadedDatasets.svelte';
	import type { Topology } from 'topojson-specification';

	let { onclose, initialFile = null, initialResult = null }: {
		onclose: () => void;
		initialFile?: File | null;
		initialResult?: UploadResult | null;
	} = $props();

	let inputEl = $state<HTMLInputElement | null>(null);
	let selectedFile = $state<File | null>(initialFile);
	let parsing = $state(false);
	let converting = $state(false);
	let result = $state<UploadResult | null>(initialResult);

	// User choices
	let splitGeometry = $state(false);
	let swapCoords = $state(false);
	let csvLatCol = $state<string | null>(null);
	let csvLonCol = $state<string | null>(null);

	// When a result comes in, pre-populate CSV column selections from detected columns
	$effect(() => {
		if (result?.csvColumns?.detected) {
			csvLatCol = result.csvColumns.detected.lat;
			csvLonCol = result.csvColumns.detected.lon;
		} else if (result && !result.csvColumns) {
			csvLatCol = null;
			csvLonCol = null;
		}
	});

	async function handleFileChange(e: Event) {
		const files = (e.target as HTMLInputElement).files;
		const file = files?.[0] ?? null;
		if (!file) return;

		selectedFile = file;
		result = null;
		splitGeometry = false;
		swapCoords = false;
		csvLatCol = null;
		csvLonCol = null;
		parsing = true;

		try {
			result = await parseFile(file);
		} finally {
			parsing = false;
		}
	}

	function reset() {
		selectedFile = null;
		result = null;
		splitGeometry = false;
		swapCoords = false;
		csvLatCol = null;
		csvLonCol = null;
		if (inputEl) inputEl.value = '';
	}

	// CSV: assign a column to lat or lon role. Swaps if already assigned to the other.
	function assignCsvCol(col: string, role: 'lat' | 'lon') {
		if (role === 'lat') {
			if (csvLonCol === col) csvLonCol = null;
			csvLatCol = col;
		} else {
			if (csvLatCol === col) csvLatCol = null;
			csvLonCol = col;
		}
	}

	async function handleImport() {
		if (!result || !selectedFile) return;

		const baseName = selectedFile.name.replace(/\.[^.]+$/, '');

		// TopoJSON uploaded directly — topology is already ready, no conversion needed.
		if (result.topology) {
			addUploadedDataset(baseName, result.topology);
			onclose();
			return;
		}

		// All other formats: apply user fixes to get GeoJSON, then convert to TopoJSON.
		const collections = applyFixes(result, {
			swapCoordinates: swapCoords,
			splitGeometryTypes: splitGeometry,
			csvLatColumn: csvLatCol ?? undefined,
			csvLonColumn: csvLonCol ?? undefined,
		});
		if (collections.length === 0) return;

		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const ms = (window as any).mapshaper;
		if (!ms) {
			console.error('Mapshaper not loaded — cannot convert to TopoJSON');
			return;
		}

		converting = true;
		try {
			for (const fc of collections) {
				let name = baseName;
				if (collections.length > 1) {
					const type = fc.features[0]?.geometry?.type ?? 'Unknown';
					name = `${baseName} — ${type}`;
				}
				const output = await ms.applyCommands(
					'-i input.geojson -o output.topojson format=topojson',
					{ 'input.geojson': JSON.stringify(fc) }
				);
				const topology = JSON.parse(output['output.topojson']) as Topology;
				addUploadedDataset(name, topology);
			}
			onclose();
		} catch (e) {
			console.error('Failed to convert to TopoJSON:', e);
		} finally {
			converting = false;
		}
	}

	// Import is ready when: canProceed, and if CSV — both columns are chosen
	let canImport = $derived(
		!!result?.canProceed &&
		(!result.csvColumns || (!!csvLatCol && !!csvLonCol)) &&
		!converting
	);

	const levelOrder = { error: 0, warning: 1, info: 2 };
	function sortedIssues(issues: UploadIssue[]) {
		// Exclude the csv-columns-detected info — replaced by the table UI
		return [...issues]
			.filter(i => i.code !== 'csv-columns-detected')
			.sort((a, b) => levelOrder[a.level] - levelOrder[b.level]);
	}

	// Preview rows for CSV table (up to 5)
	let csvPreviewRows = $derived(result?.csvRows?.slice(0, 5) ?? []);
	let csvAllCols = $derived(result?.csvColumns?.all ?? []);
</script>

{#snippet footerContent()}
	<button class="text-btn mono-small" onclick={reset}>Reset</button>
	<button
		class="primary-btn mono-small"
		disabled={!canImport}
		onclick={handleImport}
	>
		Import
	</button>
{/snippet}

<Modal title="Upload data" {onclose} footer={selectedFile || result ? footerContent : undefined}>
	{#snippet children()}
		<!-- File picker -->
			<input
				bind:this={inputEl}
				type="file"
				accept=".geojson,.json,.topojson,.zip,.kml,.kmz,.gpx,.csv"
				onchange={handleFileChange}
				class="file-input"
				aria-label="Choose file"
			/>

			<div class="file-row">
				<button class="choose-btn" onclick={() => inputEl?.click()}>
					<UploadSimple size={16} />
					{selectedFile ? 'Choose different file' : 'Choose file'}
				</button>
				{#if selectedFile}
					<span class="filename mono-small">{selectedFile.name}</span>
				{:else}
					<span class="hint mono-small">GeoJSON, Shapefile (.zip), KML, KMZ, GPX, TopoJSON, CSV</span>
				{/if}
			</div>

			<!-- Parsing / converting spinners -->
			{#if parsing}
				<div class="status-row body-small">
					<SpinnerGap size={16} class="spin" />
					<span>Parsing…</span>
				</div>
			{/if}
			{#if converting}
				<div class="status-row body-small">
					<SpinnerGap size={16} class="spin" />
					<span>Converting to TopoJSON…</span>
				</div>
			{/if}

			<!-- Result -->
			{#if result}
				<!-- Summary line -->
				<div class="summary body-regular">
					{#if result.canProceed}
						<Check size={13} color="var(--color-text-primary)" />
						{result.featureCount.toLocaleString()} feature{result.featureCount === 1 ? '' : 's'}
						{#if result.geometryTypes.length}
							· {result.geometryTypes.join(', ')}
						{/if}
					{:else}
						Could not import this file.
					{/if}
				</div>

				<!-- Issues list (excluding csv-columns-detected which becomes the table) -->
				{#if sortedIssues(result.issues).length}
					<ul class="issues">
						{#each sortedIssues(result.issues) as issue}
							<li class="issue body-small issue--{issue.level}">
								{#if issue.level === 'error'}
									<Warning size={13} />
								{:else if issue.level === 'warning'}
									<Warning size={13} />
								{:else}
									<Info size={13} />
								{/if}
								<span>{issue.message}</span>
							</li>
							{#if issue.code === 'coordinate-swap'}
								<li class="issue-action mono-small">
									<label class="radio-row">
										<input type="checkbox" bind:checked={swapCoords} />
										Swap latitude and longitude
									</label>
								</li>
							{/if}
						{/each}
					</ul>
				{/if}

				<!-- Split geometry choice -->
				{#if result.hasMixedGeometries}
					<div class="split-options mono-small">
						<label class="radio-row">
							<input type="radio" name="split" value="one" checked={!splitGeometry} onchange={() => splitGeometry = false} />
							Import as one layer
						</label>
						<label class="radio-row">
							<input type="radio" name="split" value="split" checked={splitGeometry} onchange={() => splitGeometry = true} />
							Split into separate layers by geometry type
						</label>
					</div>
				{/if}

				<!-- CSV column picker table -->
				{#if result.csvColumns && csvPreviewRows.length > 0}
					<div class="csv-section">
						<p class="csv-hint body-small">
							Click a column header to assign it as the latitude or longitude source.
						</p>
						<div class="csv-table-wrap">
							<table class="csv-table">
								<thead>
									<tr>
										{#each csvAllCols as col}
											<th class:lat={csvLatCol === col} class:lon={csvLonCol === col}>
												<div class="col-header">
													<span class="col-name">{col}</span>
													<div class="col-badges">
														<button
															class="badge badge-lat"
															class:active={csvLatCol === col}
															onclick={() => assignCsvCol(col, 'lat')}
														>LAT</button>
														<button
															class="badge badge-lon"
															class:active={csvLonCol === col}
															onclick={() => assignCsvCol(col, 'lon')}
														>LON</button>
													</div>
												</div>
											</th>
										{/each}
									</tr>
								</thead>
								<tbody>
									{#each csvPreviewRows as row}
										<tr>
											{#each csvAllCols as col}
												<td class:lat={csvLatCol === col} class:lon={csvLonCol === col}>
													{row[col] ?? ''}
												</td>
											{/each}
										</tr>
									{/each}
								</tbody>
							</table>
						</div>
					</div>
				{/if}
		{/if}
	{/snippet}
</Modal>

<style>
	/* File picker */
	.file-input { display: none; }

	.file-row {
		display: flex;
		align-items: center;
		gap: var(--space-m);
		flex-wrap: wrap;
	}

	.choose-btn {
		display: flex;
		align-items: center;
		gap: var(--space-s);
		height: 32px;
		padding: 0 var(--space-m);
		border-radius: var(--radius);
		border: 1px solid var(--color-border);
		background: var(--color-surface-primary);
		color: var(--color-text-primary);
		font-family: var(--font-mono);
		font-size: 12px;
		cursor: pointer;
		flex-shrink: 0;
	}

	.choose-btn:hover {
		background: var(--color-surface-secondary);
		border-color: var(--color-text-primary);
	}

	.filename { color: var(--color-text-primary); }
	.hint { color: var(--color-text-tertiary); }

	/* Status / summary */
	.status-row {
		display: flex;
		align-items: center;
		gap: var(--space-s);
		color: var(--color-text-tertiary);
	}

	.summary {
		display: flex;
		align-items: center;
		gap: var(--space-s);
		color: var(--color-text-primary);
	}

	/* Issues */
	.issues {
		list-style: none;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-s);
	}

	.issue {
		display: flex;
		align-items: flex-start;
		gap: var(--space-s);
		line-height: 1.5;
	}

	.issue :global(svg) { flex-shrink: 0; margin-top: 2px; }

	.issue-action {
		list-style: none;
		padding-left: calc(13px + var(--space-s));
	}

	.issue--error   { color: var(--color-error, #e53e3e); }
	.issue--warning { color: var(--color-warning, #d97706); }
	.issue--info    { color: var(--color-text-tertiary); }

	/* Split geometry options */
	.split-options {
		display: flex;
		flex-direction: column;
		gap: var(--space-s);
		padding-left: calc(13px + var(--space-s));
	}

	.radio-row {
		display: flex;
		align-items: center;
		gap: var(--space-s);
		color: var(--color-text-primary);
		cursor: pointer;
	}

	.radio-row input[type="radio"],
	.radio-row input[type="checkbox"] {
		appearance: none;
		-webkit-appearance: none;
		width: 14px;
		height: 14px;
		border: 1.5px solid var(--color-border);
		background: transparent;
		cursor: pointer;
		flex-shrink: 0;
		margin: 0;
		transition: border-color 100ms;
	}

	.radio-row input[type="radio"] {
		border-radius: 50%;
	}

	.radio-row input[type="checkbox"] {
		border-radius: 2px;
	}

	.radio-row input[type="radio"]:not(:checked):hover,
	.radio-row input[type="checkbox"]:not(:checked):hover {
		border-color: var(--color-accent);
	}

	.radio-row input[type="radio"]:checked {
		border-color: var(--color-accent);
		background: radial-gradient(circle, var(--color-accent) 38%, transparent 38%);
	}

	.radio-row input[type="checkbox"]:checked {
		border-color: var(--color-accent);
		background-color: var(--color-accent);
		background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 10 10'%3E%3Cpath d='M1.5 5l2.5 2.5 4.5-4.5' stroke='%23ffffff' stroke-width='1.5' fill='none' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
		background-size: 10px;
		background-repeat: no-repeat;
		background-position: center;
	}

	/* CSV table */
	.csv-section {
		display: flex;
		flex-direction: column;
		gap: var(--space-s);
	}

	.csv-hint {
		color: var(--color-text-tertiary);
		margin: 0;
	}

	.csv-table-wrap {
		overflow-x: auto;
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
	}

	.csv-table {
		border-collapse: collapse;
		font-family: var(--font-mono);
		font-size: 12px;
		line-height: 18px;
		width: 100%;
		min-width: max-content;
	}

	.csv-table th {
		padding: var(--space-s) var(--space-m);
		background: var(--color-surface-secondary);
		border-bottom: 1px solid var(--color-border);
		text-align: left;
		white-space: nowrap;
		font-weight: 500;
		color: var(--color-text-secondary);
	}

	.csv-table td {
		padding: var(--space-xs) var(--space-m);
		border-bottom: 1px solid var(--color-border);
		color: var(--color-text-tertiary);
		white-space: nowrap;
		max-width: 120px;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.csv-table tr:last-child td { border-bottom: none; }

	/* Highlighted lat/lon columns */
	.csv-table th.lat,
	.csv-table td.lat {
		background: color-mix(in srgb, var(--purple-500) 10%, transparent);
	}

	.csv-table th.lon,
	.csv-table td.lon {
		background: color-mix(in srgb, var(--blue-500) 12%, transparent);
	}

	/* Column header with badges */
	.col-header {
		display: flex;
		flex-direction: column;
		gap: 3px;
	}

	.col-badges {
		display: flex;
		gap: 3px;
	}

	.badge {
		font-family: var(--font-mono);
		font-size: 10px;
		line-height: 16px;
		font-weight: 400;
		padding: 0 var(--space-s);
		border-radius: 3px;
		border: 1px solid transparent;
		cursor: pointer;
		opacity: 0.7;
		transition: opacity 100ms;
	}

	.badge:hover { opacity: 1; }

	.badge-lat {
		background: color-mix(in srgb, var(--purple-500) 15%, transparent);
		border-color: var(--purple-500);
		color: var(--purple-600);
	}

	.badge-lat.active {
		background: var(--purple-500);
		color: var(--color-text-invert);
		opacity: 1;
	}

	.badge-lon {
		background: color-mix(in srgb, var(--blue-500) 15%, transparent);
		border-color: var(--blue-500);
		color: var(--blue-600);
	}

	.badge-lon.active {
		background: var(--blue-500);
		color: var(--color-text-invert);
		opacity: 1;
	}

	/* Footer buttons */
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
		color: var(--color-text-invert);
		cursor: pointer;
	}

	.primary-btn:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	.primary-btn:not(:disabled):hover { filter: brightness(1.1); }

	/* Spinner */
	:global(.spin) { animation: spin 0.8s linear infinite; }

	@keyframes spin { to { transform: rotate(360deg); } }
</style>
