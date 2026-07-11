import { ProviderRegistry } from "../config/ProviderRegistry";
import { defaultProviders } from "../config/defaultProviders";

export class Bootstrap {

    async start() {

        ProviderRegistry.load(defaultProviders);

        console.log("Providers loaded.");

    }

}
