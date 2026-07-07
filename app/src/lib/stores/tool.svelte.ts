type Tool = 'pan' | 'select' | 'edit' | 'draw' | 'text';
export const toolState = $state({ active: 'pan' as Tool });
