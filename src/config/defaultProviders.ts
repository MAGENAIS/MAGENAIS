import {Provider} from "../providers/ProviderTypes";

import {Capability} from "./providerCapabilities";

export const DefaultProviders:Provider[]=[

{

id:"pollinations-image",

name:"Pollinations Free",

enabled:true,

priority:10,

adapter:"pollinations",

type:Capability.IMAGE,

baseUrl:"https://image.pollinations.ai",

endpoint:"/prompt/{prompt}",

authType:"none",

authField:"",

apiKey:"",

timeout:30000,

retry:2,

defaultModel:"flux",

supportedModels:["flux"],

capabilities:[Capability.IMAGE]

},

{

id:"openrouter",

name:"OpenRouter",

enabled:true,

priority:20,

adapter:"openrouter",

type:Capability.TEXT,

baseUrl:"https://openrouter.ai/api/v1",

endpoint:"/chat/completions",

authType:"bearer",

authField:"Authorization",

apiKey:"",

timeout:30000,

retry:2,

defaultModel:"openai/gpt-4.1-mini",

supportedModels:[],

capabilities:[Capability.TEXT]

}

];
