/**
 * Provider registry — singleton that holds all registered ProviderAdapters.
 *
 * Adapters are registered in main.ts before routes are mounted.
 * The stream resolver calls registry.get(providerId) to retrieve the adapter.
 */

import type { ProviderAdapter } from './types.js';

class ProviderRegistry {
  private readonly adapters = new Map<string, ProviderAdapter>();

  register(adapter: ProviderAdapter): void {
    if (this.adapters.has(adapter.providerId)) {
      throw new Error(`Provider adapter already registered: ${adapter.providerId}`);
    }
    this.adapters.set(adapter.providerId, adapter);
  }

  get(providerId: string): ProviderAdapter | undefined {
    return this.adapters.get(providerId);
  }

  getAll(): ReadonlyArray<ProviderAdapter> {
    return Array.from(this.adapters.values());
  }

  has(providerId: string): boolean {
    return this.adapters.has(providerId);
  }
}

export const providerRegistry = new ProviderRegistry();
