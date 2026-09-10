#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { cpus, platform, release, arch } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';

import { issueText, searchIssues } from '../lib/issue-search.ts';
import { buildHistory, searchCompletedIssues } from '../lib/issue-history.ts';
import { buildIssueInsightContext } from '../lib/issue-insight.ts';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, '..');
const DEFAULTS = {
  issues: 'data/issues.json',
  tasks: 'evidence/poc-benchmark/task-set.json',
  groundTruth: 'evidence/poc-benchmark/ground-truth.json',
  outputDir: 'evidence/poc-benchmark/results',
  iterations: 50,
};

function help() {
  console.log(`Websidian 합성 검색·그래프 벤치마크

Usage:
  node --experimental-strip-types scripts/eval-retrieval.mjs [options]

Options:
  --issues <path>          이슈 JSON (default: ${DEFAULTS.issues})
  --tasks <path>           과제 JSON (default: ${DEFAULTS.tasks})
  --ground-truth <path>    정답 JSON (default: ${DEFAULTS.groundTruth})
  --output-dir <path>      출력 폴더 (default: ${DEFAULTS.outputDir})
  --iterations <number>    시간 측정 반복 횟수 1..10000 (default: ${DEFAULTS.iterations})
  --help                   도움말
`);
}

function parseArguments(argv) {
  const options = { ...DEFAULTS };
  const names = new Map([
    ['--issues', 'issues'],
    ['--tasks', 'tasks'],
    ['--ground-truth', 'groundTruth'],
    ['--output-dir', 'outputDir'],
    ['--iterations', 'iterations'],
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--help') return { help: true };
    const key = names.get(argument);
    if (!key) throw new Error(`알 수 없는 옵션입니다: ${argument}`);
    const value = argv[index + 1];
    if (!value || value.startsWith('--'))
      throw new Error(`${argument} 값을 입력해 주세요.`);
    index += 1;
    options[key] = key === 'iterations' ? Number(value) : value;
  }
  if (
    !Number.isSafeInteger(options.iterations) ||
    options.iterations < 1 ||
    options.iterations > 10_000
  ) {
    throw new Error('--iterations는 1..10000 정수여야 합니다.');
  }
  return options;
}

const absolute = (value) =>
  path.isAbsolute(value) ? value : path.resolve(repositoryRoot, value);

const sha256 = (value) => createHash('sha256').update(value).digest('hex');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function loadJson(file) {
  const raw = await readFile(file, 'utf8');
  return { raw, value: JSON.parse(raw) };
}

function validateInputs(issues, taskSet, truth) {
  assert(Array.isArray(issues), '이슈 데이터는 배열이어야 합니다.');
  assert(
    issues.length === taskSet.dataset.expectedIssueCount,
    `이슈 수가 다릅니다: expected=${taskSet.dataset.expectedIssueCount}, actual=${issues.length}`,
  );
  assert(
    issues.filter((issue) => issue.synthetic === true).length ===
      taskSet.dataset.expectedSyntheticIssueCount,
    '모든 벤치마크 이슈가 synthetic=true인지 확인해 주세요.',
  );
  assert(
    taskSet.benchmarkId === truth.benchmarkId,
    'task-set과 ground-truth의 benchmarkId가 다릅니다.',
  );
  assert(
    Array.isArray(taskSet.tasks) && taskSet.tasks.length > 0,
    '과제가 없습니다.',
  );
  assert(
    Array.isArray(truth.representativeIssueIds) &&
      truth.representativeIssueIds.length === 24,
    '대표 이슈는 정확히 24건이어야 합니다.',
  );
  assert(
    new Set(truth.representativeIssueIds).size === 24,
    '대표 이슈 ID가 중복되었습니다.',
  );

  const byId = new Map(issues.map((issue) => [issue.id, issue]));
  assert(byId.size === issues.length, '이슈 ID가 중복되었습니다.');
  for (const id of truth.representativeIssueIds)
    assert(byId.has(id), `대표 이슈가 없습니다: ${id}`);

  const truthByTask = new Map(
    truth.scenarios.map((scenario) => [scenario.taskId, scenario]),
  );
  assert(
    truthByTask.size === truth.scenarios.length,
    'ground-truth taskId가 중복되었습니다.',
  );
  assert(
    truthByTask.size === taskSet.tasks.length,
    '과제 수와 ground-truth 시나리오 수가 다릅니다.',
  );

  const partition = new Set();
  for (const task of taskSet.tasks) {
    const scenario = truthByTask.get(task.taskId);
    assert(scenario, `ground-truth가 없는 과제입니다: ${task.taskId}`);
    assert(
      scenario.rootIssueId === task.rootIssueId,
      `rootIssueId가 다릅니다: ${task.taskId}`,
    );
    const root = byId.get(task.rootIssueId);
    assert(root, `기준 이슈가 없습니다: ${task.rootIssueId}`);
    assert(root.status === 'open', `기준 이슈는 open이어야 합니다: ${root.id}`);
    assert(
      !partition.has(root.id),
      `대표 시나리오 ID가 중복되었습니다: ${root.id}`,
    );
    partition.add(root.id);

    const relevant = Object.keys(scenario.relevance);
    assert(relevant.length > 0, `relevance가 비어 있습니다: ${task.taskId}`);
    for (const id of relevant) {
      const issue = byId.get(id);
      assert(issue, `관련 이슈가 없습니다: ${id}`);
      assert(issue.status === 'closed', `관련 이슈는 closed여야 합니다: ${id}`);
      assert(
        [1, 2, 3].includes(scenario.relevance[id]),
        `관련성 등급은 1..3이어야 합니다: ${id}`,
      );
      assert(!partition.has(id), `대표 시나리오 ID가 중복되었습니다: ${id}`);
      partition.add(id);
    }
    const relevantSet = new Set(relevant);
    for (const id of scenario.expectedDirectIssueIds) {
      assert(relevantSet.has(id), `direct ID가 relevance에 없습니다: ${id}`);
    }
    for (const expected of scenario.expectedTwoHopPaths) {
      assert(
        relevantSet.has(expected.targetIssueId),
        `2-hop target이 relevance에 없습니다: ${expected.targetIssueId}`,
      );
      assert(
        Array.isArray(expected.acceptedViaIssueIds) &&
          expected.acceptedViaIssueIds.length > 0,
        `2-hop acceptedViaIssueIds가 비어 있습니다: ${expected.targetIssueId}`,
      );
      for (const via of expected.acceptedViaIssueIds)
        assert(
          relevantSet.has(via),
          `2-hop via가 relevance에 없습니다: ${via}`,
        );
    }
  }
  assert(
    partition.size === truth.representativeIssueIds.length &&
      truth.representativeIssueIds.every((id) => partition.has(id)),
    '세 시나리오의 root+relevance가 대표 24건을 정확히 분할해야 합니다.',
  );
  const representativeSet = new Set(truth.representativeIssueIds);
  const backgroundCount = issues.filter(
    (issue) => !representativeSet.has(issue.id),
  ).length;
  assert(
    backgroundCount === 270,
    `배경 이슈는 270건이어야 합니다: ${backgroundCount}`,
  );
  return { byId, truthByTask };
}

function percentile(values, ratio) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * ratio) - 1)];
}

