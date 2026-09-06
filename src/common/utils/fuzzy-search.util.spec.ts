import { buildFuzzyLikePatterns } from './fuzzy-search.util';

describe('buildFuzzyLikePatterns', () => {
  it('builds subsequence patterns for multiple keywords', () => {
    expect(buildFuzzyLikePatterns('北大 计算机')).toEqual(['%北%大%', '%计%算%机%']);
  });

  it('normalizes case, full-width characters and punctuation', () => {
    expect(buildFuzzyLikePatterns('Ａ-B')).toEqual(['%a%b%']);
  });

  it('ignores separator-only input', () => {
    expect(buildFuzzyLikePatterns(' - /，')).toEqual([]);
  });
});
