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
