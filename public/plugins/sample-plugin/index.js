export function activate(api) {
  console.log('Sample plugin activated.');
  // Register a provider
  api.registerProvider({
    id: 'sample-provider',
    name: 'Sample Provider',
    type: 'text',
    adapterId: 'openai-compatible',
    baseUrl: 'https://api.sample.com/v1',
    authType: 'bearer',
    defaultModel: 'sample-model',
    priority: 10,
    enabled: true,
  });
  // Register a menu
  api.registerMenu({
    id: 'sample-menu',
    label: 'Sample Plugin',
    command: 'sampleCommand',
  });
  // Register a command
  api.registerCommand({
    id: 'sampleCommand',
    handler: () => {
      alert('Sample plugin command executed!');
    },
  });
}

export function deactivate() {
  console.log('Sample plugin deactivated.');
}
