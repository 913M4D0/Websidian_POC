'use client';

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type SyntheticEvent,
} from 'react';
import {
  ArrowUpRight,
  BrainCircuit,
  Check,
  ChevronRight,
  CircleDot,
  Copy,
  FileText,
  FlaskConical,
  GitBranch,
  LoaderCircle,
  Maximize2,
  Network,
  Plus,
  RotateCcw,
  Search,
  Sparkles,
  X,
} from 'lucide-react';
import { GraphStage } from '@/components/issue-graph';
import { DelimitedOutputView } from '@/components/delimited-output-view';
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
  type MemoryNode,
} from '@/lib/memory-graph';
import type { Issue } from '@/lib/issues';
import { issueText, type IssueSearchResult } from '@/lib/issue-search';
import { llmPolicy } from '@/lib/llm-policy';
import type { IssueHistory } from '@/lib/issue-history';
import type { BriefResponse, LlmStatus } from '@/lib/brief-contract';
import type { MemoryArtifactClient } from '@/lib/memory-artifact';
import {
  demoResolutionDefaults,
  representativeScenarios,
} from '@/lib/demo-scenarios';
import type {
  IssueAnalysisResponse,
  IssueTestPlanResponse,
} from '@/lib/issue-insight';
import { streamApi } from '@/lib/browser-stream';

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
  let response: Response;
  try {
    response = await fetch(
      path,
      body === undefined
        ? { cache: 'no-store' }
        : {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          },
    );
  } catch {
    throw new Error(
      '서버와 연결하지 못했습니다. 네트워크를 확인한 뒤 다시 시도해 주세요.',
    );
  }
  const raw = await response.text();
  let data: unknown = null;
  if (raw)
    try {
      data = JSON.parse(raw);
    } catch {
      data = null;
    }
  if (!response.ok) {
    const providerMessage =
      data &&
      typeof data === 'object' &&
      'error' in data &&
      typeof data.error === 'string'
        ? data.error
        : '';
    const fallback =
      response.status === 401
        ? '로그인이 필요합니다.'
        : response.status === 429
          ? 'AI 요청이 많습니다. 잠시 후 다시 시도해 주세요.'
          : response.status === 504
            ? 'AI 생성이 제한 시간 안에 완료되지 않았습니다.'
            : response.status >= 500
              ? '서버 응답이 지연되고 있습니다. 잠시 후 다시 시도해 주세요.'
              : '요청에 실패했습니다.';
    throw new Error(providerMessage || fallback);
  }
  if (data === null) throw new Error('서버 응답 형식을 확인하지 못했습니다.');
  return data as T;
}

async function copyPlainText(value: string) {
  if (!value) throw new Error('복사할 결과가 없습니다.');
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return;
    } catch {
      // Continue with the selection-based fallback for restricted browsers.
    }
  }

  const textarea = document.createElement('textarea');
  const activeElement =
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
  textarea.value = value;
  textarea.readOnly = true;
  textarea.style.position = 'fixed';
  textarea.style.inset = '0 auto auto -9999px';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  textarea.setSelectionRange(0, value.length);
  const fallbackCopy = Reflect.get(document, 'execCommand');
  const copied =
    typeof fallbackCopy === 'function' &&
    Boolean(fallbackCopy.call(document, 'copy'));
  textarea.remove();
  activeElement?.focus({ preventScroll: true });
  if (!copied) throw new Error('브라우저에서 결과를 복사하지 못했습니다.');
}

const shortId = (id: string) =>
  id.startsWith('WS-L-') ? `LOCAL · ${id.slice(-6)}` : id;
const percent = (n: number) => `${(n * 100).toFixed(1)}%`;
const elapsedSeconds = (milliseconds: number) =>
  (milliseconds / 1000).toFixed(1);
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
}: {
  mode: 'create' | 'resolve';
  issue: Issue | null;
  onSaved: (issue: Issue) => void;
  onClose: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const requestId = useRef<string | null>(null);
  const demoDefaults = issue ? demoResolutionDefaults(issue.id) : null;
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
                {demoDefaults && (
                  <span>시연용 처리 내용이 미리 입력되어 있습니다.</span>
                )}
              </div>
              <label htmlFor="issue-body">
                처리 내용
                <Textarea
                  id="issue-body"
                  name="body"
                  required
                  rows={6}
                  maxLength={20000}
                  defaultValue={demoDefaults?.body}
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
                  defaultValue={demoDefaults?.outcome}
                  placeholder="예: 기존 정책 안내 후 종료 / 공통 절차 적용"
                />
              </label>
              <label htmlFor="issue-resources">
                변경·참고 자료 추가 · 선택
                <Textarea
                  id="issue-resources"
                  name="resources"
                  rows={2}
                  defaultValue={demoDefaults?.resources}
                  placeholder="자료 식별자 | 자료명 | 유형"
                />
                <small>
                  문서·정책·소스·양식 모두 가능하며 기존 자료는 유지됩니다.
                </small>
              </label>
              <small>
                관련 이력은 서버가 같은 기준으로 다시 수집해 처리 참고 기록으로
                보관합니다.
              </small>
            </>
          )}
          <label htmlFor="issue-tags">
            태그 · 자유 입력
            <Input
              id="issue-tags"
              name="tags"
              defaultValue={demoDefaults?.tags || issue?.tags.join(', ') || ''}
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
      const duplicateCount = result.linked + result.unchanged;
      const friendly = `${result.repository} · 새로 가져옴 ${result.imported}건 · 이미 등록됨 ${duplicateCount}건${result.skipped ? ` · 제외 ${result.skipped}건` : ''}`;
      setMessage(friendly);
      await onImported(friendly);
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

