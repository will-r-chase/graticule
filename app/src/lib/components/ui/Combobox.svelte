<script lang="ts">
	import { CaretDown, Check } from 'phosphor-svelte';

	interface Option {
		id: string;
		label: string;
		group?: string;
		italic?: boolean;
	}

	let {
		options,
		value = $bindable(''),
		placeholder = 'Search...',
		direction = 'down',
		disabled = false,
		onchange,
	}: {
		options: Option[];
		value: string;
		placeholder?: string;
		direction?: 'up' | 'down';
		disabled?: boolean;
		onchange?: (id: string) => void;
	} = $props();

	let open = $state(false);
	let search = $state('');
	let highlightedIndex = $state(-1);

	let containerEl = $state<HTMLDivElement | null>(null);
	let triggerEl = $state<HTMLDivElement | null>(null);
	let inputEl = $state<HTMLInputElement | null>(null);
	let listEl = $state<HTMLUListElement | null>(null);

	// The dropdown renders position:fixed (computed from the trigger rect) so it escapes any
	// ancestor `overflow: hidden` — e.g. the layer accordion that clips its rounded corners.
	let menuStyle = $state('');
	$effect(() => {
		if (!open || !triggerEl) return;
		const rect = triggerEl.getBoundingClientRect();
		const gap = 4;
		if (direction === 'up') {
			menuStyle = `bottom: ${window.innerHeight - rect.top + gap}px; left: ${rect.left}px; width: ${rect.width}px;`;
		} else {
			menuStyle = `top: ${rect.bottom + gap}px; left: ${rect.left}px; width: ${rect.width}px;`;
		}
	});

	// Label of the currently selected option, shown when the dropdown is closed.
	let selectedLabel = $derived(options.find((o) => o.id === value)?.label ?? '');
	let selectedItalic = $derived(options.find((o) => o.id === value)?.italic ?? false);

	// Options filtered by the current search string.
	let filteredOptions = $derived(
		search.trim() === ''
			? options
			: options.filter((o) => o.label.toLowerCase().includes(search.toLowerCase()))
	);

	// Filtered options grouped by their `group` field, preserving insertion order.
	let groupedOptions = $derived.by(() => {
		const groups = new Map<string, Option[]>();
		for (const option of filteredOptions) {
			const g = option.group ?? '';
			if (!groups.has(g)) groups.set(g, []);
			groups.get(g)!.push(option);
		}
		return [...groups.entries()].map(([group, opts]) => ({ group, opts }));
	});

	// Close when clicking outside the component.
	$effect(() => {
		if (!open) return;
		function handleOutsideClick(e: MouseEvent) {
			if (!containerEl?.contains(e.target as Node)) {
				open = false;
				search = '';
				highlightedIndex = -1;
			}
		}
		document.addEventListener('click', handleOutsideClick);
		return () => document.removeEventListener('click', handleOutsideClick);
	});

	// Scroll the highlighted item into view when navigating with keyboard.
	$effect(() => {
		if (highlightedIndex < 0 || !listEl) return;
		const item = listEl.querySelector(`[data-index="${highlightedIndex}"]`);
		item?.scrollIntoView({ block: 'nearest' });
	});

	function select(option: Option) {
		value = option.id;
		open = false;
		search = '';
		highlightedIndex = -1;
		onchange?.(option.id);
	}

	function handleInputClick() {
		if (disabled) return;
		open = true;
		search = '';
		highlightedIndex = -1;
		inputEl?.focus();
	}

	function handleInput(e: Event) {
		search = (e.target as HTMLInputElement).value;
		highlightedIndex = -1;
		open = true;
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'ArrowDown') {
			e.preventDefault();
			if (!open) { open = true; return; }
			highlightedIndex = Math.min(highlightedIndex + 1, filteredOptions.length - 1);
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			highlightedIndex = Math.max(highlightedIndex - 1, 0);
		} else if (e.key === 'Enter') {
			e.preventDefault();
			if (highlightedIndex >= 0 && filteredOptions[highlightedIndex]) {
				select(filteredOptions[highlightedIndex]);
			}
		} else if (e.key === 'Escape') {
			open = false;
			search = '';
			highlightedIndex = -1;
		}
	}
