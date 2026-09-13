# Bahasa Coach interface

The user's current direction is a minimal, focused conversation surface. Use a single reading column, a neutral white background, restrained type and a small text navigation bar. No sidebar, hero copy, dashboard metrics, decorative cards, or repeated explanations.

Voice starts directly with one action. Optional topic exercises belong in a collapsed control. During conversation the visible content is the transcript, up to three short reply examples, and start/end/microphone controls. The primary in-call control is a large central microphone toggle. Keep ending the call separate on the left and secondary controls on the right. Use a microphone/slashed microphone icon, color, and a short on/off label together; show M as the shortcut. Ignore keyboard shortcuts while editing, composing text, or using dialogs. Less frequent controls and cost details stay in the action menu. The transcript uses paragraphs, not transport chunks. User text is slightly muted; coach text remains clear and readable. Useful automatic language feedback appears directly below the corresponding learner utterance, with a natural expression and one short Japanese explanation. It never replaces the transcript or pauses the conversation. No transcript-editing controls appear in the conversation UI. Coach controls close their menu on selection and do not create learner utterances.

Every Latin-script word can be inspected. Word explanations open in one viewport-clamped portal so the transcript's scrolling container cannot clip them. Show loading and retry states; keep the reading position while a word is inspected.

Learning happens after practice, intentionally: one quoted source expression, one proposed improvement and its reason, a fresh answer, an evidence-backed check, then a different situation. Support use is recorded. Do not show grades, generic praise, completion badges or unsupported mastery claims. Keep feedback and controls for later stages hidden until relevant.

Visual verification must not use computer use or browser automation without the user's explicit request. Use source inspection and isolated DOM/unit tests.
