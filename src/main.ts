/**
 * MAGENAIS Bootstrap
 * Initialises the Kernel and starts the application.
 */
import { Kernel } from './core/Kernel';
import { EventBus } from './core/EventBus';
import { Logger } from './core/Logger';
import { Config } from './core/Config';
import { Store } from './core/state/Store';
import { Persistence } from './core/state/Persistence';

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

  // 6. Register core plugins (none yet – Phase 2.3 will add providers)

  // 7. Boot the kernel
  await kernel.boot();

  // 8. Mount the UI (to be replaced by UI layer in Phase 2.5)
  // For now, we just log success
  Logger.info('MAGENAIS kernel booted successfully');
}

bootstrap().catch((err) => {
  console.error('Fatal bootstrap error:', err);
});
