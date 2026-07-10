import { Store } from './Store';

export class Actions {
  constructor(private store: Store) {}

  // Example actions – will grow in later phases
  setTheme(theme: string): void {
    this.store.dispatch({ type: 'SET_THEME', payload: theme });
  }

  addProvider(provider: any): void {
    this.store.dispatch({ type: 'ADD_PROVIDER', payload: provider });
  }

  // ... more actions
}
