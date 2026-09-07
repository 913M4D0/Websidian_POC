import type { Issue } from './issues.ts';
import { compileIssueMemory } from './llm-server.ts';
import {
  contentHash,
  cosineSimilarity,
  embeddingDocument,
  MemoryArtifactError,
  semanticNeighbors,
  type CompiledMemory,
  type MemoryArtifact,
} from './memory-artifact.ts';
import {
  embeddingPolicy,
  embedTexts,
  getEmbeddingStatus,
} from './embedding-server.ts';
import {
  findMemoryArtifact,
  listMemoryArtifacts,
  memoryIndexSnapshot,
  saveMemoryArtifacts,
} from './memory-store.ts';
import { sourceMemory } from './delimited-output.ts';

function compiledFrom(artifact?: MemoryArtifact | null): CompiledMemory | null {
  return artifact?.compileStatus === 'ready' &&
    artifact.summary &&
    artifact.concepts &&
    artifact.facets
    ? {
        summary: artifact.summary,
        concepts: artifact.concepts,
        facets: artifact.facets,
      }
    : null;
}

function withRecalculatedNeighbors(artifacts: MemoryArtifact[]) {
  const neighbors = semanticNeighbors(artifacts);
  return artifacts.map((artifact) => ({
    ...artifact,
    semanticNeighbors: neighbors.get(artifact.issueId) ?? [],
  }));
}

export async function indexMemoryBatch(
  actor: string,
  issues: Issue[],
  requestedLimit: number = embeddingPolicy.batchSize,
) {
  const status = getEmbeddingStatus();
  if (!status.ready) throw new MemoryArtifactError(status.reason, 503);
  const limit = Math.max(
    1,
    Math.min(embeddingPolicy.batchSize, Math.floor(requestedLimit)),
  );
  const artifacts = await listMemoryArtifacts(actor);
  const byId = new Map(
    artifacts.map((artifact) => [artifact.issueId, artifact]),
  );
  const completed = issues.filter((issue) => issue.status === 'closed');
  const hashes = new Map(
    await Promise.all(
      completed.map(
        async (issue) => [issue.id, await contentHash(issue)] as const,
      ),
    ),
  );
  const pending = completed
    .filter((issue) => {
      const artifact = byId.get(issue.id);
      return !(
        artifact?.embeddingStatus === 'ready' &&
        artifact.embeddingModel === embeddingPolicy.modelId &&
        artifact.sourceRevision === issue.revision &&
        artifact.contentHash === hashes.get(issue.id)
      );
    })
    .slice(0, limit);
  if (!pending.length) {
    const snapshot = await memoryIndexSnapshot(
      actor,
      issues,
      embeddingPolicy.modelId,
    );
    return { ...snapshot, processed: 0, modelId: embeddingPolicy.modelId };
  }
  const embedded = await embedTexts(
    pending.map((issue) => {
      const artifact = byId.get(issue.id);
      const compiled =
        artifact?.contentHash === hashes.get(issue.id)
          ? compiledFrom(artifact)
          : null;
      return embeddingDocument(issue, compiled ?? undefined);
    }),
    'search_document',
  );
  const now = new Date().toISOString();
  pending.forEach((issue, index) => {
    const existing = byId.get(issue.id);
    const sameSource = existing?.contentHash === hashes.get(issue.id);
    const vector = embedded.vectors[index];
    byId.set(issue.id, {
      issueId: issue.id,
      sourceRevision: issue.revision,
      contentHash: hashes.get(issue.id)!,
      compileStatus: sameSource
        ? (existing?.compileStatus ?? 'not-started')
        : 'not-started',
      embeddingStatus: 'ready',
      ...(sameSource && existing?.compiledAt
        ? { compiledAt: existing.compiledAt }
        : {}),
      ...(sameSource && existing?.compileModel
        ? { compileModel: existing.compileModel }
        : {}),
      ...(sameSource && existing?.summary ? { summary: existing.summary } : {}),
      ...(sameSource && existing?.concepts
        ? { concepts: existing.concepts }
        : {}),
      ...(sameSource && existing?.facets ? { facets: existing.facets } : {}),
      embeddingModel: embedded.model,
      dimensions: vector.length,
      embedding: vector,
      semanticNeighbors: [],
      updatedAt: now,
    });
  });
  const recalculated = withRecalculatedNeighbors([...byId.values()]);
  await saveMemoryArtifacts(actor, recalculated);
  const snapshot = await memoryIndexSnapshot(
    actor,
    issues,
    embeddingPolicy.modelId,
  );
  return {
    ...snapshot,
    processed: pending.length,
    modelId: embedded.model,
  };
}

