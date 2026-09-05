import { env } from 'cloudflare:workers';
import { authenticate, apiFailure, json, readJson } from '@/lib/api-security';
import {
  fetchGitHubRepository,
  mapGitHubIssue,
  parseGitHubRepository,
} from '@/lib/github-import';
import { insertExternalIssue, listIssues } from '@/lib/issue-store';

export async function POST(request: Request) {
  try {
    const actor = authenticate(request, true);
    const raw = (await readJson(request)) as { repository?: unknown };
    const repository = parseGitHubRepository(raw?.repository);
    const token = (
      env as unknown as { GITHUB_TOKEN?: string }
    ).GITHUB_TOKEN?.trim();
    const source = await fetchGitHubRepository(repository, token);
    const existing = await listIssues(actor);
    const knownUrls = new Set(
      existing.map((issue) => issue.source?.url).filter(Boolean),
    );
    const syncedAt = new Date().toISOString();
    let imported = 0;
    let unchanged = 0;
    let linked = 0;
    let skipped = 0;
    for (const record of source.issues) {
      try {
        const issue = mapGitHubIssue(
          record,
          source.comments,
          repository,
          syncedAt,
        );
        if (knownUrls.has(issue.source!.url)) {
          linked += 1;
          continue;
        }
        const result = await insertExternalIssue(actor, issue);
        if (result.created) {
          imported += 1;
          knownUrls.add(issue.source!.url);
        } else unchanged += 1;
      } catch {
        skipped += 1;
      }
    }
    return json({
      repository: repository.slug,
      found: source.issues.length,
      imported,
      linked,
      unchanged,
      skipped,
      authenticated: Boolean(token),
      rateLimitRemaining: source.rateLimitRemaining,
      mode: 'one-way-snapshot',
      syncedAt,
    });
  } catch (error) {
    return apiFailure(error);
  }
}
