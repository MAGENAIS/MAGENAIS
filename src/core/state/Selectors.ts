import { Store, AppState } from './Store';

export class Selectors {
  constructor(private store: Store) {}

  getTheme(): string {
    return this.store.getState().theme;
  }

  getProviders(): any[] {
    return this.store.getState().providers;
  }

  getHistory(): any[] {
    return this.store.getState().history;
  }

  // More selectors
}
