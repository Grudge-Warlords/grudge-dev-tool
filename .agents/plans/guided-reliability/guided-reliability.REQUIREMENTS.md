# Guided workflow reliability requirements

Current request: analyse recent chats, finish incomplete configuration and enhancements, then improve performance, reliability and ease of use. Prefer one input per stage and prevent invalid or unsupported actions.

Verified on 2026-09-05, main at 54feed59, with extensive pre-existing uncommitted work. Reverify before adoption.

## Current facts
- The authoritative application is E:/grudge/grudge-dev-tool. D:/gruda-build is coordination, D:/grudgeblox runtime, D:/grudox staging.
- Recent Hunyuan and maintenance tasks left substantial implemented work. PROJECT_STATUS.md supersedes older interrupted chat summaries.
- NeuralPrompt3D exposes optional dimensions, budgets, seeds and provider overrides beside the prompt. Fractional finish seeds are silently truncated; invalid numeric text becomes an omitted override.
- Fleet probes lack an abort deadline and accept HTTP 200 HTML on API routes. CLI doctor has inconsistent human/JSON success criteria.
- Failed automatic saves still display a permanent saving spinner.
- The crystal flower-opening prompt produced rigid motion only; strict acceptance remains 0/6 individual and 0/6 fresh batch workflows.
- Daily maintenance authority/budgets are deliberately unapproved. They must not be signed or activated by this implementation.

## Requirements and acceptance
1. Prompt, texture and motion stages show their primary prompt by default; optional configuration remains accessible with its effective selection visible.
2. Shared numeric checks reject invalid dimensions, budgets, seeds and duration before submission and in the trusted process. Do not round, silently omit or replace invalid user input.
3. Unsupported known motion transformations cannot silently produce an unrelated successful partial animation. Do not add named-asset implementations or fabricate visual acceptance.
4. API health probes have a finite deadline, release unused responses and reject HTML API fallbacks; CLI output formats agree on exit status.
5. Automatic save failures remain visible with an explicit retry, without repeated automatic attempts or stale status crossing asset changes.
6. Updates remain explicit; invalid or duplicate download/install transitions are prevented by main-process state.
7. Preserve dirty work, existing models, visual gates, canonical identities and the running installed application. Produce an isolated validated package and a precise audit/status record.
8. Verify focused failures, type checks, build, preload and packaged runtime. Record generative acceptance and owner-controlled activation separately.

## Overrides
The current user requests full implementation. Toolkit phase-only stopping and optional naming confirmations are superseded; continue from requirements through plan, implementation and review in this task.
