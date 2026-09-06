const SEARCH_SEPARATOR_PATTERN = /[\s·•・—_\-，,。.!！?？、/\\（）()《》【】\[\]:：;；'"“”‘’%]+/g;

const normalizeSearchText = (value: unknown) => {
  let text = String(value || '').trim().toLowerCase();
  if (typeof text.normalize === 'function') {
    text = text.normalize('NFKC');
  }
  return text;
};

const compactSearchText = (value: unknown) => normalizeSearchText(value).replace(SEARCH_SEPARATOR_PATTERN, '');

/**
 * 将用户输入转换为 SQL LIKE 子序列模式。
 * 例如“计网”转换为“%计%网%”，可匹配“计算机网络”。
 */
export const buildFuzzyLikePatterns = (value: unknown): string[] => {
  return normalizeSearchText(value)
    .split(/\s+/)
    .map(compactSearchText)
    .filter(Boolean)
    .map((keyword) => `%${Array.from(keyword).join('%')}%`);
};
