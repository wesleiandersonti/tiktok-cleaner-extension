const REQUIRED_UNFOLLOW_CONFIRMATION = 'CONFIRMAR';
globalThis.__TT_ANALYZER_CONTENT_READY__ = false;

const scoreEngine = globalThis.TikTokInactivityScore;
if (!scoreEngine) {
  throw new Error('Inactivity score engine not loaded.');
}

const DEFAULT_WEIGHTS = scoreEngine.DEFAULT_WEIGHTS;
const CLASSIFICATION_THRESHOLDS = scoreEngine.CLASSIFICATION_THRESHOLDS;
const normalizeScoreWeights = scoreEngine.normalizeWeights;
const calculateInactivityScore = scoreEngine.calculateInactivityScore;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clampNumber(value, fallback, min, max) {
  let n = Number(value);
  if (!Number.isFinite(n)) n = fallback;
  if (Number.isFinite(min)) n = Math.max(min, n);
  if (Number.isFinite(max)) n = Math.min(max, n);
  return n;
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseCompactNumber(raw) {
  if (!raw) return null;

  const compact = String(raw).trim().toLowerCase().replace(/\s+/g, '');
  if (!compact) return null;

  const suffix = compact.match(/[kmb]$/);
  if (suffix) {
    const baseRaw = compact.slice(0, -1).replace(/\./g, '').replace(',', '.');
    const base = Number(baseRaw);
    if (!Number.isFinite(base)) return null;
    const factor = suffix[0] === 'k' ? 1_000 : suffix[0] === 'm' ? 1_000_000 : 1_000_000_000;
    return Math.round(base * factor);
  }

  const digits = compact.replace(/[^\d]/g, '');
  if (!digits) return null;
  const parsed = Number(digits);
  return Number.isFinite(parsed) ? parsed : null;
}

function extractMetricByKeywords(text, keywords) {
  const source = String(text || '');
  if (!source) return null;
  const group = keywords.map(escapeRegex).join('|');

  const patterns = [
    new RegExp(`([\\d.,]+\\s*[kmb]?)\\s*(?:${group})`, 'i'),
    new RegExp(`(?:${group})\\s*[:\\-]?\\s*([\\d.,]+\\s*[kmb]?)`, 'i')
  ];

  for (const pattern of patterns) {
    const match = source.match(pattern);
    if (!match) continue;
    const value = parseCompactNumber(match[1]);
    if (value !== null) return value;
  }

  return null;
}

function parseRelativeDays(text) {
  const source = String(text || '').toLowerCase();
  if (!source) return null;

  if (source.includes('yesterday') || source.includes('ontem')) return 1;

  const patterns = [
    { regex: /(\d+)\s*(d|day|days|dia|dias)\b/i, factor: 1 },
    { regex: /(\d+)\s*(w|week|weeks|sem|semana|semanas)\b/i, factor: 7 },
    { regex: /(\d+)\s*(mo|month|months|mes|meses)\b/i, factor: 30 },
    { regex: /(\d+)\s*(y|year|years|ano|anos)\b/i, factor: 365 },
    { regex: /(\d+)\s*(h|hour|hours|hora|horas)\b/i, factor: 0 }
  ];

  for (const item of patterns) {
    const m = source.match(item.regex);
    if (!m) continue;
    const amount = Number(m[1]);
    if (!Number.isFinite(amount)) continue;
    return Math.max(0, Math.round(amount * item.factor));
  }

  return null;
}

function extractDaysSinceLastPost(row) {
  const timeEl = row.querySelector('time[datetime]');
  if (timeEl?.dateTime) {
    const dt = Date.parse(timeEl.dateTime);
    if (Number.isFinite(dt)) {
      const diffDays = Math.floor((Date.now() - dt) / (24 * 60 * 60 * 1000));
      if (diffDays >= 0) return diffDays;
    }
  }

  return parseRelativeDays(row.innerText || '');
}

function detectBioEmpty(row) {
  const bioNode = row.querySelector('[data-e2e*="bio"], [class*="bio"]');
  if (bioNode) {
    return String(bioNode.textContent || '').trim().length === 0;
  }

  const text = String(row.innerText || '').toLowerCase();
  if (text.includes('sem bio') || text.includes('no bio')) return true;
  return null;
}

function detectHasAvatar(row) {
  const img = row.querySelector('img');
  if (!img) return false;
  const src = String(img.getAttribute('src') || '').trim().toLowerCase();
  if (!src) return false;
  if (src.includes('default-avatar') || src.includes('placeholder')) return false;
  return true;
}

const PROFILE_ANCHOR_SELECTORS = [
  'a[href^="/@"]',
  'a[href*="/@"]',
  'a[href^="https://www.tiktok.com/@"]',
  'a[href^="https://m.tiktok.com/@"]'
];

function isProfileHref(href) {
  if (!href) return false;
  try {
    const url = new URL(href, window.location.origin);
    return /^\/@[a-zA-Z0-9._]+/.test(url.pathname || '');
  } catch {
    return false;
  }
}

function getProfileAnchorFromScope(scope) {
  for (const selector of PROFILE_ANCHOR_SELECTORS) {
    const anchors = Array.from(scope.querySelectorAll(selector));
    const hit = anchors.find((a) => isProfileHref(a.getAttribute('href')));
    if (hit) return hit;
  }
  return null;
}

function collectProfileAnchors(scope) {
  const result = [];
  const seenHref = new Set();

  for (const selector of PROFILE_ANCHOR_SELECTORS) {
    const anchors = Array.from(scope.querySelectorAll(selector));
    for (const anchor of anchors) {
      const href = String(anchor.getAttribute('href') || '');
      if (!isProfileHref(href)) continue;
      if (seenHref.has(href)) continue;
      seenHref.add(href);
      result.push(anchor);
    }
  }

  return result;
}

function isVisibleElement(el) {
  if (!el || !el.isConnected) return false;
  const style = getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden') return false;
  if (Number(style.opacity) === 0) return false;

  const rect = el.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return false;
  if (rect.bottom <= 0 || rect.top >= window.innerHeight) return false;
  return true;
}

function getFollowButton(row) {
  const structural = row.querySelector(
    'button[data-e2e*="follow"], button[aria-label*="follow" i], button[aria-label*="segu" i], button[aria-pressed]'
  );
  if (structural) return structural;

  return Array.from(row.querySelectorAll('button')).find((btn) => {
    const label = String(btn.textContent || '').trim().toLowerCase();
    return label === 'following' || label === 'seguindo';
  }) || null;
}

function isLikelyRowNode(node) {
  if (!(node instanceof HTMLElement)) return false;
  if (!isVisibleElement(node)) return false;

  const anchor = getProfileAnchorFromScope(node);
  if (!anchor) return false;

  const rect = node.getBoundingClientRect();
  if (rect.height < 24 || rect.height > 360) return false;

  return !!node.querySelector('button, [role="button"]');
}

function deriveRowFromAnchor(anchor, container) {
  if (!anchor || !container || !container.contains(anchor)) return null;

  const candidates = [
    anchor.closest('[role="listitem"]'),
    anchor.closest('li'),
    anchor.closest('article'),
    anchor.closest('[data-e2e*="follow"]'),
    anchor.closest('section'),
    anchor.closest('div')
  ].filter(Boolean);

  for (const node of candidates) {
    if (!container.contains(node)) continue;
    if (isLikelyRowNode(node)) return node;
  }

  return null;
}

function addUniqueElement(list, set, element) {
  if (!element || set.has(element)) return;
  set.add(element);
  list.push(element);
}

function sortByDomOrder(elements) {
  return elements.sort((a, b) => {
    if (a === b) return 0;
    const pos = a.compareDocumentPosition(b);
    if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
    if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1;
    return 0;
  });
}

function parseUsernameFromRow(row) {
  const anchor = getProfileAnchorFromScope(row);
  const href = String(anchor?.getAttribute('href') || '');
  const match = href.match(/\/@([a-zA-Z0-9._]+)/i);
  return match ? match[1] : null;
}

function parseDisplayNameFromRow(row) {
  const anchor = getProfileAnchorFromScope(row);
  const txt = String(anchor?.textContent || '').trim();
  if (txt) return txt;
  const maybe = String(row.querySelector('strong, h3, h4')?.textContent || '').trim();
  return maybe || null;
}

function collectRowsFromContainerPrimary(container) {
  const rows = [];
  const seen = new Set();
  const semanticRows = Array.from(container.querySelectorAll('[role="listitem"], li, article'));

  for (const row of semanticRows) {
    if (!isLikelyRowNode(row)) continue;
    addUniqueElement(rows, seen, row);
  }

  return rows;
}

function collectRowsFromContainerByAnchors(container) {
  const rows = [];
  const seen = new Set();
  const anchors = collectProfileAnchors(container);

  for (const anchor of anchors) {
    const row = deriveRowFromAnchor(anchor, container);
    if (!row) continue;
    addUniqueElement(rows, seen, row);
  }

  return rows;
}

function getVisibleFollowingRows() {
  const container = findFollowingContainer();
  if (!container) return [];

  // Fallback 1 (primario): usa semantica de lista (role=listitem, li, article).
  const primaryRows = collectRowsFromContainerPrimary(container);
  if (primaryRows.length > 0) {
    return sortByDomOrder(primaryRows);
  }

  // Fallback 2: ancora de perfil (/@user) + subida estrutural para linha/cartao.
  const secondaryRows = collectRowsFromContainerByAnchors(container);
  if (secondaryRows.length > 0) {
    return sortByDomOrder(secondaryRows);
  }

  // Fallback 3: busca em escopo principal visivel quando a lista muda de hierarquia.
  const mainScope = document.querySelector('main') || document.body;
  const tertiaryRows = collectRowsFromContainerByAnchors(mainScope);
  return sortByDomOrder(tertiaryRows);
}

function findVisibleFollowingRows() {
  return getVisibleFollowingRows();
}

function findFollowingContainer() {
  const candidates = [
    // dialog modal de following em alguns layouts
    '[role="dialog"] [role="list"]',
    '[role="dialog"]',
    // lista inline no perfil em layouts alternativos
    'main [role="list"]',
    'main section[role="region"]',
    'main section',
    'main'
  ];

  for (const selector of candidates) {
    const node = document.querySelector(selector);
    if (!node || !node.isConnected) continue;

    const hasAnchors = collectProfileAnchors(node).length > 0;
    const hasSemanticList = !!node.querySelector('[role="list"], [role="listitem"], li, article');
    if (hasAnchors || hasSemanticList) {
      return node;
    }
  }

  return null;
}

function precheckFollowingContext() {
  // Ordem de validacao: dominio -> perfil -> aba seguindo -> container -> linhas visiveis.
  const host = String(window.location.hostname || '').toLowerCase();
  if (!host.endsWith('tiktok.com')) {
    return {
      ok: false,
      code: 'NOT_TIKTOK_DOMAIN',
      message: 'Abra o TikTok antes de usar a extensao.'
    };
  }

  const path = String(window.location.pathname || '').toLowerCase();
  if (!/\/@[a-z0-9._]+/.test(path)) {
    return {
      ok: false,
      code: 'NOT_PROFILE_PAGE',
      message: 'Va ate o seu perfil para analisar quem voce segue.'
    };
  }

  if (!path.includes('/following')) {
    return {
      ok: false,
      code: 'NOT_FOLLOWING_TAB',
      message: "No seu perfil, clique na aba 'Seguindo'."
    };
  }

  const container = findFollowingContainer();
  if (!container) {
    return {
      ok: false,
      code: 'FOLLOWING_LIST_NOT_READY',
      message: 'A lista de Seguindo ainda nao carregou. Aguarde alguns segundos.'
    };
  }

  const rows = findVisibleFollowingRows();
  if (!rows.length) {
    return {
      ok: false,
      code: 'NO_VISIBLE_ROWS',
      message: "Role a lista de 'Seguindo' para carregar perfis antes de analisar."
    };
  }

  return { ok: true };
}

function extractSignalsFromRow(row) {
  const text = String(row.innerText || '');
  return {
    daysSinceLastPost: extractDaysSinceLastPost(row),
    posts: extractMetricByKeywords(text, ['posts', 'videos', 'publicacoes']),
    followers: extractMetricByKeywords(text, ['followers', 'seguidores']),
    following: extractMetricByKeywords(text, ['following', 'seguindo']),
    likes: extractMetricByKeywords(text, ['likes', 'curtidas']),
    bioEmpty: detectBioEmpty(row),
    hasAvatar: detectHasAvatar(row)
  };
}

async function analyzeVisibleFollowing(payload) {
  const context = precheckFollowingContext();
  if (!context.ok) {
    return context;
  }

  const weights = normalizeScoreWeights(payload?.weights);
  const rows = findVisibleFollowingRows();

  if (rows.length === 0) {
    throw new Error('Nenhuma linha visivel de seguindo encontrada. Abra a lista de Seguindo antes de analisar.');
  }

  const profiles = [];
  const seenUsers = new Set();

  for (const row of rows) {
    const username = parseUsernameFromRow(row);
    if (!username || seenUsers.has(username)) continue;
    seenUsers.add(username);

    const signals = extractSignalsFromRow(row);
    const scoreData = calculateInactivityScore(signals, weights);

    profiles.push({
      username,
      displayName: parseDisplayNameFromRow(row),
      ...signals,
      ...scoreData
    });
  }

  profiles.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.username.localeCompare(b.username);
  });

  return {
    ok: true,
    scannedAt: new Date().toISOString(),
    totalVisibleRows: rows.length,
    totalProfiles: profiles.length,
    thresholds: CLASSIFICATION_THRESHOLDS,
    weights,
    profiles
  };
}

