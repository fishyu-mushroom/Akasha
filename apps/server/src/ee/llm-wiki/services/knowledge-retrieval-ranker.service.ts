import { Injectable } from '@nestjs/common';
import { KnowledgeChunk } from '@docmost/db/types/entity.types';

type RankableChunk = {
  chunk: KnowledgeChunk;
  vector: number[];
  baseScore: number;
};

type RankedChunk = {
  chunk: KnowledgeChunk;
  score: number;
};

const BASE_SCORE_WEIGHT = 0.5;
const BM25_K1 = 1.5;
const BM25_B = 0.75;

@Injectable()
export class KnowledgeRetrievalRankerService {
  rankChunks(input: {
    query: string;
    queryEmbedding: number[];
    chunks: KnowledgeChunk[];
    limit: number;
  }): KnowledgeChunk[] {
    return rankAllChunks(input).slice(0, input.limit);
  }

  rankPageIds(input: {
    query: string;
    queryEmbedding: number[];
    chunks: KnowledgeChunk[];
    limit: number;
  }): string[] {
    const ranked = rankAllChunks(input);
    const pageIds: string[] = [];
    const seen = new Set<string>();

    for (const chunk of ranked) {
      const pageId = chunk.knowledgePageId;
      if (seen.has(pageId)) continue;
      seen.add(pageId);
      pageIds.push(pageId);
      if (pageIds.length >= input.limit) break;
    }

    return pageIds;
  }
}

function rankAllChunks(input: {
  query: string;
  queryEmbedding: number[];
  chunks: KnowledgeChunk[];
}): KnowledgeChunk[] {
  const candidates = input.chunks.flatMap((chunk) => {
    const vector = parseEmbeddingVector(chunk.embedding);
    if (!vector || vector.length !== input.queryEmbedding.length) return [];
    return [
      {
        chunk,
        vector,
        baseScore: cosineSimilarity(input.queryEmbedding, vector),
      },
    ];
  });

  return rerankWithBm25(input.query, candidates)
    .map((item) => item.chunk);
}

function parseEmbeddingVector(value: unknown): number[] | undefined {
  if (!Array.isArray(value)) return undefined;
  if (!value.every((item) => typeof item === 'number' && Number.isFinite(item))) {
    return undefined;
  }
  return value;
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;

  let dot = 0;
  let magA = 0;
  let magB = 0;

  for (let index = 0; index < a.length; index++) {
    dot += a[index] * b[index];
    magA += a[index] * a[index];
    magB += b[index] * b[index];
  }

  if (magA === 0 || magB === 0) return 0;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

function rerankWithBm25(query: string, candidates: RankableChunk[]): RankedChunk[] {
  if (candidates.length === 0) return [];
  const queryTerms = tokenize(query);

  if (queryTerms.length === 0) {
    return candidates
      .map((candidate) => ({
        chunk: candidate.chunk,
        score: candidate.baseScore,
      }))
      .sort((left, right) => right.score - left.score);
  }

  const docs = candidates.map((candidate) => tokenize(candidate.chunk.text));
  const stats = buildCorpusStats(docs);

  return candidates
    .map((candidate, index) => ({
      chunk: candidate.chunk,
      score:
        bm25Score(queryTerms, docs[index], stats) +
        candidate.baseScore * BASE_SCORE_WEIGHT,
    }))
    .sort((left, right) => right.score - left.score);
}

function tokenize(text: string): string[] {
  const normalized = text.toLowerCase();
  const latinTerms = normalized.match(/[a-z0-9]+/g) ?? [];
  const hanChars = normalized.match(/\p{Script=Han}/gu) ?? [];
  const hanBigrams = hanChars.slice(0, -1).map((char, index) => {
    return `${char}${hanChars[index + 1]}`;
  });

  return [...latinTerms, ...hanChars, ...hanBigrams];
}

type CorpusStats = {
  docFreq: Map<string, number>;
  avgDocLen: number;
  totalDocs: number;
};

function buildCorpusStats(docs: string[][]): CorpusStats {
  const docFreq = new Map<string, number>();
  let totalLen = 0;

  for (const tokens of docs) {
    totalLen += tokens.length;
    for (const term of new Set(tokens)) {
      docFreq.set(term, (docFreq.get(term) ?? 0) + 1);
    }
  }

  return {
    docFreq,
    avgDocLen: docs.length > 0 ? totalLen / docs.length : 0,
    totalDocs: docs.length,
  };
}

function bm25Score(
  queryTerms: string[],
  docTokens: string[],
  stats: CorpusStats,
): number {
  if (docTokens.length === 0 || stats.totalDocs === 0) return 0;

  const termFreq = countTerms(docTokens);
  const lengthRatio = docTokens.length / (stats.avgDocLen || 1);
  let total = 0;

  for (const term of queryTerms) {
    const tf = termFreq.get(term) ?? 0;
    if (tf === 0) continue;

    const idf = idfWeight(stats.docFreq.get(term) ?? 0, stats.totalDocs);
    const numerator = tf * (BM25_K1 + 1);
    const denominator = tf + BM25_K1 * (1 - BM25_B + BM25_B * lengthRatio);
    total += idf * (numerator / denominator);
  }

  return total;
}

function idfWeight(docFrequency: number, totalDocs: number): number {
  return Math.log(1 + (totalDocs - docFrequency + 0.5) / (docFrequency + 0.5));
}

function countTerms(tokens: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const token of tokens) {
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }
  return counts;
}
