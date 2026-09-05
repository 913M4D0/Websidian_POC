'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type SyntheticEvent,
} from 'react';
import {
  ArrowUpRight,
  Check,
  ChevronRight,
  CircleDot,
  FileText,
  GitBranch,
  LoaderCircle,
  Maximize2,
  Network,
  Plug,
  Plus,
  RotateCcw,
  Search,
  X,
} from 'lucide-react';
import { GraphStage, type GravitySummary } from '@/components/issue-graph';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  createMemoryGraph,
  colorFor,
  issueNodeId,
  linkEndpointId,
  type MemoryNode,
} from '@/lib/memory-graph';
import type { Issue } from '@/lib/issues';
import { issueText, type IssueSearchResult } from '@/lib/issue-search';
import { llmPolicy } from '@/lib/llm-policy';
import type { IssueHistory } from '@/lib/issue-history';
import type { BriefResponse, LlmStatus } from '@/lib/brief-contract';
import type { MemoryArtifactClient } from '@/lib/memory-artifact';

type MemoryIndexInfo = {
  total: number;
  indexed: number;
  compiled: number;
  remaining: number;
  stale: number;
  embedding: {
    ready: boolean;
    modelId: string;
    requestedModel: string;
    requires: string[];
    reason: string;
  };
};
type IssuesPayload = {
  issues: Issue[];
  artifacts: MemoryArtifactClient[];
  memoryIndex: MemoryIndexInfo;
};

async function api<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(
    path,
    body === undefined
      ? { cache: 'no-store' }
      : {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
  );
  const data = await response.json();
  if (!response.ok)
    throw new Error(
      response.status === 401
        ? '로그인이 필요합니다.'
        : (data as { error?: string }).error || '요청에 실패했습니다.',
    );
  return data as T;
}
const shortId = (id: string) =>
  id.startsWith('WS-L-') ? `LOCAL · ${id.slice(-6)}` : id;
const percent = (n: number) => `${(n * 100).toFixed(1)}%`;
const fieldText = (value: FormDataEntryValue | null, fallback = '') =>
  typeof value === 'string' ? value : fallback;
const splitTags = (value: FormDataEntryValue | null) =>
  fieldText(value)
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);
const parseResources = (value: FormDataEntryValue | null) =>
  fieldText(value)
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => {
      const [key, label, kind] = line.split('|').map((part) => part.trim());
      return { key, label: label || key, kind: kind || 'document' };
    });

