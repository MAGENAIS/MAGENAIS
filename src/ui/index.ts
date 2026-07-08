import { App } from './App';
import { Kernel } from '../core/Kernel';

let appInstance: App | null = null;

export function initUI(kernel: Kernel): void {
  if (!appInstance) {
    appInstance = new App(kernel);
    appInstance.init();
  }
}

export function getApp(): App | null {
  return appInstance;
}
