import {
  parseDelimitedDisplay,
  parseDelimitedDisplayProgress,
  parseDelimitedDisplaySegments,
  type DelimitedDisplayBlock,
  type DelimitedDisplayKind,
} from '@/lib/delimited-output';

const toneFor = (label: string) => {
  if (label === '요약' || label === '전략') return 'lead';
  if (label.includes('주의') || label.includes('위험')) return 'warning';
  if (label === '권장처리' || label === '다음행동') return 'action';
  if (label === '테스트케이스' || label === '회귀범위') return 'test';
  return 'context';
};

function DelimitedSectionCard({
  block,
  number,
  active,
}: {
  block: DelimitedDisplayBlock;
  number: number;
  active: boolean;
}) {
  return (
    <section
      className={`llm-section-card is-${toneFor(block.label)} ${active ? 'is-streaming' : 'is-closed'}`}
    >
      <header className="llm-section-heading">
        <span>{String(number).padStart(2, '0')}</span>
        <h3>{block.label}</h3>
        {active && <small>작성 중</small>}
      </header>
      {block.body && (
        <p className="llm-section-body">
          {block.body}
          {active && block.fields.length === 0 && (
            <span className="llm-stream-caret" aria-hidden="true" />
          )}
        </p>
      )}
      {!block.body && block.fields.length === 0 && active && (
        <p className="llm-section-body is-empty-stream">
          <span className="llm-stream-caret" aria-hidden="true" />
        </p>
      )}
      {block.fields.length > 0 && (
        <dl className="llm-section-fields">
          {block.fields.map((item, fieldIndex) => {
            const activeField =
              active && fieldIndex === block.fields.length - 1;
            return (
              <div key={`${item.label}-${fieldIndex}`}>
                <dt>{item.label}</dt>
                <dd>
                  {item.value || (!activeField ? '—' : '')}
                  {activeField && (
                    <span className="llm-stream-caret" aria-hidden="true" />
                  )}
                </dd>
              </div>
            );
          })}
        </dl>
      )}
    </section>
  );
}

export function DelimitedOutputView({
  content,
  kind,
  streaming = false,
}: {
  content: string;
  kind: DelimitedDisplayKind;
  streaming?: boolean;
}) {
  const parsed = streaming
    ? parseDelimitedDisplayProgress(content, kind)
    : parseDelimitedDisplay(content, kind);
  const recovered =
    !parsed && kind !== 'memory'
      ? parseDelimitedDisplaySegments(content, kind, streaming)
      : undefined;
  const hasRecoveredCard = recovered?.segments.some(
    (segment) => segment.type === 'block',
  );

  if (!parsed && !hasRecoveredCard)
    return (
      <pre
        className="llm-plain-output"
        data-output-format="raw"
        aria-label="AI 생성 결과 원문"
        aria-busy={streaming || undefined}
      >
        {content}
        {streaming && <span className="llm-stream-caret" aria-hidden="true" />}
      </pre>
    );

  if (!parsed && recovered) {
    return (
      <div
        className="llm-section-list"
        data-output-format="mixed"
        aria-label="AI 생성 결과"
        aria-busy={streaming || undefined}
      >
        <p className="llm-mixed-note">
          일부 형식을 해석하지 못해 확인 가능한 구획과 원문을 함께 표시합니다.
        </p>
        {recovered.segments.map((segment, segmentIndex) => {
          const active =
            recovered.activeTarget?.type === segment.type &&
            recovered.activeTarget.start === segment.start;
          if (segment.type === 'block') {
            const cardNumber = recovered.segments
              .slice(0, segmentIndex + 1)
              .filter((candidate) => candidate.type === 'block').length;
            return (
              <DelimitedSectionCard
                key={`block-${segment.start}`}
                block={segment.block}
                number={cardNumber}
                active={active}
              />
            );
          }
          return (
            <section className="llm-raw-fragment" key={`raw-${segment.start}`}>
              <header className="llm-raw-fragment-heading">
                <h3>원문 조각</h3>
                <small>형식 미완성</small>
              </header>
              <pre className="llm-plain-output is-fragment">
                {segment.content}
                {active && (
                  <span className="llm-stream-caret" aria-hidden="true" />
                )}
              </pre>
            </section>
          );
        })}
      </div>
    );
  }

  return (
    <div
      className="llm-section-list"
      data-output-format="sections"
      aria-label="AI 생성 결과"
      aria-busy={streaming || undefined}
    >
      {parsed!.blocks.map((block, index) => {
        const active =
          streaming && !parsed!.complete && index === parsed!.blocks.length - 1;
        return (
          <DelimitedSectionCard
            key={`${block.label}-${index}`}
            block={block}
            number={index + 1}
            active={active}
          />
        );
      })}
    </div>
  );
}
