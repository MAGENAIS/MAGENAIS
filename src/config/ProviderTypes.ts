import {Capability} from "../config/providerCapabilities";

export interface Provider {

    id:string;

    name:string;

    enabled:boolean;

    priority:number;

    adapter:string;

    type:Capability;

    baseUrl:string;

    endpoint:string;

    authType:"none"|"bearer"|"apikey";

    authField:string;

    apiKey:string;

    timeout:number;

    retry:number;

    defaultModel:string;

    supportedModels:string[];

    capabilities:Capability[];

}
