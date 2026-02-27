const ALARM_NAME = 'tiktokCleanerSchedule';
const RUN_LOCK_KEY = 'tiktokCleanerRunLock';
const RUN_LOCK_TTL_MS = 45 * 60 * 1000;
const DEFAULT_PROFILE_URL = 'https://www.tiktok.com/following';
const LOCAL_WEBHOOK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
const STOP_REQUEST_KEY = 'tiktokCleanerStopRequested';
const COOLDOWN_UNTIL_KEY = 'tiktokCleanerCooldownUntil';
const DAILY_REMOVALS_KEY = 'tiktokCleanerDailyRemovalStats';
const LAST_ANALYZE_KEY = 'tiktokCleanerLastAnalyzeRun';

function toNumber(value, fallback, opts = {}) {
  const { min, max } = opts;
  let n = Number(value);
  if (!Number.isFinite(n)) n = fallback;
  if (Number.isFinite(min)) n = Math.max(min, n);
  if (Number.isFinite(max)) n = Math.min(max, n);
  return n;
}

function normalizeHour(value, fallback) {
  const n = toNumber(value, fallback);
  return ((Math.floor(n) % 24) + 24) % 24;
}

function getLocalDateKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

async function getDailyRemovalStats() {
  const today = getLocalDateKey();
  const raw = (await chrome.storage.local.get(DAILY_REMOVALS_KEY))?.[DAILY_REMOVALS_KEY];
  if (!raw || raw.date !== today) return { date: today, removed: 0 };
  return { date: today, removed: toNumber(raw.removed, 0, { min: 0 }) };
}

async function getDailyRemaining(dailyCap) {
  if (!dailyCap || dailyCap <= 0) {
    return { unlimited: true, remaining: Number.POSITIVE_INFINITY, stats: await getDailyRemovalStats() };
  }

  const stats = await getDailyRemovalStats();
  return {
    unlimited: false,
    remaining: Math.max(0, dailyCap - stats.removed),
    stats
  };
}

async function consumeDailyRemovals(removedCount) {
  const delta = toNumber(removedCount, 0, { min: 0 });
  if (delta <= 0) return;
  const stats = await getDailyRemovalStats();
  await chrome.storage.local.set({
    [DAILY_REMOVALS_KEY]: {
      date: stats.date,
      removed: stats.removed + delta
    }
  });
}

async function evaluateRecentAnalyze(maxAgeHours) {
  const data = await chrome.storage.local.get(LAST_ANALYZE_KEY);
  const analyze = data?.[LAST_ANALYZE_KEY];
  if (!analyze?.at) {
    return { ok: false, reason: 'no_recent_analysis' };
  }

  const atMs = Date.parse(analyze.at);
  if (!Number.isFinite(atMs)) {
    return { ok: false, reason: 'invalid_analysis_timestamp' };
  }

  const maxAgeMs = toNumber(maxAgeHours, 24, { min: 1 }) * 60 * 60 * 1000;
  const ageMs = Date.now() - atMs;
  if (ageMs > maxAgeMs) {
    return { ok: false, reason: 'analysis_too_old', at: analyze.at, ageMs };
  }

  const summary = analyze.summary || {};
  const checked = toNumber(summary.checked, 0, { min: 0 });
  const stoppedReason = summary.stoppedReason || '';
  if (checked <= 0 || !!stoppedReason) {
    return { ok: false, reason: 'analysis_not_valid', at: analyze.at, checked, stoppedReason };
  }

  return { ok: true, at: analyze.at, checked };
}

function normalizeProfileUrl(raw) {
  const value = String(raw || '').trim();
  if (!value) return DEFAULT_PROFILE_URL;

  try {
    const parsed = new URL(value);
    const host = parsed.hostname.toLowerCase();
    if (!host.endsWith('tiktok.com')) return DEFAULT_PROFILE_URL;
    parsed.protocol = 'https:';
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return DEFAULT_PROFILE_URL;
  }
}

function parseWebhookUrl(raw) {
  const value = String(raw || '').trim();
  if (!value) return { ok: true, url: '' };

  try {
    const parsed = new URL(value);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return { ok: false, error: 'Webhook deve usar http:// ou https://.' };
    }

    const host = parsed.hostname.toLowerCase();
    if (parsed.protocol === 'http:' && !LOCAL_WEBHOOK_HOSTS.has(host)) {
      return { ok: false, error: 'Webhook remoto precisa usar https:// (http:// apenas localhost).' };
    }

    parsed.hash = '';
    return { ok: true, url: parsed.toString() };
  } catch {
    return { ok: false, error: 'URL de webhook inválida.' };
  }
}

