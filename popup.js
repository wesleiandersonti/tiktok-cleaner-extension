const REQUIRED_CONFIRMATION = 'CONFIRMAR';

const scoreEngine = globalThis.TikTokInactivityScore;

const DEFAULT_WEIGHTS = scoreEngine?.DEFAULT_WEIGHTS || {
  noPosts180: 50,
  noPosts90: 30,
  followersZero: 10,
  likesZero: 10,
  bioEmpty: 5,
  noAvatar: 10
};

const CLASSIFICATION_THRESHOLDS = scoreEngine?.CLASSIFICATION_THRESHOLDS || {
  likelyInactive: 60,
  lowActivity: 30
};

const criteriaListEl = document.getElementById('criteriaList');
const statusEl = document.getElementById('status');
const summaryEl = document.getElementById('summary');
const resultsEl = document.getElementById('results');

const dailyLimitEl = document.getElementById('dailyLimit');
const minDelayMsEl = document.getElementById('minDelayMs');
const maxPerActionEl = document.getElementById('maxPerAction');
const remainingTodayEl = document.getElementById('remainingToday');

const saveSettingsBtn = document.getElementById('saveSettingsBtn');
const analyzeBtn = document.getElementById('analyzeBtn');
const selectLikelyBtn = document.getElementById('selectLikelyBtn');
const unfollowBtn = document.getElementById('unfollowBtn');
const confirmInputEl = document.getElementById('confirmInput');

let analyzedProfiles = [];
let lastAnalysis = null;
let appState = null;

function setStatus(text) {
  statusEl.textContent = text;
}

function appendStatus(text) {
  statusEl.textContent = `${statusEl.textContent}\n${text}`;
}

function clampNumber(value, fallback, min, max) {
  let n = Number(value);
  if (!Number.isFinite(n)) n = fallback;
  n = Math.floor(n);
  if (Number.isFinite(min)) n = Math.max(min, n);
  if (Number.isFinite(max)) n = Math.min(max, n);
  return n;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatNumber(value) {
  if (value === null || value === undefined) return '-';
  const n = Number(value);
  if (!Number.isFinite(n)) return '-';
  return n.toLocaleString('pt-BR');
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function scoreClass(score) {
  if (score >= CLASSIFICATION_THRESHOLDS.likelyInactive) return 'score-risk';
  if (score >= CLASSIFICATION_THRESHOLDS.lowActivity) return 'score-warn';
  return 'score-ok';
}

function getSelectedUsernames() {
  return Array.from(resultsEl.querySelectorAll('input[data-username]:checked')).map(
    (input) => input.dataset.username
  );
}

function renderCriteria() {
  const lines = [
    `Sem posts > 180 dias: +${DEFAULT_WEIGHTS.noPosts180}`,
    `Sem posts > 90 dias: +${DEFAULT_WEIGHTS.noPosts90}`,
    `Seguidores = 0: +${DEFAULT_WEIGHTS.followersZero}`,
    `Curtidas = 0: +${DEFAULT_WEIGHTS.likesZero}`,
    `Bio vazia: +${DEFAULT_WEIGHTS.bioEmpty}`,
    `Sem avatar: +${DEFAULT_WEIGHTS.noAvatar}`,
    `Score >= ${CLASSIFICATION_THRESHOLDS.likelyInactive} => Provavelmente inativo`
  ];

  criteriaListEl.innerHTML = lines.map((line) => `<li>${escapeHtml(line)}</li>`).join('');
}

function renderDailyState() {
  if (!appState?.daily) {
    remainingTodayEl.value = '-';
    return;
  }

  const d = appState.daily;
  remainingTodayEl.value = `${d.remaining}/${d.limit}`;
}

function renderSummary() {
  if (!lastAnalysis) {
    summaryEl.textContent = 'Ainda sem analise.';
    return;
  }

  const selected = getSelectedUsernames().length;
  const likely = analyzedProfiles.filter(
    (p) => p.score >= CLASSIFICATION_THRESHOLDS.likelyInactive
  ).length;

  summaryEl.textContent = [
    `Visiveis: ${lastAnalysis.totalVisibleRows}`,
    `Perfis analisados: ${lastAnalysis.totalProfiles}`,
    `Provavelmente inativos: ${likely}`,
    `Selecionados: ${selected}`
  ].join(' | ');
}

function profileMeta(profile) {
  return [
    `dias sem post: ${formatNumber(profile.daysSinceLastPost)}`,
    `posts: ${formatNumber(profile.posts)}`,
    `seguidores: ${formatNumber(profile.followers)}`,
    `seguindo: ${formatNumber(profile.following)}`,
    `curtidas: ${formatNumber(profile.likes)}`,
    `bio vazia: ${profile.bioEmpty === null ? '-' : profile.bioEmpty ? 'sim' : 'nao'}`,
    `avatar: ${profile.hasAvatar ? 'sim' : 'nao'}`
  ].join(' | ');
}

function renderResults() {
  if (!analyzedProfiles.length) {
    resultsEl.innerHTML = '<div class="tiny">Nenhum perfil visivel analisado.</div>';
    renderSummary();
    return;
  }

  const html = analyzedProfiles
    .map((profile) => {
      const reasons = profile.reasons?.length
        ? profile.reasons.join(' | ')
        : 'Nenhum criterio de risco acionado.';

      return `
      <div class="result-item">
        <div class="line">
          <label class="checkline">
            <input type="checkbox" data-username="${escapeHtml(profile.username)}" data-score="${profile.score}"/>
            <span class="name">@${escapeHtml(profile.username)}</span>
          </label>
          <span class="score ${scoreClass(profile.score)}">${profile.score} - ${escapeHtml(profile.classification)}</span>
        </div>
        <div class="meta">${escapeHtml(profileMeta(profile))}</div>
        <div class="reasons">${escapeHtml(reasons)}</div>
      </div>
    `;
    })
    .join('');

  resultsEl.innerHTML = html;
  renderSummary();
}

function runtimeMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(response);
    });
  });
}