export async function compileAndIndexIssue(actor: string, issue: Issue) {
  if (issue.status !== 'closed' || !issue.resolution)
    throw new MemoryArtifactError(
      '처리 완료된 이슈만 AI 기억으로 컴파일할 수 있습니다.',
      409,
    );
  const hash = await contentHash(issue);
  const existing = await findMemoryArtifact(actor, issue.id);
  const sameSource =
    existing?.sourceRevision === issue.revision &&
    existing.contentHash === hash;
  if (
    sameSource &&
    existing.compileStatus === 'ready' &&
    existing.compileModel !== 'source-fallback' &&
    existing.embeddingStatus === 'ready' &&
    existing.embeddingModel === embeddingPolicy.modelId
  )
    return { artifact: existing, reused: true as const };

  let compiled =
    sameSource && existing?.compileModel !== 'source-fallback'
      ? compiledFrom(existing)
      : null;
  let compileMetadata:
    | { modelId: string; reasoning: string; compiledAt: string }
    | undefined;
  let compileWarning: string | undefined;
  if (!compiled) {
    try {
      const response = await compileIssueMemory(actor, issue);
      compiled = response.compiled;
      compileMetadata = response;
      compileWarning = response.warning;
    } catch (error) {
      compiled = sourceMemory(issue);
      compileMetadata = {
        modelId: 'source-fallback',
        reasoning: 'source-only',
        compiledAt: new Date().toISOString(),
      };
      compileWarning = `${error instanceof Error ? error.message : 'AI 기억 생성에 실패했습니다.'} 원문 기반 기억 노드는 정상 생성됐습니다.`;
    }
  }

  const base: MemoryArtifact = {
    issueId: issue.id,
    sourceRevision: issue.revision,
    contentHash: hash,
    compileStatus: 'ready',
    embeddingStatus: 'not-started',
    compiledAt:
      compileMetadata?.compiledAt ??
      existing?.compiledAt ??
      new Date().toISOString(),
    compileModel: compileMetadata?.modelId ?? existing?.compileModel,
    summary: compiled.summary,
    concepts: compiled.concepts,
    facets: compiled.facets,
    semanticNeighbors: [],
    updatedAt: new Date().toISOString(),
  };
  let ready: MemoryArtifact;
  try {
    const embedded = await embedTexts(
      [embeddingDocument(issue, compiled)],
      'search_document',
    );
    ready = {
      ...base,
      embeddingStatus: 'ready',
      embeddingModel: embedded.model,
      dimensions: embedded.vectors[0].length,
      embedding: embedded.vectors[0],
    };
  } catch {
    ready = {
      ...base,
      embeddingStatus: 'failed',
      error:
        'AI 요약은 저장됐지만 의미 벡터 생성에 실패했습니다. 다시 시도할 수 있습니다.',
    };
    await saveMemoryArtifacts(actor, [ready]);
    return {
      artifact: ready,
      reused: false as const,
      warning: [compileWarning, ready.error].filter(Boolean).join(' '),
    };
  }
  const all = await listMemoryArtifacts(actor);
  const merged = new Map(all.map((artifact) => [artifact.issueId, artifact]));
  merged.set(issue.id, ready);
  const recalculated = withRecalculatedNeighbors([...merged.values()]);
  await saveMemoryArtifacts(actor, recalculated);
  return {
    artifact: recalculated.find((artifact) => artifact.issueId === issue.id)!,
    reused: false as const,
    ...(compileWarning ? { warning: compileWarning } : {}),
  };
}

export async function semanticScores(
  actor: string,
  query: string,
  issues: Issue[],
  excludeId?: string,
) {
  const status = getEmbeddingStatus();
  if (!status.ready) return new Map<string, number>();
  const issueById = new Map(issues.map((issue) => [issue.id, issue]));
  const artifacts = (await listMemoryArtifacts(actor)).filter((artifact) => {
    const issue = issueById.get(artifact.issueId);
    return (
      issue?.status === 'closed' &&
      issue.id !== excludeId &&
      artifact.embeddingStatus === 'ready' &&
      artifact.embeddingModel === embeddingPolicy.modelId &&
      artifact.sourceRevision === issue.revision &&
      artifact.embedding?.length
    );
  });
  if (!artifacts.length) return new Map<string, number>();
  const queryVector = (
    await embedTexts([query.slice(0, 80_000)], 'search_query')
  ).vectors[0];
  return new Map(
    artifacts
      .filter((artifact) => artifact.dimensions === queryVector.length)
      .map((artifact) => [
        artifact.issueId,
        cosineSimilarity(queryVector, artifact.embedding!),
      ]),
  );
}
