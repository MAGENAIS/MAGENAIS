import { App } from './App';
import { Kernel } from '../core/Kernel';

let appInstance: App | null = null;

/**
 * Initialize the UI after the kernel is booted.
 */
export function initUI(kernel: Kernel): void {
  if (!appInstance) {
    appInstance = new App(kernel);
    appInstance.init();
  }
}

/**
 * Get the app instance (for testing or debugging).
 */
export function getApp(): App | null {
  return appInstance;
}
