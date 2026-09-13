import { TRANSLATION_PRECISIONS, type TranslationPrecision } from "../shared/translation-settings";

export function TranslationSettings({
  value,
  disabled,
  onChange,
}: {
  value: TranslationPrecision;
  disabled: boolean;
  onChange: (value: TranslationPrecision) => void;
}) {
  return (
    <section>
      <fieldset className="translation-preferences" disabled={disabled}>
        <legend>字幕の訳し方</legend>
        <div className="translation-precision-options">
          {TRANSLATION_PRECISIONS.map((option) => (
            <label key={option.value}>
              <input
                type="radio"
                name="translation-precision"
                value={option.value}
                checked={value === option.value}
                onChange={() => onChange(option.value)}
              />
              {option.label}
            </label>
          ))}
        </div>
        <p>{TRANSLATION_PRECISIONS.find((option) => option.value === value)?.description}</p>
        <small>変更は次の字幕翻訳から反映します。</small>
      </fieldset>
    </section>
  );
}
