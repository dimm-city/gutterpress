/**
 * Publish provider registry (#35). Static — providers are part of the lib, so
 * a plain map keeps the compiled binary free of computed dynamic imports
 * (CLAUDE.md §3).
 */
import { azureSwaProvider } from "./providers/azure-swa.ts";
import { drivethrurpgProvider } from "./providers/drivethrurpg.ts";
import { itchProvider } from "./providers/itch.ts";
import { kdpProvider } from "./providers/kdp.ts";
import { shopifyProvider } from "./providers/shopify.ts";
import type {
  PublishProvider,
  PublishProviderId,
  PublishProviderInfo,
} from "./types.ts";

const PROVIDERS: Record<PublishProviderId, PublishProvider> = {
  itch: itchProvider,
  drivethrurpg: drivethrurpgProvider,
  kdp: kdpProvider,
  "azure-swa": azureSwaProvider,
  shopify: shopifyProvider,
};

/** All providers' static descriptions, in display order. */
export function listPublishProviders(): PublishProviderInfo[] {
  return Object.values(PROVIDERS).map((p) => p.info);
}

/** Look up a provider by id; throws a friendly error listing valid ids. */
export function publishProviderFor(id: string): PublishProvider {
  const provider = PROVIDERS[id as PublishProviderId];
  if (!provider) {
    const known = Object.keys(PROVIDERS).join(", ");
    throw new Error(`Unknown publish provider "${id}". Available: ${known}.`);
  }
  return provider;
}
