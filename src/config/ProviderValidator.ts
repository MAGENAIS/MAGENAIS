import {Provider} from "./ProviderTypes";

export class ProviderValidator{

static validate(provider:Provider){

if(!provider.name) return false;

if(!provider.baseUrl) return false;

if(!provider.adapter) return false;

if(provider.timeout<=0) return false;

return true;

}

}
