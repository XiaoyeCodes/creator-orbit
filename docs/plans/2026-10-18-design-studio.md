# 偏爱日常设计所 Implementation Plan

> Execute within the current authorized workspace. Preserve all existing user changes and active encyclopedia tasks.

**Goal:** Add a dedicated design studio below 拾光百科 with 100 complete editable topics, publication copy, four subject-specific image prompts per topic, real sample previews, and single-topic generation.

**Architecture:** Keep the encyclopedia pipeline intact. Add a separate catalog compiler, persistent studio service and API namespace, and a scoped frontend workspace. Reuse local Codex discovery and image generation transport. Each design uses one master image followed by three reference-based views.

**Tech Stack:** Node.js built-in HTTP/fs/crypto, vanilla JavaScript/CSS, native Codex image tool, existing Python/Pillow validation.

1. Author and validate 100 unique topics in two bounded content files: 40 bag, 30 phone/accessories, 15 clothing, 15 home corners. Each contains finished copy, a design brief and four tailored scene descriptions.
2. Compile complete prompts with shared brand rules and category-specific construction constraints. Save a downloadable full catalog; do not generate all 400 images.
3. Implement isolated persistence, optimistic revision checks, immutable job snapshots, master-reference generation, resume/cancel, output validation and safe asset access.
4. Import the approved bookstore bag sample as an actual existing work with four original PNGs.
5. Add sidebar entry and responsive workspace: search/filter, detail editing, prompt copy, saved revisions, single-topic generation, real work previews and export.
6. Verify catalog completeness and diversity, API validation/conflicts/security, stopped-job recovery, routing and edit persistence through isolated tests. Run existing regression checks and desktop/mobile browser verification.
7. Activate the updated local service after checking active tasks. Never terminate a running encyclopedia generation to deploy this change.

Completed: all seven steps. The updated service is active on port 4174; port 4173 remains untouched after automatic review rejected the combined stop/restart command. Both instances retain the same 13 encyclopedia job IDs and states. Full verification is recorded in `docs/design-studio-verification.md`.