</script>

<div class="combobox" bind:this={containerEl}>
	<div class="trigger" class:disabled bind:this={triggerEl} onclick={handleInputClick}>
		<input
			class="body-regular"
			class:italic={!open && selectedItalic}
			bind:this={inputEl}
			type="text"
			value={open ? search : selectedLabel}
			oninput={handleInput}
			onkeydown={handleKeydown}
			{placeholder}
			{disabled}
			role="combobox"
			aria-expanded={open}
			aria-autocomplete="list"
			autocomplete="off"
			spellcheck="false"
		/>
		<span class="caret">
			<span class="caret-icon" class:open>
				<CaretDown size={12} weight="bold" />
			</span>
		</span>
	</div>

	{#if open}
		<ul class="dropdown" style={menuStyle} bind:this={listEl} role="listbox">
			{#if filteredOptions.length === 0}
				<li class="empty mono-small">No results</li>
			{:else}
				{#each groupedOptions as { group, opts }}
					{#if group}
						<li role="presentation"><h4>{group}</h4></li>
					{/if}
					{#each opts as option}
						{@const flatIndex = filteredOptions.indexOf(option)}
						<li
							role="option"
							aria-selected={option.id === value}
							data-index={flatIndex}
							class="body-regular"
							class:italic={option.italic}
							class:highlighted={flatIndex === highlightedIndex}
							class:selected={option.id === value}
							onclick={() => select(option)}
							onmouseenter={() => (highlightedIndex = flatIndex)}
						>
							{option.label}
							{#if option.id === value}
								<span class="check"><Check size={12} weight="bold" /></span>
							{/if}
						</li>
					{/each}
				{/each}
			{/if}
		</ul>
	{/if}
</div>

<style>
	.combobox {
		position: relative;
		width: 100%;
	}

	.trigger {
		display: flex;
		align-items: center;
		height: 32px;
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
		background-color: var(--color-surface-primary);
		cursor: pointer;
	}

	.trigger:focus-within {
		outline: 2px solid var(--color-accent);
		outline-offset: -1px;
	}

	.trigger.disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.trigger.disabled input {
		cursor: not-allowed;
	}

	input {
		flex: 1;
		height: 100%;
		padding: 0 var(--space-m);
		border: none;
		background: transparent;
		color: var(--color-text-primary);
		cursor: pointer;
		outline: none;
		min-width: 0;
	}

	input::placeholder {
		color: var(--color-text-tertiary);
	}

	.caret {
		display: flex;
		align-items: center;
		padding-right: var(--space-m);
		color: var(--color-text-tertiary);
		pointer-events: none;
	}

	.caret-icon {
		display: flex;
		transition: transform 200ms linear;
	}

	.caret-icon.open {
		transform: rotate(180deg);
	}

	.dropdown {
		position: fixed;
		max-height: 280px;
		overflow-y: auto;
		background-color: var(--color-surface-primary);
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
		z-index: 50;
		list-style: none;
		margin: 0;
		padding: var(--space-m);
	}

	li:has(h4) {
		padding: var(--space-l) var(--space-m) var(--space-xs);
		user-select: none;
	}

	li:has(h4):first-child {
		padding-top: var(--space-xs);
	}

	li[role='option'] {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: var(--space-s) var(--space-m) var(--space-s) calc(var(--space-m) + var(--space-s));
		color: var(--color-text-primary);
		cursor: pointer;
	}

	li[role='option'].highlighted {
		background-color: var(--color-surface-secondary);
	}

	li[role='option'].highlighted.selected {
		background-color: var(--color-surface-secondary);
	}

	.check {
		display: flex;
		flex-shrink: 0;
		color: var(--color-icon-primary);
	}

	.empty {
		padding: var(--space-m);
		color: var(--color-text-tertiary);
	}

	.italic {
		font-style: italic;
	}
</style>
