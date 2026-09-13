# Bahasa Coach

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Confirmed: React, Vite+, TypeScript, Node.js 24, Fastify, SQLite.

## Users

A single Japanese-speaking adult who knows basic Indonesian grammar and wants much more output practice on their Mac, particularly work and nuanced discussions.

## Product Purpose

Practice speaking and writing, read live transcripts at all times, and use past feedback for the next exercise.

## Operating Context

Launch with vp dev, open Chrome, use at a desk. No deployment, PWA, background service, Dropbox, recordings, or complex spaced repetition in this MVP.

## Capabilities and Constraints

GPT-Live-1 voice API with interruption and both speakers' live captions. Codex App Server with official ChatGPT authentication for subscription-backed teaching. Japanese, English, Chinese and Indonesian may be mixed. SQLite stores text and feedback only. Original transcripts, recognition revisions and language feedback stay separate. No automatic paid API fallback for text. Voice cost is visible without a budget cap.

## Product Principles

- The learner's words and captions have first priority.
- Teach natural, moderately informal Indonesian; show formal equivalents.
- Corrections must never silently rewrite what the learner actually said.
- A simple, useful MVP outranks extra infrastructure or decorative features.
- Preserve drafts and history when a provider fails.

## Accessibility & Inclusion

Japanese UI, clear reading widths, keyboard-accessible annotations, visible focus, comfortable text sizes, reduced motion support.

## Current learning flow

Free voice conversation starts without an exercise. Provide contextual word lookup and up to three short reply examples. Every completed voice conversation automatically opens a dedicated whole-lesson recap. A single microphone toggle closes the voice connection when off and reconnects the same lesson when on, preserving captions and hints. No separate thinking-break control or coach action menu. Practice one grounded improvement, check a fresh learner answer, distinguish help use, then test in a different situation. No unsupported mastery scores.

The voice partner roleplays Rani, a fictional adult living in Bandung. She shares everyday experiences and opinions, develops a topic naturally, and avoids repeating biographical interviews. Captions and reply hints offer whole-sentence Japanese translation within word popups, informed by surrounding dialogue and cached by context.