const rounded = (value, digits = 6) =>
  value === null || value === undefined ? null : Number(value.toFixed(digits));

function mean(values) {
  const usable = values.filter(
    (value) => value !== null && value !== undefined,
  );
  return usable.length
    ? usable.reduce((total, value) => total + value, 0) / usable.length
    : null;
}

function ndcg(rankedIds, grades, k) {
  const gain = (grade, rank) => (2 ** grade - 1) / Math.log2(rank + 2);
  const actual = rankedIds
    .slice(0, k)
    .reduce((total, id, rank) => total + gain(grades[id] ?? 0, rank), 0);
  const ideal = Object.values(grades)
    .sort((left, right) => right - left)
    .slice(0, k)
    .reduce((total, grade, rank) => total + gain(grade, rank), 0);
  return ideal ? actual / ideal : 0;
}

function rankMetrics(rankedIds, scenario, representativeIds) {
  const relevantIds = new Set(Object.keys(scenario.relevance));
  const representative = new Set(representativeIds);
  const at = (k) => {
    const top = rankedIds.slice(0, k);
    const relevantHits = new Set(top.filter((id) => relevantIds.has(id))).size;
    const falseHits = top.filter((id) => !relevantIds.has(id)).length;
    const backgroundHits = top.filter((id) => !representative.has(id)).length;
    return {
      recall: relevantHits / relevantIds.size,
      distractorFalsePositiveRate: top.length ? falseHits / top.length : 0,
      background270Rate: top.length ? backgroundHits / top.length : 0,
    };
  };
  const firstRelevant = rankedIds.findIndex((id) => relevantIds.has(id));
  return {
    relevantCount: relevantIds.size,
    recallAt5: at(5).recall,
    recallAt10: at(10).recall,
    mrr: firstRelevant < 0 ? 0 : 1 / (firstRelevant + 1),
    ndcgAt5: ndcg(rankedIds, scenario.relevance, 5),
    ndcgAt10: ndcg(rankedIds, scenario.relevance, 10),
    distractorFalsePositiveRateAt5: at(5).distractorFalsePositiveRate,
    distractorFalsePositiveRateAt10: at(10).distractorFalsePositiveRate,
    background270RateAt5: at(5).background270Rate,
    background270RateAt10: at(10).background270Rate,
  };
}

