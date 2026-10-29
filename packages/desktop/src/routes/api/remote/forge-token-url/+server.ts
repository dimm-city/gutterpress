import { defineRoute, loadLib } from '../../_lib/route';
import type { RequestHandler } from './$types';

/**
 * Where a Git server makes access tokens: the token-settings page of a server
 * the lib recognises (GitLab, Gitea, Forgejo, Bitbucket, Azure Repos), else
 * null. A lookup by address alone — nothing is contacted and no credential is
 * read — so the Accounts page can offer the link while the address is typed.
 */
export const POST: RequestHandler = defineRoute<{ host?: string }>({
  call: async ({ body }) => {
    const host = typeof body?.host === 'string' ? body.host : '';
    return { url: host ? (await loadLib()).knownForgeTokenUrl(host) : null };
  },
});
