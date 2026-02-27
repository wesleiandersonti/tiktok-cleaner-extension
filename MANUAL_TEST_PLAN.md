# Manual Test Plan

## Preconditions
- TikTok logged in and opened on Following list
- Extension reloaded in `chrome://extensions`
- Developer mode enabled

## 1) Analyzer smoke
1. Open popup.
2. Click `Analisar perfis visiveis`.

Expected:
- Analysis completes with visible rows count.
- Result cards show score, classification and reasons.
- No network/webhook prompt or external URL usage.

## 2) Transparency and score
1. Pick one profile card.
2. Check shown metrics and reasons.

Expected:
- Reasons are explicit (`+weight` style).
- Classification follows thresholds:
  - `>= 60` => Provavelmente inativo
  - `>= 30` => Baixa atividade
  - `< 30` => Ativo

## 3) Assisted unfollow confirmation
1. Select one or more profiles.
2. Try unfollow without typing `CONFIRMAR`.
3. Type `CONFIRMAR` and run again.

Expected:
- Step 2 blocked.
- Step 3 allowed only after explicit confirmation.

## 4) Daily limit enforcement
1. Set low daily limit (example: 1).
2. Save settings.
3. Try assisted unfollow of multiple selected profiles.

Expected:
- Approval caps operation by remaining daily budget.
- Popup displays remaining count update.

## 5) Max per action enforcement
1. Set `Max por acao assistida` to `2`.
2. Select more than 2 profiles and confirm.

Expected:
- Approved count does not exceed 2.

## 6) DOM-only behavior
1. Keep Following list partially loaded.
2. Run analysis.

Expected:
- Only currently visible/loaded rows are analyzed.
- Extension does not navigate automatically to profiles or call private APIs.

## 7) Handshake and messaging stability
1. With TikTok open and Following list visible, click `Analisar perfis visiveis`.
2. With TikTok open but outside Following tab, click `Analisar perfis visiveis`.
3. With a non-TikTok tab active, click `Analisar perfis visiveis`.

Expected:
- Step 1 runs without `Receiving end does not exist` errors.
- Step 2 shows PRECHECK guidance to open the `Seguindo` tab.
- Step 3 shows guidance to open `https://www.tiktok.com/`.
