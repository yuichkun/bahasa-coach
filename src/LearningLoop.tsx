import type { Lesson, PracticeFocus } from "../shared/types";
import { Gloss } from "./Gloss";

export function LearningLoop({
  lesson,
  busy,
  onPractice,
  onReview,
}: {
  lesson: Lesson;
  busy: boolean;
  onPractice: (focus: PracticeFocus, mode: "retry" | "transfer") => void;
  onReview: () => void;
}) {
  const practice = lesson.practice,
    review = lesson.review;
  const annotations = lesson.attempts[0]?.feedback.annotations || [];
  if (practice) {
    if (!practice.check) return null;
    const check = practice.check,
      assisted = check.assisted ?? practice.hintUsed;
    const passed = check.outcome === "pass" && !assisted;
    const label =
      check.outcome === "uncertain"
        ? "まだ確認できていません"
        : check.outcome === "retry"
          ? "もう一度、この一点だけ"
          : assisted
            ? "助けを使って表現できました"
            : practice.mode === "transfer"
              ? "別の場面でも使えました"
              : lesson.kind === "voice"
                ? "自分の表現で言い直せました"
                : "自分の表現で書き直せました";
    return (
      <section className="learning-loop" aria-label="再練習の結果">
        <h2>{label}</h2>
        {check.evidence && (
          <blockquote>
            <Gloss text={check.evidence} annotations={annotations} />
          </blockquote>
        )}
        <p>{check.explanation}</p>
        {assisted && (
          <p className="muted">見本・単語の説明を使った記録です。次は見ずに試します。</p>
        )}
        <button
          className="primary"
          disabled={busy || practice.focus.state === "withdrawn"}
          onClick={() => onPractice(practice.focus, passed ? "transfer" : practice.mode)}
        >
          {passed ? "別の場面で使う" : lesson.kind === "voice" ? "もう一度話す" : "もう一度書く"}
        </button>
        {passed && practice.mode === "retry" && (
          <p className="next-step">次のお題でも、この表現を別の場面で使います。</p>
        )}
      </section>
    );
  }
  if (!review)
    return (
      <section className="review-entry">
        <button className="primary" disabled={busy} onClick={onReview}>
          {busy ? "発言を確認しています…" : "この練習から、表現を１つ見直す"}
        </button>
      </section>
    );
  if (review.status === "clear")
    return (
      <section className="learning-loop">
        <h2>修正の提案はありません</h2>
        <p>この回答には、再練習を勧める修正は見つかりませんでした。</p>
      </section>
    );
  if (review.status !== "ready" || !review.focus)
    return (
      <section className="learning-loop">
        <p>元の発言と対応する修正を確認できませんでした。字幕・回答を確認してから見直します。</p>
        <button disabled={busy} onClick={onReview}>
          もう一度確認する
        </button>
      </section>
    );
  const focus = review.focus;
  return (
    <section className="learning-loop" aria-label="次に練習する表現">
      <h2>この表現を、もう一度使ってみる</h2>
      <div className="learning-example">
        <span>あなたの表現</span>
        <p>
          <Gloss text={focus.original} annotations={annotations} />
        </p>
      </div>
      <div className="learning-example suggested">
        <span>こう言うと自然</span>
        <p>
          <Gloss text={focus.suggestion} annotations={annotations} />
        </p>
      </div>
      <p>{focus.reason}</p>
      <button className="primary" disabled={busy} onClick={() => onPractice(focus, "retry")}>
        {lesson.kind === "voice" ? "自分でもう一度話す" : "自分でもう一度書く"}
      </button>
      <p className="next-step">見本を閉じて練習し、その回答を確認します。</p>
      {focus.state === "transfer_due" && (
        <p className="muted">言い直しは確認済み。次は別の場面で試します。</p>
      )}
      {focus.state === "transferred" && (
        <p className="muted">別の場面で使えた回答も記録されています。</p>
      )}
    </section>
  );
}