function buildExecutionSummary(resp) {
  const audit = Array.isArray(resp?.audit) ? resp.audit : [];
  const unfollowedAccounts = audit
    .filter(a => a?.removed)
    .map(a => ({
      username: a.username || '',
      followers: a.followers ?? null,
      reason: a.reason || 'unknown'
    }));

  return {
    foundTotal: resp?.foundTotal ?? resp?.checked ?? 0,
    checked: resp?.checked ?? 0,
    banned: resp?.banned ?? 0,
    below: resp?.below ?? 0,
    removed: resp?.removed ?? 0,
    skippedProtected: resp?.skippedProtected ?? 0,
    errors: (resp?.errors || []).slice(0, 10),
    unfollowedCount: unfollowedAccounts.length,
    unfollowedAccounts,
    heuristicsVersion: resp?.heuristicsVersion || null,
    stoppedReason: resp?.stoppedReason || null
  };
}

async function postWebhook(url, payload) {
  const parsed = parseWebhookUrl(url);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  if (!parsed.url) return { ok: true, skipped: true };

  try {
    const resp = await fetch(parsed.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!resp.ok) return { ok: false, error: `Webhook HTTP ${resp.status}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}

function inWindow(now, startHour, endHour) {
  if (startHour === endHour) return true;
  const h = now.getHours();
  if (startHour < endHour) return h >= startHour && h < endHour;
  return h >= startHour || h < endHour;
}

function buildRunId() {
  return `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

async function acquireRunLock() {
  const now = Date.now();
  const current = (await chrome.storage.local.get(RUN_LOCK_KEY))?.[RUN_LOCK_KEY];
  if (current?.expiresAt && Number(current.expiresAt) > now) return null;

  const candidate = {
    runId: buildRunId(),
    createdAt: new Date().toISOString(),
    expiresAt: now + RUN_LOCK_TTL_MS
  };

  await chrome.storage.local.set({ [RUN_LOCK_KEY]: candidate });
  const check = (await chrome.storage.local.get(RUN_LOCK_KEY))?.[RUN_LOCK_KEY];
  if (!check || check.runId !== candidate.runId) return null;
  return candidate;
}

async function releaseRunLock(runId) {
  const current = (await chrome.storage.local.get(RUN_LOCK_KEY))?.[RUN_LOCK_KEY];
  if (current?.runId === runId) {
    await chrome.storage.local.remove(RUN_LOCK_KEY);
  }
}

async function getOrCreateTikTokTab(profileUrl) {
  const targetUrl = normalizeProfileUrl(profileUrl);
  const tabs = await chrome.tabs.query({ url: ['https://www.tiktok.com/*'] });
  const normalizedTarget = targetUrl.replace(/\/$/, '');

  const exact = tabs.find(tab => {
    if (typeof tab.url !== 'string') return false;
    const normalizedTabUrl = tab.url.replace(/\/$/, '');
    return normalizedTabUrl === normalizedTarget || normalizedTabUrl.startsWith(`${normalizedTarget}?`);
  });
  if (exact?.id) return exact.id;

  if (/\/following(?:[/?#]|$)/i.test(targetUrl)) {
    const followingTab = tabs.find(tab => typeof tab.url === 'string' && /\/following(?:[/?#]|$)/i.test(tab.url));
    if (followingTab?.id) return followingTab.id;
  }

  const tab = await chrome.tabs.create({ url: targetUrl, active: false });
  return tab.id;
}

async function runScheduledCleanup() {
  const { tiktokCleanerSchedule } = await chrome.storage.local.get('tiktokCleanerSchedule');
  if (!tiktokCleanerSchedule?.enabled) return;

  const cooldownUntil = toNumber((await chrome.storage.local.get(COOLDOWN_UNTIL_KEY))?.[COOLDOWN_UNTIL_KEY], 0, { min: 0 });
  if (cooldownUntil > Date.now()) {
    await chrome.storage.local.set({
      tiktokCleanerLastScheduledRun: {
        at: new Date().toISOString(),
        skipped: true,
        reason: 'cooldown_active',
        cooldownUntil
      }
    });
    return;
  }

  const now = new Date();
  const start = normalizeHour(tiktokCleanerSchedule.startHour, 2);
  const end = normalizeHour(tiktokCleanerSchedule.endHour, 6);
  if (!inWindow(now, start, end)) return;

  const requireRecentAnalyze = tiktokCleanerSchedule.requireRecentAnalyze !== false;
  const analysisMaxAgeHours = toNumber(tiktokCleanerSchedule.analysisMaxAgeHours, 24, { min: 1, max: 168 });
  if (requireRecentAnalyze) {
    const gate = await evaluateRecentAnalyze(analysisMaxAgeHours);
    if (!gate.ok) {
      await chrome.storage.local.set({
        tiktokCleanerLastScheduledRun: {
          at: new Date().toISOString(),
          skipped: true,
          reason: gate.reason,
          gate
        }
      });
      return;
    }
  }

  const dailyRemovalCap = toNumber(tiktokCleanerSchedule.dailyRemovalCap, 200, { min: 0, max: 5000 });
  const daily = await getDailyRemaining(dailyRemovalCap);
  if (!daily.unlimited && daily.remaining <= 0) {
    await chrome.storage.local.set({
      tiktokCleanerLastScheduledRun: {
        at: new Date().toISOString(),
        skipped: true,
        reason: 'daily_cap_reached',
        daily
      }
    });
    return;
  }

  const lock = await acquireRunLock();
  if (!lock) {
    await chrome.storage.local.set({
      tiktokCleanerLastScheduledRun: {
        at: new Date().toISOString(),
        skipped: true,
        reason: 'already_running'
      }
    });
    return;
  }

  let result = null;
  let summary = null;
  let webhookResult = null;
  await chrome.storage.local.set({ [STOP_REQUEST_KEY]: false });

  try {
    const tabId = await getOrCreateTikTokTab(tiktokCleanerSchedule.profileUrl);
    await chrome.tabs.update(tabId, { active: false });

    const payload = {
      type: 'AUTO_TOTAL',
      payload: {
        minFollowers: toNumber(tiktokCleanerSchedule.minFollowers, 100, { min: 0 }),
        maxAccounts: toNumber(tiktokCleanerSchedule.maxAccounts, 0, { min: 0 }),
        dryRun: false,
        autoTotal: true,
        ultraSafe: true,
        maxRemovals: daily.unlimited
          ? toNumber(tiktokCleanerSchedule.maxRemovals, 100, { min: 1 })
          : Math.max(1, Math.min(
            toNumber(tiktokCleanerSchedule.maxRemovals, 100, { min: 1 }),
            daily.remaining
          )),
        cooldownMs: toNumber(tiktokCleanerSchedule.cooldownMs, 1200, { min: 300 }),
        batchPauseMs: toNumber(tiktokCleanerSchedule.batchPauseMs, 8000, { min: 1000 }),
        batchSize: toNumber(tiktokCleanerSchedule.batchSize, 8, { min: 1 }),
        protectedUsers: Array.isArray(tiktokCleanerSchedule.protectedUsers) ? tiktokCleanerSchedule.protectedUsers : [],
        dailyRemovalCap,
        stopKey: STOP_REQUEST_KEY
      }
    };

    const send = () => new Promise((resolve) => {
      chrome.tabs.sendMessage(tabId, payload, (resp) => {
        if (chrome.runtime.lastError) return resolve({ ok: false, err: chrome.runtime.lastError.message });
        resolve({ ok: true, resp });
      });
    });

    result = await send();
    if (!result.ok) {
      try {
        await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
        result = await send();
      } catch (e) {
        result = { ok: false, err: String(e?.message || e) };
      }
    }

    summary = result?.ok ? buildExecutionSummary(result.resp) : null;
    if (summary) {
      await consumeDailyRemovals(summary.removed);
    }

    const cooldownAfterBlockHours = toNumber(tiktokCleanerSchedule.cooldownAfterBlockHours, 12, { min: 1, max: 72 });
    const shouldStartCooldown = summary?.stoppedReason === 'access_denied' || summary?.stoppedReason === 'throttled';
    let nextCooldownUntil = 0;
    if (shouldStartCooldown) {
      nextCooldownUntil = Date.now() + cooldownAfterBlockHours * 60 * 60 * 1000;
      await chrome.storage.local.set({ [COOLDOWN_UNTIL_KEY]: nextCooldownUntil });
    }

    if (summary) {
      webhookResult = await postWebhook(tiktokCleanerSchedule.webhookUrl, {
        source: 'tiktok-cleaner-extension',
        mode: 'scheduled',
        ts: new Date().toISOString(),
        summary
      });
    }

    await chrome.storage.local.set({
      tiktokCleanerLastScheduledRun: {
        at: new Date().toISOString(),
        result,
        summary,
        webhookResult,
        runId: lock.runId,
        cooldownUntil: nextCooldownUntil || null
      },
      ...(summary ? { tiktokCleanerLastReport: result.resp, tiktokCleanerLastSummary: summary } : {})
    });
  } catch (e) {
    await chrome.storage.local.set({
      tiktokCleanerLastScheduledRun: {
        at: new Date().toISOString(),
        result: { ok: false, err: String(e?.message || e) },
        runId: lock.runId
      }
    });
  } finally {
    await releaseRunLock(lock.runId);
  }
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) {
    runScheduledCleanup().catch(() => {});
  }
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'EMERGENCY_STOP') {
    (async () => {
      const { tiktokCleanerSchedule } = await chrome.storage.local.get('tiktokCleanerSchedule');
      await chrome.alarms.clear(ALARM_NAME);
      await chrome.storage.local.set({
        [STOP_REQUEST_KEY]: true,
        tiktokCleanerSchedule: {
          ...(tiktokCleanerSchedule || {}),
          enabled: false
        },
        tiktokCleanerLastEmergencyStopAt: new Date().toISOString()
      });
      sendResponse({ ok: true });
    })().catch((e) => {
      sendResponse({ ok: false, error: String(e?.message || e) });
    });
    return true;
  }

  if (msg?.type === 'SCHEDULE_SAVE') {
    const cfg = msg.payload || {};
    const parsedWebhook = parseWebhookUrl(cfg.webhookUrl);
    if (!parsedWebhook.ok) {
      sendResponse({ ok: false, error: parsedWebhook.error });
      return true;
    }

    const interval = toNumber(cfg.intervalMin, 20, { min: 5 });
    const normalizedSchedule = {
      enabled: !!cfg.enabled,
      profileUrl: normalizeProfileUrl(cfg.profileUrl),
      startHour: normalizeHour(cfg.startHour, 2),
      endHour: normalizeHour(cfg.endHour, 6),
      intervalMin: interval,
      minFollowers: toNumber(cfg.minFollowers, 100, { min: 0 }),
      maxAccounts: toNumber(cfg.maxAccounts, 0, { min: 0 }),
      maxRemovals: toNumber(cfg.maxRemovals, 100, { min: 1 }),
      cooldownMs: toNumber(cfg.cooldownMs, 1200, { min: 300 }),
      batchPauseMs: toNumber(cfg.batchPauseMs, 8000, { min: 1000 }),
      batchSize: toNumber(cfg.batchSize, 8, { min: 1 }),
      dailyRemovalCap: toNumber(cfg.dailyRemovalCap, 200, { min: 0, max: 5000 }),
      requireRecentAnalyze: cfg.requireRecentAnalyze !== false,
      analysisMaxAgeHours: toNumber(cfg.analysisMaxAgeHours, 24, { min: 1, max: 168 }),
      cooldownAfterBlockHours: toNumber(cfg.cooldownAfterBlockHours, 12, { min: 1, max: 72 }),
      protectedUsers: Array.isArray(cfg.protectedUsers)
        ? cfg.protectedUsers.map(x => String(x || '').trim().replace(/^@/, '').toLowerCase()).filter(Boolean)
        : [],
      webhookUrl: parsedWebhook.url
    };

    chrome.storage.local.set({ tiktokCleanerSchedule: normalizedSchedule }, async () => {
      await chrome.alarms.clear(ALARM_NAME);
      if (normalizedSchedule.enabled) {
        await chrome.alarms.create(ALARM_NAME, { periodInMinutes: interval });
      }
      sendResponse({ ok: true });
    });
    return true;
  }

  if (msg?.type === 'SCHEDULE_GET') {
    chrome.storage.local.get([
      'tiktokCleanerSchedule',
      'tiktokCleanerLastScheduledRun',
      'tiktokCleanerLastEmergencyStopAt',
      COOLDOWN_UNTIL_KEY,
      LAST_ANALYZE_KEY,
      DAILY_REMOVALS_KEY
    ], (data) => {
      sendResponse({ ok: true, ...data });
    });
    return true;
  }
});
