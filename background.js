const SETTINGS_KEY = 'tiktokAnalyzerSettings';
const DAILY_STATS_KEY = 'tiktokAnalyzerDailyStats';
const APPROVAL_KEY = 'tiktokAnalyzerUnfollowApproval';

const DEFAULT_SETTINGS = {
  dailyUnfollowLimit: 20,
  minDelayMs: 1200,
  maxPerAction: 15
};

function clampNumber(value, fallback, min, max) {
  let n = Number(value);
  if (!Number.isFinite(n)) n = fallback;
  n = Math.floor(n);
  if (Number.isFinite(min)) n = Math.max(min, n);
  if (Number.isFinite(max)) n = Math.min(max, n);
  return n;
}

function getTodayKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function createToken() {
  return `approve_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

async function getSettings() {
  const raw = (await chrome.storage.local.get(SETTINGS_KEY))?.[SETTINGS_KEY] || {};
  return {
    dailyUnfollowLimit: clampNumber(raw.dailyUnfollowLimit, DEFAULT_SETTINGS.dailyUnfollowLimit, 1, 300),
    minDelayMs: clampNumber(raw.minDelayMs, DEFAULT_SETTINGS.minDelayMs, 500, 15000),
    maxPerAction: clampNumber(raw.maxPerAction, DEFAULT_SETTINGS.maxPerAction, 1, 100)
  };
}

async function saveSettings(input) {
  const settings = {
    dailyUnfollowLimit: clampNumber(input?.dailyUnfollowLimit, DEFAULT_SETTINGS.dailyUnfollowLimit, 1, 300),
    minDelayMs: clampNumber(input?.minDelayMs, DEFAULT_SETTINGS.minDelayMs, 500, 15000),
    maxPerAction: clampNumber(input?.maxPerAction, DEFAULT_SETTINGS.maxPerAction, 1, 100)
  };
  await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
  return settings;
}

async function getDailyStats() {
  const today = getTodayKey();
  const raw = (await chrome.storage.local.get(DAILY_STATS_KEY))?.[DAILY_STATS_KEY];
  if (!raw || raw.date !== today) {
    const stats = { date: today, unfollowed: 0 };
    await chrome.storage.local.set({ [DAILY_STATS_KEY]: stats });
    return stats;
  }

  const stats = {
    date: today,
    unfollowed: clampNumber(raw.unfollowed, 0, 0, 100000)
  };
  if (stats.unfollowed !== raw.unfollowed) {
    await chrome.storage.local.set({ [DAILY_STATS_KEY]: stats });
  }
  return stats;
}

async function getAppState() {
  const [settings, stats] = await Promise.all([getSettings(), getDailyStats()]);
  const remaining = Math.max(0, settings.dailyUnfollowLimit - stats.unfollowed);
  return {
    settings,
    daily: {
      date: stats.date,
      unfollowed: stats.unfollowed,
      remaining,
      limit: settings.dailyUnfollowLimit
    }
  };
}

async function clearApproval() {
  await chrome.storage.local.remove(APPROVAL_KEY);
}

async function requestApproval(payload) {
  const explicitConfirmation = !!payload?.explicitConfirmation;
  if (!explicitConfirmation) {
    return { ok: false, error: 'Confirmacao explicita obrigatoria.' };
  }

  const requestedCount = clampNumber(payload?.requestedCount, 0, 0, 1000);
  if (requestedCount <= 0) {
    return { ok: false, error: 'Nenhum perfil selecionado.' };
  }

  const state = await getAppState();
  if (state.daily.remaining <= 0) {
    return { ok: false, error: 'Limite diario atingido.' };
  }

  const approvedCount = Math.min(requestedCount, state.settings.maxPerAction, state.daily.remaining);
  if (approvedCount <= 0) {
    return { ok: false, error: 'Nao ha capacidade disponivel.' };
  }

  const approval = {
    token: createToken(),
    approvedCount,
    createdAt: Date.now(),
    expiresAt: Date.now() + 2 * 60 * 1000
  };

  await chrome.storage.local.set({ [APPROVAL_KEY]: approval });
  return {
    ok: true,
    approval,
    daily: state.daily
  };
}

async function commitApproval(payload) {
  const token = String(payload?.token || '');
  const consumedCount = clampNumber(payload?.consumedCount, 0, 0, 1000);

  const approval = (await chrome.storage.local.get(APPROVAL_KEY))?.[APPROVAL_KEY];
  if (!approval?.token || approval.token !== token) {
    return { ok: false, error: 'Token de aprovacao invalido.' };
  }

  if (Date.now() > Number(approval.expiresAt || 0)) {
    await clearApproval();
    return { ok: false, error: 'Aprovacao expirada.' };
  }

  if (consumedCount < 0 || consumedCount > approval.approvedCount) {
    return { ok: false, error: 'Quantidade consumida invalida.' };
  }

  const stats = await getDailyStats();
  const nextStats = {
    date: stats.date,
    unfollowed: stats.unfollowed + consumedCount
  };
  await chrome.storage.local.set({ [DAILY_STATS_KEY]: nextStats });
  await clearApproval();

  const state = await getAppState();
  return {
    ok: true,
    consumedCount,
    daily: state.daily
  };
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    switch (msg?.type) {
      case 'APP_GET_STATE': {
        const state = await getAppState();
        sendResponse({ ok: true, ...state });
        return;
      }

      case 'APP_SAVE_SETTINGS': {
        const settings = await saveSettings(msg.payload || {});
        const state = await getAppState();
        sendResponse({ ok: true, settings, daily: state.daily });
        return;
      }

      case 'UNFOLLOW_REQUEST_APPROVAL': {
        const result = await requestApproval(msg.payload || {});
        sendResponse(result);
        return;
      }

      case 'UNFOLLOW_COMMIT': {
        const result = await commitApproval(msg.payload || {});
        sendResponse(result);
        return;
      }

      default:
        sendResponse({ ok: false, error: 'Mensagem nao suportada.' });
    }
  })().catch((e) => {
    sendResponse({ ok: false, error: String(e?.message || e) });
  });

  return true;
});
