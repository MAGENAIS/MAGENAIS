export const Environment = {

    isGitHubPages:
        location.hostname.endsWith("github.io"),

    isLocalhost:
        location.hostname === "localhost" ||
        location.hostname === "127.0.0.1",

    hasServerProxy:
        !(location.hostname.endsWith("github.io")),

};
