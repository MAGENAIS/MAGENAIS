/**
 * Default AI Providers
 */

export const DEFAULT_PROVIDERS = [

    {
        id: "pollinations-image",

        name: "Pollinations Image",

        enabled: true,

        type: "image",

        adapter: "pollinations",

        baseUrl: "https://image.pollinations.ai",

        endpoint: "/prompt/{prompt}",

        authType: "none",

        apiKey: "",

        defaultModel: "flux",

        timeout: 30000,

        priority: 1
    },

    {
        id: "openrouter",

        name: "OpenRouter",

        enabled: false,

        type: "text",

        adapter: "openrouter",

        baseUrl: "https://openrouter.ai/api/v1",

        endpoint: "/chat/completions",

        authType: "bearer",

        apiKey: "",

        defaultModel: "openai/gpt-4.1-mini",

        timeout: 30000,

        priority: 2
    },

    {
        id: "groq",

        name: "Groq",

        enabled: false,

        type: "text",

        adapter: "groq",

        baseUrl: "https://api.groq.com/openai/v1",

        endpoint: "/chat/completions",

        authType: "bearer",

        apiKey: "",

        defaultModel: "llama-3.3-70b-versatile",

        timeout: 30000,

        priority: 3
    }

];
