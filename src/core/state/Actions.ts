import { Store } from './Store';

export interface HistoryEntry {
  id: string;
  mode: string;
  prompt: string;
  result: any;
  resultType: 'text' | 'image' | 'video' | 'audio' | 'other';
  timestamp: number;
}

export class Actions {
  constructor(private store: Store) {}

  // Example actions – will grow in later phases
  setTheme(theme: string): void {
    this.store.dispatch({ type: 'SET_THEME', payload: theme });
  }

  addProvider(provider: any): void {
    this.store.dispatch({ type: 'ADD_PROVIDER', payload: provider });
  }

  addHistoryEntry(entry: Omit<HistoryEntry, 'id' | 'timestamp'>): void {
    this.store.dispatch({
      type: 'ADD_HISTORY_ENTRY',
      payload: {
        ...entry,
        id: 'hist-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7),
        timestamp: Date.now(),
      },
    });
  }

  clearHistory(): void {
    this.store.dispatch({ type: 'CLEAR_HISTORY' });
  }

  // ... more actions
}
