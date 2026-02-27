const ALARM_NAME = 'tiktokCleanerSchedule';

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
    unfollowedAccounts
  };
}

async function postWebhook(url, payload) {
  if (!url) return;
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
  } catch {
    // silencioso para não quebrar a rotina
  }
}

function inWindow(now, startHour, endHour) {
  const h = now.getHours();
  if (startHour <= endHour) return h >= startHour && h < endHour;
  return h >= startHour || h < endHour;
}

async function getOrCreateTikTokTab(profileUrl) {
  const tabs = await chrome.tabs.query({ url: ['https://www.tiktok.com/*'] });
  if (tabs && tabs.length) return tabs[0].id;
  const tab = await chrome.tabs.create({ url: profileUrl || 'https://www.tiktok.com/following', active: false });
  return tab.id;
}

async function runScheduledCleanup() {
  const { tiktokCleanerSchedule } = await chrome.storage.local.get('tiktokCleanerSchedule');
  if (!tiktokCleanerSchedule?.enabled) return;

  const now = new Date();
  const start = Number(tiktokCleanerSchedule.startHour ?? 2);
  const end = Number(tiktokCleanerSchedule.endHour ?? 6);
  if (!inWindow(now, start, end)) return;

  const tabId = await getOrCreateTikTokTab(tiktokCleanerSchedule.profileUrl);
  await chrome.tabs.update(tabId, { active: false });

  const payload = {
    type: 'AUTO_TOTAL',
    payload: {
      minFollowers: Number(tiktokCleanerSchedule.minFollowers ?? 100),
      maxAccounts: Number(tiktokCleanerSchedule.maxAccounts ?? 0),
      dryRun: false,
      autoTotal: true,
      ultraSafe: true,
      maxRemovals: Number(tiktokCleanerSchedule.maxRemovals ?? 100),
      cooldownMs: Number(tiktokCleanerSchedule.cooldownMs ?? 1200),
      batchPauseMs: Number(tiktokCleanerSchedule.batchPauseMs ?? 8000),
      batchSize: Number(tiktokCleanerSchedule.batchSize ?? 8),
      protectedUsers: tiktokCleanerSchedule.protectedUsers || []
    }
  };

  const send = () => new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, payload, (resp) => {
      if (chrome.runtime.lastError) return resolve({ ok: false, err: chrome.runtime.lastError.message });
      resolve({ ok: true, resp });
    });
  });

  let result = await send();
  if (!result.ok) {
    try {
      await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
      result = await send();
    } catch (e) {
      result = { ok: false, err: String(e.message || e) };
    }
  }

  const summary = result?.ok ? buildExecutionSummary(result.resp) : null;

  await chrome.storage.local.set({
    tiktokCleanerLastScheduledRun: { at: new Date().toISOString(), result, summary },
    ...(summary ? { tiktokCleanerLastReport: result.resp, tiktokCleanerLastSummary: summary } : {})
  });

  if (summary && tiktokCleanerSchedule.webhookUrl) {
    await postWebhook(tiktokCleanerSchedule.webhookUrl, {
      source: 'tiktok-cleaner-extension',
      mode: 'scheduled',
      ts: new Date().toISOString(),
      summary
    });
  }
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) {
    runScheduledCleanup().catch(() => {});
  }
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'SCHEDULE_SAVE') {
    const cfg = msg.payload || {};
    chrome.storage.local.set({ tiktokCleanerSchedule: cfg }, async () => {
      await chrome.alarms.clear(ALARM_NAME);
      if (cfg.enabled) {
        const interval = Math.max(5, Number(cfg.intervalMin || 20));
        await chrome.alarms.create(ALARM_NAME, { periodInMinutes: interval });
      }
      sendResponse({ ok: true });
    });
    return true;
  }

  if (msg?.type === 'SCHEDULE_GET') {
    chrome.storage.local.get(['tiktokCleanerSchedule', 'tiktokCleanerLastScheduledRun'], (data) => {
      sendResponse({ ok: true, ...data });
    });
    return true;
  }
});
