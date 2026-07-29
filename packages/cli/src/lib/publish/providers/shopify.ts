/**
 * Shopify publish provider (#35) — creates/updates the product listing via
 * the Admin GraphQL API (Shopify is GraphQL-first; the REST Product API was
 * deprecated Feb 2025). Plain `fetch`, no SDK.
 *
 * Digital file delivery has NO public API (Shopify's Digital Downloads app is
 * closed), so the PDF attachment is a follow-up step the author completes in
 * the Shopify admin — the outcome links straight to the product page.
 *
 * Auth: a custom-app Admin API access token, sent as X-Shopify-Access-Token.
 * Token source: injected TokenStore (host = the shop domain is NOT used as
 * the key — the stable key "shopify" is, so switching shops re-prompts) or
 * SHOPIFY_ADMIN_TOKEN in CI.
 */
import { FriendlyHttpError, withFetchTimeout } from "../../fetch-timeout.ts";
import {
  resolvePublishCredential,
  type PreflightIssue,
  type PublishAuthStatus,
  type PublishListingMetadata,
  type PublishOutcome,
  type PublishProduct,
  type PublishProvider,
  type PublishProviderInfo,
  type PublishRequest,
} from "../types.ts";

const SHOPIFY_HOST = "shopify";
const DEFAULT_API_VERSION = "2026-04";

/** Total deadline per Admin API call (shared fetch-timeout policy — a stalled
 * connection must not hang the publish pipeline). Covers the body read too;
 * 30s is generous for one GraphQL query/mutation on a slow store. */
const SHOPIFY_API_TIMEOUT_MS = 30_000;

/**
 * The Admin API lives on the store's canonical `*.myshopify.com` domain only.
 * Enforced as a HARD gate before any request: `publish.shopify.shop` comes
 * from the manifest — a committed, shareable file — so posting the admin
 * token to an arbitrary configured host would let a hostile or typo'd
 * project exfiltrate it.
 */
const SHOP_DOMAIN_RE = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;

function requireValidShop(shop: string): string {
  if (!shop) {
    throw new Error(
      'Set the store first: publish.shopify.shop: "my-store.myshopify.com" in the manifest.',
    );
  }
  if (!SHOP_DOMAIN_RE.test(shop)) {
    throw new Error(
      `publish.shopify.shop must be the store's myshopify.com domain (got "${shop}"). ` +
        "The access token is only ever sent there.",
    );
  }
  return shop;
}

const info: PublishProviderInfo = {
  id: "shopify",
  label: "Shopify",
  kind: "api",
  format: "pdf",
  description:
    "Create or update a digital product on your Shopify store (file delivery is attached in the Shopify admin).",
  configFields: [
    { key: "shop", label: "Store domain", placeholder: "my-store.myshopify.com" },
    {
      key: "productId",
      label: "Product ID (optional)",
      placeholder: "gid://shopify/Product/…",
    },
    { key: "apiVersion", label: "API version (optional)", placeholder: DEFAULT_API_VERSION },
  ],
  credential: {
    required: true,
    host: SHOPIFY_HOST,
    envVar: "SHOPIFY_ADMIN_TOKEN",
    tokenUrl: "https://help.shopify.com/manual/apps/app-types/custom-apps",
    hint: "Create a custom app in Shopify admin (Settings → Apps → Develop apps) with write_products scope, then paste its Admin API access token.",
  },
};

interface ShopifyConfig {
  shop?: string;
  productId?: string;
  apiVersion?: string;
}

function readConfig(req: PublishRequest): Required<ShopifyConfig> {
  const cfg = req.config as ShopifyConfig;
  return {
    shop: (cfg.shop ?? "").trim().toLowerCase(),
    productId: (cfg.productId ?? "").trim(),
    apiVersion: (cfg.apiVersion ?? DEFAULT_API_VERSION).trim(),
  };
}

interface GraphQLResponse {
  data?: Record<string, unknown>;
  errors?: Array<{ message: string }>;
}

/** POST one GraphQL operation to the shop's Admin API. Throws token-free errors. */
async function adminGraphQL(
  req: PublishRequest,
  query: string,
  variables: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const { shop: rawShop, apiVersion } = readConfig(req);
  const shop = requireValidShop(rawShop);
  const resolved = await resolvePublishCredential(info, req.deps);
  if (!resolved) {
    throw new Error(
      "No Shopify access token found. Connect Shopify (or set SHOPIFY_ADMIN_TOKEN) first.",
    );
  }
  const fetchFn = req.deps.fetch ?? globalThis.fetch;
  // The whole request — including the body read — runs under the shared
  // deadline; status errors are already author-friendly (FriendlyHttpError),
  // so only genuine network failures get the offline/timeout mapping.
  const payload = await withFetchTimeout(
    {
      timeoutMs: SHOPIFY_API_TIMEOUT_MS,
      timeoutMessage:
        "Shopify didn't respond in time. Check your connection and try again.",
      offlineMessage:
        "Couldn't reach Shopify. Check your connection and try again.",
    },
    async (signal) => {
      const response = await fetchFn(
        `https://${shop}/admin/api/${apiVersion}/graphql.json`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Shopify-Access-Token": resolved.credential.token,
          },
          body: JSON.stringify({ query, variables }),
          signal,
        },
      );
      if (response.status === 401 || response.status === 403) {
        throw new FriendlyHttpError(
          "Shopify rejected the access token. Re-create the custom app token (with write_products scope) and reconnect.",
        );
      }
      if (!response.ok) {
        throw new FriendlyHttpError(
          `Shopify API request failed (HTTP ${response.status}).`,
        );
      }
      return (await response.json()) as GraphQLResponse;
    },
  );
  if (payload.errors?.length) {
    throw new Error(`Shopify API error: ${payload.errors[0]!.message}`);
  }
  return payload.data ?? {};
}

