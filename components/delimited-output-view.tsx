import {
  parseDelimitedDisplay,
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
}: {
  content: string;
  kind: DelimitedDisplayKind;
}) {
  const parsed = parseDelimitedDisplay(content, kind);
  if (!parsed)
    return (
      <pre className="llm-plain-output" data-output-format="raw">
        {content}
      </pre>
    );

  return (
    <div
      className="llm-section-list"
      data-output-format="sections"
      aria-label="AI 생성 결과"
    >
      {parsed.blocks.map((block, index) => (
        <section
          className={`llm-section-card is-${toneFor(block.label)}`}
          key={`${block.label}-${index}`}
        >
          <header className="llm-section-heading">
            <span>{String(index + 1).padStart(2, '0')}</span>
            <h3>{block.label}</h3>
          </header>
          {block.body && <p className="llm-section-body">{block.body}</p>}
          {block.fields.length > 0 && (
            <dl className="llm-section-fields">
              {block.fields.map((item, fieldIndex) => (
                <div key={`${item.label}-${fieldIndex}`}>
                  <dt>{item.label}</dt>
                  <dd>{item.value || '—'}</dd>
                </div>
              ))}
            </dl>
          )}
        </section>
      ))}
    </div>
  );
}
