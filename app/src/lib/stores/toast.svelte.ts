interface Toast {
	id: string;
	message: string;
}

let toasts = $state<Toast[]>([]);

export function showToast(message: string, duration = 6000): void {
	const id = Math.random().toString(36).slice(2, 9);
	toasts.push({ id, message });
	setTimeout(() => {
		const i = toasts.findIndex((t) => t.id === id);
		if (i !== -1) toasts.splice(i, 1);
	}, duration);
}

export function dismissToast(id: string): void {
	const i = toasts.findIndex((t) => t.id === id);
	if (i !== -1) toasts.splice(i, 1);
}

export { toasts };