async function unfollowSelectedVisible(payload) {
  const context = precheckFollowingContext();
  if (!context.ok) {
    return context;
  }

  const usernames = Array.isArray(payload?.usernames)
    ? payload.usernames.map((u) => String(u || '').trim()).filter(Boolean)
    : [];

  if (usernames.length === 0) {
    throw new Error('Nenhum usuario selecionado para unfollow.');
  }

  if (String(payload?.confirmationText || '').trim().toUpperCase() !== REQUIRED_UNFOLLOW_CONFIRMATION) {
    throw new Error('Confirmacao invalida.');
  }

  const delayMs = clampNumber(payload?.delayMs, 1200, 700, 10000);
  const rows = findVisibleFollowingRows();
  const rowByUsername = new Map();
  for (const row of rows) {
    const username = parseUsernameFromRow(row);
    if (!username || rowByUsername.has(username)) continue;
    rowByUsername.set(username, row);
  }

  const result = {
    ok: true,
    attempted: usernames.length,
    unfollowed: 0,
    skippedNotVisible: 0,
    skippedNoButton: 0,
    errors: [],
    processedUsernames: []
  };

  for (const username of usernames) {
    const row = rowByUsername.get(username);
    if (!row) {
      result.skippedNotVisible++;
      continue;
    }

    const button = getFollowButton(row);
    if (!button) {
      result.skippedNoButton++;
      continue;
    }

    try {
      button.click();
      result.unfollowed++;
      result.processedUsernames.push(username);
      const jitter = Math.floor(Math.random() * 500);
      await sleep(delayMs + jitter);
    } catch (e) {
      result.errors.push(`Falha @${username}: ${String(e?.message || e)}`);
    }
  }

  return result;
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg?.type) return;

  (async () => {
    if (msg.type === 'PING') {
      sendResponse({ ok: true, pong: true });
      return;
    }

    if (msg.type === 'PRECHECK') {
      const data = precheckFollowingContext();
      sendResponse(data);
      return;
    }

    if (msg.type === 'ANALYZE_VISIBLE_FOLLOWING') {
      const data = await analyzeVisibleFollowing(msg.payload || {});
      sendResponse(data);
      return;
    }

    if (msg.type === 'UNFOLLOW_SELECTED_VISIBLE') {
      const data = await unfollowSelectedVisible(msg.payload || {});
      sendResponse(data);
      return;
    }

    sendResponse({ ok: false, error: 'Mensagem nao suportada.' });
  })().catch((e) => {
    sendResponse({ ok: false, error: String(e?.message || e) });
  });

  return true;
});

globalThis.__TT_ANALYZER_CONTENT_READY__ = true;
