# Bahasa Coach

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Confirmed: React, Vite+, TypeScript, Node.js 24, Fastify, SQLite.

## Users

Japanese-speaking adults practicing Indonesian, Mandarin Chinese (Simplified Chinese), or English on their own Mac. Each installation is local and single-user, using its owner's ChatGPT authentication and voice API key. Adapt language complexity to the learner's replies.

## Product Purpose

Practice speaking and writing, read live transcripts at all times, and use past feedback for the next exercise.

## Operating Context

Launch with vp dev, open Chrome, use at a desk. No deployment, PWA, background service, Dropbox, recordings, or complex spaced repetition in this MVP.

## Capabilities and Constraints

GPT-Live-1 voice API with interruption and both speakers' live captions. Codex App Server with official ChatGPT authentication for subscription-backed teaching. Japanese, English, Chinese and Indonesian may be mixed. SQLite stores text and feedback only. Original transcripts, recognition revisions and language feedback stay separate. No automatic paid API fallback for text. Voice cost is visible without a budget cap.

## Product Principles

- The learner's words and captions have first priority.
- Teach natural adult conversation in the selected language, with Japanese explanations and useful register distinctions. Preserve the Indonesian colloquial/formal teaching approach; support Mandarin with Simplified Chinese and pinyin, and English with valid American/British variants.
- Corrections must never silently rewrite what the learner actually said.
- A simple, useful MVP outranks extra infrastructure or decorative features.
- Preserve drafts and history when a provider fails.

## Accessibility & Inclusion

Japanese UI, clear reading widths, keyboard-accessible annotations, visible focus, comfortable text sizes, reduced motion support.

## Current learning flow

Free voice conversation starts without an exercise. Provide contextual word lookup and up to three short reply examples. Every completed voice conversation automatically opens a dedicated whole-lesson recap. A single microphone toggle closes the voice connection when off and reconnects the same lesson when on, preserving captions and hints. No separate thinking-break control or coach action menu. A green conversation canvas and persistent status text communicate that the microphone is currently live. The same microphone button uses explicit stop/resume action labels, while the idle screen gives starting a conversation a prominent centered CTA. Practice one grounded improvement, check a fresh learner answer, distinguish help use, then test in a different situation. No unsupported mastery scores.

The voice partner roleplays Rani, a fictional adult living in Bandung. She shares everyday experiences and opinions, develops a topic naturally, and avoids repeating biographical interviews. Each transcript sentence displays its Japanese translation directly below the original without requiring hover, informed by surrounding dialogue and cached by context. Interrupted sentences are translated without inventing their endings. Failed translations recover automatically; no manual retry control belongs in the transcript. If a fast subtitle or dictionary model hits its usage limit, try another eligible model from the same subscription catalog and temporarily skip exhausted models. Never switch to a paid text API. Word popups remain dedicated to word meanings and formal forms. Prepare these before interaction and mark only ready definitions with an underline. Hover must immediately show cached content and must not start an AI request. Unready words stay plain text while background preparation proceeds.

Translation precision is a persistent three-level user preference, with speed prioritized by default. It maps to available subscription models and supported reasoning effort internally, only for subtitle translation. Rani opens with a brief everyday situation, then develops one new detail or opinion when the learner responds, including short replies. She carries conversational material without requiring the learner to choose topics, repeating filler, or making every response a question. A compact situation seed replaces a full prepared plot in the voice prompt. Microphone-off silences audio immediately while connection closure is confirmed.

## Language support

A persistent selector offers Indonesian, Mandarin Chinese (Simplified Chinese) and English. Each lesson keeps its language immutably. Existing lessons migrate to Indonesian without modifying transcripts, recognition revisions or feedback. History, conversation memory, due practice, dictionary senses and sentence translations are isolated by language. Writing supports both Japanese-to-target and target-to-Japanese directions. A live voice connection must be stopped before switching languages. Paused conversations and drafts are restored by language. Rani remains the Indonesian partner; 林悦 is the Mandarin partner in Shanghai; Alex is the English partner in Seattle. All are fictional.

Chinese text supports word segmentation and optional tone-marked pinyin across captions, replies, corrections and notebooks. Pinyin derives from the full text locally, preserving source offsets and quotes. Load its data only when needed. Japanese prose is only annotated for explicit Chinese terms; mixed-script runs containing kana are conservatively kept as Japanese. Reading assistance in a retry counts as assisted practice. Pronunciation scoring, multi-user hosting and deployment remain outside this scope.