function productivityProxyMetrics(rankedIds, scenario) {
  const relevantIds = new Set(Object.keys(scenario.relevance));
  const grade3Ids = Object.entries(scenario.relevance)
    .filter(([, grade]) => grade === 3)
    .map(([id]) => id);
  const positions = new Map(rankedIds.map((id, index) => [id, index + 1]));
  const foundPositions = grade3Ids
    .map((id) => positions.get(id))
    .filter((position) => position !== undefined);
  const missingGrade3Ids = grade3Ids.filter((id) => !positions.has(id));
  const top10 = rankedIds.slice(0, 10);
  const validEvidenceCountAt10 = top10.filter((id) =>
    relevantIds.has(id),
  ).length;
  const grade3HitsAt10 = grade3Ids.filter((id) => {
    const position = positions.get(id);
    return position !== undefined && position <= 10;
  }).length;
  return {
    grade3Count: grade3Ids.length,
    documentsToFirstGrade3Evidence: foundPositions.length
      ? Math.min(...foundPositions)
      : null,
    documentsToAllGrade3Evidence: missingGrade3Ids.length
      ? null
      : foundPositions.length
        ? Math.max(...foundPositions)
        : 0,
    allGrade3Recovered: missingGrade3Ids.length === 0,
    missingGrade3Ids,
    validEvidenceDensityAt10: top10.length
      ? validEvidenceCountAt10 / top10.length
      : 0,
    grade3CoverageAt10: grade3Ids.length
      ? grade3HitsAt10 / grade3Ids.length
      : 0,
  };
}

function projectedCompletedHistory(issue) {
  return {
    issueId: issue.id,
    title: issue.title,
    occurredAt: issue.occurredAt,
    bodyExcerpt: issue.body.slice(0, 800),
    resolution: {
      at: issue.resolution.at,
      outcome: issue.resolution.outcome,
      bodyExcerpt: issue.resolution.body.slice(0, 1200),
    },
    resources: issue.resources.slice(0, 4).map((resource) => ({
      key: resource.key.slice(0, 160),
      label: resource.label.slice(0, 120),
      kind: resource.kind.slice(0, 60),
    })),
    path: { depth: 1 },
    synthetic: issue.synthetic,
  };
}