/** `gid://shopify/Product/123` → `123` (for admin deep links). */
export function shopifyLegacyId(gid: string): string {
  return gid.split("/").pop() ?? gid;
}

function productAdminUrl(shop: string, gid: string): string {
  return `https://${shop}/admin/products/${shopifyLegacyId(gid)}`;
}

interface ProductNode {
  id: string;
  title: string;
  onlineStoreUrl?: string | null;
}

function toProduct(shop: string, node: ProductNode): PublishProduct {
  return {
    id: node.id,
    title: node.title,
    url: node.onlineStoreUrl ?? productAdminUrl(shop, node.id),
  };
}

const PRODUCT_FIELDS = "id title onlineStoreUrl";

function userErrorsToMessage(result: unknown): string | null {
  const errs = (result as { userErrors?: Array<{ message: string }> })?.userErrors;
  return errs?.length ? errs[0]!.message : null;
}

export const shopifyProvider: PublishProvider = {
  info,

  async authenticate(req): Promise<PublishAuthStatus> {
    const resolved = await resolvePublishCredential(info, req.deps);
    if (!resolved) {
      return {
        ok: false,
        message:
          "No Shopify access token found. Connect Shopify (or set SHOPIFY_ADMIN_TOKEN) first.",
      };
    }
    try {
      // adminGraphQL enforces the myshopify.com shop-domain gate.
      await adminGraphQL(req, "{ shop { name } }");
      return { ok: true, source: resolved.source };
    } catch (e) {
      return {
        ok: false,
        source: resolved.source,
        message: e instanceof Error ? e.message : String(e),
      };
    }
  },

  async preflight(req): Promise<PreflightIssue[]> {
    const issues: PreflightIssue[] = [];
    const { shop } = readConfig(req);
    if (!shop) {
      issues.push({
        severity: "error",
        id: "shopify/shop-missing",
        message:
          'Set the store in the manifest: publish.shopify.shop: "my-store.myshopify.com".',
      });
    } else if (!SHOP_DOMAIN_RE.test(shop)) {
      // Mirrors the hard gate in adminGraphQL: the token is never sent to a
      // non-myshopify.com host, so a bad domain must block, not warn.
      issues.push({
        severity: "error",
        id: "shopify/shop-invalid",
        message: `publish.shopify.shop must be the store's myshopify.com domain (got "${shop}").`,
      });
    }
    if (!req.project.title) {
      issues.push({
        severity: "error",
        id: "shopify/title-missing",
        message: "The manifest has no title — Shopify products need one.",
      });
    }
    return issues;
  },

  async listProducts(req): Promise<PublishProduct[]> {
    const { shop } = readConfig(req);
    const data = await adminGraphQL(
      req,
      `{ products(first: 25, sortKey: UPDATED_AT, reverse: true) { nodes { ${PRODUCT_FIELDS} } } }`,
    );
    const nodes =
      ((data.products as { nodes?: ProductNode[] })?.nodes ?? []) as ProductNode[];
    return nodes.map((n) => toProduct(shop, n));
  },

  async updateListing(
    req,
    productId: string,
    metadata: PublishListingMetadata,
  ): Promise<PublishProduct> {
    const { shop } = readConfig(req);
    const data = await adminGraphQL(
      req,
      `mutation($product: ProductUpdateInput!) {
        productUpdate(product: $product) {
          product { ${PRODUCT_FIELDS} }
          userErrors { message }
        }
      }`,
      {
        product: {
          id: productId,
          ...(metadata.title ? { title: metadata.title } : {}),
          ...(metadata.description ? { descriptionHtml: metadata.description } : {}),
        },
      },
    );
    const result = data.productUpdate as {
      product?: ProductNode;
      userErrors?: Array<{ message: string }>;
    };
    const err = userErrorsToMessage(result);
    if (err || !result?.product) {
      throw new Error(`Shopify couldn't update the product: ${err ?? "unknown error"}`);
    }
    return toProduct(shop, result.product);
  },

  async upload(req): Promise<PublishOutcome> {
    const { shop, productId } = readConfig(req);
    const title = req.project.title || "Untitled";

    let product: PublishProduct;
    if (productId) {
      req.deps.onProgress?.(`Updating Shopify product ${productId}…`);
      product = await this.updateListing!(req, productId, { title });
    } else {
      req.deps.onProgress?.(`Creating Shopify product "${title}"…`);
      const data = await adminGraphQL(
        req,
        `mutation($product: ProductCreateInput!) {
          productCreate(product: $product) {
            product { ${PRODUCT_FIELDS} }
            userErrors { message }
          }
        }`,
        {
          product: {
            title,
            status: "DRAFT",
            productType: "Digital Download",
          },
        },
      );
      const result = data.productCreate as {
        product?: ProductNode;
        userErrors?: Array<{ message: string }>;
      };
      const err = userErrorsToMessage(result);
      if (err || !result?.product) {
        throw new Error(`Shopify couldn't create the product: ${err ?? "unknown error"}`);
      }
      product = toProduct(shop, result.product);
    }

    return {
      kind: "published",
      url: productAdminUrl(shop, product.id),
      detail: productId
        ? `Updated the Shopify product listing for "${product.title}".`
        : `Created a draft Shopify product "${product.title}".`,
      followUp: [
        "Attach the PDF to the product with your digital-delivery app (e.g. Shopify's Digital Downloads) — Shopify has no API for file attachment.",
        productId
          ? "Review the listing, then save."
          : "Add pricing, description and images, then change the product status from Draft to Active.",
        `Tip: record the product id in the manifest (publish.shopify.productId: "${product.id}") so future publishes update this listing.`,
      ],
    };
  },
};
