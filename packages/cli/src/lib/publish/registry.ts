/**
 * Publish provider registry (#35, ADR 0012). One provider per target in the
 * target registry (`../targets.ts`), in its order: the registry says what a
 * target is and which file it receives, its provider says how the file gets
 * there. Static — providers are part of the lib, so a plain map keeps the
 * compiled binary free of computed dynamic imports (CLAUDE.md §3).
 */
import { azureSwaProvider } from "./providers/azure-swa.ts";
import { drivethrurpgDigitalProvider, drivethrurpgPrintProvider } from "./providers/drivethrurpg.ts";
import { gdriveProvider } from "./providers/gdrive.ts";
import { itchProvider } from "./providers/itch.ts";
import { kdpProvider } from "./providers/kdp.ts";
import { localFolderProvider } from "./providers/local-folder.ts";
import { shopifyProvider } from "./providers/shopify.ts";
import { canonicalTargetId } from "../targets.ts";
import type {
  PublishProvider,
  PublishProviderId,
  PublishProviderInfo,
} from "./types.ts";

const PROVIDERS: Record<PublishProviderId, PublishProvider> = {
  local: localFolderProvider,
  itch: itchProvider,
  "drivethrurpg-print": drivethrurpgPrintProvider,
  "drivethrurpg-digital": drivethrurpgDigitalProvider,
  kdp: kdpProvider,
  "azure-swa": azureSwaProvider,
  shopify: shopifyProvider,
  gdrive: gdriveProvider,
};

/** All providers' static descriptions, in display order. */
export function listPublishProviders(): PublishProviderInfo[] {
  return Object.values(PROVIDERS).map((p) => p.info);
}

/** Look up a provider by id (an older name is accepted); throws a friendly error listing valid ids. */
export function publishProviderFor(id: string): PublishProvider {
  const provider = PROVIDERS[canonicalTargetId(id) as PublishProviderId];
  if (!provider) {
    const known = Object.keys(PROVIDERS).join(", ");
    throw new Error(`Unknown publish provider "${id}". Available: ${known}.`);
  }
  return provider;
}
