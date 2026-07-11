import { DEFAULT_PROVIDERS } from "./defaultProviders";
import { APP_DEFAULTS } from "./appDefaults";

export class ProviderRegistry {

    static initialize(): void {

        const exists = localStorage.getItem(APP_DEFAULTS.providerStorageKey);

        if (!exists) {

            localStorage.setItem(

                APP_DEFAULTS.providerStorageKey,

                JSON.stringify(DEFAULT_PROVIDERS)

            );

            console.log("Default providers installed.");

        }

    }

    static getProviders() {

        return JSON.parse(

            localStorage.getItem(

                APP_DEFAULTS.providerStorageKey

            ) || "[]"

        );

    }

}
