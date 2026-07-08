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

  // Dispatch an action: update state via reducer
  dispatch(action: { type: string; payload?: any }): void {
    const reducer = this.reducers.getReducer(action.type);
    if (!reducer) {
      console.warn(`No reducer for action type: ${action.type}`);
      return;
    }
    const newState = reducer(this.state, action.payload);
    this.state = newState;
    this.persistence.save(this.state);
  }

  async load(): Promise<void> {
    const saved = await this.persistence.load();
    if (saved) {
      this.state = { ...initialState, ...saved };
    }
  }

  async persist(): Promise<void> {
    await this.persistence.save(this.state);
  }

  // Expose action creators
  getActions(): Actions {
    return this.actions;
  }
}
