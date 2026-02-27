const fixtures = [
  {
    id: 'active_profile',
    description: 'Perfil ativo com sinais positivos e sem penalidade.',
    html: '<article role="listitem"><a href="/@ativo">@ativo</a><time datetime="2026-02-20"></time></article>',
    signals: {
      daysSinceLastPost: 7,
      posts: 24,
      followers: 120,
      following: 89,
      likes: 540,
      bioEmpty: false,
      hasAvatar: true
    },
    expected: {
      score: 0,
      classification: 'Ativo',
      reasonsCount: 0
    }
  },
  {
    id: 'partially_inactive_profile',
    description: 'Sem post ha mais de 90 dias e bio vazia.',
    html: '<article role="listitem"><a href="/@parcial">@parcial</a><div data-e2e="user-bio"></div></article>',
    signals: {
      daysSinceLastPost: 120,
      posts: 4,
      followers: 42,
      following: 200,
      likes: 75,
      bioEmpty: true,
      hasAvatar: true
    },
    expected: {
      score: 35,
      classification: 'Baixa atividade',
      reasonsCount: 2
    }
  },
  {
    id: 'likely_inactive_profile',
    description: 'Perfil com todos os sinais de inatividade.',
    html: '<article role="listitem"><a href="/@inativo">@inativo</a><img src="default-avatar"/></article>',
    signals: {
      daysSinceLastPost: 220,
      posts: 0,
      followers: 0,
      following: 15,
      likes: 0,
      bioEmpty: true,
      hasAvatar: false
    },
    expected: {
      score: 85,
      classification: 'Provavelmente inativo',
      reasonsCount: 5
    }
  },
  {
    id: 'missing_signals_profile',
    description: 'Sinais ausentes nao devem adicionar penalidade.',
    html: '<article role="listitem"><a href="/@semdados">@semdados</a></article>',
    signals: {
      daysSinceLastPost: null,
      posts: null,
      followers: null,
      following: null,
      likes: null,
      bioEmpty: null,
      hasAvatar: null
    },
    expected: {
      score: 0,
      classification: 'Ativo',
      reasonsCount: 0
    }
  },
  {
    id: 'likely_inactive_threshold_boundary',
    description: 'Score exato no limite de inativo.',
    html: '<article role="listitem"><a href="/@limite">@limite</a></article>',
    signals: {
      daysSinceLastPost: 200,
      posts: 2,
      followers: 0,
      following: 100,
      likes: 12,
      bioEmpty: false,
      hasAvatar: true
    },
    expected: {
      score: 60,
      classification: 'Provavelmente inativo',
      reasonsCount: 2
    }
  }
];

module.exports = {
  fixtures
};
