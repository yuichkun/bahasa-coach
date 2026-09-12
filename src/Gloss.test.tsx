import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it, expect } from "vite-plus/test";
import { Gloss } from "./Gloss";
describe("contextual annotations", () => {
  it("does not mistake Japanese source text for an Indonesian annotation", () => {
    const html = renderToStaticMarkup(
      <Gloss
        text="締め切り"
        annotations={[{ term: "締め切り", meaning: "deadline", formal: "tenggat", note: "" }]}
      />,
    );
    expect(html).not.toContain('class="term"');
  });
  it("matches full words and phrases without annotating the inside of other words", () => {
    const html = renderToStaticMarkup(
      <Gloss
        text="Aku lagi sibuk, bukan lagipula."
        annotations={[{ term: "lagi", meaning: "今〜している", formal: "sedang", note: "口語" }]}
      />,
    );
    expect(html.match(/class="term"/g)).toHaveLength(5);
    expect(html).toMatch(/>lagi<\/button>/);
    expect(html).toMatch(/>lagipula<\/button>/);
  });
  it("renders learner markup as text rather than HTML", () => {
    const html = renderToStaticMarkup(<Gloss text={"<img src=x onerror=alert(1)>"} />);
    expect(html).toContain("&lt;");
    expect(html).not.toContain("<img");
  });
});