function InsightDialog({
  mode,
  root,
  analysis,
  testPlan,
  busy,
  failure,
  draft,
  elapsedMs,
  onMode,
  onRetry,
  onCancel,
  onClose,
  onEvidence,
}: {
  mode: 'analysis' | 'test-cases';
  root: Issue;
  analysis: IssueAnalysisResponse | null;
  testPlan: IssueTestPlanResponse | null;
  busy: 'analysis' | 'test-cases' | null;
  failure: string;
  draft: string;
  elapsedMs: number;
  onMode: (mode: 'analysis' | 'test-cases') => void;
  onRetry: () => void;
  onCancel: () => void;
  onClose: () => void;
  onEvidence: (id: string) => void;
}) {
  const current = mode === 'analysis' ? analysis : testPlan;
  const scrollRef = useRef<HTMLDivElement>(null);
  const followRef = useRef(true);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [copyFeedback, setCopyFeedback] = useState<{
    key: string;
    status: 'copied' | 'failed';
  } | null>(null);

  const copyResult = async (value: string, key: string) => {
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    try {
      await copyPlainText(value);
      setCopyFeedback({ key, status: 'copied' });
    } catch {
      setCopyFeedback({ key, status: 'failed' });
    }
    copyTimerRef.current = setTimeout(() => {
      setCopyFeedback((feedback) => (feedback?.key === key ? null : feedback));
      copyTimerRef.current = null;
    }, 2200);
  };

  const copyStatus = (key: string) =>
    copyFeedback?.key === key ? copyFeedback.status : null;

  useEffect(
    () => () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    },
    [],
  );

  useLayoutEffect(() => {
    if (busy === mode && !draft) followRef.current = true;
    const viewport = scrollRef.current;
    if (viewport && followRef.current)
      viewport.scrollTop = viewport.scrollHeight;
  }, [busy, current, draft, mode]);

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) (busy ? onCancel : onClose)();
      }}
    >
      <DialogContent
        className="insight-dialog sm:max-w-[760px]"
        showCloseButton
      >
        <DialogHeader>
          <DialogTitle className="insight-dialog-title">
            <Sparkles /> AI 이슈 워크벤치
          </DialogTitle>
          <DialogDescription>
            분석 기준 · {shortId(root.id)} · {root.title}
          </DialogDescription>
        </DialogHeader>
        <div className="insight-navigation">
          <div className="insight-tabs" aria-label="AI 결과 전환">
            <button
              aria-pressed={mode === 'analysis'}
              disabled={Boolean(busy)}
              onClick={() => onMode('analysis')}
            >
              <BrainCircuit /> 이슈 분석
              {analysis && <span>완료</span>}
            </button>
            <button
              aria-pressed={mode === 'test-cases'}
              disabled={Boolean(busy)}
              onClick={() => onMode('test-cases')}
            >
              <FlaskConical /> 테스트 케이스
              {testPlan && <span>완료</span>}
            </button>
          </div>
          {current && !busy && (
            <div className="insight-result-actions">
              <Button
                className={`insight-copy ${copyStatus(`${mode}:${current.content}`) === 'copied' ? 'is-copied' : ''}`}
                size="sm"
                variant="outline"
                aria-label={`${mode === 'analysis' ? '이슈 분석' : '테스트 케이스'} 결과 전체 복사`}
                aria-live="polite"
                onClick={() =>
                  void copyResult(current.content, `${mode}:${current.content}`)
                }
              >
                {copyStatus(`${mode}:${current.content}`) === 'copied' ? (
                  <Check />
                ) : (
                  <Copy />
                )}
                {copyStatus(`${mode}:${current.content}`) === 'copied'
                  ? '복사 완료'
                  : copyStatus(`${mode}:${current.content}`) === 'failed'
                    ? '복사 실패 · 다시 시도'
                    : '결과 전체 복사'}
              </Button>
              <Button
                className="insight-regenerate"
                size="sm"
                variant="outline"
                onClick={onRetry}
              >
                <RotateCcw /> 다시 생성
              </Button>
            </div>
          )}
        </div>
        <div
          ref={scrollRef}
          className="insight-content-scroll"
          onScroll={(event) => {
            const viewport = event.currentTarget;
            followRef.current =
              viewport.scrollHeight -
                viewport.scrollTop -
                viewport.clientHeight <=
              48;
          }}
        >
          {busy === mode && (
            <div className={`insight-loading ${draft ? 'has-output' : ''}`}>
              <output className="insight-stream-status">
                <LoaderCircle className="animate-spin" />
                <span className="insight-stream-copy">
                  <strong>
                    {draft
                      ? 'AI 평문을 실시간으로 구성하는 중…'
                      : mode === 'analysis'
                        ? '관련 이력을 분석하는 중…'
                        : '검증 시나리오를 만드는 중…'}
                  </strong>
                  <small>
                    {draft
                      ? '구획을 감지해 카드를 채우는 중'
                      : '첫 구획을 기다리는 중'}
                    <span aria-hidden="true">
                      {' · '}
                      {elapsedSeconds(elapsedMs)}초 경과
                    </span>
                  </small>
                </span>
              </output>
              {draft && (
                <DelimitedOutputView content={draft} kind={mode} streaming />
              )}
            </div>
          )}
          {!busy && failure && (
            <div className="insight-empty">
              <div role="alert">
                <strong>AI 결과를 만들지 못했습니다.</strong>
                <p>{failure}</p>
              </div>
              {draft && (
                <>
                  <pre className="llm-plain-output">{draft}</pre>
                  <Button
                    className={`insight-copy ${copyStatus(`draft:${draft}`) === 'copied' ? 'is-copied' : ''}`}
                    size="sm"
                    variant="outline"
                    aria-label="현재까지 받은 AI 결과 복사"
                    aria-live="polite"
                    onClick={() => void copyResult(draft, `draft:${draft}`)}
                  >
                    {copyStatus(`draft:${draft}`) === 'copied' ? (
                      <Check />
                    ) : (
                      <Copy />
                    )}
                    {copyStatus(`draft:${draft}`) === 'copied'
                      ? '복사 완료'
                      : copyStatus(`draft:${draft}`) === 'failed'
                        ? '복사 실패 · 다시 시도'
                        : '현재까지 받은 내용 복사'}
                  </Button>
                </>
              )}
              <Button size="sm" variant="outline" onClick={onRetry}>
                다시 시도
              </Button>
            </div>
          )}
          {!busy && !failure && !current && (
            <div className="insight-empty">
              아직 생성하지 않은 결과입니다. AI 이슈 도구에서 생성해 주세요.
            </div>
          )}
          {mode === 'analysis' && analysis && busy !== mode && (
            <div className="insight-result">
              {analysis.warning && (
                <p className="insight-stream-warning">{analysis.warning}</p>
              )}
              <DelimitedOutputView content={analysis.content} kind="analysis" />
              <div className="insight-citations">
                {analysis.evidenceIds.map((id) => (
                  <button key={id} onClick={() => onEvidence(id)}>
                    {shortId(id)} 제공된 원문
                  </button>
                ))}
              </div>
              {analysis.warning && (
                <Button size="sm" variant="outline" onClick={onRetry}>
                  실시간 AI 다시 시도
                </Button>
              )}
            </div>
          )}
          {mode === 'test-cases' && testPlan && busy !== mode && (
            <div className="insight-result">
              {testPlan.warning && (
                <p className="insight-stream-warning">{testPlan.warning}</p>
              )}
              <DelimitedOutputView
                content={testPlan.content}
                kind="test-cases"
              />
              <div className="insight-citations">
                {testPlan.evidenceIds.map((id) => (
                  <button key={id} onClick={() => onEvidence(id)}>
                    {shortId(id)} 제공된 원문
                  </button>
                ))}
              </div>
              {testPlan.warning && (
                <Button size="sm" variant="outline" onClick={onRetry}>
                  실시간 AI 다시 시도
                </Button>
              )}
            </div>
          )}
          <p className="insight-disclosure">
            {current?.engine === 'source-fallback'
              ? '실시간 AI 대신 서버가 자동 수집한 원문을 정리한 안전 결과입니다.'
              : 'GPT 5.6 Luna가 서버에서 자동 수집한 이력만 사용합니다.'}{' '}
            결과는 원본 이슈를 바꾸지 않으며, 실제 조치 전 연결된 기록을
            확인해야 합니다.
          </p>
        </div>
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
  const [dataVersion, setDataVersion] = useState(0);
  const [resetVersion, setResetVersion] = useState(0);
  const [focusVersion, setFocusVersion] = useState(0);
  const [graphReady, setGraphReady] = useState(false);
  const [graphError, setGraphError] = useState(false);
  const highlightStrength = 0.7;
  const neighbors = 5;
  const [tab, setTab] = useState<'issues' | 'memories' | 'search' | 'brief'>(
    'issues',
  );
  const [contextRootId, setContextRootId] = useState<string | null>(null);
  const [listFilter, setListFilter] = useState('');
  const [history, setHistory] = useState<IssueHistory | null>(null);
  const [brief, setBrief] = useState<BriefResponse | null>(null);
  const [briefBusy, setBriefBusy] = useState(false);
  const [briefDraft, setBriefDraft] = useState('');
  const [briefElapsedMs, setBriefElapsedMs] = useState(0);
  const [briefFailure, setBriefFailure] = useState('');
  const [llmStatus, setLlmStatus] = useState<LlmStatus | null>(null);
  const [progressText, setProgressText] = useState('');
  const [progressBusy, setProgressBusy] = useState(false);
  const [demoResetBusy, setDemoResetBusy] = useState(false);
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
  const [analysis, setAnalysis] = useState<IssueAnalysisResponse | null>(null);
  const [testPlan, setTestPlan] = useState<IssueTestPlanResponse | null>(null);
  const [insightMode, setInsightMode] = useState<
    'analysis' | 'test-cases' | null
  >(null);
  const [insightBusy, setInsightBusy] = useState<
    'analysis' | 'test-cases' | null
  >(null);
  const [insightFailure, setInsightFailure] = useState<{
    mode: 'analysis' | 'test-cases';
    message: string;
  } | null>(null);
  const [insightDraft, setInsightDraft] = useState('');
  const [insightElapsedMs, setInsightElapsedMs] = useState(0);
  const [contextBusy, setContextBusy] = useState(false);
  const [birthIssueId, setBirthIssueId] = useState<string | null>(null);
  const [birthVersion, setBirthVersion] = useState(0);
  const searchSequence = useRef(0);
  const briefSequence = useRef(0);
  const contextSequence = useRef(0);
  const briefScrollRef = useRef<HTMLElement>(null);
  const briefFollowRef = useRef(true);
  const briefAbortRef = useRef<AbortController | null>(null);
  const insightAbortRef = useRef<AbortController | null>(null);

  const invalidateBrief = useCallback(() => {
    briefSequence.current += 1;
    briefAbortRef.current?.abort();
    briefAbortRef.current = null;
    setBriefBusy(false);
    setBrief(null);
    setBriefDraft('');
    setBriefFailure('');
  }, []);

  useLayoutEffect(() => {
    const viewport = briefScrollRef.current;
    if (viewport && briefFollowRef.current)
      viewport.scrollTop = viewport.scrollHeight;
  }, [brief, briefBusy, briefDraft]);

  useEffect(
    () => () => {
      briefAbortRef.current?.abort();
      insightAbortRef.current?.abort();
    },
    [],
  );

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
      setContextRootId(null);
      setHistory(null);
      invalidateBrief();
      setPinnedIds([]);
      setResults(null);
      setSearching(false);
      setAnalysis(null);
      setTestPlan(null);
      setInsightMode(null);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setLoading(false);
    }
  }, [invalidateBrief]);

  useEffect(() => {
    if (!birthIssueId) return;
    const timer = window.setTimeout(() => setBirthIssueId(null), 2400);
    return () => window.clearTimeout(timer);
  }, [birthIssueId, birthVersion]);
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
    () => createMemoryGraph(issues, neighbors, null, artifacts),
    [issues, neighbors, artifacts],
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
  const contextRoot = contextRootId ? byId.get(contextRootId) : undefined;
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
  async function loadContext(issue: Issue) {
    const sequence = ++contextSequence.current;
    setContextBusy(true);
    setHistory(null);
    try {
      const result = await api<IssueHistory>('/api/history', {
        query: issueText(issue).slice(0, 6000),
        referenceId: issue.id,
      });
      if (sequence === contextSequence.current) setHistory(result);
    } catch (cause) {
      if (sequence === contextSequence.current)
        setError((cause as Error).message);
    } finally {
      if (sequence === contextSequence.current) setContextBusy(false);
    }
  }
  function inspectIssue(issue: Issue) {
    setSelectedId(issue.id);
    setProgressText('');
    setFocusVersion((value) => value + 1);
    if (window.innerWidth <= 680) setSidebarOpen(false);
  }
  function beginContext(issue: Issue) {
    invalidateBrief();
    contextSequence.current++;
    setContextRootId(issue.id);
    setSelectedId(issue.id);
    setGravityRootId(issueNodeId(issue));
    setFocusVersion((value) => value + 1);
    setProgressText('');
    setHistory(null);
    setAnalysis(null);
    setTestPlan(null);
    setInsightMode(null);
    setReferenceId(issue.id);
    void loadContext(issue);
    if (window.innerWidth <= 680) setSidebarOpen(false);
  }
  const select = (node: MemoryNode | null) => {
    if (!node) {
      invalidateBrief();
      setSelectedId(null);
      setGravityRootId(null);
      setContextRootId(null);
      setHistory(null);
      return;
    }
    const issue = byId.get(node.issueId);
    if (!issue) return;
    if (gravityRootId) inspectIssue(issue);
    else beginContext(issue);
  };
  const selectIssue = (issue: Issue) => beginContext(issue);
  function resetView() {
    invalidateBrief();
    contextSequence.current++;
    setSelectedId(null);
    setGravityRootId(null);
    setResetVersion((value) => value + 1);
    setContextRootId(null);
    setHistory(null);
    setInsightMode(null);
  }
  async function search(text = query, excludeId = referenceId) {
    if (!text.trim()) return;
    const sequence = ++searchSequence.current;
    setSearching(true);
    invalidateBrief();
    setError('');
    setTab('search');
    setSidebarOpen(true);
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
    beginContext(issue);
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
    if (issue.status === 'closed') {
      setBirthIssueId(issue.id);
      setBirthVersion((value) => value + 1);
      setContextRootId(null);
      setGravityRootId(null);
      setResetVersion((value) => value + 1);
    } else {
      setContextRootId(issue.id);
      setGravityRootId(issueNodeId(issue));
      setFocusVersion((value) => value + 1);
      void loadContext(issue);
    }
    setTab(issue.status === 'open' ? 'issues' : 'memories');
    setListFilter('');
    setResults(null);
    setReferenceId(undefined);
    setSubmittedQuery('');
    setQuery('');
    setHistory(null);
    invalidateBrief();
    setPinnedIds([]);
    setProgressText('');
    setNotice(
      issue.status === 'closed'
        ? '처리 완료. 정식 기억 노드가 생성됐고 AI 검색 보강을 진행합니다.'
        : '신규 이슈가 접수됐습니다. 관련 이력이 자동으로 정렬됩니다.',
    );
    if (issue.status === 'closed') void compileMemory(issue.id);
  }
  function togglePin(id: string) {
    if (byId.get(id)?.status !== 'closed' || id === referenceId) return;
    invalidateBrief();
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
      if (contextRootId === issueId) {
        setHistory(null);
        setAnalysis(null);
        setTestPlan(null);
        void loadContext(data.issue);
      }
      invalidateBrief();
      setResults(null);
      searchSequence.current++;
      setSearching(false);
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
      setDataVersion((value) => value + 1);
      setGraphReady(false);
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
    if (!history || !submittedQuery || briefBusy || briefAbortRef.current)
      return;
    const controller = new AbortController();
    briefAbortRef.current = controller;
    const sequence = ++briefSequence.current;
    const startedAt = performance.now();
    const elapsedTimer = window.setInterval(() => {
      if (sequence === briefSequence.current)
        setBriefElapsedMs(performance.now() - startedAt);
    }, 250);
    setBriefBusy(true);
    briefFollowRef.current = true;
    setBrief(null);
    setBriefDraft('');
    setBriefElapsedMs(0);
    setBriefFailure('');
    setError('');
    try {
      const data = await streamApi<BriefResponse>(
        '/api/brief',
        {
          query: history.query,
          referenceId: history.referenceId,
          pinnedIds,
        },
        {
          onDelta: (text) => {
            if (briefAbortRef.current === controller)
              setBriefDraft((current) => `${current}${text}`);
          },
          onReplace: (text) => {
            if (briefAbortRef.current === controller) setBriefDraft(text);
          },
          onHeartbeat: (elapsed) =>
            briefAbortRef.current === controller &&
            setBriefElapsedMs((current) => Math.max(current, elapsed)),
        },
        { signal: controller.signal },
      );
      if (
        !controller.signal.aborted &&
        briefAbortRef.current === controller &&
        sequence === briefSequence.current
      )
        setBrief(data);
    } catch (cause) {
      if (
        !controller.signal.aborted &&
        briefAbortRef.current === controller &&
        sequence === briefSequence.current
      )
        setBriefFailure((cause as Error).message);
    } finally {
      window.clearInterval(elapsedTimer);
      if (briefAbortRef.current === controller) {
        briefAbortRef.current = null;
        setBriefBusy(false);
      }
    }
  }
  async function generateInsight(kind: 'analysis' | 'test-cases') {
    if (!contextRoot || insightBusy || insightAbortRef.current) return;
    const controller = new AbortController();
    insightAbortRef.current = controller;
    const startedAt = performance.now();
    const elapsedTimer = window.setInterval(() => {
      if (insightAbortRef.current === controller)
        setInsightElapsedMs(performance.now() - startedAt);
    }, 250);
    setInsightMode(kind);
    setInsightBusy(kind);
    setInsightFailure(null);
    setInsightDraft('');
    setInsightElapsedMs(0);
    setError('');
    try {
      if (kind === 'analysis') {
        const response = await streamApi<IssueAnalysisResponse>(
          `/api/issues/${encodeURIComponent(contextRoot.id)}/analyze`,
          {},
          {
            onDelta: (text) =>
              insightAbortRef.current === controller &&
              setInsightDraft((current) => `${current}${text}`),
            onReplace: (text) => {
              if (insightAbortRef.current === controller) setInsightDraft(text);
            },
            onHeartbeat: (elapsed) =>
              insightAbortRef.current === controller &&
              setInsightElapsedMs((current) => Math.max(current, elapsed)),
          },
          { signal: controller.signal },
        );
        if (
          !controller.signal.aborted &&
          insightAbortRef.current === controller
        )
          setAnalysis(response);
      } else {
        const response = await streamApi<IssueTestPlanResponse>(
          `/api/issues/${encodeURIComponent(contextRoot.id)}/test-cases`,
          {},
          {
            onDelta: (text) =>
              insightAbortRef.current === controller &&
              setInsightDraft((current) => `${current}${text}`),
            onReplace: (text) => {
              if (insightAbortRef.current === controller) setInsightDraft(text);
            },
            onHeartbeat: (elapsed) =>
              insightAbortRef.current === controller &&
              setInsightElapsedMs((current) => Math.max(current, elapsed)),
          },
          { signal: controller.signal },
        );
        if (
          !controller.signal.aborted &&
          insightAbortRef.current === controller
        )
          setTestPlan(response);
      }
    } catch (cause) {
      if (!controller.signal.aborted)
        setInsightFailure({ mode: kind, message: (cause as Error).message });
    } finally {
      window.clearInterval(elapsedTimer);
      if (insightAbortRef.current === controller) {
        insightAbortRef.current = null;
        setInsightBusy(null);
      }
    }
  }

  function openInsight(kind: 'analysis' | 'test-cases') {
    if (insightBusy) return;
    const cached = kind === 'analysis' ? analysis : testPlan;
    if (cached) {
      setInsightMode(kind);
      setInsightFailure(null);
      return;
    }
    void generateInsight(kind);
  }

  async function resetRepresentativeIssue() {
    if (!selected || demoResetBusy || !(selected.id in representativeScenarios))
      return;
    setDemoResetBusy(true);
    setError('');
    try {
      const data = await api<{ issue: Issue }>(
        `/api/issues/${encodeURIComponent(selected.id)}/reset-demo`,
        { expectedRevision: selected.revision },
      );
      setArtifacts((current) =>
        current.filter((artifact) => artifact.issueId !== data.issue.id),
      );
      saved(data.issue);
      setNotice(
        `${shortId(data.issue.id)}을(를) 처리 전 대표 시나리오로 되돌렸습니다.`,
      );
      await refreshMemoryArtifacts();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setDemoResetBusy(false);
    }
  }

  function cancelInsight() {
    insightAbortRef.current?.abort();
    insightAbortRef.current = null;
    setInsightBusy(null);
    setInsightMode(null);
    setInsightFailure(null);
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
            <GitBranch /> GitHub 가져오기
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
                  ['search', '검색'],
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
                          invalidateBrief();
                          setSearching(false);
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
                        invalidateBrief();
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
                          <span
                            style={{
                              color:
                                issue.status === 'open'
                                  ? '#ffffff'
                                  : colorFor(issue.team),
                            }}
                          >
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
                        {issue.id in representativeScenarios && (
                          <small className="representative-row">
                            대표 사례 ·{' '}
                            {
                              representativeScenarios[
                                issue.id as keyof typeof representativeScenarios
                              ]
                            }
                          </small>
                        )}
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
              <section
                ref={briefScrollRef}
                className="brief-workspace"
                onScroll={(event) => {
                  const viewport = event.currentTarget;
                  briefFollowRef.current =
                    viewport.scrollHeight -
                      viewport.scrollTop -
                      viewport.clientHeight <=
                    48;
                }}
              >
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
                        if (contextRoot) explore(contextRoot);
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
                    {llmStatus?.ready
                      ? 'AI 분석 준비됨'
                      : '원문 안전 결과 사용 가능'}
                  </span>
                  <strong>
                    {llmPolicy.provider} · {llmPolicy.requestedModel}
                  </strong>
                  <small>
                    {llmStatus?.reason || '서버 연결 설정을 확인하고 있습니다.'}
                    <br />
                    균형 추론 · 빠른 응답 우선 · 근거 없는 단정은 구분
                  </small>
                </div>
                <Button
                  className="w-full brief-generate"
                  disabled={!history || !submittedQuery || briefBusy}
                  onClick={() => void generateBrief()}
                >
                  {briefBusy && <LoaderCircle className="animate-spin" />}
                  {briefBusy
                    ? 'AI 분석 중 · 받는 즉시 표시'
                    : 'AI History Brief 생성'}
                </Button>
                {briefFailure && (
                  <div className="brief-inline-error">
                    <span role="alert">{briefFailure}</span>
                    {briefDraft && (
                      <pre className="llm-plain-output">{briefDraft}</pre>
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void generateBrief()}
                    >
                      Brief 다시 시도
                    </Button>
                  </div>
                )}
                <small>
                  생성 시 현재 이슈와 선택·수집한 이력이 OpenRouter에
                  전송됩니다. 키가 없어도 위의 원문 탐색과 이슈 처리는 사용할 수
                  있습니다.
                </small>
                {briefBusy && (
                  <div className="brief-stream-live">
                    <small>
                      <span aria-live="polite">
                        {briefDraft
                          ? '구획을 감지해 카드를 채우는 중'
                          : '첫 구획을 기다리는 중'}
                      </span>
                      <span aria-hidden="true">
                        {' · '}
                        {elapsedSeconds(briefElapsedMs)}초 경과
                      </span>
                    </small>
                    {briefDraft && (
                      <DelimitedOutputView
                        content={briefDraft}
                        kind="brief"
                        streaming
                      />
                    )}
                  </div>
                )}
                {brief && (
                  <div className="generated-brief">
                    <span className="section-kicker">AI HISTORY BRIEF</span>
                    {brief.warning && (
                      <p className="insight-stream-warning">{brief.warning}</p>
                    )}
                    <DelimitedOutputView content={brief.content} kind="brief" />
                    <div className="brief-citations">
                      {brief.evidenceIds.map((id) => (
                        <button
                          key={id}
                          onClick={() => {
                            const issue = byId.get(id);
                            if (issue) selectIssue(issue);
                          }}
                        >
                          {shortId(id)} 원문 ↗
                        </button>
                      ))}
                    </div>
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
              key={`${dataVersion}:${neighbors}:${birthVersion}`}
              nodes={graph.nodes}
              links={graph.links}
              selectedId={selectedNodeId}
              gravityRootId={gravityRootId}
              activeCluster={null}
              highlightStrength={highlightStrength}
              highlightedIds={highlightedIds}
              viewResetVersion={resetVersion}
              selectionFocusVersion={focusVersion}
              birthNodeId={birthIssueId ? `memory:${birthIssueId}` : null}
              birthVersion={birthVersion}
              onSelect={select}
              onGravityChange={() => undefined}
              onReady={() => setGraphReady(true)}
              onError={() => setGraphError(true)}
            />
          )}
          <div className="graph-toolbar" data-graph-obstruction="top">
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
          {birthIssueId && (
            <div className="star-birth-effect" key={birthVersion}>
              <Sparkles />
              <span />
              <strong>
                {shortId(birthIssueId)} · 새로운 기억이 태어났습니다
              </strong>
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
                  style={{
                    color:
                      selected.status === 'open'
                        ? '#ffffff'
                        : colorFor(selected.team),
                  }}
                />{' '}
                {shortId(selected.id)}{' '}
                <span className="revision">r{selected.revision}</span>
              </span>
              <button aria-label="이슈 상세 닫기" onClick={resetView}>
                <X size={17} />
              </button>
            </div>
            {contextRoot && (
              <section className="inspector-ai-tools" aria-label="AI 이슈 도구">
                <div className="inspector-ai-heading">
                  <span>
                    <Sparkles /> <strong>AI 이슈 도구</strong>
                  </span>
                  <small>{shortId(contextRoot.id)} 기준</small>
                </div>
                <div className="inspector-ai-actions">
                  <button
                    className="inspector-ai-action is-analysis"
                    disabled={Boolean(insightBusy)}
                    aria-haspopup="dialog"
                    onClick={() => openInsight('analysis')}
                  >
                    <span className="ai-action-icon">
                      {insightBusy === 'analysis' ? (
                        <LoaderCircle className="animate-spin" />
                      ) : (
                        <BrainCircuit />
                      )}
                    </span>
                    <span className="ai-action-copy">
                      <strong>
                        {analysis ? '분석 결과 보기' : '이슈 분석'}
                      </strong>
                      <small>원인 · 위험 · 처리 방향</small>
                    </span>
                    <ChevronRight />
                  </button>
                  <button
                    className="inspector-ai-action is-test"
                    disabled={Boolean(insightBusy)}
                    aria-haspopup="dialog"
                    onClick={() => openInsight('test-cases')}
                  >
                    <span className="ai-action-icon">
                      {insightBusy === 'test-cases' ? (
                        <LoaderCircle className="animate-spin" />
                      ) : (
                        <FlaskConical />
                      )}
                    </span>
                    <span className="ai-action-copy">
                      <strong>
                        {testPlan ? '테스트 결과 보기' : '테스트 케이스'}
                      </strong>
                      <small>이력 기반 검증 시나리오</small>
                    </span>
                    <ChevronRight />
                  </button>
                </div>
              </section>
            )}
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
                {selected.id in representativeScenarios && (
                  <span className="representative-badge">
                    대표 사례 ·{' '}
                    {
                      representativeScenarios[
                        selected.id as keyof typeof representativeScenarios
                      ]
                    }
                  </span>
                )}
                {selected.synthetic && (
                  <small>합성 POC 이슈 · 날짜와 처리 이력은 가상입니다.</small>
                )}
              </div>
              <div className="inspector-actions">
                {contextRoot && selected.id !== contextRoot.id && (
                  <Button size="sm" onClick={() => inspectIssue(contextRoot)}>
                    <RotateCcw /> 기준 이슈로 돌아가기
                  </Button>
                )}
                {selected.id !== contextRoot?.id && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => beginContext(selected)}
                  >
                    <GitBranch /> 이 이슈를 새 기준으로
                  </Button>
                )}
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
              <section className="context-history">
                <h3>
                  관련 이슈 흐름 <span>{history?.evidence.length ?? 0}</span>
                </h3>
                <p className="caption">
                  {contextRoot
                    ? `${shortId(contextRoot.id)}를 처음 기준으로 찾은 완료 이력입니다. 다른 노드를 눌러도 분석 기준은 유지됩니다.`
                    : '이슈를 선택하면 관련된 완료 이력을 자동으로 찾습니다.'}
                </p>
                {contextBusy && (
                  <p className="context-loading">
                    <LoaderCircle className="animate-spin" /> 관련 이력을
                    정리하는 중…
                  </p>
                )}
                {!contextBusy && history?.evidence.length === 0 && (
                  <p className="context-loading">
                    현재 기준에서 연결할 완료 이력을 찾지 못했습니다.
                  </p>
                )}
                {([1, 2] as const).map((depth) => {
                  const group =
                    history?.evidence.filter(
                      (evidence) => evidence.depth === depth,
                    ) ?? [];
                  if (!group.length) return null;
                  return (
                    <div className="history-group" key={depth}>
                      <strong>
                        {depth === 1
                          ? '바로 관련된 기록'
                          : '한 단계 더 연결된 기록'}
                      </strong>
                      {group.slice(0, depth === 1 ? 5 : 4).map((evidence) => {
                        const issue = byId.get(evidence.issueId);
                        if (!issue) return null;
                        return (
                          <button
                            className={`related-issue ${selected.id === issue.id ? 'is-selected' : ''}`}
                            key={issue.id}
                            onClick={() => inspectIssue(issue)}
                          >
                            <strong>
                              {shortId(issue.id)} · {issue.title}
                            </strong>
                            <span>
                              {evidence.sharedResources.length
                                ? `같은 자료 ${evidence.sharedResources.length}개`
                                : '내용이 유사한 기록'}
                              {evidence.timeDistanceDays !== null
                                ? ` · ${evidence.timeDistanceDays}일 차이`
                                : ''}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  );
                })}
              </section>
              <details className="inspector-details">
                <summary>관련 자료와 처리 기록 자세히 보기</summary>
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
                        onChange={(event) =>
                          setProgressText(event.target.value)
                        }
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
                      {Object.entries(selected.attributes).map(
                        ([key, value]) => (
                          <div key={key}>
                            <dt>{key}</dt>
                            <dd>{value}</dd>
                          </div>
                        ),
                      )}
                    </dl>
                  </section>
                )}
              </details>
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
              {selected.id !== contextRoot?.id && (
                <button
                  className="reroot-button"
                  onClick={() => beginContext(selected)}
                >
                  이 이슈를 새 분석 기준으로 <GitBranch size={14} />
                </button>
              )}
            </div>
            <div className="inspector-bottom">
              {selected.status === 'open' ? (
                <Button className="w-full" onClick={() => setForm('resolve')}>
                  <Check />
                  처리 완료
                </Button>
              ) : (
                <div className="memory-artifact-status">
                  <p>
                    원문 보존 · 처리 기록 포함 탐색 가능
                    <br />
                    <span>
                      {selectedArtifact?.compileStatus === 'ready'
                        ? selectedArtifact.compileModel === 'source-fallback'
                          ? `원문 기반 기억 생성 완료 · ${selectedArtifact.embeddingStatus === 'ready' ? '의미 연결 완료' : '벡터 재시도 필요'} · AI 보강 재시도 가능`
                          : `AI 기억 컴파일 완료 · ${selectedArtifact.embeddingStatus === 'ready' ? '의미 연결 완료' : '벡터 재시도 필요'}`
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
                    disabled={compilingIds.has(selected.id)}
                    onClick={() => void compileMemory(selected.id)}
                  >
                    {compilingIds.has(selected.id) ? (
                      <LoaderCircle className="animate-spin" />
                    ) : (
                      <Network />
                    )}
                    {compilingIds.has(selected.id)
                      ? 'AI 기억을 생성하는 중…'
                      : selectedArtifact?.compileModel === 'source-fallback'
                        ? 'AI 보강 재시도'
                        : selectedArtifact?.compileStatus === 'ready'
                          ? 'AI 기억 갱신'
                          : 'AI 기억 생성'}
                  </Button>
                  {selected.id in representativeScenarios && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={demoResetBusy}
                      onClick={() => void resetRepresentativeIssue()}
                    >
                      {demoResetBusy ? (
                        <LoaderCircle className="animate-spin" />
                      ) : (
                        <RotateCcw />
                      )}
                      대표 이슈 다시 열기
                    </Button>
                  )}
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
            ? `의미 색인 ${memoryIndex.indexed}/${memoryIndex.total} · AI 분석 ${llmStatus?.ready ? '준비됨' : '설정 필요'}`
            : llmStatus?.ready
              ? 'AI 분석 준비됨 · 의미 색인 대기'
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
        />
      )}
      {insightMode && contextRoot && (
        <InsightDialog
          mode={insightMode}
          root={contextRoot}
          analysis={analysis}
          testPlan={testPlan}
          busy={insightBusy}
          draft={insightDraft}
          elapsedMs={insightElapsedMs}
          failure={
            insightFailure?.mode === insightMode ? insightFailure.message : ''
          }
          onMode={(mode) => {
            if (mode === 'analysis' && !analysis) {
              void generateInsight(mode);
              return;
            }
            if (mode === 'test-cases' && !testPlan) {
              void generateInsight(mode);
              return;
            }
            setInsightMode(mode);
            setInsightFailure(null);
          }}
          onRetry={() => void generateInsight(insightMode)}
          onCancel={cancelInsight}
          onClose={() => {
            setInsightMode(null);
            setInsightFailure(null);
          }}
          onEvidence={(id) => {
            const issue = byId.get(id);
            if (!issue) return;
            setInsightMode(null);
            setInsightFailure(null);
            inspectIssue(issue);
          }}
        />
      )}
    </main>
  );
}