async function getActiveTikTokTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0];
  if (!tab?.id || !String(tab.url || '').startsWith('https://www.tiktok.com/')) {
    throw new Error('Abra o TikTok antes de usar a extensao.');
  }
  return tab;
}

function sendTabMessageRaw(tabId, message) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(response);
    });
  });
}

function isReceivingEndError(error) {
  const msg = String(error?.message || error || '').toLowerCase();
  return (
    msg.includes('receiving end does not exist') ||
    msg.includes('message port closed before a response was received')
  );
}

async function isContentBridgeReady(tabId) {
  const exec = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => Boolean(globalThis.__TT_ANALYZER_CONTENT_READY__ && globalThis.TikTokInactivityScore)
  });
  return !!exec?.[0]?.result;
}

async function waitForBridge(tabId, timeoutMs = 2000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt <= timeoutMs) {
    try {
      const ping = await sendTabMessageRaw(tabId, { type: 'PING' });
      if (ping?.ok && ping?.pong === true) {
        return true;
      }
    } catch (e) {
      if (!isReceivingEndError(e)) {
        throw e;
      }
    }

    await sleep(150);
  }

  return false;
}

async function ensureContentBridge(tabId) {
  let ready = false;
  try {
    ready = await isContentBridgeReady(tabId);
  } catch {
    throw new Error(
      'Nao foi possivel acessar a pagina do TikTok. Recarregue a aba e tente novamente.'
    );
  }

  if (!ready) {
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['inactivity-score.js', 'content.js']
      });
    } catch {
      throw new Error(
        'Falha ao preparar a conexao com a pagina. Recarregue o TikTok e tente novamente.'
      );
    }
  }

  const connected = await waitForBridge(tabId, 2000);
  if (!connected) {
    throw new Error(
      'Nao foi possivel estabelecer conexao com a pagina. Abra https://www.tiktok.com, recarregue a aba e abra a lista Seguindo antes de tentar novamente.'
    );
  }
}

