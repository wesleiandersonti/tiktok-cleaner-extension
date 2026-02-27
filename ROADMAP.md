# Technical Roadmap

## Completed in current refactor
- MV3 cleanup with minimal permissions and no external webhook flow.
- DOM-only analyzer for Following visible rows.
- Transparent inactivity score with explicit weighted rules.
- Assisted unfollow flow with typed confirmation (`CONFIRMAR`).
- Daily unfollow budget + per-action cap managed by background state.

## Next priorities

### 1) Selector resilience pack
- add fallback selectors by language/DOM variation
- keep parser isolated and versioned
- add diagnostics for missing signals per row

### 2) UX for uncertainty
- show confidence level when metrics are missing
- allow filtering by `has sufficient data`
- add explain panel for each score component

### 3) Testability
- create parser unit tests with static HTML fixtures
- add score engine tests for threshold boundaries
- add message contract tests between popup/background/content

### 4) Compliance hardening
- prepare Chrome Web Store listing text focused on assistive flow
- add internal checklist for policy-safe releases
- document explicit non-use of private APIs/endpoints

### 5) Performance and stability
- incremental rendering in popup for large visible lists
- debounce heavy DOM reads
- add safe timeout and cancellation support for long analyses