function llmContextSelection(rootId, issues) {
  const { context } = buildIssueInsightContext(rootId, issues);
  const completed = issues.filter(
    (issue) => issue.status === 'closed' && issue.resolution,
  );
  const fullRelatedHistories = completed.map(projectedCompletedHistory);
  const fullContext = {
    ...context,
    relatedHistories: fullRelatedHistories,
    citationIds: [rootId, ...completed.map((issue) => issue.id)],
  };
  const selectedContextChars = JSON.stringify(context).length;
  const fullContextChars = JSON.stringify(fullContext).length;
  const selectedHistoryChars = JSON.stringify(context.relatedHistories).length;
  const fullHistoryChars = JSON.stringify(fullRelatedHistories).length;
  return {
    selectedHistoryCount: context.relatedHistories.length,
    totalCompletedHistoryCount: completed.length,
    historyCountRatio:
      context.relatedHistories.length / Math.max(1, completed.length),
    selectedContextChars,
    fullContextChars,
    contextCharRatio: selectedContextChars / Math.max(1, fullContextChars),
    selectedHistoryChars,
    fullHistoryChars,
    historyCharRatio: selectedHistoryChars / Math.max(1, fullHistoryChars),
    fullContextExceedsCurrent64kLimit: fullContextChars > 64_000,
    comparisonNote:
      '선별 분자는 buildIssueInsightContext 실제 출력입니다. 전체 분모는 같은 발췌 길이와 필드로 251개 완료 이력을 투영한 비교용 컨텍스트이며 실제 모델 전송은 수행하지 않습니다.',
  };
}

function pathMetrics(records, scenario) {
  const direct = new Set(
    records
      .filter((record) => record.depth === 1)
      .map((record) => record.issueId),
  );
  const directHits = scenario.expectedDirectIssueIds.filter((id) =>
    direct.has(id),
  );
  const targetHits = [];
  const pathHits = [];
  const pathDetails = scenario.expectedTwoHopPaths.map((expected) => {
    const actual = records.find(
      (record) =>
        record.depth === 2 && record.issueId === expected.targetIssueId,
    );
    const targetHit = Boolean(actual);
    const pathHit = Boolean(
      actual && expected.acceptedViaIssueIds.includes(actual.viaIssueId),
    );
    if (targetHit) targetHits.push(expected.targetIssueId);
    if (pathHit) pathHits.push(expected.targetIssueId);
    return {
      targetIssueId: expected.targetIssueId,
      acceptedViaIssueIds: expected.acceptedViaIssueIds,
      actualDepth: actual?.depth ?? null,
      actualViaIssueId: actual?.viaIssueId ?? null,
      targetHit,
      pathHit,
    };
  });
  return {
    directPathRecall:
      directHits.length / Math.max(1, scenario.expectedDirectIssueIds.length),
    twoHopTargetRecall:
      targetHits.length / Math.max(1, scenario.expectedTwoHopPaths.length),
    twoHopPathRecall:
      pathHits.length / Math.max(1, scenario.expectedTwoHopPaths.length),
    directHits,
    pathDetails,
  };
}

function measure(fn, iterations) {
  let checksum = 0;
  for (let index = 0; index < 5; index += 1) checksum ^= fn().length;
  const samples = [];
  for (let index = 0; index < iterations; index += 1) {
    const startedAt = performance.now();
    const value = fn();
    samples.push(performance.now() - startedAt);
    checksum ^= value.length + index;
  }
  return {
    samplesMs: samples.map((value) => rounded(value)),
    p50Ms: rounded(percentile(samples, 0.5)),
    p95Ms: rounded(percentile(samples, 0.95)),
    checksum,
  };
}

function gitMetadata() {
  const commit = spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  });
  const status = spawnSync(
    'git',
    ['status', '--porcelain', '--untracked-files=no'],
    {
      cwd: repositoryRoot,
      encoding: 'utf8',
    },
  );
  return {
    commit: commit.status === 0 ? commit.stdout.trim() : null,
    trackedWorkingTreeDirty:
      status.status === 0 ? Boolean(status.stdout.trim()) : null,
  };
}

