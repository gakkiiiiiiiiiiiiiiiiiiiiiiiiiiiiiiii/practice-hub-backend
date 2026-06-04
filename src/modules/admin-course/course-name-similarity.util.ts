export type CourseNameMatchType = 'exact' | 'similar';

export const DEFAULT_COURSE_SIMILARITY_THRESHOLD = 0.82;
export const MIN_COURSE_SIMILARITY_THRESHOLD = 0.5;
export const MAX_COURSE_SIMILARITY_THRESHOLD = 0.99;

export interface CourseSimilarityOptions {
  threshold?: number;
}

export function normalizeSimilarityThreshold(raw: unknown): number {
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    return DEFAULT_COURSE_SIMILARITY_THRESHOLD;
  }
  const rounded = Math.round(value * 100) / 100;
  return Math.min(MAX_COURSE_SIMILARITY_THRESHOLD, Math.max(MIN_COURSE_SIMILARITY_THRESHOLD, rounded));
}

export interface CourseNameSimilarityItem {
  id: number;
  name: string;
}

export interface SimilarCourseGroupResult {
  groupId: string;
  matchType: CourseNameMatchType;
  representativeName: string;
  normalizedKey: string;
  courseIds: number[];
}

/** 规范化课程名：去空白、标点，英文转小写 */
export function normalizeCourseName(name: string): string {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/[\s\u3000]+/g, '')
    .replace(/[（）()[\]【】「」『』《》〈〉、，,。．.·•\-—_]/g, '')
    .replace(/[\uff01-\uff5e]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0));
}

/** 去掉年份等可变片段，用于识别「同年份不同」的类似名 */
export function stripYearVariant(normalized: string): string {
  return normalized.replace(/\d{4}年?/g, '').replace(/20\d{2}/g, '');
}

function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  const rows = a.length + 1;
  const cols = b.length + 1;
  const matrix: number[][] = Array.from({ length: rows }, () => Array(cols).fill(0));

  for (let i = 0; i < rows; i += 1) matrix[i][0] = i;
  for (let j = 0; j < cols; j += 1) matrix[0][j] = j;

  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost,
      );
    }
  }

  return matrix[rows - 1][cols - 1];
}

function similarityRatio(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshteinDistance(a, b) / maxLen;
}

export function getCourseNameMatchType(
  nameA: string,
  nameB: string,
  options?: CourseSimilarityOptions,
): CourseNameMatchType | null {
  const threshold = normalizeSimilarityThreshold(options?.threshold);
  const normalizedA = normalizeCourseName(nameA);
  const normalizedB = normalizeCourseName(nameB);
  if (!normalizedA || !normalizedB) return null;
  if (normalizedA === normalizedB) return 'exact';

  const coreA = stripYearVariant(normalizedA);
  const coreB = stripYearVariant(normalizedB);
  if (coreA && coreB && coreA === coreB) return 'similar';

  const minLen = Math.min(normalizedA.length, normalizedB.length);
  const maxLen = Math.max(normalizedA.length, normalizedB.length);
  if (minLen >= 3 && (normalizedA.includes(normalizedB) || normalizedB.includes(normalizedA))) {
    return 'similar';
  }
  if (maxLen >= 4 && similarityRatio(normalizedA, normalizedB) >= threshold) {
    return 'similar';
  }
  return null;
}

class UnionFind {
  private readonly parent: number[];

  constructor(size: number) {
    this.parent = Array.from({ length: size }, (_, index) => index);
  }

  find(index: number): number {
    if (this.parent[index] !== index) {
      this.parent[index] = this.find(this.parent[index]);
    }
    return this.parent[index];
  }

  union(a: number, b: number) {
    const rootA = this.find(a);
    const rootB = this.find(b);
    if (rootA !== rootB) {
      this.parent[rootB] = rootA;
    }
  }
}

/**
 * 将同名或名称相近的课程聚合成组（每组至少 2 门课）
 */
export function buildSimilarCourseGroups(
  courses: CourseNameSimilarityItem[],
  options?: CourseSimilarityOptions,
): SimilarCourseGroupResult[] {
  if (!Array.isArray(courses) || courses.length < 2) {
    return [];
  }

  const unionFind = new UnionFind(courses.length);
  for (let i = 0; i < courses.length; i += 1) {
    for (let j = i + 1; j < courses.length; j += 1) {
      if (getCourseNameMatchType(courses[i].name, courses[j].name, options)) {
        unionFind.union(i, j);
      }
    }
  }

  const clusterMap = new Map<number, number[]>();
  courses.forEach((course, index) => {
    const root = unionFind.find(index);
    const bucket = clusterMap.get(root) || [];
    bucket.push(index);
    clusterMap.set(root, bucket);
  });

  const groups: SimilarCourseGroupResult[] = [];
  let groupIndex = 0;

  clusterMap.forEach((indexes) => {
    if (indexes.length < 2) return;

    const normalizedKeys = indexes.map((idx) => normalizeCourseName(courses[idx].name));
    const allExact = normalizedKeys.every((key) => key === normalizedKeys[0]);
    const representativeName = courses[indexes[0]].name;
    const normalizedKey = normalizedKeys[0] || '';
    groupIndex += 1;

    groups.push({
      groupId: `similar_${groupIndex}`,
      matchType: allExact ? 'exact' : 'similar',
      representativeName,
      normalizedKey,
      courseIds: indexes.map((idx) => courses[idx].id),
    });
  });

  return groups.sort((a, b) => b.courseIds.length - a.courseIds.length || a.representativeName.localeCompare(b.representativeName, 'zh-CN'));
}

export function collectSimilarCourseIds(groups: SimilarCourseGroupResult[]): number[] {
  const ids = new Set<number>();
  groups.forEach((group) => {
    group.courseIds.forEach((id) => ids.add(id));
  });
  return [...ids];
}
