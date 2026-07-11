import {Provider} from "./ProviderTypes";

export class ProviderRegistry{

private providers:Provider[]=[];

register(provider:Provider){

this.providers.push(provider);

}

all(){

return this.providers;

}

enabled(){

return this.providers.filter(p=>p.enabled);

}

byType(type:string){

return this.providers.filter(p=>p.type===type);

}

}
