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
  linkEndpointId,
  type MemoryNode,
} from '@/lib/memory-graph';
import type { Issue } from '@/lib/issues';
import { issueText, type IssueSearchResult } from '@/lib/issue-search';
import { llmPolicy } from '@/lib/llm-policy';

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

function IssueForm({
  mode,
  issue,
  onSaved,
  onClose,
}: {
  mode: 'create' | 'resolve';
  issue: Issue | null;
  onSaved: (issue: Issue) => void;
  onClose: () => void;
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
            {mode === 'create' ? '새 이슈 등록' : '처리 기록 남기기'}
          </DialogTitle>
          <DialogDescription>
            {mode === 'create'
              ? '개발, 운영, 문의, 기획 — 업무 종류와 관계없이 같은 이슈로 기록합니다.'
              : '원래 제목과 본문은 그대로 보존하고, 이 이슈에 처리 내역을 추가합니다.'}
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
              {mode === 'create' ? '이슈 등록' : '처리 완료 · 같은 노드 갱신'}
            </Button>
          </div>
          <small>
            현재 개인 POC 작업공간에 저장합니다. GitHub 자동 동기화와 LLM
            컴파일은 아직 연결되지 않았습니다.
          </small>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function MemoryUniverse() {
  const [issues, setIssues] = useState<Issue[]>([]);
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
  const [tab, setTab] = useState<'issues' | 'search' | 'brief'>('issues');
  const [openOnly, setOpenOnly] = useState(false);
  const [query, setQuery] = useState('');
  const [submittedQuery, setSubmittedQuery] = useState('');
  const [referenceId, setReferenceId] = useState<string | undefined>();
  const [results, setResults] = useState<IssueSearchResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [limit, setLimit] = useState(24);
  const [form, setForm] = useState<'create' | 'resolve' | null>(null);
  const [pinnedIds, setPinnedIds] = useState<string[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const searchSequence = useRef(0);

  const load = useCallback(async () => {
    try {
      const data = await api<{ issues: Issue[] }>('/api/issues');
      searchSequence.current += 1;
      setIssues(data.issues);
      setError('');
      setDataVersion((value) => value + 1);
      setGraphReady(false);
      setGraphError(false);
      setSelectedId(null);
      setGravityRootId(null);
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
    void api<{ issues: Issue[] }>('/api/issues')
      .then((data) => {
        if (active) setIssues(data.issues);
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

  const graph = useMemo(
    () => createMemoryGraph(issues, neighbors),
    [issues, neighbors],
  );
  const byId = useMemo(
    () => new Map(issues.map((issue) => [issue.id, issue])),
    [issues],
  );
  const selected = selectedId ? (byId.get(selectedId) ?? null) : null;
  const openCount = issues.filter((issue) => issue.status === 'open').length;
  const highlightedIds = useMemo(
    () =>
      new Set(
        (results || [])
          .filter((result) => result.score > 0)
          .slice(0, 12)
          .map((result) => result.issueId),
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
      : sortedIssues.filter((issue) => !openOnly || issue.status === 'open');
  const resultById = useMemo(
    () => new Map((results || []).map((result) => [result.issueId, result])),
    [results],
  );
  const adjacent = useMemo(() => {
    if (!selectedId) return [];
    return graph.links
      .filter(
        (link) =>
          linkEndpointId(link.source) === selectedId ||
          linkEndpointId(link.target) === selectedId,
      )
      .map((link) => ({
        link,
        issue: byId.get(
          linkEndpointId(link.source) === selectedId
            ? linkEndpointId(link.target)
            : linkEndpointId(link.source),
        )!,
      }))
      .sort((a, b) => b.link.score - a.link.score);
  }, [graph.links, selectedId, byId]);
  const select = useCallback((node: MemoryNode | null) => {
    setSelectedId(node?.id ?? null);
    if (node) {
      setGravityRootId((root) => root || node.id);
      setFocusVersion((version) => version + 1);
    } else setGravityRootId(null);
  }, []);
  const selectIssue = (issue: Issue) => {
    const node = graph.nodes.find((node) => node.id === issue.id);
    if (node) select(node);
  };
  function resetView() {
    setSelectedId(null);
    setGravityRootId(null);
    setResetVersion((value) => value + 1);
  }
  async function search(text = query, excludeId = referenceId) {
    if (!text.trim()) return;
    const sequence = ++searchSequence.current;
    setSearching(true);
    setError('');
    setTab('search');
    try {
      const response = await api<{ results: IssueSearchResult[] }>(
        '/api/search',
        { query: text, excludeId },
      );
      if (sequence !== searchSequence.current) return;
      setResults(response.results);
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
    const text = issueText(issue).slice(0, 6000);
    setQuery(text);
    setReferenceId(issue.id);
    void search(text, issue.id);
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
    setGravityRootId(null);
    setResults(null);
    setReferenceId(undefined);
    setSubmittedQuery('');
    setQuery('');
    setNotice(
      issue.status === 'closed'
        ? '처리 내역을 저장했습니다. 노드 ID와 원문은 유지되며 탐색 색인에 반영됩니다. LLM 컴파일은 대기 중입니다.'
        : '새 이슈를 영구 저장했습니다. 과거 기록 탐색을 시작할 수 있습니다.',
    );
  }
  function togglePin(id: string) {
    setPinnedIds((current) =>
      current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id],
    );
  }
  function commitNeighbors() {
    if (neighborDraft === neighbors) return;
    setNeighbors(neighborDraft);
    setGraphReady(false);
    setGravityRootId(null);
  }

  return (
    <main className="issue-workbench">
      <header className="workbench-header">
        <button
          className="brand-button"
          onClick={resetView}
          aria-label="Websidian 전체 보기"
        >
          <Network size={20} />
          <strong>websidian</strong>
          <span>ISSUE MEMORY</span>
        </button>
        <div className="header-center">
          <span className="live-dot" /> 개인 POC · 합성 데이터{' '}
          {issues.filter((issue) => issue.synthetic).length}건
        </div>
        <Button
          size="sm"
          disabled={loading || !issues.length}
          onClick={() => setForm('create')}
        >
          <Plus /> 이슈 등록
        </Button>
      </header>
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
                  ['issues', '이슈'],
                  ['search', '기록 탐색'],
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
                    void search();
                  }}
                >
                  <label htmlFor="history-query" className="sr-only">
                    이슈 내용으로 과거 기록 탐색
                  </label>
                  <div className="search-field">
                    <Search size={16} />
                    <Input
                      id="history-query"
                      value={query}
                      maxLength={6000}
                      onChange={(event) => {
                        setQuery(event.target.value);
                        setReferenceId(undefined);
                      }}
                      placeholder="어떤 이슈를 해결하고 있나요?"
                    />
                    <button
                      type="submit"
                      disabled={searching || !query.trim()}
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
                    텍스트·자료 기반 탐색 <span>LLM 미연결</span>
                  </p>
                </form>
                <div className="list-caption">
                  <span>
                    {tab === 'search' && results
                      ? `전체 ${results.length}건 순위`
                      : `ISSUES · ${list.length}`}
                  </span>
                  {tab === 'issues' ? (
                    <button
                      aria-pressed={openOnly}
                      onClick={() => {
                        setOpenOnly(!openOnly);
                        setLimit(24);
                      }}
                    >
                      {openOnly ? '모든 상태 보기' : `미해결 ${openCount}건`}
                    </button>
                  ) : (
                    <button
                      onClick={() => {
                        searchSequence.current++;
                        setSearching(false);
                        setResults(null);
                        setQuery('');
                        setSubmittedQuery('');
                        setReferenceId(undefined);
                        setTab('issues');
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
                    점수는 문장·자료 일치도이며, 정답 확률이 아닙니다.
                    {results.every((result) => result.score === 0) && (
                      <strong>
                        일치하는 기록이 없습니다. 전체 이슈는 아래에서 확인할 수
                        있습니다.
                      </strong>
                    )}
                  </div>
                )}
                <nav className="issue-list" aria-label="전체 이슈 목록">
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
                            {issue.status === 'open' ? '미해결' : '완료'}
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
                <span className="section-kicker">HISTORY BRIEF</span>
                <h2>
                  근거를 모은 다음,
                  <br />
                  현재 이슈의 관점으로.
                </h2>
                <p>
                  이슈 원문과 처리 기록은 바뀌지 않습니다. 현재 질문에 대한
                  해석과 제안은 추후 이 패널에서만 생성됩니다.
                </p>
                <div className="provider-state">
                  <span>연결 예정</span>
                  <strong>
                    {llmPolicy.provider} · {llmPolicy.requestedModel}
                  </strong>
                  <small>
                    최대 지원 추론 · 추가 내용 필터 최소화
                    <br />
                    정확한 모델 ID 확인 후 연결
                  </small>
                </div>
                <h3>수집한 근거 {pinnedIds.length}건</h3>
                {!pinnedIds.length && (
                  <p>이슈를 선택하고 “근거 담기”를 눌러 주세요.</p>
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
                <Button disabled className="w-full">
                  History Brief 생성 · LLM 연결 대기
                </Button>
                <small>근거 선택은 현재 화면의 임시 작업입니다.</small>
              </section>
            )}
            <div className="sidebar-bottom">
              <GitBranch size={13} /> GitHub 등록 대기 24건 · 내부 이슈{' '}
              {issues.length}건
            </div>
          </aside>
        )}
        <section className="graph-viewport" aria-label="이슈 연결 그래프">
          {issues.length > 0 && (
            <GraphStage
              key={`${dataVersion}:${neighbors}`}
              nodes={graph.nodes}
              links={graph.links}
              selectedId={selectedId}
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
                  : '조직의 기억을 연결하다.'}
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
          {(loading || (!graphReady && !graphError && issues.length > 0)) &&
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
          <div className="graph-footer" data-graph-obstruction="bottom">
            <div className="graph-facts">
              <span>
                <i className="live-dot" />
                {graph.nodes.length} ISSUES
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
                      내용 {percent(link.textScore)} · 자료{' '}
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
                <a
                  className="source-link"
                  href={selected.source.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  원본 {selected.source.platform} 이슈 열기{' '}
                  <ArrowUpRight size={14} />
                </a>
              )}
              <button
                className="reroot-button"
                onClick={() => {
                  setGravityRootId(selected.id);
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
                  처리 완료 기록
                </Button>
              ) : (
                <p>
                  원문 보존 · 처리 기록 포함 탐색 가능
                  <br />
                  <span>LLM 기억 컴파일은 연결 후 활성화됩니다.</span>
                </p>
              )}
            </div>
          </aside>
        )}
      </div>
      <footer className="workbench-status">
        <span>
          <GitBranch size={12} /> source-neutral / issue-first
        </span>
        <span>D1 영구 저장 · 개인 작업공간</span>
        <span>LLM 연결 대기</span>
      </footer>
      {form && (
        <IssueForm
          mode={form}
          issue={form === 'resolve' ? selected : null}
          onSaved={saved}
          onClose={() => setForm(null)}
        />
      )}
    </main>
  );
}
