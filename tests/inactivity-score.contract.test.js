const test = require('node:test');
const assert = require('node:assert/strict');

const {
  DEFAULT_WEIGHTS,
  CLASSIFICATION_THRESHOLDS,
  normalizeWeights,
  calculateInactivityScore
} = require('../inactivity-score.js');

const { fixtures } = require('./fixtures/inactivity-score-fixtures.js');

test('contract: pesos padrao permanecem inalterados', () => {
  assert.deepEqual(DEFAULT_WEIGHTS, {
    noPosts180: 50,
    noPosts90: 30,
    followersZero: 10,
    likesZero: 10,
    bioEmpty: 5,
    noAvatar: 10
  });

  assert.deepEqual(CLASSIFICATION_THRESHOLDS, {
    likelyInactive: 60,
    lowActivity: 30
  });
});

for (const fixture of fixtures) {
  test(`contract: ${fixture.id}`, () => {
    assert.equal(typeof fixture.html, 'string');
    assert.ok(fixture.html.includes('/@'));

    const output = calculateInactivityScore(fixture.signals);

    assert.equal(output.score, fixture.expected.score, fixture.description);
    assert.equal(output.classification, fixture.expected.classification, fixture.description);
    assert.equal(output.reasons.length, fixture.expected.reasonsCount, fixture.description);
  });
}

test('contract: sinais ausentes nao penalizam', () => {
  const output = calculateInactivityScore({
    daysSinceLastPost: undefined,
    followers: undefined,
    likes: undefined,
    bioEmpty: undefined,
    hasAvatar: undefined
  });

  assert.equal(output.score, 0);
  assert.equal(output.classification, 'Ativo');
  assert.deepEqual(output.reasons, []);
});

test('contract: normalizacao de pesos e deterministica', () => {
  const normalized = normalizeWeights({
    noPosts180: 500,
    noPosts90: -10,
    followersZero: '12',
    likesZero: null,
    bioEmpty: 1.8,
    noAvatar: 'not-a-number'
  });

  assert.deepEqual(normalized, {
    noPosts180: 200,
    noPosts90: 0,
    followersZero: 12,
    likesZero: 0,
    bioEmpty: 1.8,
    noAvatar: 10
  });

  const signals = {
    daysSinceLastPost: 200,
    followers: 0,
    likes: 0,
    bioEmpty: true,
    hasAvatar: false
  };

  const a = calculateInactivityScore(signals, normalized);
  const b = calculateInactivityScore(signals, normalized);

  assert.deepEqual(a, b);
});
