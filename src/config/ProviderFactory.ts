import {Provider} from "./ProviderTypes";

import {DefaultProviders} from "../config/defaultProviders";

export class ProviderFactory{

static createDefaults():Provider[]{

return structuredClone(DefaultProviders);

}

}