function toFriendlyConnectionError(error) {
  const msg = String(error?.message || error || '').toLowerCase();
  if (msg.includes('receiving end does not exist')) {
    return 'A pagina ainda nao esta pronta para comunicacao. Recarregue o TikTok e tente novamente.';
  }
  if (msg.includes('cannot access') || msg.includes('not allowed')) {
    return 'A extensao nao conseguiu acessar esta aba. Abra https://www.tiktok.com e tente novamente.';
  }
  return String(
    error?.message || error || 'Falha de comunicacao com a pagina do TikTok.'
  );
}

async function sendMessageToActiveTikTok(message) {
  const tab = await getActiveTikTokTab();

  try {
    await ensureContentBridge(tab.id);
    const response = await sendTabMessageRaw(tab.id, message);
    if (!response) {
      throw new Error('Sem resposta da pagina do TikTok.');
    }
    return response;
  } catch (e) {
    throw new Error(toFriendlyConnectionError(e));
  }
}

async function loadAppState() {
  const state = await runtimeMessage({ type: 'APP_GET_STATE' });
  if (!state?.ok) {
    throw new Error(state?.error || 'Falha ao carregar estado da extensao.');
  }

  appState = state;
  dailyLimitEl.value = String(state.settings.dailyUnfollowLimit);
  minDelayMsEl.value = String(state.settings.minDelayMs);
  maxPerActionEl.value = String(state.settings.maxPerAction);
  renderDailyState();
}

async function saveSettings() {
  const payload = {
    dailyUnfollowLimit: clampNumber(dailyLimitEl.value, 20, 1, 300),
    minDelayMs: clampNumber(minDelayMsEl.value, 1200, 500, 15000),
    maxPerAction: clampNumber(maxPerActionEl.value, 15, 1, 100)
  };

  const response = await runtimeMessage({ type: 'APP_SAVE_SETTINGS', payload });
  if (!response?.ok) {
    throw new Error(response?.error || 'Falha ao salvar configuracoes.');
  }

  appState = { settings: response.settings, daily: response.daily };
  renderDailyState();
  setStatus('Configuracoes salvas com sucesso.');
}

async function analyzeVisibleProfiles() {
  const precheck = await sendMessageToActiveTikTok({ type: 'PRECHECK' });
  if (!precheck?.ok) {
    setStatus(
      precheck?.message || 'Nao foi possivel iniciar a analise neste contexto.'
    );
    return;
  }

  const response = await sendMessageToActiveTikTok({
    type: 'ANALYZE_VISIBLE_FOLLOWING',
    payload: { weights: DEFAULT_WEIGHTS }
  });

  if (!response?.ok) {
    throw new Error(
      response?.message || response?.error || 'Falha na analise.'
    );
  }

  analyzedProfiles = Array.isArray(response.profiles) ? response.profiles : [];
  lastAnalysis = {
    totalVisibleRows: response.totalVisibleRows || 0,
    totalProfiles: response.totalProfiles || analyzedProfiles.length,
    scannedAt: response.scannedAt || new Date().toISOString()
  };

  renderResults();
  setStatus(
    `Analise concluida em ${lastAnalysis.scannedAt}. Revise os criterios antes de confirmar unfollow.`
  );
}

function selectLikelyInactive() {
  const checkboxes = Array.from(resultsEl.querySelectorAll('input[data-username]'));
  if (!checkboxes.length) {
    setStatus('Nenhum resultado para selecionar. Rode a analise primeiro.');
    return;
  }

  let selected = 0;
  for (const input of checkboxes) {
    const score = Number(input.dataset.score || 0);
    const shouldSelect = score >= CLASSIFICATION_THRESHOLDS.likelyInactive;
    input.checked = shouldSelect;
    if (shouldSelect) selected++;
  }

  renderSummary();
  setStatus(
    `Selecionados automaticamente ${selected} perfis com score >= ${CLASSIFICATION_THRESHOLDS.likelyInactive}.`
  );
}

