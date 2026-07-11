/**
 * MAGENAIS – Application Entry Point
 * Bootstraps the Kernel, loads configuration, and mounts the UI.
 */

// Design system — order matters: tokens first, then base reset/layout, then
// components. (light.css is intentionally NOT imported here: ThemeEngine
// applies light/dark values directly as inline CSS custom properties on
// :root at runtime, which already overrides these defaults with higher
// specificity — importing light.css's unscoped `:root{...}` block here would
// permanently override the dark defaults instead of only applying when the
// user picks the light theme.)
import './css/variables.css';
import './css/main.css';
import './css/layout.css';
import './css/components.css';

import { Kernel } from './core/Kernel';
import { EventBus } from './core/EventBus';
import { Logger } from './core/Logger';
import { Config } from './core/Config';
import { Store } from './core/state/Store';
import { Persistence } from './core/state/Persistence';
import { App } from './ui/App';



import { Bootstrap } from "./bootstrap/Bootstrap";

new Bootstrap().start();


async function bootstrap() {
  // 1. Load configuration
  const config = await Config.load();

  // 2. Setup logger
  Logger.configure(config.logLevel || 'info');

  // 3. Create event bus
  const eventBus = new EventBus();

  // 4. Create state store with persistence
  const persistence = new Persistence(config.storage);
  const store = new Store(persistence);

  // 5. Instantiate kernel
  const kernel = new Kernel({ config, eventBus, store, logger: Logger });

  // 6. Boot the kernel
  await kernel.boot();

  // 7. Mount the UI
  const app = new App(kernel);
  app.init();

  // 8. Expose kernel to window for debugging (optional)
  (window as any).__MAGENAIS_KERNEL = kernel;
  (window as any).__MAGENAIS_APP = app;

  Logger.info('MAGENAIS UI mounted and ready.');
}

bootstrap().catch((err) => {
  console.error('Fatal bootstrap error:', err);
  Logger.error('Application failed to start.', err);
});