function csvCell(value) {
  if (value === null || value === undefined) return '';
  const text =
    typeof value === 'string'
      ? value
      : typeof value === 'number'
        ? String(value)
        : JSON.stringify(value);
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function csv(rows) {
  const columns = [
    'benchmark_id',
    'dataset_sha256',
    'run_at',
    'task_id',
    'root_issue_id',
    'method',
    'retrieved_count',
    'relevant_count',
    'recall_at_5',
    'recall_at_10',
    'mrr',
    'ndcg_at_5',
    'ndcg_at_10',
    'direct_path_recall',
    'two_hop_target_recall',
    'two_hop_path_recall',
    'distractor_false_positive_rate_at_5',
    'distractor_false_positive_rate_at_10',
    'background_270_rate_at_5',
    'background_270_rate_at_10',
    'documents_to_first_grade3_evidence',
    'documents_to_all_grade3_evidence',
    'all_grade3_recovered',
    'missing_grade3_count',
    'missing_grade3_ids',
    'valid_evidence_density_at_10',
    'grade3_coverage_at_10',
    'llm_selected_history_count',
    'llm_total_completed_history_count',
    'llm_history_count_ratio',
    'llm_selected_context_chars',
    'llm_full_context_chars',
    'llm_context_char_ratio',
    'llm_selected_history_chars',
    'llm_full_history_chars',
    'llm_history_char_ratio',
    'llm_full_context_exceeds_current_64k_limit',
    'runtime_p50_ms',
    'runtime_p95_ms',
    'top_10_ids',
    'path_details',
  ];
  const lines = [columns.join(',')];
  for (const row of rows) {
    const record = {
      benchmark_id: row.benchmarkId,
      dataset_sha256: row.datasetSha256,
      run_at: row.runAt,
      task_id: row.taskId,
      root_issue_id: row.rootIssueId,
      method: row.method,
      retrieved_count: row.retrievedCount,
      relevant_count: row.relevantCount,
      recall_at_5: row.recallAt5,
      recall_at_10: row.recallAt10,
      mrr: row.mrr,
      ndcg_at_5: row.ndcgAt5,
      ndcg_at_10: row.ndcgAt10,
      direct_path_recall: row.directPathRecall,
      two_hop_target_recall: row.twoHopTargetRecall,
      two_hop_path_recall: row.twoHopPathRecall,
      distractor_false_positive_rate_at_5: row.distractorFalsePositiveRateAt5,
      distractor_false_positive_rate_at_10: row.distractorFalsePositiveRateAt10,
      background_270_rate_at_5: row.background270RateAt5,
      background_270_rate_at_10: row.background270RateAt10,
      documents_to_first_grade3_evidence: row.documentsToFirstGrade3Evidence,
      documents_to_all_grade3_evidence: row.documentsToAllGrade3Evidence,
      all_grade3_recovered: row.allGrade3Recovered,
      missing_grade3_count: row.missingGrade3Ids.length,
      missing_grade3_ids: row.missingGrade3Ids,
      valid_evidence_density_at_10: row.validEvidenceDensityAt10,
      grade3_coverage_at_10: row.grade3CoverageAt10,
      llm_selected_history_count: row.llmContextSelection?.selectedHistoryCount,
      llm_total_completed_history_count:
        row.llmContextSelection?.totalCompletedHistoryCount,
      llm_history_count_ratio: row.llmContextSelection?.historyCountRatio,
      llm_selected_context_chars: row.llmContextSelection?.selectedContextChars,
      llm_full_context_chars: row.llmContextSelection?.fullContextChars,
      llm_context_char_ratio: row.llmContextSelection?.contextCharRatio,
      llm_selected_history_chars: row.llmContextSelection?.selectedHistoryChars,
      llm_full_history_chars: row.llmContextSelection?.fullHistoryChars,
      llm_history_char_ratio: row.llmContextSelection?.historyCharRatio,
      llm_full_context_exceeds_current_64k_limit:
        row.llmContextSelection?.fullContextExceedsCurrent64kLimit,
      runtime_p50_ms: row.runtime.p50Ms,
      runtime_p95_ms: row.runtime.p95Ms,
      top_10_ids: row.top10Ids,
      path_details: row.pathDetails,
    };
    lines.push(columns.map((column) => csvCell(record[column])).join(','));
  }
  return `${lines.join('\n')}\n`;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    help();
    return;
  }

  const paths = {
    issues: absolute(options.issues),
    tasks: absolute(options.tasks),
    groundTruth: absolute(options.groundTruth),
    outputDir: absolute(options.outputDir),
  };
  const [issueFile, taskFile, truthFile] = await Promise.all([
    loadJson(paths.issues),
    loadJson(paths.tasks),
    loadJson(paths.groundTruth),
  ]);
  const issues = issueFile.value;
  const taskSet = taskFile.value;
  const truth = truthFile.value;
  const { byId, truthByTask } = validateInputs(issues, taskSet, truth);
  const completed = issues.filter((issue) => issue.status === 'closed');
  const representativeIds = new Set(truth.representativeIssueIds);
  const runAt = new Date().toISOString();
  const datasetSha256 = sha256(issueFile.raw);
  const taskSetSha256 = sha256(taskFile.raw);
  const groundTruthSha256 = sha256(truthFile.raw);
  const rows = [];

  for (const task of taskSet.tasks) {
    const root = byId.get(task.rootIssueId);
    const scenario = truthByTask.get(task.taskId);
    const baselineQuery = `${root.title}\n${root.body}`;
    const websidianQuery = issueText(root);
    const contextSelection = llmContextSelection(root.id, issues);
    const methods = [
      {
        name: 'baseline-text',
        run: () => searchIssues(baselineQuery, completed),
      },
      {
        name: 'websidian-search',
        run: () => searchCompletedIssues(websidianQuery, issues, root.id),
      },
      {
        name: 'websidian-history',
        run: () =>
          buildHistory({ query: websidianQuery, referenceId: root.id }, issues)
            .evidence,
      },
    ];

    for (const method of methods) {
      const records = method.run();
      const rankedIds = records.map((record) => record.issueId);
      const rank = rankMetrics(rankedIds, scenario, representativeIds);
      const productivityProxy = productivityProxyMetrics(rankedIds, scenario);
      const pathsForMethod =
        method.name === 'websidian-history'
          ? pathMetrics(records, scenario)
          : {
              directPathRecall: null,
              twoHopTargetRecall: null,
              twoHopPathRecall: null,
              directHits: [],
              pathDetails: [],
            };
      rows.push({
        benchmarkId: taskSet.benchmarkId,
        datasetSha256,
        runAt,
        taskId: task.taskId,
        rootIssueId: root.id,
        method: method.name,
        retrievedCount: records.length,
        ...Object.fromEntries(
          Object.entries(rank).map(([key, value]) => [key, rounded(value)]),
        ),
        directPathRecall: rounded(pathsForMethod.directPathRecall),
        twoHopTargetRecall: rounded(pathsForMethod.twoHopTargetRecall),
        twoHopPathRecall: rounded(pathsForMethod.twoHopPathRecall),
        directHits: pathsForMethod.directHits,
        pathDetails: pathsForMethod.pathDetails,
        grade3Count: productivityProxy.grade3Count,
        documentsToFirstGrade3Evidence:
          productivityProxy.documentsToFirstGrade3Evidence,
        documentsToAllGrade3Evidence:
          productivityProxy.documentsToAllGrade3Evidence,
        allGrade3Recovered: productivityProxy.allGrade3Recovered,
        missingGrade3Ids: productivityProxy.missingGrade3Ids,
        validEvidenceDensityAt10: rounded(
          productivityProxy.validEvidenceDensityAt10,
        ),
        grade3CoverageAt10: rounded(productivityProxy.grade3CoverageAt10),
        llmContextSelection:
          method.name === 'websidian-history'
            ? Object.fromEntries(
                Object.entries(contextSelection).map(([key, value]) => [
                  key,
                  typeof value === 'number' ? rounded(value) : value,
                ]),
              )
            : null,
        top10Ids: rankedIds.slice(0, 10),
        top10: records.slice(0, 10).map((record, index) => ({
          rank: index + 1,
          issueId: record.issueId,
          score: rounded(record.score),
          depth: record.depth ?? null,
          viaIssueId: record.viaIssueId ?? null,
          relevantGrade: scenario.relevance[record.issueId] ?? 0,
        })),
        runtime: measure(method.run, options.iterations),
      });
    }
  }

  const overall = [
    'baseline-text',
    'websidian-search',
    'websidian-history',
  ].map((method) => {
    const selected = rows.filter((row) => row.method === method);
    const samples = selected.flatMap((row) => row.runtime.samplesMs);
    const average = (field) => rounded(mean(selected.map((row) => row[field])));
    return {
      method,
      taskCount: selected.length,
      recallAt5: average('recallAt5'),
      recallAt10: average('recallAt10'),
      mrr: average('mrr'),
      ndcgAt5: average('ndcgAt5'),
      ndcgAt10: average('ndcgAt10'),
      directPathRecall: average('directPathRecall'),
      twoHopTargetRecall: average('twoHopTargetRecall'),
      twoHopPathRecall: average('twoHopPathRecall'),
      distractorFalsePositiveRateAt5: average('distractorFalsePositiveRateAt5'),
      distractorFalsePositiveRateAt10: average(
        'distractorFalsePositiveRateAt10',
      ),
      background270RateAt5: average('background270RateAt5'),
      background270RateAt10: average('background270RateAt10'),
      documentsToFirstGrade3Evidence: average('documentsToFirstGrade3Evidence'),
      documentsToAllGrade3Evidence: average('documentsToAllGrade3Evidence'),
      allGrade3RecoveredTaskRate: rounded(
        mean(selected.map((row) => (row.allGrade3Recovered ? 1 : 0))),
      ),
      missingGrade3Total: selected.reduce(
        (total, row) => total + row.missingGrade3Ids.length,
        0,
      ),
      validEvidenceDensityAt10: average('validEvidenceDensityAt10'),
      grade3CoverageAt10: average('grade3CoverageAt10'),
      llmSelectedHistoryCount: rounded(
        mean(
          selected.map(
            (row) => row.llmContextSelection?.selectedHistoryCount ?? null,
          ),
        ),
      ),
      llmTotalCompletedHistoryCount: rounded(
        mean(
          selected.map(
            (row) =>
              row.llmContextSelection?.totalCompletedHistoryCount ?? null,
          ),
        ),
      ),
      llmHistoryCountRatio: rounded(
        mean(
          selected.map(
            (row) => row.llmContextSelection?.historyCountRatio ?? null,
          ),
        ),
      ),
      llmContextCharRatio: rounded(
        mean(
          selected.map(
            (row) => row.llmContextSelection?.contextCharRatio ?? null,
          ),
        ),
      ),
      runtimeP50Ms: rounded(percentile(samples, 0.5)),
      runtimeP95Ms: rounded(percentile(samples, 0.95)),
    };
  });

  const result = {
    schemaVersion: 1,
    benchmarkId: taskSet.benchmarkId,
    runAt,
    claimsBoundary:
      '합성 294건에서의 검색·경로 회수, 생산성 대리지표 및 서버측 함수 실행시간입니다. 실제 현업 시간 절감·생산성 향상이나 인과 정확도를 뜻하지 않습니다.',
    productivityProxyNotice:
      '문서 확인 수와 유효근거 밀도는 순위 기반 proxy입니다. 사용자의 읽기·판단 시간, 업무 완료 시간 또는 비용 절감으로 환산하지 않습니다.',
    inputs: {
      issues: path.relative(repositoryRoot, paths.issues),
      tasks: path.relative(repositoryRoot, paths.tasks),
      groundTruth: path.relative(repositoryRoot, paths.groundTruth),
      datasetSha256,
      taskSetSha256,
      groundTruthSha256,
      git: gitMetadata(),
    },
    environment: {
      node: process.version,
      platform: platform(),
      release: release(),
      arch: arch(),
      cpu: cpus()[0]?.model ?? null,
      iterations: options.iterations,
      warmupIterations: 5,
    },
    dataset: {
      issueCount: issues.length,
      closedCount: completed.length,
      openCount: issues.length - completed.length,
      representativeCount: representativeIds.size,
      backgroundCount: issues.length - representativeIds.size,
      backgroundClosedCandidates: completed.filter(
        (issue) => !representativeIds.has(issue.id),
      ).length,
    },
    metricDefinitions: {
      recallAtK: 'top-K relevant unique IDs / 7 relevant IDs',
      mrr: '1 / first relevant rank',
      ndcgAtK: 'graded relevance DCG / ideal DCG',
      directPathRecall:
        'expected direct IDs returned with depth=1 / expected direct IDs',
      twoHopTargetRecall:
        'expected targets returned with depth=2 / expected 2-hop targets',
      twoHopPathRecall:
        'expected targets returned at depth=2 through an accepted via ID / expected 2-hop paths',
      distractorFalsePositiveRateAtK:
        'nonrelevant IDs in returned top-K / returned top-K slots; false-discovery style, not classical corpus FPR',
      background270RateAtK:
        'WS-025..WS-294 IDs in returned top-K / returned top-K slots',
      documentsToFirstGrade3Evidence:
        'rank position of the first grade-3 evidence; document-count proxy, not elapsed time',
      documentsToAllGrade3Evidence:
        'maximum rank needed to encounter every grade-3 evidence; null when any grade-3 evidence is unretrieved',
      validEvidenceDensityAt10:
        'relevant IDs in returned top-10 / returned top-10 slots',
      grade3CoverageAt10: 'grade-3 IDs in returned top-10 / all grade-3 IDs',
      llmHistoryCountRatio:
        'histories selected by actual buildIssueInsightContext / all 251 completed histories',
      llmContextCharRatio:
        'characters in actual selected serialized context / characters in comparison context projecting all completed histories with the same excerpt limits; not a token or cost ratio',
      runtime:
        'server-side function time after five warm-ups; excludes file IO, network, and UI rendering',
    },
    overall,
    tasks: rows,
  };

  await mkdir(paths.outputDir, { recursive: true });
  const jsonPath = path.join(paths.outputDir, 'retrieval-eval.json');
  const csvPath = path.join(paths.outputDir, 'retrieval-eval.csv');
  await Promise.all([
    writeFile(jsonPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8'),
    writeFile(csvPath, csv(rows), 'utf8'),
  ]);

  console.table(
    overall.map((item) => ({
      method: item.method,
      'R@5': item.recallAt5,
      'R@10': item.recallAt10,
      MRR: item.mrr,
      'nDCG@10': item.ndcgAt10,
      'direct-path': item.directPathRecall,
      '2hop-target': item.twoHopTargetRecall,
      '2hop-path': item.twoHopPathRecall,
      'distractor@10': item.distractorFalsePositiveRateAt10,
      'first G3 docs': item.documentsToFirstGrade3Evidence,
      'all G3 docs': item.documentsToAllGrade3Evidence,
      'valid@10': item.validEvidenceDensityAt10,
      'G3@10': item.grade3CoverageAt10,
      'LLM ctx ratio': item.llmContextCharRatio,
      'p95 ms': item.runtimeP95Ms,
    })),
  );
  console.log(`JSON: ${jsonPath}`);
  console.log(`CSV : ${csvPath}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
