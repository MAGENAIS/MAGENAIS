import { Config } from "../config/Config";
import { Logger } from "../core/Logger";
import { EventBus } from "../core/EventBus";
import { Kernel } from "../core/Kernel";
import { Persistence } from "../state/Persistence";
import { Store } from "../state/Store";
import { App } from "../ui/App";

export class Bootstrap {

    public async start(): Promise<void> {

        // Load configuration
        const config = await Config.load();

        // Configure logger
        Logger.configure(config.logLevel ?? "info");

        // Core services
        const eventBus = new EventBus();

        const persistence = new Persistence(config.storage);

        const store = new Store(persistence);

        // Create kernel
        const kernel = new Kernel({
            config,
            eventBus,
            store,
            logger: Logger
        });

        // Boot kernel
        await kernel.boot();

        // Create UI
        const app = new App(kernel);

        app.init();

        Logger.info("Bootstrap completed.");

    }

}
