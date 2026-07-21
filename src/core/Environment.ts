export const Environment = {

  isGitHubPages:
    window.location.hostname.endsWith("github.io"),

  hasServerProxy:
    !window.location.hostname.endsWith("github.io"),

};
