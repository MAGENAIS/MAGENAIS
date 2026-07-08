import { Kernel } from './core/Kernel';
import { EventBus } from './core/EventBus';
import { Logger } from './core/Logger';
import { Config } from './core/Config';
import { Store } from './core/state/Store';
import { Persistence } from './core/state/Persistence';
import { initUI } from './ui';

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
  initUI(kernel);

  Logger.info('MAGENAIS UI mounted');
}

bootstrap().catch((err) => {
  console.error('Fatal bootstrap error:', err);
});
