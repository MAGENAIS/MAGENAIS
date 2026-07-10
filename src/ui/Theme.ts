/**
 * Theme Engine – manages CSS variables and theme switching.
 * Dark theme is the default, mirroring the original MAGENAIS design.
 */
export type ThemeName = 'dark' | 'light';

export interface Theme {
  name: ThemeName;
  variables: Record<string, string>;
}

const DARK_THEME: Theme = {
  name: 'dark',
  variables: {
    '--bg': '#0c0e0d',
    '--bg-raised': '#141716',
    '--bg-panel': '#181b19',
    '--line': '#292e2b',
    '--line-bright': '#3c433e',
    '--ink': '#eaede8',
    '--ink-dim': '#99a39b',
    '--ink-faint': '#5b645e',
    '--amber': '#e8a23d',
    '--amber-dim': '#6b5430',
    '--moss': '#7fae6f',
    '--rust': '#c4644a',
    '--azure': '#5b9bd5',
    '--mono': '"IBM Plex Mono", "SF Mono", Consolas, monospace',
    '--sans': '"IBM Plex Sans", "Inter", system-ui, sans-serif',
    '--radius': '3px',
  },
};

const LIGHT_THEME: Theme = {
  name: 'light',
  variables: {
    '--bg': '#f5f5f5',
    '--bg-raised': '#ffffff',
    '--bg-panel': '#eeeeee',
    '--line': '#cccccc',
    '--line-bright': '#aaaaaa',
    '--ink': '#1a1a1a',
    '--ink-dim': '#444444',
    '--ink-faint': '#777777',
    '--amber': '#b8860b',
    '--amber-dim': '#d4a017',
    '--moss': '#2e7d32',
    '--rust': '#b71c1c',
    '--azure': '#0d47a1',
    '--mono': DARK_THEME.variables['--mono'],
    '--sans': DARK_THEME.variables['--sans'],
    '--radius': DARK_THEME.variables['--radius'],
  },
};

export class ThemeEngine {
  private currentTheme: Theme = DARK_THEME;

  constructor() {
    this.applyTheme(this.currentTheme);
  }

  getTheme(): Theme {
    return this.currentTheme;
  }

  setTheme(name: ThemeName): void {
    const theme = name === 'dark' ? DARK_THEME : LIGHT_THEME;
    this.currentTheme = theme;
    this.applyTheme(theme);
  }

  private applyTheme(theme: Theme): void {
    const root = document.documentElement;
    for (const [key, value] of Object.entries(theme.variables)) {
      root.style.setProperty(key, value);
    }
  }

  // Toggle between dark and light
  toggleTheme(): ThemeName {
    const newName = this.currentTheme.name === 'dark' ? 'light' : 'dark';
    this.setTheme(newName);
    return newName;
  }
}
