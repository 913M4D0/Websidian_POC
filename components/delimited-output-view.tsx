import {
  parseDelimitedDisplay,
  parseDelimitedDisplayProgress,
  type DelimitedDisplayKind,
} from '@/lib/delimited-output';

const toneFor = (label: string) => {
  if (label === '요약' || label === '전략') return 'lead';
  if (label.includes('주의') || label.includes('위험')) return 'warning';
  if (label === '권장처리' || label === '다음행동') return 'action';
  if (label === '테스트케이스' || label === '회귀범위') return 'test';
  return 'context';
};

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
  if (!parsed)
    return (
      <pre
        className="llm-plain-output"
        data-output-format="raw"
        aria-live={streaming ? 'polite' : undefined}
      >
        {content}
        {streaming && <span className="llm-stream-caret" aria-hidden="true" />}
      </pre>
    );

  return (
    <div
      className="llm-section-list"
      data-output-format="sections"
      aria-label="AI 생성 결과"
      aria-live={streaming ? 'polite' : undefined}
      aria-busy={streaming || undefined}
    >
      {parsed.blocks.map((block, index) => {
        const active =
          streaming && !parsed.complete && index === parsed.blocks.length - 1;
        return (
          <section
            className={`llm-section-card is-${toneFor(block.label)} ${active ? 'is-streaming' : 'is-closed'}`}
            key={`${block.label}-${index}`}
          >
            <header className="llm-section-heading">
              <span>{String(index + 1).padStart(2, '0')}</span>
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
                          <span
                            className="llm-stream-caret"
                            aria-hidden="true"
                          />
                        )}
                      </dd>
                    </div>
                  );
                })}
              </dl>
            )}
          </section>
        );
      })}
    </div>
  );
}
