import { Persistence } from './Persistence';
import { Actions } from './Actions';
import { Reducers } from './Reducers';
import { Selectors } from './Selectors';

export interface AppState {
  providers: any[];      // will be typed later
  plugins: any[];
  settings: Record<string, any>;
  currentWorkflow: any;
  history: any[];
  gallery: any[];
  assets: any[];
  projects: any[];
  userPreferences: Record<string, any>;
  theme: string;
}

const initialState: AppState = {
  providers: [],
  plugins: [],
  settings: {},
  currentWorkflow: null,
  history: [],
  gallery: [],
  assets: [],
  projects: [],
  userPreferences: {},
  theme: 'dark',
};

export class Store {
  private state: AppState = initialState;
  private persistence: Persistence;
  private actions: Actions;
  private reducers: Reducers;
  public selectors: Selectors;

  constructor(persistence: Persistence) {
    this.persistence = persistence;
    this.actions = new Actions(this);
    this.reducers = new Reducers(this);
    this.selectors = new Selectors(this);
  }

  getState(): AppState {
    return this.state;
  }

  getPersistence(): Persistence {
    return this.persistence;
  }

  // Dispatch an action: update state via reducer
  dispatch(action: { type: string; payload?: any }): void {
    const reducer = this.reducers.getReducer(action.type);
    if (!reducer) {
      console.warn(`No reducer for action type: ${action.type}`);
      return;
    }
    const newState = reducer(this.state, action.payload);
    this.state = newState;
    // ROOT CAUSE (Priority 3 — provider API keys lost on every restart):
    // Store, ProviderManager, AssetManager, and ProjectManager all share one
    // Persistence instance / localStorage key. AssetManager and
    // ProjectManager correctly read-merge-write (`load() || {}`, patch their
    // own slice, `save()`), but Store used to call `persistence.save(this.state)`
    // directly — replacing the ENTIRE stored blob with just AppState's shape
    // (which has its own always-empty `providers: []`) on every single
    // dispatch, including the `ADD_HISTORY_ENTRY` dispatched after every
    // successful Generate. That silently wiped out whatever
    // ProviderManager.saveProviders() had just written moments earlier.
    // Fire-and-forget to match the previous (synchronous-looking) call
    // signature of dispatch(), but now merges instead of clobbering.
    this.persistMerged();
  }

  private async persistMerged(): Promise<void> {
    const existing = (await this.persistence.load()) || {};
    // Only merge in the slices Store actually owns/mutates via its
    // reducers. `providers`, `assets`, and `projects` are separately owned
    // by ProviderManager / AssetManager / ProjectManager (each of which
    // reads the shared blob, patches only its own slice, and writes it
    // back) — Store's copies of those fields are never populated by any
    // reducer, so blindly including them here would silently zero them
    // back out on every dispatch, reintroducing the exact clobbering bug
    // this fix exists to prevent.
    const { providers, assets, projects, ...ownedState } = this.state;
    await this.persistence.save({ ...existing, ...ownedState });
  }

  async load(): Promise<void> {
    const saved = await this.persistence.load();
    if (saved) {
      this.state = { ...initialState, ...saved };
    }
  }

  async persist(): Promise<void> {
    await this.persistMerged();
  }

  // Expose action creators
  getActions(): Actions {
    return this.actions;
  }
}
