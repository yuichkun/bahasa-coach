import { pinyin } from "pinyin-pro";

export function pinyinSpans(text: string) {
  let index = 0;
  // Convert the entire sentence together so 银行 / 行走 get contextual readings.
  return pinyin(text, { type: "all", toneType: "symbol" }).map((part) => {
    const start = index;
    index += part.origin.length;
    return { start, end: index, text: part.origin, reading: part.isZh ? part.pinyin : "" };
  });
}