async function runAssistedUnfollow() {
  const selected = getSelectedUsernames();
  if (!selected.length) {
    throw new Error('Selecione pelo menos um perfil para unfollow assistido.');
  }

  if (String(confirmInputEl.value || '').trim().toUpperCase() !== REQUIRED_CONFIRMATION) {
    throw new Error(`Digite ${REQUIRED_CONFIRMATION} para confirmar.`);
  }

  const approval = await runtimeMessage({
    type: 'UNFOLLOW_REQUEST_APPROVAL',
    payload: {
      requestedCount: selected.length,
      explicitConfirmation: true
    }
  });

  if (!approval?.ok) {
    throw new Error(approval?.error || 'Aprovacao negada.');
  }

  const approvedCount = approval.approval.approvedCount;
  const toProcess = selected.slice(0, approvedCount);
  if (!toProcess.length) {
    throw new Error('Nenhum perfil aprovado para esta acao.');
  }

  const response = await sendMessageToActiveTikTok({
    type: 'UNFOLLOW_SELECTED_VISIBLE',
    payload: {
      usernames: toProcess,
      delayMs: appState?.settings?.minDelayMs || 1200,
      confirmationText: REQUIRED_CONFIRMATION
    }
  });

  if (!response?.ok) {
    throw new Error(
      response?.message || response?.error || 'Falha ao executar unfollow assistido.'
    );
  }

  const commit = await runtimeMessage({
    type: 'UNFOLLOW_COMMIT',
    payload: {
      token: approval.approval.token,
      consumedCount: response.unfollowed
    }
  });

  if (!commit?.ok) {
    appendStatus(
      `Aviso: nao foi possivel registrar consumo diario (${commit?.error || 'erro desconhecido'}).`
    );
  } else {
    appState = { ...appState, daily: commit.daily };
    renderDailyState();
  }

  setStatus([
    `Unfollow assistido finalizado.`,
    `Aprovados: ${approvedCount}`,
    `Unfollow executado: ${response.unfollowed}`,
    `Nao visiveis: ${response.skippedNotVisible}`,
    `Sem botao: ${response.skippedNoButton}`,
    response.errors?.length ? `Erros: ${response.errors.length}` : 'Erros: 0'
  ].join('\n'));

  confirmInputEl.value = '';
  await analyzeVisibleProfiles();
}

function setBusy(button, busyText, fn) {
  return async () => {
    const original = button.textContent;
    button.disabled = true;
    button.textContent = busyText;
    try {
      await fn();
    } catch (e) {
      setStatus(`Erro: ${String(e?.message || e)}`);
    } finally {
      button.disabled = false;
      button.textContent = original;
    }
  };
}

analyzeBtn.addEventListener(
  'click',
  setBusy(analyzeBtn, 'Analisando...', analyzeVisibleProfiles)
);
saveSettingsBtn.addEventListener(
  'click',
  setBusy(saveSettingsBtn, 'Salvando...', saveSettings)
);
unfollowBtn.addEventListener(
  'click',
  setBusy(unfollowBtn, 'Executando...', runAssistedUnfollow)
);
selectLikelyBtn.addEventListener('click', selectLikelyInactive);

resultsEl.addEventListener('change', (event) => {
  if (
    event.target instanceof HTMLInputElement &&
    event.target.matches('input[data-username]')
  ) {
    renderSummary();
  }
});

(async () => {
  try {
    renderCriteria();
    await loadAppState();
    renderSummary();
    setStatus('Pronto. Abra Seguindo no TikTok e clique em analisar.');
  } catch (e) {
    setStatus(`Erro ao iniciar popup: ${String(e?.message || e)}`);
  }
})();
