/**
 * Theme Engine – manages CSS variables and theme switching.
 * Dark theme is the default, mirroring the original MAGENAIS design, and
 * is left byte-for-byte unchanged from before this file supported more
 * than two themes.
 *
 * Every theme provides the same token set (see `ThemeTokens`), which is
 * exactly the set of CSS custom properties layout.css/components.css
 * already consume — adding a new theme is just adding a new entry to
 * `THEMES` below with real values for each token; nothing else needs to
 * change (the picker UI in App.ts renders whatever's registered here).
 */
export type ThemeTokens = {
  '--bg': string;
  '--bg-raised': string;
  '--bg-panel': string;
  '--line': string;
  '--line-bright': string;
  '--ink': string;
  '--ink-dim': string;
  '--ink-faint': string;
  '--amber': string;
  '--amber-dim': string;
  '--moss': string;
  '--rust': string;
  '--azure': string;
  '--mono': string;
  '--sans': string;
  '--radius': string;
};

export interface Theme {
  name: string;
  label: string;
  /** Two swatch colors shown in the theme picker (background, accent). */
  swatch: [string, string];
  variables: ThemeTokens;
}

const FONTS = {
  '--mono': '"IBM Plex Mono", "SF Mono", Consolas, monospace',
  '--sans': '"IBM Plex Sans", "Inter", system-ui, sans-serif',
  '--radius': '3px',
};

// 'dark' is the ORIGINAL, unchanged default theme — every value here is
// identical to what shipped before multi-theme support existed.
const DARK_THEME: Theme = {
  name: 'dark',
  label: 'Dark (default)',
  swatch: ['#0c0e0d', '#e8a23d'],
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
    ...FONTS,
  },
};

const LIGHT_THEME: Theme = {
  name: 'light',
  label: 'Light',
  swatch: ['#f5f5f5', '#b8860b'],
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
    ...FONTS,
  },
};

const OCEAN_THEME: Theme = {
  name: 'ocean',
  label: 'Ocean',
  swatch: ['#0a1420', '#4fb0d6'],
  variables: {
    '--bg': '#0a1420',
    '--bg-raised': '#101d2e',
    '--bg-panel': '#142438',
    '--line': '#1f3349',
    '--line-bright': '#2f4a67',
    '--ink': '#e7f0f7',
    '--ink-dim': '#93aec2',
    '--ink-faint': '#56728a',
    '--amber': '#4fb0d6',
    '--amber-dim': '#2b5468',
    '--moss': '#4fd6b0',
    '--rust': '#d65f6b',
    '--azure': '#5b9bd5',
    ...FONTS,
  },
};

const MIDNIGHT_VIOLET_THEME: Theme = {
  name: 'midnight-violet',
  label: 'Midnight Violet',
  swatch: ['#120f1c', '#a685e2'],
  variables: {
    '--bg': '#120f1c',
    '--bg-raised': '#1a1628',
    '--bg-panel': '#201a30',
    '--line': '#302849',
    '--line-bright': '#453a67',
    '--ink': '#ece8f7',
    '--ink-dim': '#a99fc4',
    '--ink-faint': '#6d6390',
    '--amber': '#a685e2',
    '--amber-dim': '#4c3d73',
    '--moss': '#7fd6ae',
    '--rust': '#e2718f',
    '--azure': '#7ea6f0',
    ...FONTS,
  },
};

const FOREST_THEME: Theme = {
  name: 'forest',
  label: 'Forest',
  swatch: ['#0d1611', '#6fbf73'],
  variables: {
    '--bg': '#0d1611',
    '--bg-raised': '#132018',
    '--bg-panel': '#17271e',
    '--line': '#243a2d',
    '--line-bright': '#365342',
    '--ink': '#e7f2ea',
    '--ink-dim': '#9cb8a7',
    '--ink-faint': '#5f7a6a',
    '--amber': '#6fbf73',
    '--amber-dim': '#345b39',
    '--moss': '#a3d977',
    '--rust': '#d68a5f',
    '--azure': '#5fb0a8',
    ...FONTS,
  },
};

const CRIMSON_SLATE_THEME: Theme = {
  name: 'crimson-slate',
  label: 'Crimson Slate',
  swatch: ['#161314', '#d9765a'],
  variables: {
    '--bg': '#161314',
    '--bg-raised': '#1e1a1b',
    '--bg-panel': '#241f20',
    '--line': '#38302f',
    '--line-bright': '#52453f',
    '--ink': '#f2e9e6',
    '--ink-dim': '#bfa9a1',
    '--ink-faint': '#7a6a64',
    '--amber': '#d9765a',
    '--amber-dim': '#6e3d2d',
    '--moss': '#9dbf7f',
    '--rust': '#e05a5a',
    '--azure': '#7fa3c9',
    ...FONTS,
  },
};

const LIGHT_STEEL_THEME: Theme = {
  name: 'light-steel',
  label: 'Light Steel',
  swatch: ['#eef1f4', '#3f6ea5'],
  variables: {
    '--bg': '#eef1f4',
    '--bg-raised': '#ffffff',
    '--bg-panel': '#e4e9ee',
    '--line': '#cfd7de',
    '--line-bright': '#aab6c0',
    '--ink': '#1c2733',
    '--ink-dim': '#48586a',
    '--ink-faint': '#7c8a99',
    '--amber': '#3f6ea5',
    '--amber-dim': '#9dbcdc',
    '--moss': '#2e7d5b',
    '--rust': '#a83c3c',
    '--azure': '#3f6ea5',
    ...FONTS,
  },
};

const THEMES: Theme[] = [
  DARK_THEME,
  LIGHT_THEME,
  OCEAN_THEME,
  MIDNIGHT_VIOLET_THEME,
  FOREST_THEME,
  CRIMSON_SLATE_THEME,
  LIGHT_STEEL_THEME,
];

export class ThemeEngine {
  private currentTheme: Theme = DARK_THEME;

  constructor() {
    this.applyTheme(this.currentTheme);
  }

  getTheme(): Theme {
    return this.currentTheme;
  }

  /** All themes available for the picker UI, in display order. */
  getAvailableThemes(): Theme[] {
    return THEMES;
  }

  setTheme(name: string): void {
    const theme = THEMES.find(t => t.name === name) || DARK_THEME;
    this.currentTheme = theme;
    this.applyTheme(theme);
  }

  private applyTheme(theme: Theme): void {
    const root = document.documentElement;
    for (const [key, value] of Object.entries(theme.variables)) {
      root.style.setProperty(key, value);
    }
    root.setAttribute('data-theme', theme.name);
  }

  /** Kept for compatibility with any existing dark/light-only call sites. */
  toggleTheme(): string {
    const newName = this.currentTheme.name === 'dark' ? 'light' : 'dark';
    this.setTheme(newName);
    return newName;
  }
}
