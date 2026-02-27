(function initInactivityScore(globalObj) {
  const DEFAULT_WEIGHTS = Object.freeze({
    noPosts180: 50,
    noPosts90: 30,
    followersZero: 10,
    likesZero: 10,
    bioEmpty: 5,
    noAvatar: 10
  });

  const CLASSIFICATION_THRESHOLDS = Object.freeze({
    likelyInactive: 60,
    lowActivity: 30
  });

  function clampNumber(value, fallback, min, max) {
    let n = Number(value);
    if (!Number.isFinite(n)) n = fallback;
    if (Number.isFinite(min)) n = Math.max(min, n);
    if (Number.isFinite(max)) n = Math.min(max, n);
    return n;
  }

  function normalizeWeights(input) {
    const src = input || {};
    return {
      noPosts180: clampNumber(src.noPosts180, DEFAULT_WEIGHTS.noPosts180, 0, 200),
      noPosts90: clampNumber(src.noPosts90, DEFAULT_WEIGHTS.noPosts90, 0, 200),
      followersZero: clampNumber(src.followersZero, DEFAULT_WEIGHTS.followersZero, 0, 200),
      likesZero: clampNumber(src.likesZero, DEFAULT_WEIGHTS.likesZero, 0, 200),
      bioEmpty: clampNumber(src.bioEmpty, DEFAULT_WEIGHTS.bioEmpty, 0, 200),
      noAvatar: clampNumber(src.noAvatar, DEFAULT_WEIGHTS.noAvatar, 0, 200)
    };
  }

  function classifyScore(score, thresholds = CLASSIFICATION_THRESHOLDS) {
    if (score >= thresholds.likelyInactive) return 'Provavelmente inativo';
    if (score >= thresholds.lowActivity) return 'Baixa atividade';
    return 'Ativo';
  }

  function calculateInactivityScore(signals, inputWeights) {
    const safeSignals = signals || {};
    const weights = normalizeWeights(inputWeights);
    let score = 0;
    const reasons = [];

    if (safeSignals.daysSinceLastPost !== null && safeSignals.daysSinceLastPost !== undefined && safeSignals.daysSinceLastPost > 180) {
      score += weights.noPosts180;
      reasons.push(`Sem post ha mais de 180 dias (+${weights.noPosts180})`);
    } else if (safeSignals.daysSinceLastPost !== null && safeSignals.daysSinceLastPost !== undefined && safeSignals.daysSinceLastPost > 90) {
      score += weights.noPosts90;
      reasons.push(`Sem post ha mais de 90 dias (+${weights.noPosts90})`);
    }

    if (safeSignals.followers === 0) {
      score += weights.followersZero;
      reasons.push(`Seguidores = 0 (+${weights.followersZero})`);
    }

    if (safeSignals.likes === 0) {
      score += weights.likesZero;
      reasons.push(`Curtidas = 0 (+${weights.likesZero})`);
    }

    if (safeSignals.bioEmpty === true) {
      score += weights.bioEmpty;
      reasons.push(`Bio vazia (+${weights.bioEmpty})`);
    }

    if (safeSignals.hasAvatar === false) {
      score += weights.noAvatar;
      reasons.push(`Sem avatar (+${weights.noAvatar})`);
    }

    return {
      score,
      classification: classifyScore(score),
      reasons
    };
  }

  const api = {
    DEFAULT_WEIGHTS,
    CLASSIFICATION_THRESHOLDS,
    normalizeWeights,
    calculateInactivityScore,
    classifyScore
  };

  globalObj.TikTokInactivityScore = api;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
