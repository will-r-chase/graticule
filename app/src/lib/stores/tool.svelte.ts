type Tool = 'pan' | 'select' | 'edit' | 'draw';
export const toolState = $state({ active: 'pan' as Tool });
