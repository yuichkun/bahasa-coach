import type { Annotation, Lesson } from "../shared/types";
import { transcriptBlocks } from "../shared/transcript";
import { Gloss } from "./Gloss";
import "./recap.css";

function Highlight({
  text,
  focus,
  annotations,
}: {
  text: string;
  focus: string;
  annotations: Annotation[];
}) {
  return <Gloss text={text} annotations={annotations} highlight={focus} />;
}
export function RecapPage({
  lesson,
  onRetry,
  onTranscript,
  onPractice,
  busy,
  requestError = "",
}: {
  lesson: Lesson | null;
  onRetry: () => void;
  onTranscript: () => void;
  onPractice: (section: number, point: number) => void;
  busy: boolean;
  requestError?: string;
}) {
  const recap = lesson?.recap;
  const data = recap?.status === "ready" ? recap.data : null;
  const blocks = transcriptBlocks(lesson?.rows || []);
  return (
    <article className="recap-page">
      <div className="recap-navigation">
        <button className="text-button" onClick={onTranscript} disabled={!lesson}>
          会話の字幕を見る
        </button>
        {lesson && (
          <time>
            {new Date(lesson.createdAt).toLocaleDateString("ja-JP", {
              year: "numeric",
              month: "long",
              day: "numeric",
            })}
          </time>
        )}
      </div>
      <header className="recap-header">
        <h1>{data?.title || "今日のレッスンノート"}</h1>
        <p>
          {data?.introduction || "話したことを振り返って、次の会話で使える形に整理しましょう。"}
        </p>
      </header>
      {!data && (
        <section className="recap-loading" aria-live="polite">
          {recap?.status === "error" || requestError ? (
            <>
              <h2>ノートの作成を、もう一度試しましょう</h2>
              <p>会話は保存されています。音声接続は終了しています。</p>
              <p className="recap-error">{requestError || recap?.error}</p>
              <button onClick={onRetry} disabled={busy}>
                まとめを作り直す
              </button>
            </>
          ) : (
            <>
              <h2>会話全体から、学びを整理しています</h2>
              <p>
                話題や使った表現を確認しながら、使い分けと例文を添えています。画面を離れても、履歴から読めます。
              </p>
              <div className="recap-skeleton" aria-hidden="true">
                <span />
                <span />
                <span />
              </div>
            </>
          )}
        </section>
      )}
      {data && (
        <div className="recap-layout">
          <nav className="recap-contents" aria-label="レッスンノートの目次">
            <p>今日の内容</p>
            {data.sections.map((section, index) => (
              <button
                key={index}
                onClick={() =>
                  document.getElementById(`recap-section-${index}`)?.scrollIntoView({
                    behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
                      ? "instant"
                      : "smooth",
                    block: "start",
                  })
                }
              >
                {section.title}
              </button>
            ))}
            <button
              onClick={() =>
                document.getElementById("recap-next")?.scrollIntoView({
                  behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
                    ? "instant"
                    : "smooth",
                  block: "start",
                })
              }
            >
              次の会話へ
            </button>
          </nav>
          <div className="recap-notebook">
            {data.sections.map((section, sectionIndex) => (
              <section
                className="recap-section"
                id={`recap-section-${sectionIndex}`}
                key={sectionIndex}
              >
                <h2>{section.title}</h2>
                <p className="recap-topic-summary">{section.summary}</p>
                {section.points.map((point, pointIndex) => {
                  const source = blocks.find((b) => b.id === point.sourceId);
                  return (
                    <article className={`recap-point ${point.kind}`} key={pointIndex}>
                      <h3>{point.title}</h3>
                      <div className="recap-comparison">
                        <div className="recap-original">
                          <span>{source?.role === "user" ? "あなたのことば" : "コーチの表現"}</span>
                          <p>
                            <Highlight
                              text={point.quote}
                              focus={point.originalFocus}
                              annotations={point.annotations}
                            />
                          </p>
                        </div>
                        <div className="recap-natural">
                          <span>
                            {point.kind === "adjust"
                              ? "こう言うと、もっと自然"
                              : point.kind === "worked"
                                ? "この言い方を、大切に"
                                : "覚えておくと便利な言い方"}
                          </span>
                          <p>
                            <Highlight
                              text={point.natural}
                              focus={point.focus}
                              annotations={point.annotations}
                            />
                          </p>
                        </div>
                      </div>
                      <div className="recap-teaching">
                        <strong>ここがポイント</strong>
                        <p>
                          <Gloss text={point.explanation} annotations={point.annotations} />
                        </p>
                      </div>
                      {point.examples.length > 0 && (
                        <div className="recap-examples">
                          <h4>こんな場面でも使えます</h4>
                          {point.examples.map((example, index) => (
                            <div key={index}>
                              <p>
                                <Gloss text={example.text} annotations={point.annotations} />
                              </p>
                              <p className="recap-meaning">{example.meaning}</p>
                            </div>
                          ))}
                        </div>
                      )}
                      <div className="recap-point-actions">
                        <details>
                          <summary>会話の前後を読む</summary>
                          <div className="recap-source-context">
                            {blocks
                              .slice(
                                Math.max(0, blocks.indexOf(source!) - 1),
                                blocks.indexOf(source!) + 2,
                              )
                              .map((b) => (
                                <p key={b.id}>
                                  <small>{b.role === "user" ? "あなた" : "コーチ"}</small>
                                  <Gloss text={b.text} />
                                </p>
                              ))}
                          </div>
                        </details>
                        {point.kind === "adjust" && (
                          <button
                            className="text-button"
                            disabled={busy}
                            onClick={() => onPractice(sectionIndex, pointIndex)}
                          >
                            この表現を、書いて使ってみる
                          </button>
                        )}
                      </div>
                    </article>
                  );
                })}
              </section>
            ))}
            <section className="recap-next" id="recap-next">
              <h2>{data.next.title}</h2>
              <p className="recap-next-prompt">{data.next.prompt}</p>
              <p>{data.next.reason}</p>
            </section>
            <p className="recap-closing">{data.closing}</p>
          </div>
        </div>
      )}
    </article>
  );
}
