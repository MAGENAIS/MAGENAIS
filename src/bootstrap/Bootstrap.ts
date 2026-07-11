import { APP_DEFAULTS } from "../config/appDefaults";
import { ProviderRegistry } from "../config/ProviderRegistry";

export class Bootstrap {

    public start(): void {

        const initialized = localStorage.getItem(

            APP_DEFAULTS.firstRunKey

        );

        if (!initialized) {

            console.log("First run detected.");

            ProviderRegistry.initialize();

            localStorage.setItem(

                APP_DEFAULTS.settingsStorageKey,

                JSON.stringify(APP_DEFAULTS)

            );

            localStorage.setItem(

                APP_DEFAULTS.firstRunKey,

                "true"

            );

            console.log("MAGENAIS initialized.");

        } else {

            console.log("MAGENAIS already initialized.");

        }

    }

}
