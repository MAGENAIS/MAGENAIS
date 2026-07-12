import { Store, AppState } from './Store';

type ReducerFn = (state: AppState, payload: any) => AppState;

export class Reducers {
  private reducers: Map<string, ReducerFn> = new Map();

  constructor(private store: Store) {
    this.registerBuiltinReducers();
  }

  private registerBuiltinReducers(): void {
    this.reducers.set('SET_THEME', (state, payload) => ({
      ...state,
      theme: payload,
    }));

    this.reducers.set('ADD_PROVIDER', (state, payload) => ({
      ...state,
      providers: [...state.providers, payload],
    }));

    this.reducers.set('ADD_HISTORY_ENTRY', (state, payload) => ({
      ...state,
      // newest first, capped so localStorage doesn't grow unbounded
      history: [payload, ...state.history].slice(0, 60),
    }));

    this.reducers.set('UPDATE_HISTORY_ENTRY', (state, payload: { id: string; patch: Partial<AppState['history'][number]> }) => ({
      ...state,
      history: state.history.map(h => (h.id === payload.id ? { ...h, ...payload.patch } : h)),
    }));

    this.reducers.set('CLEAR_HISTORY', (state) => ({
      ...state,
      history: [],
    }));

    // More reducers will be added later
  }

  getReducer(actionType: string): ReducerFn | undefined {
    return this.reducers.get(actionType);
  }

  registerReducer(actionType: string, reducer: ReducerFn): void {
    if (this.reducers.has(actionType)) {
      console.warn(`Reducer for ${actionType} already exists, overwriting`);
    }
    this.reducers.set(actionType, reducer);
  }
}