function IssueForm({
  mode,
  issue,
  onSaved,
  onClose,
  evidenceIds,
}: {
  mode: 'create' | 'resolve';
  issue: Issue | null;
  onSaved: (issue: Issue) => void;
  onClose: () => void;
  evidenceIds: string[];
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const requestId = useRef<string | null>(null);
  async function submit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError('');
    const fields = new FormData(event.currentTarget);
    try {
      let body: Record<string, unknown>;
      const attributes = JSON.parse(fieldText(fields.get('attributes'), '{}'));
      if (mode === 'create') {
        requestId.current ??= crypto.randomUUID();
        const resourceText = fieldText(fields.get('resources')).trim();
        const resources = resourceText
          ? resourceText.split('\n').map((line) => {
              const [key, label, kind] = line
                .split('|')
                .map((value) => value.trim());
              return { key, label: label || key, kind: kind || 'document' };
            })
          : [];
        body = {
          title: fields.get('title'),
          body: fields.get('body'),
          team: fields.get('team'),
          issueType: fields.get('issueType'),
          occurredAt: fields.get('occurredAt'),
          tags: splitTags(fields.get('tags')),
          resources,
          attributes,
          requestId: requestId.current,
        };
      } else {
        body = {
          expectedRevision: issue?.revision,
          body: fields.get('body'),
          outcome: fields.get('outcome'),
          tags: splitTags(fields.get('tags')),
          attributes,
          resources: parseResources(fields.get('resources')),
          evidenceIssueIds: evidenceIds,
        };
      }
      const result = await api<{ issue: Issue }>(
        mode === 'create'
          ? '/api/issues'
          : `/api/issues/${encodeURIComponent(issue!.id)}/resolve`,
        body,
      );
      onSaved(result.issue);
      onClose();
    } catch (cause) {
      setError(
        cause instanceof SyntaxError
          ? '추가 속성의 JSON 형식을 확인해 주세요.'
          : (cause as Error).message,
      );
    } finally {
      setSaving(false);
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !saving) onClose();
      }}
    >
      <DialogContent
        className="issue-dialog max-h-[88dvh] overflow-y-auto sm:max-w-[640px]"
        showCloseButton={!saving}
      >
        <DialogHeader>
          <DialogTitle>
            {mode === 'create' ? '새 이슈 등록' : '처리 완료 · 기억으로 전환'}
          </DialogTitle>
          <DialogDescription>
            {mode === 'create'
              ? '개발, 운영, 문의, 기획 — 업무 종류와 관계없이 같은 이슈로 기록합니다.'
              : '진행 노드는 사라지고 완료 기억 노드가 생성됩니다. 원문과 모든 처리 이력은 보존됩니다.'}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="issue-form">
          {mode === 'create' ? (
            <>
              <label htmlFor="issue-title">
                제목
                <Input
                  id="issue-title"
                  name="title"
                  required
                  maxLength={240}
                  placeholder="어떤 상황이 발생했나요?"
                />
              </label>
              <div className="form-columns">
                <label htmlFor="issue-team">
                  담당 팀
                  <Input
                    id="issue-team"
                    name="team"
                    required
                    defaultValue="업무 담당팀"
                    maxLength={120}
                  />
                </label>
                <label htmlFor="issue-issueType">
                  이슈 유형 · 자유 입력
                  <Input
                    id="issue-issueType"
                    name="issueType"
                    required
                    defaultValue="업무문의"
                    maxLength={120}
                  />
                </label>
              </div>
              <label htmlFor="issue-occurredAt">
                발생일
                <Input
                  id="issue-occurredAt"
                  name="occurredAt"
                  type="date"
                  required
                  defaultValue={new Intl.DateTimeFormat('en-CA', {
                    timeZone: 'Asia/Seoul',
                  }).format(new Date())}
                />
              </label>
              <label htmlFor="issue-body">
                본문
                <Textarea
                  id="issue-body"
                  name="body"
                  required
                  rows={5}
                  maxLength={20000}
                  placeholder="현상, 기대 동작, 재현 조건과 확인된 사실을 적어 주세요."
                />
              </label>
              <label htmlFor="issue-resources">
                관련 자료 · 선택
                <Textarea
                  id="issue-resources"
                  name="resources"
                  rows={2}
                  placeholder={
                    'doc:/운영/접수절차 | 접수 절차 | document\ncode:/서비스/파일.ts | 변경 파일 | code'
                  }
                />
                <small>
                  한 줄에 식별자 | 자료명 | 유형. 코드뿐 아니라 문서·정책·양식도
                  연결됩니다.
                </small>
              </label>
            </>
          ) : (
            <>
              <div className="form-context">
                {shortId(issue!.id)} · {issue!.title}
              </div>
              <label htmlFor="issue-body">
                처리 내용
                <Textarea
                  id="issue-body"
                  name="body"
                  required
                  rows={6}
                  maxLength={20000}
                  placeholder="확인한 원인, 판단 근거, 조치, 검증 결과를 기록해 주세요."
                />
              </label>
              <label htmlFor="issue-outcome">
                처리 결과 · 자유 입력
                <Input
                  id="issue-outcome"
                  name="outcome"
                  required
                  maxLength={240}
                  placeholder="예: 기존 정책 안내 후 종료 / 공통 절차 적용"
                />
              </label>
              <label htmlFor="issue-resources">
                변경·참고 자료 추가 · 선택
                <Textarea
                  id="issue-resources"
                  name="resources"
                  rows={2}
                  placeholder="자료 식별자 | 자료명 | 유형"
                />
                <small>
                  문서·정책·소스·양식 모두 가능하며 기존 자료는 유지됩니다.
                </small>
              </label>
              <small>
                선택한 과거 근거 {evidenceIds.length}건을 처리 참고 기록으로
                함께 보관합니다.
              </small>
            </>
          )}
          <label htmlFor="issue-tags">
            태그 · 자유 입력
            <Input
              id="issue-tags"
              name="tags"
              defaultValue={issue?.tags.join(', ') || ''}
              placeholder="쉼표로 구분 · 서로 다른 표현이어도 괜찮습니다"
            />
          </label>
          <details>
            <summary>추가 평가·분류 속성 (선택)</summary>
            <label htmlFor="issue-attributes">
              문자열 또는 숫자 값을 갖는 JSON
              <Textarea
                id="issue-attributes"
                name="attributes"
                defaultValue={JSON.stringify(issue?.attributes || {}, null, 2)}
                rows={4}
                className="font-mono"
              />
            </label>
          </details>
          {error && (
            <p role="alert" className="form-error">
              {error}
            </p>
          )}
          <div className="form-actions">
            <Button
              type="button"
              variant="outline"
              disabled={saving}
              onClick={onClose}
            >
              취소
            </Button>
            <Button type="submit" disabled={saving}>
              {saving && <LoaderCircle className="animate-spin" />}
              {mode === 'create' ? '이슈 등록' : '완료하고 기억에 저장'}
            </Button>
          </div>
          <small>
            Websidian 개인 POC 작업공간에 영구 저장합니다. 외부 도구 연결 없이
            사용할 수 있습니다.
          </small>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function IntegrationDialog({
  index,
  onArtifacts,
  onImported,
  onClose,
}: {
  index: MemoryIndexInfo | null;
  onArtifacts: (
    artifacts: MemoryArtifactClient[],
    index: Partial<MemoryIndexInfo>,
  ) => void;
  onImported: (message: string) => Promise<void>;
  onClose: () => void;
}) {
  const [repository, setRepository] = useState('913M4D0/Websidian_POC');
  const [busy, setBusy] = useState<'github' | 'index' | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function importGitHub() {
    if (!repository.trim() || busy) return;
    setBusy('github');
    setError('');
    setMessage('');
    try {
      const result = await api<{
        repository: string;
        found: number;
        imported: number;
        linked: number;
        unchanged: number;
        skipped: number;
        authenticated: boolean;
        mode: string;
      }>('/api/integrations/github/import', { repository });
      const summary = `${result.repository} · 확인 ${result.found}건 · 신규 ${result.imported}건 · 기존 연결 ${result.linked}건 · 보존 ${result.unchanged}건${result.skipped ? ` · 제외 ${result.skipped}건` : ''}`;
      setMessage(summary);
      await onImported(summary);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function buildIndex() {
    if (busy) return;
    setBusy('index');
    setError('');
    setMessage('');
    try {
      const result = await api<{
        total: number;
        indexed: number;
        compiled: number;
        remaining: number;
        stale: number;
        processed: number;
        modelId: string;
        artifacts: MemoryArtifactClient[];
      }>('/api/memory/index', { limit: 32 });
      onArtifacts(result.artifacts, result);
      setMessage(
        result.processed
          ? `${result.processed}건을 의미 색인했습니다. 남은 기억 ${result.remaining}건입니다.`
          : '모든 완료 기억의 의미 색인이 최신 상태입니다.',
      );
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent
        className="integration-dialog sm:max-w-[620px]"
        showCloseButton={!busy}
      >
        <DialogHeader>
          <DialogTitle>외부 기억 연결 · AI 색인</DialogTitle>
          <DialogDescription>
            Websidian은 독립형 이슈 처리 사이트입니다. GitHub는 연결 가능한 형상
            기억 도구의 한 예이며, 가져오기는 원본을 덮어쓰지 않는 단방향
            스냅샷입니다.
          </DialogDescription>
        </DialogHeader>
        <section className="integration-section">
          <div>
            <strong>GitHub 이슈 가져오기</strong>
            <span>공개 저장소는 토큰 없이도 최대 300건을 가져옵니다.</span>
          </div>
          <label htmlFor="github-repository">저장소 또는 이슈 URL</label>
          <div className="integration-action">
            <Input
              id="github-repository"
              value={repository}
              onChange={(event) => setRepository(event.target.value)}
              disabled={Boolean(busy)}
              maxLength={300}
            />
            <Button
              size="sm"
              variant="outline"
              onClick={() => void importGitHub()}
              disabled={Boolean(busy) || !repository.trim()}
            >
              {busy === 'github' ? (
                <LoaderCircle className="animate-spin" />
              ) : (
                <GitBranch />
              )}
              가져오기
            </Button>
          </div>
        </section>
        <section className="integration-section">
          <div>
            <strong>의미 기반 Memory Graph</strong>
            <span>
              {index
                ? `완료 기억 ${index.total}건 중 ${index.indexed}건 색인 · AI 컴파일 ${index.compiled}건`
                : '색인 상태를 확인하는 중입니다.'}
            </span>
          </div>
          <div className="index-meter" aria-label="의미 색인 진행률">
            <span
              style={{
                width: `${index?.total ? (index.indexed / index.total) * 100 : 0}%`,
              }}
            />
          </div>
          <p className="integration-disclosure">
            실행하면 처리 완료 이슈의 발췌문을 OpenRouter의 데이터 수집 거부·ZDR
            조건 제공자에게 전송합니다. API 사용량이 발생할 수 있어 자동
            실행하지 않습니다. 생성 모델은 GPT 5.6 Luna, 검색 임베딩은 Qwen3
            Embedding 8B로 분리합니다.
          </p>
          <Button
            size="sm"
            onClick={() => void buildIndex()}
            disabled={
              Boolean(busy) || !index?.embedding.ready || index.remaining === 0
            }
          >
            {busy === 'index' ? (
              <LoaderCircle className="animate-spin" />
            ) : (
              <Network />
            )}
            다음 {Math.min(32, index?.remaining ?? 0)}건 색인
          </Button>
          {index && !index.embedding.ready && (
            <small className="integration-warning">
              {index.embedding.reason}
            </small>
          )}
        </section>
        {message && <p className="integration-message">{message}</p>}
        {error && <p className="form-error">{error}</p>}
      </DialogContent>
    </Dialog>
  );
}

export function MemoryUniverse() {
  const [issues, setIssues] = useState<Issue[]>([]);
  const [artifacts, setArtifacts] = useState<MemoryArtifactClient[]>([]);
  const [memoryIndex, setMemoryIndex] = useState<MemoryIndexInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [gravityRootId, setGravityRootId] = useState<string | null>(null);
  const [gravity, setGravity] = useState<GravitySummary | null>(null);
  const [dataVersion, setDataVersion] = useState(0);
  const [resetVersion, setResetVersion] = useState(0);
  const [focusVersion, setFocusVersion] = useState(0);
  const [graphReady, setGraphReady] = useState(false);
  const [graphError, setGraphError] = useState(false);
  const [highlightStrength, setHighlightStrength] = useState(0.7);
  const [neighbors, setNeighbors] = useState(4);
  const [neighborDraft, setNeighborDraft] = useState(4);
  const [tab, setTab] = useState<'issues' | 'memories' | 'search' | 'brief'>(
    'issues',
  );
  const [activeIssueId, setActiveIssueId] = useState<string | null>(null);
  const [listFilter, setListFilter] = useState('');
  const [history, setHistory] = useState<IssueHistory | null>(null);
  const [brief, setBrief] = useState<BriefResponse | null>(null);
  const [briefBusy, setBriefBusy] = useState(false);
  const [llmStatus, setLlmStatus] = useState<LlmStatus | null>(null);
  const [progressText, setProgressText] = useState('');
  const [progressBusy, setProgressBusy] = useState(false);
  const [query, setQuery] = useState('');
  const [submittedQuery, setSubmittedQuery] = useState('');
  const [referenceId, setReferenceId] = useState<string | undefined>();
  const [results, setResults] = useState<IssueSearchResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [limit, setLimit] = useState(24);
  const [form, setForm] = useState<'create' | 'resolve' | null>(null);
  const [pinnedIds, setPinnedIds] = useState<string[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [integrationOpen, setIntegrationOpen] = useState(false);
  const [compilingIds, setCompilingIds] = useState<Set<string>>(new Set());
  const searchSequence = useRef(0);
  const briefSequence = useRef(0);

  const load = useCallback(async () => {
    try {
      const data = await api<IssuesPayload>('/api/issues');
      searchSequence.current += 1;
      setIssues(data.issues);
      setArtifacts(data.artifacts);
      setMemoryIndex(data.memoryIndex);
      setError('');
      setDataVersion((value) => value + 1);
      setGraphReady(false);
      setGraphError(false);
      setSelectedId(null);
      setGravityRootId(null);
      setActiveIssueId(null);
      setHistory(null);
      setBrief(null);
      setPinnedIds([]);
      briefSequence.current++;
      setResults(null);
      setSearching(false);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    let active = true;
    void api<IssuesPayload>('/api/issues')
      .then((data) => {
        if (active) {
          setIssues(data.issues);
          setArtifacts(data.artifacts);
          setMemoryIndex(data.memoryIndex);
        }
      })
      .catch((cause: unknown) => {
        if (active) setError((cause as Error).message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    void api<LlmStatus>('/api/llm')
      .then((data) => {
        if (active) setLlmStatus(data);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  const graph = useMemo(
    () => createMemoryGraph(issues, neighbors, activeIssueId, artifacts),
    [issues, neighbors, activeIssueId, artifacts],
  );
  const byId = useMemo(
    () => new Map(issues.map((issue) => [issue.id, issue])),
    [issues],
  );
  const selected = selectedId ? (byId.get(selectedId) ?? null) : null;
  const artifactById = useMemo(
    () => new Map(artifacts.map((artifact) => [artifact.issueId, artifact])),
    [artifacts],
  );
  const selectedArtifact = selected ? artifactById.get(selected.id) : undefined;
  const activeIssue = activeIssueId ? byId.get(activeIssueId) : undefined;
  const selectedNodeId = selected ? issueNodeId(selected) : null;
  const memoryCount = issues.filter(
    (issue) => issue.status === 'closed',
  ).length;
  const openCount = issues.filter((issue) => issue.status === 'open').length;
  const githubCount = issues.filter(
    (issue) => issue.source?.platform === 'github',
  ).length;
  const highlightedIds = useMemo(
    () =>
      new Set(
        (results || [])
          .filter((result) => result.score > 0)
          .slice(0, 12)
          .map((result) => `memory:${result.issueId}`),
      ),
    [results],
  );
  const sortedIssues = useMemo(
    () =>
      [...issues].sort(
        (a, b) =>
          b.occurredAt.localeCompare(a.occurredAt) || a.id.localeCompare(b.id),
      ),
    [issues],
  );
  const list =
    tab === 'search' && results
      ? results.map((result) => byId.get(result.issueId)!).filter(Boolean)
      : sortedIssues.filter(
          (issue) =>
            issue.status === (tab === 'issues' ? 'open' : 'closed') &&
            `${issue.id} ${issue.title} ${issue.team}`
              .toLocaleLowerCase()
              .includes(listFilter.toLocaleLowerCase()),
        );
  const resultById = useMemo(
    () => new Map((results || []).map((result) => [result.issueId, result])),
    [results],
  );
  const adjacent = (() => {
    if (!selectedNodeId) return [];
    return graph.links
      .filter(
        (link) =>
          linkEndpointId(link.source) === selectedNodeId ||
          linkEndpointId(link.target) === selectedNodeId,
      )
      .map((link) => ({
        link,
        issue: byId.get(
          (linkEndpointId(link.source) === selectedNodeId
            ? linkEndpointId(link.target)
            : linkEndpointId(link.source)
          ).replace(/^(active|memory):/, ''),
        )!,
      }))
      .sort((a, b) => b.link.score - a.link.score);
  })();
  const select = useCallback((node: MemoryNode | null) => {
    setSelectedId(node?.issueId ?? null);
    setProgressText('');
    if (node) {
      setGravityRootId((root) => root || node.id);
      setFocusVersion((version) => version + 1);
    } else setGravityRootId(null);
  }, []);
  const selectIssue = (issue: Issue) => {
    if (issue.status === 'open') {
      if (activeIssueId !== issue.id) {
        searchSequence.current++;
        briefSequence.current++;
        setSearching(false);
        setHistory(null);
        setBrief(null);
        setResults(null);
        setPinnedIds([]);
        setSubmittedQuery('');
        setQuery('');
        setReferenceId(issue.id);
        setGraphReady(false);
        setGraphError(false);
      }
      setActiveIssueId(issue.id);
      setSelectedId(issue.id);
      setGravityRootId(issueNodeId(issue));
      setFocusVersion((value) => value + 1);
      setProgressText('');
    } else {
      const node = graph.nodes.find((node) => node.issueId === issue.id);
      if (node) select(node);
    }
    if (window.innerWidth <= 680) setSidebarOpen(false);
  };
  function resetView() {
    setSelectedId(null);
    setGravityRootId(null);
    setResetVersion((value) => value + 1);
    setActiveIssueId(null);
  }
  async function search(
    text = query,
    excludeId = referenceId,
    evidencePins = pinnedIds,
  ) {
    if (!text.trim()) return;
    const sequence = ++searchSequence.current;
    setSearching(true);
    setHistory(null);
    setBrief(null);
    briefSequence.current++;
    setError('');
    setTab('search');
    setSidebarOpen(true);
    try {
      const [response, context] = await Promise.all([
        api<{ results: IssueSearchResult[] }>('/api/search', {
          query: text,
          excludeId,
        }),
        api<IssueHistory>('/api/history', {
          query: text,
          referenceId: excludeId,
          pinnedIds: evidencePins.filter((id) => id !== excludeId),
        }),
      ]);
      if (sequence !== searchSequence.current) return;
      setResults(response.results);
      setHistory(context);
      setSubmittedQuery(text);
      setLimit(24);
    } catch (cause) {
      if (sequence === searchSequence.current)
        setError((cause as Error).message);
    } finally {
      if (sequence === searchSequence.current) setSearching(false);
    }
  }
  function explore(issue: Issue) {
    const evidencePins =
      issue.status === 'open' && activeIssueId !== issue.id
        ? []
        : pinnedIds.filter((id) => id !== issue.id);
    setPinnedIds(evidencePins);
    if (issue.status === 'open') selectIssue(issue);
    const text = issueText(issue).slice(0, 6000);
    setQuery(text);
    setReferenceId(issue.id);
    void search(text, issue.id, evidencePins);
  }
  function saved(issue: Issue) {
    searchSequence.current += 1;
    setSearching(false);
    setIssues((current) =>
      current.some((item) => item.id === issue.id)
        ? current.map((item) => (item.id === issue.id ? issue : item))
        : [...current, issue],
    );
    setDataVersion((value) => value + 1);
    setGraphReady(false);
    setGraphError(false);
    setSelectedId(issue.id);
    setActiveIssueId(issue.status === 'open' ? issue.id : null);
    setGravityRootId(issueNodeId(issue));
    setFocusVersion((value) => value + 1);
    setTab(issue.status === 'open' ? 'issues' : 'memories');
    setListFilter('');
    setResults(null);
    setReferenceId(undefined);
    setSubmittedQuery('');
    setQuery('');
    setHistory(null);
    setBrief(null);
    setPinnedIds([]);
    setProgressText('');
    briefSequence.current++;
    setNotice(
      issue.status === 'closed'
        ? '처리 완료. 진행 노드를 제거하고 완료 기억 노드를 생성했습니다. 원문·처리 이력·참고 근거는 그대로 보관됩니다.'
        : '신규 이슈가 접수됐습니다. 이슈를 확인하고 과거 히스토리를 탐색해 보세요.',
    );
    if (issue.status === 'closed') void compileMemory(issue.id);
  }
  function togglePin(id: string) {
    if (byId.get(id)?.status !== 'closed' || id === referenceId) return;
    setBrief(null);
    briefSequence.current++;
    setPinnedIds((current) =>
      current.includes(id)
        ? current.filter((item) => item !== id)
        : current.length < 16
          ? [...current, id]
          : current,
    );
  }
  async function saveProgress() {
    if (
      !selected ||
      selected.status !== 'open' ||
      !progressText.trim() ||
      progressBusy
    )
      return;
    setProgressBusy(true);
    setError('');
    const issueId = selected.id;
    try {
      const data = await api<{ issue: Issue }>(
        `/api/issues/${encodeURIComponent(issueId)}/activities`,
        {
          expectedRevision: selected.revision,
          body: progressText,
        },
      );
      setIssues((current) =>
        current.map((item) => (item.id === issueId ? data.issue : item)),
      );
      setDataVersion((value) => value + 1);
      setGraphReady(false);
      setHistory(null);
      setBrief(null);
      setResults(null);
      searchSequence.current++;
      setSearching(false);
      briefSequence.current++;
      setProgressText('');
      setNotice('진행 기록을 저장했습니다. 원문은 변경하지 않았습니다.');
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setProgressBusy(false);
    }
  }
  async function refreshMemoryArtifacts() {
    const data = await api<
      MemoryIndexInfo & { artifacts: MemoryArtifactClient[] }
    >('/api/memory/index');
    setArtifacts(data.artifacts);
    setMemoryIndex((current) =>
      current
        ? { ...current, ...data }
        : { ...data, embedding: data.embedding },
    );
  }
  async function compileMemory(issueId: string) {
    if (compilingIds.has(issueId)) return;
    setCompilingIds((current) => new Set(current).add(issueId));
    try {
      const result = await api<{
        artifact: MemoryArtifactClient;
        reused: boolean;
        warning?: string;
      }>(`/api/issues/${encodeURIComponent(issueId)}/memory/compile`, {});
      setArtifacts((current) => [
        ...current.filter((artifact) => artifact.issueId !== issueId),
        result.artifact,
      ]);
      await refreshMemoryArtifacts();
      setNotice(
        result.warning ||
          (result.reused
            ? 'AI 기억과 의미 연결이 이미 최신 상태입니다.'
            : 'GPT 5.6 Luna가 검색용 기억을 컴파일하고 의미 연결을 갱신했습니다.'),
      );
    } catch (cause) {
      try {
        await refreshMemoryArtifacts();
      } catch {}
      setError(
        `${(cause as Error).message} 이슈 완료와 원문은 보존됐으며 다시 시도할 수 있습니다.`,
      );
    } finally {
      setCompilingIds((current) => {
        const next = new Set(current);
        next.delete(issueId);
        return next;
      });
    }
  }
  function acceptIndexedArtifacts(
    nextArtifacts: MemoryArtifactClient[],
    nextIndex: Partial<MemoryIndexInfo>,
  ) {
    setArtifacts(nextArtifacts);
    setMemoryIndex((current) =>
      current ? { ...current, ...nextIndex } : (nextIndex as MemoryIndexInfo),
    );
    setDataVersion((value) => value + 1);
    setGraphReady(false);
  }
  async function refreshAfterImport(message: string) {
    await load();
    setNotice(message);
  }
  async function generateBrief() {
    if (!history || !submittedQuery || briefBusy || !llmStatus?.ready) return;
    const sequence = ++briefSequence.current;
    setBriefBusy(true);
    setError('');
    try {
      const data = await api<BriefResponse>('/api/brief', {
        query: history.query,
        referenceId: history.referenceId,
        pinnedIds,
      });
      if (sequence === briefSequence.current) setBrief(data);
    } catch (cause) {
      if (sequence === briefSequence.current)
        setError((cause as Error).message);
    } finally {
      setBriefBusy(false);
    }
  }
  function commitNeighbors() {
    if (neighborDraft === neighbors) return;
    setNeighbors(neighborDraft);
    setGraphReady(false);
    setGravityRootId(null);
  }

  return (
    <main className={`issue-workbench ${sidebarOpen ? 'sidebar-visible' : ''}`}>
      <header className="workbench-header">
        <button
          className="brand-button"
          onClick={resetView}
          aria-label="Websidian 전체 보기"
        >
          <Network size={20} />
          <strong>websidian</strong>
          <span>ISSUE WORKSPACE</span>
        </button>
        <div className="header-center">
          <span className="live-dot" /> 개인 POC · 합성 데이터{' '}
          {issues.filter((issue) => issue.synthetic).length}건 · GitHub 단방향
          연결 가능
        </div>
        <div className="header-actions">
          <Button
            size="sm"
            variant="outline"
            disabled={loading || Boolean(error && !issues.length)}
            onClick={() => setIntegrationOpen(true)}
          >
            <Plug /> 연결 · AI
          </Button>
          <Button
            size="sm"
            disabled={loading || Boolean(error && !issues.length)}
            onClick={() => setForm('create')}
          >
            <Plus /> 이슈 등록
          </Button>
        </div>
      </header>
      <div className="workflow-strip" aria-label="이슈 처리 흐름">
        <button
          onClick={() => {
            setTab('issues');
            setSidebarOpen(true);
          }}
        >
          <span>01</span> 신규 이슈 <b>{openCount}</b>
        </button>
        <ChevronRight size={13} />
        <button
          onClick={() => {
            if (activeIssue) explore(activeIssue);
            else {
              setTab('search');
              setSidebarOpen(true);
            }
          }}
        >
          <span>02</span> 확인 · 히스토리 탐색
        </button>
        <ChevronRight size={13} />
        <button
          onClick={() => {
            setTab('memories');
            setSidebarOpen(true);
          }}
        >
          <span>03</span> 완료된 기억 <b>{memoryCount}</b>
        </button>
        <small>일이 끝나면, 다음 일을 위한 기억이 됩니다.</small>
      </div>
      <div className="workbench-body">
        {sidebarOpen && (
          <aside className="issue-sidebar">
            <button
              className="sidebar-mobile-close"
              aria-label="이슈 목록 닫기"
              onClick={() => setSidebarOpen(false)}
            >
              <X size={15} /> 목록 닫기
            </button>
            <div className="sidebar-tabs" aria-label="작업 메뉴">
              {(
                [
                  ['issues', '진행'],
                  ['memories', '기억'],
                  ['search', '탐색'],
                  ['brief', 'Brief'],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  aria-pressed={tab === value}
                  onClick={() => {
                    setTab(value);
                    setLimit(24);
                  }}
                >
                  {label}
                  {value === 'issues' && <span>{openCount}</span>}
                  {value === 'memories' && <span>{memoryCount}</span>}
                  {value === 'brief' && pinnedIds.length > 0 && (
                    <span>{pinnedIds.length}</span>
                  )}
                </button>
              ))}
            </div>
            {tab !== 'brief' ? (
              <>
                <form
                  className="issue-search"
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (tab === 'search') void search();
                  }}
                >
                  <label htmlFor="history-query" className="sr-only">
                    이슈 내용으로 과거 기록 탐색
                  </label>
                  <div className="search-field">
                    <Search size={16} />
                    <Input
                      id="history-query"
                      value={tab === 'search' ? query : listFilter}
                      maxLength={6000}
                      onChange={(event) => {
                        if (tab === 'search') {
                          setQuery(event.target.value);
                          setReferenceId(undefined);
                          searchSequence.current++;
                          briefSequence.current++;
                          setSearching(false);
                          setHistory(null);
                          setBrief(null);
                          setResults(null);
                          setSubmittedQuery('');
                        } else {
                          setListFilter(event.target.value);
                          setLimit(24);
                        }
                      }}
                      placeholder={
                        tab === 'search'
                          ? '어떤 히스토리가 필요한가요?'
                          : '제목 · 이슈 번호 · 담당 팀 검색'
                      }
                    />
                    <button
                      type="submit"
                      disabled={tab !== 'search' || searching || !query.trim()}
                      aria-label="과거 기록 탐색"
                    >
                      {searching ? (
                        <LoaderCircle size={16} className="animate-spin" />
                      ) : (
                        <ChevronRight size={17} />
                      )}
                    </button>
                  </div>
                  <p>
                    {tab === 'issues'
                      ? '처리를 기다리는 이슈'
                      : tab === 'memories'
                        ? '완료되어 축적된 기억'
                        : '완료 이력만 탐색 · 최대 2-hop 근거 수집'}
                  </p>
                </form>
                <div className="list-caption">
                  <span>
                    {tab === 'search' && results
                      ? `전체 ${results.length}건 순위`
                      : `ISSUES · ${list.length}`}
                  </span>
                  {tab === 'search' && (
                    <button
                      onClick={() => {
                        searchSequence.current++;
                        setSearching(false);
                        setResults(null);
                        setQuery('');
                        setSubmittedQuery('');
                        setReferenceId(undefined);
                        setTab('issues');
                        setHistory(null);
                        setBrief(null);
                        briefSequence.current++;
                      }}
                    >
                      탐색 초기화
                    </button>
                  )}
                </div>
                {tab === 'search' && results && (
                  <div className="search-note">
                    {referenceId
                      ? `${shortId(referenceId)} 기준`
                      : '입력한 내용 기준'}{' '}
                    · {results.filter((result) => result.score > 0).length}건
                    일치
                    <br />
                    점수는{' '}
                    {results.some(
                      (result) => result.semanticScore !== undefined,
                    )
                      ? '의미·문장·자료의 혼합 관련도'
                      : '문장·자료 일치도'}
                    이며, 정답 확률이 아닙니다.
                    {history && (
                      <button
                        className="history-report-link"
                        onClick={() => setTab('brief')}
                      >
                        수집된 근거 {history.evidence.length}건 확인{' '}
                        <ArrowUpRight size={12} />
                      </button>
                    )}
                    {results.every((result) => result.score === 0) && (
                      <strong>
                        일치하는 기록이 없습니다. 전체 이슈는 아래에서 확인할 수
                        있습니다.
                      </strong>
                    )}
                  </div>
                )}
                <nav
                  className="issue-list"
                  aria-label={
                    tab === 'issues' ? '진행 이슈 목록' : '완료 기억 목록'
                  }
                >
                  {loading && (
                    <p className="empty-copy">이슈를 불러오는 중입니다…</p>
                  )}
                  {!loading && !list.length && (
                    <p className="empty-copy">표시할 이슈가 없습니다.</p>
                  )}
                  {list.slice(0, limit).map((issue) => {
                    const result =
                      tab === 'search' ? resultById.get(issue.id) : undefined;
                    return (
                      <button
                        key={issue.id}
                        className={`issue-row ${selectedId === issue.id ? 'is-selected' : ''}`}
                        onClick={() => selectIssue(issue)}
                        aria-pressed={selectedId === issue.id}
                      >
                        <span className="issue-row-meta">
                          <span style={{ color: colorFor(issue.team) }}>
                            <CircleDot size={12} />
                            {shortId(issue.id)}
                          </span>
                          <span>
                            {result
                              ? `${percent(result.score)} 일치`
                              : issue.occurredAt}
                          </span>
                        </span>
                        <strong>{issue.title}</strong>
                        <span className="issue-row-bottom">
                          <span>{issue.team}</span>
                          <span
                            className={
                              issue.status === 'open'
                                ? 'status-open'
                                : 'status-closed'
                            }
                          >
                            {issue.status === 'open' ? '진행 중' : '완료 기억'}
                          </span>
                        </span>
                        {result && result.evidence.length > 0 && (
                          <small>{result.evidence[0]}</small>
                        )}
                      </button>
                    );
                  })}
                  {list.length > limit && (
                    <Button
                      className="load-more"
                      variant="ghost"
                      onClick={() => setLimit((value) => value + 24)}
                    >
                      더 보기 · {limit} / {list.length}
                    </Button>
                  )}
                </nav>
              </>
            ) : (
              <section className="brief-workspace">
                <span className="section-kicker">HISTORY / EVIDENCE</span>
                <h2>
                  이번 이슈를 위한
                  <br />
                  과거의 근거.
                </h2>
                <p>
                  기존 이슈의 원문은 바뀌지 않습니다. 현재 관점의 해석은 이
                  화면에서만 확인합니다.
                </p>
                {referenceId && (
                  <button
                    className="context-reference"
                    onClick={() => {
                      const issue = byId.get(referenceId);
                      if (issue) selectIssue(issue);
                    }}
                  >
                    {shortId(referenceId)} · {byId.get(referenceId)?.title}
                  </button>
                )}
                {!history && (
                  <div className="brief-empty">
                    <Network size={28} />
                    <p>
                      진행 이슈에서 ‘히스토리’를 누르거나 탐색어를 입력하면,
                      직접 연결과 그 다음 연결의 근거를 모읍니다.
                    </p>
                    <Button
                      size="sm"
                      onClick={() => {
                        if (activeIssue) explore(activeIssue);
                        else {
                          setTab('search');
                          setSidebarOpen(true);
                        }
                      }}
                    >
                      히스토리 탐색 시작
                    </Button>
                  </div>
                )}
                {history && (
                  <>
                    <h3>
                      자동 수집한 과거 이력{' '}
                      <span>{history.evidence.length}건</span>
                    </h3>
                    <p className="evidence-disclosure">
                      텍스트·자료 기반 2-hop 탐색 / 아래 내용은 원문 발췌입니다.
                      AI의 해석이나 원인 확정이 아닙니다.
                    </p>
                    {!history.evidence.length && (
                      <p>
                        일치하는 완료 기록을 찾지 못했습니다. 탐색어를 바꾸거나
                        직접 참고할 기억을 담아 주세요.
                      </p>
                    )}
                    {history.evidence.map((evidence) => (
                      <article
                        className="history-evidence"
                        key={evidence.issueId}
                      >
                        <div className="evidence-route">
                          <span>
                            {evidence.depth === 2 ? '연결의 연결' : '직접 탐색'}
                          </span>
                          <time>{evidence.occurredAt}</time>
                        </div>
                        <button
                          className="evidence-title"
                          onClick={() => {
                            const issue = byId.get(evidence.issueId);
                            if (issue) selectIssue(issue);
                          }}
                        >
                          {shortId(evidence.issueId)} · {evidence.title}
                        </button>
                        {evidence.viaIssueId && (
                          <button
                            className="evidence-via"
                            onClick={() => {
                              const via = byId.get(evidence.viaIssueId!);
                              if (via) selectIssue(via);
                            }}
                          >
                            경유한 기록: {shortId(evidence.viaIssueId)} ↗
                          </button>
                        )}
                        <p>{evidence.summary}</p>
                        {!!evidence.sharedResources.length && (
                          <small>
                            공통 자료 {evidence.sharedResources.length}개 ·{' '}
                            {evidence.sharedResources.join(', ')}
                          </small>
                        )}
                        <button
                          className="evidence-pin"
                          aria-pressed={pinnedIds.includes(evidence.issueId)}
                          onClick={() => togglePin(evidence.issueId)}
                        >
                          {pinnedIds.includes(evidence.issueId) ? (
                            <Check size={12} />
                          ) : (
                            <Plus size={12} />
                          )}
                          {pinnedIds.includes(evidence.issueId)
                            ? '처리 참고 근거에 담음'
                            : '처리 참고 근거로 담기'}
                        </button>
                      </article>
                    ))}
                  </>
                )}
                <h3>직접 선택한 참고 근거 {pinnedIds.length}건</h3>
                {pinnedIds.length === 0 && (
                  <p>
                    활용할 과거 기록을 담으면, 이슈 완료 시 참고 관계로
                    보관됩니다.
                  </p>
                )}
                {pinnedIds.map((id) => {
                  const issue = byId.get(id);
                  return issue ? (
                    <div className="evidence-item" key={id}>
                      <button onClick={() => selectIssue(issue)}>
                        <span>{shortId(id)} · 원문</span>
                        {issue.title}
                      </button>
                      <button
                        aria-label={`${shortId(id)} 근거 제거`}
                        onClick={() => togglePin(id)}
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ) : null;
                })}
                <div className="provider-state">
                  <span>
                    {llmStatus?.ready ? 'AI 분석 준비됨' : 'AI 분석 연결 대기'}
                  </span>
                  <strong>
                    {llmPolicy.provider} · {llmPolicy.requestedModel}
                  </strong>
                  <small>
                    {llmStatus?.reason || '서버 연결 설정을 확인하고 있습니다.'}
                    <br />
                    공식 지원 최대 추론 · 근거 없는 단정은 구분
                  </small>
                </div>
                <Button
                  className="w-full brief-generate"
                  disabled={
                    !llmStatus?.ready ||
                    !history ||
                    !submittedQuery ||
                    briefBusy
                  }
                  onClick={() => void generateBrief()}
                >
                  {briefBusy && <LoaderCircle className="animate-spin" />}
                  {briefBusy ? '근거를 해석하는 중…' : 'AI History Brief 생성'}
                </Button>
                <small>
                  생성 시 현재 이슈와 선택·수집한 이력이 OpenRouter에
                  전송됩니다. 키가 없어도 위의 원문 탐색과 이슈 처리는 사용할 수
                  있습니다.
                </small>
                {brief && (
                  <div className="generated-brief">
                    <span className="section-kicker">AI HISTORY BRIEF</span>
                    <h3>현재 이슈에 대한 해석</h3>
                    <p>{brief.brief.summary}</p>
                    {brief.brief.findings.map((finding, index) => (
                      <div className="brief-finding" key={`finding-${index}`}>
                        <small>
                          {finding.kind === 'fact'
                            ? '확인된 사실'
                            : '추정 · 추가 확인 필요'}
                        </small>
                        <p>{finding.text}</p>
                        <div className="brief-citations">
                          {finding.evidenceIds.map((id) => (
                            <button
                              key={id}
                              onClick={() => {
                                const issue = byId.get(id);
                                if (issue) selectIssue(issue);
                              }}
                            >
                              {shortId(id)} ↗
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                    {!!brief.brief.cautions.length && <h3>주의할 점</h3>}
                    {brief.brief.cautions.map((finding, index) => (
                      <div className="brief-finding" key={`caution-${index}`}>
                        <p>{finding.text}</p>
                        <div className="brief-citations">
                          {finding.evidenceIds.map((id) => (
                            <button
                              key={id}
                              onClick={() => {
                                const issue = byId.get(id);
                                if (issue) selectIssue(issue);
                              }}
                            >
                              {shortId(id)} ↗
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                    <h3>다음 확인 사항</h3>
                    <ol>
                      {brief.brief.nextActions.map((action, index) => (
                        <li key={index}>{action}</li>
                      ))}
                    </ol>
                    <small>
                      AI 출력은 원본 기록을 대체하지 않습니다. 조치 전 근거를
                      확인하세요.
                    </small>
                  </div>
                )}
              </section>
            )}
            <div className="sidebar-bottom">
              <GitBranch size={13} />
              {loading
                ? '불러오는 중…'
                : `웹 자체 저장 · 외부 도구 연결 예시 ${githubCount}건`}
            </div>
          </aside>
        )}
        <section
          className="graph-viewport"
          aria-label="이슈 연결 그래프"
          data-memory-count={
            graph.nodes.filter((node) => node.phase === 'memory').length
          }
          data-active-node={
            graph.nodes.find((node) => node.phase === 'active')?.id || ''
          }
          data-selected-node={selectedNodeId || ''}
        >
          {graph.nodes.length > 0 && (
            <GraphStage
              key={`${dataVersion}:${neighbors}:${activeIssueId ?? 'nebula'}`}
              nodes={graph.nodes}
              links={graph.links}
              selectedId={selectedNodeId}
              gravityRootId={gravityRootId}
              activeCluster={null}
              highlightStrength={highlightStrength}
              highlightedIds={highlightedIds}
              viewResetVersion={resetVersion}
              selectionFocusVersion={focusVersion}
              onSelect={select}
              onGravityChange={setGravity}
              onReady={() => setGraphReady(true)}
              onError={() => setGraphError(true)}
            />
          )}
          <div className="graph-toolbar" data-graph-obstruction="top">
            <div>
              <span className="section-kicker">
                {gravityRootId ? 'CONTEXT TREE' : 'MEMORY UNIVERSE'}
              </span>
              <h1>
                {gravityRootId
                  ? '한 이슈에서 이어지는 기록'
                  : '완료된 일이, 다음 일의 기억으로.'}
              </h1>
            </div>
            <div className="graph-tool-actions">
              <Button
                size="icon-sm"
                variant="outline"
                aria-label={sidebarOpen ? '이슈 목록 접기' : '이슈 목록 열기'}
                onClick={() => setSidebarOpen((value) => !value)}
              >
                <FileText />
              </Button>
              <Button
                size="icon-sm"
                variant="outline"
                aria-label="전체 성운 보기"
                onClick={resetView}
              >
                <RotateCcw />
              </Button>
              <Button
                size="icon-sm"
                variant="outline"
                disabled={!selectedId || !gravityRootId}
                aria-label="선택 이슈 화면에 맞추기"
                onClick={() => setFocusVersion((value) => value + 1)}
              >
                <Maximize2 />
              </Button>
            </div>
          </div>
          {activeIssue?.status === 'open' && (
            <div className="active-issue-bar" data-graph-obstruction="top">
              <span className="active-indicator" />
              <button onClick={() => selectIssue(activeIssue)}>
                <small>현재 확인 중 · {shortId(activeIssue.id)}</small>
                <strong>{activeIssue.title}</strong>
              </button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => explore(activeIssue)}
                disabled={searching}
              >
                <Search size={13} /> 히스토리
              </Button>
            </div>
          )}
          {error && (
            <div className="workbench-alert" role="alert">
              {error}
              {error.includes('로그인') ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    window.location.assign('/signin-with-chatgpt?return_to=/')
                  }
                >
                  로그인하기
                </Button>
              ) : (
                <button onClick={() => void load()}>다시 불러오기</button>
              )}
            </div>
          )}
          {notice && (
            <output className="workbench-notice">
              {notice}
              <button aria-label="알림 닫기" onClick={() => setNotice('')}>
                <X size={14} />
              </button>
            </output>
          )}
          {(loading ||
            (!graphReady && !graphError && graph.nodes.length > 0)) &&
            !error && (
              <div className="graph-loading">
                <LoaderCircle className="animate-spin" />
                <span>
                  {loading ? '기록을 불러오는 중' : '이슈의 연결을 배치하는 중'}
                </span>
              </div>
            )}
          {graphError && (
            <div className="graph-loading">
              <p>
                이 환경에서는 3D 그래프를 표시할 수 없습니다.
                <br />
                왼쪽 이슈 목록에서 같은 기록을 탐색할 수 있습니다.
              </p>
            </div>
          )}
          {!loading && !graph.nodes.length && !error && (
            <div className="graph-loading">
              <Network size={28} />
              <p>
                아직 완료된 기억이 없습니다.
                <br />
                신규 이슈를 등록하고 처리하면 이곳에 축적됩니다.
              </p>
            </div>
          )}
          <div className="graph-footer" data-graph-obstruction="bottom">
            <div className="graph-facts">
              <span>
                <i className="live-dot" />
                {memoryCount} MEMORIES{' '}
                {activeIssue?.status === 'open' ? '+ 1 ACTIVE' : ''}
              </span>
              <span>{graph.links.length} LINKS</span>
              <span>
                {gravityRootId && gravity
                  ? `직접 ${gravity.directCount} · 트리 ${gravity.treeCount} · 배경 ${gravity.sedimentCount}`
                  : '회전 · 확대 · 노드 드래그'}
              </span>
            </div>
            <div className="graph-settings">
              <label>
                강조
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={highlightStrength}
                  onChange={(event) =>
                    setHighlightStrength(Number(event.target.value))
                  }
                />
                <output>{Math.round(highlightStrength * 100)}%</output>
              </label>
              <label>
                관계선
                <input
                  type="range"
                  min="1"
                  max="10"
                  step="1"
                  value={neighborDraft}
                  onChange={(event) =>
                    setNeighborDraft(Number(event.target.value))
                  }
                  onPointerUp={commitNeighbors}
                  onKeyUp={commitNeighbors}
                  onBlur={commitNeighbors}
                />
                <output>{neighborDraft} / 노드</output>
              </label>
            </div>
            <p>
              배치: 내용·공통 자료의 연결 + 시간 보조 · 색상: 담당 팀 · 트리:
              최대 3단계 · 선은 인과관계 확정이 아닙니다.
            </p>
            {submittedQuery && (
              <p>탐색 상위 12건을 밝게 표시 · 검색 결과 전체는 왼쪽에서 확인</p>
            )}
          </div>
        </section>
        {selected && (
          <aside
            className="issue-inspector"
            data-graph-obstruction="adaptive"
            aria-label="선택 이슈 원문"
          >
            <div className="inspector-title">
              <span>
                <CircleDot
                  size={15}
                  style={{ color: colorFor(selected.team) }}
                />{' '}
                {shortId(selected.id)}{' '}
                <span className="revision">r{selected.revision}</span>
              </span>
              <button aria-label="이슈 상세 닫기" onClick={resetView}>
                <X size={17} />
              </button>
            </div>
            <div className="inspector-scroll">
              <div className="issue-identity">
                <span
                  className={
                    selected.status === 'open' ? 'status-open' : 'status-closed'
                  }
                >
                  {selected.status === 'open' ? '미해결' : '처리 완료'}
                </span>
                <span>{selected.issueType}</span>
                <h2>{selected.title}</h2>
                <p>
                  {selected.team} · {selected.occurredAt}
                </p>
                {selected.synthetic && (
                  <small>합성 POC 이슈 · 날짜와 처리 이력은 가상입니다.</small>
                )}
              </div>
              <div className="inspector-actions">
                <Button
                  size="sm"
                  onClick={() => explore(selected)}
                  disabled={searching}
                >
                  <Search />
                  과거 기록 탐색
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => togglePin(selected.id)}
                  disabled={
                    selected.status !== 'closed' || selected.id === referenceId
                  }
                >
                  {pinnedIds.includes(selected.id) ? <Check /> : <Plus />}
                  {pinnedIds.includes(selected.id) ? '담은 근거' : '근거 담기'}
                </Button>
              </div>
              <section>
                <h3>이슈 원문</h3>
                <p className="original-body">{selected.body}</p>
              </section>
              <div className="issue-tags">
                {selected.tags.map((tag) => (
                  <span key={tag}>{tag}</span>
                ))}
              </div>
              <section>
                <h3>
                  관련 자료 <span>{selected.resources.length}</span>
                </h3>
                {selected.resources.length ? (
                  selected.resources.map((resource) => (
                    <div className="resource-row" key={resource.key}>
                      <FileText size={14} />
                      <div>
                        <strong>{resource.label}</strong>
                        <code>{resource.key}</code>
                        <small>
                          {resource.kind}
                          {selected.synthetic ? ' · 합성 참조' : ''}
                        </small>
                      </div>
                    </div>
                  ))
                ) : (
                  <p>등록된 관련 자료가 없습니다.</p>
                )}
              </section>
              <section>
                <h3>처리 기록</h3>
                <ol className="activity-list">
                  {selected.activities.map((activity) => (
                    <li key={activity.id}>
                      <span>
                        {activity.at.slice(0, 10)} · {activity.author}
                      </span>
                      <p>{activity.body}</p>
                    </li>
                  ))}
                </ol>
                {selected.status === 'open' && (
                  <form
                    className="progress-form"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void saveProgress();
                    }}
                  >
                    <label htmlFor="progress-note">
                      확인한 내용 · 진행 기록
                    </label>
                    <Textarea
                      id="progress-note"
                      value={progressText}
                      onChange={(event) => setProgressText(event.target.value)}
                      maxLength={20000}
                      rows={3}
                      placeholder="조사한 내용, 담당자 협의, 검증 결과를 남기세요."
                      disabled={progressBusy}
                    />
                    <Button
                      size="sm"
                      type="submit"
                      variant="outline"
                      disabled={progressBusy || !progressText.trim()}
                    >
                      {progressBusy ? (
                        <LoaderCircle className="animate-spin" />
                      ) : (
                        <Plus />
                      )}{' '}
                      진행 기록 저장
                    </Button>
                  </form>
                )}
                {selected.resolution && (
                  <div className="resolution-box">
                    <span>
                      <Check size={13} />
                      처리 결과 · {selected.resolution.at.slice(0, 10)}
                    </span>
                    <p>{selected.resolution.body}</p>
                    <strong>{selected.resolution.outcome}</strong>
                  </div>
                )}
              </section>
              {Object.keys(selected.attributes).length > 0 && (
                <section>
                  <h3>추가 속성</h3>
                  <dl className="attribute-list">
                    {Object.entries(selected.attributes).map(([key, value]) => (
                      <div key={key}>
                        <dt>{key}</dt>
                        <dd>{value}</dd>
                      </div>
                    ))}
                  </dl>
                </section>
              )}
              <section>
                <h3>
                  직접 연결 <span>{adjacent.length}</span>
                </h3>
                <p className="caption">
                  관련 기록이지 정답이나 원인 확정이 아닙니다.
                </p>
                {adjacent.slice(0, 12).map(({ link, issue }) => (
                  <button
                    className="related-issue"
                    key={issue.id}
                    onClick={() => selectIssue(issue)}
                  >
                    <strong>
                      {shortId(issue.id)} · {issue.title}
                    </strong>
                    <span>
                      {link.relation}
                      {link.semanticScore !== undefined
                        ? ` · 의미 ${percent(link.semanticScore)}`
                        : ''}{' '}
                      · 내용 {percent(link.textScore)} · 자료{' '}
                      {percent(link.resourceScore)} · {link.timeDistanceDays}일
                      차이
                    </span>
                  </button>
                ))}
                {adjacent.length > 12 && (
                  <p className="caption">
                    나머지 연결은 그래프에서 확인할 수 있습니다.
                  </p>
                )}
              </section>
              {selected.source && (
                <details className="external-example">
                  <summary>
                    외부 원본 · {selected.source.platform}
                    {selected.source.number
                      ? ` #${selected.source.number}`
                      : ''}
                  </summary>
                  <p>
                    이 이슈는 웹에서 독립적으로 처리합니다. 아래 원본은 단방향
                    스냅샷으로 연결되며 Websidian의 처리 기록이 원본을 덮어쓰지
                    않습니다.
                  </p>
                  <a
                    className="source-link"
                    href={selected.source.url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    원본 {selected.source.platform} 이슈 열기{' '}
                    <ArrowUpRight size={14} />
                  </a>
                </details>
              )}
              <button
                className="reroot-button"
                onClick={() => {
                  setGravityRootId(issueNodeId(selected));
                  setFocusVersion((value) => value + 1);
                }}
              >
                이 이슈를 트리의 기준으로 <GitBranch size={14} />
              </button>
            </div>
            <div className="inspector-bottom">
              {selected.status === 'open' ? (
                <Button className="w-full" onClick={() => setForm('resolve')}>
                  <Check />
                  처리 완료 · 기억으로 전환
                </Button>
              ) : (
                <div className="memory-artifact-status">
                  <p>
                    원문 보존 · 처리 기록 포함 탐색 가능
                    <br />
                    <span>
                      {selectedArtifact?.compileStatus === 'ready'
                        ? `AI 기억 컴파일 완료 · ${selectedArtifact.embeddingStatus === 'ready' ? '의미 연결 완료' : '벡터 재시도 필요'}`
                        : selectedArtifact?.compileStatus === 'failed'
                          ? 'AI 기억 생성 실패 · 원문과 완료 상태는 보존됨'
                          : selected.memory
                            ? `추출 색인 보유 · 참고한 기억 ${selected.memory.relatedIssueIds.length}건`
                            : '완료 기억 · 원문/자료 검색 가능'}
                    </span>
                  </p>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={
                      compilingIds.has(selected.id) || !llmStatus?.ready
                    }
                    onClick={() => void compileMemory(selected.id)}
                  >
                    {compilingIds.has(selected.id) ? (
                      <LoaderCircle className="animate-spin" />
                    ) : (
                      <Network />
                    )}
                    {selectedArtifact?.compileStatus === 'ready'
                      ? 'AI 기억 갱신'
                      : 'AI 기억 생성'}
                  </Button>
                </div>
              )}
            </div>
          </aside>
        )}
      </div>
      <footer className="workbench-status">
        <span>
          <Network size={12} /> 독립형 이슈 처리 / 기억 재사용
        </span>
        <span>D1 영구 저장 · 개인 작업공간</span>
        <span>
          {memoryIndex?.indexed
            ? `의미 색인 ${memoryIndex.indexed}/${memoryIndex.total} · AI Brief ${llmStatus?.ready ? '준비됨' : '설정 필요'}`
            : llmStatus?.ready
              ? 'AI Brief 준비됨 · 의미 색인 대기'
              : '원문 탐색 사용 가능 · AI 키 설정 필요'}
        </span>
      </footer>
      {integrationOpen && (
        <IntegrationDialog
          index={memoryIndex}
          onArtifacts={acceptIndexedArtifacts}
          onImported={refreshAfterImport}
          onClose={() => setIntegrationOpen(false)}
        />
      )}
      {form && (
        <IssueForm
          mode={form}
          issue={form === 'resolve' ? selected : null}
          onSaved={saved}
          onClose={() => setForm(null)}
          evidenceIds={pinnedIds}
        />
      )}
    </main>
  );
}
