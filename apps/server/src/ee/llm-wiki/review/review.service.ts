import { Injectable } from '@nestjs/common';
import { generateText, LanguageModel } from 'ai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { EnvironmentService } from '../../../integrations/environment/environment.service';
import { SearchProvider, SearchResult } from './search-provider';
import {
  DraftContent,
  draftContentSchema,
  ReviewItem,
  ReviewResult,
  reviewResultSchema,
  StoredResolvedReview,
} from './review.schema';
import { StructuredWiki, WikiDocument } from './structured-wiki';
import { WikiSource } from './wiki-source';

export const REVIEW_SYSTEM_PROMPT = [
  'You are a meticulous knowledge-base reviewer for a personal/team wiki.',
  'The wiki pages already exist. Your job is NOT to rewrite pages now — only to',
  'surface high-value review items, each with a concrete RECOMMENDATION.',
  'Do not output chain-of-thought, hidden reasoning, or explanatory preamble.',
  '',
  'For every item provide:',
  '- detail: what you found and the evidence (report).',
  '- recommendation: what to do and why (your opinion, be specific and actionable).',
  '',
  'Use exactly one of these types, and fill its type-specific fields:',
  '- missing-page: an important entity/concept is referenced but lacks a dedicated page.',
  '    fields: relatedDocIds (where it is referenced), searchQueries (2-3), outline (suggested section headings).',
  '- suggestion: a research question / comparison / source gap that would materially improve an existing page.',
  '    fields: relatedDocIds, searchQueries (2-3), targetDocId (which existing doc to enrich, or null if unsure).',
  '- contradiction: two or more docs conflict and need human judgement.',
  '    fields: relatedDocIds (>=2), searchQueries (2-3 to find authoritative evidence on who is right).',
  '    detail MUST pin down the precise point of disagreement; recommendation MUST state which side to trust (or how to reconcile) and why.',
  '- duplicate: two or more docs are highly redundant.',
  '    fields: relatedDocIds (>=2), suggestedPrimaryId (which doc to keep as primary, or null if unsure), searchQueries (2-3 to find an authoritative overview for the merged page).',
  '',
  'ALWAYS fill searchQueries with 2-3 keyword-rich web queries for every item — they seed an optional DeepSearch step.',
  'Prefer 1-5 high-signal items. If there is nothing worth reviewing, return an empty list.',
  'Use the [id=...] values from the input as document ids.',
  'When you mention an existing document inside title/detail/recommendation, ALWAYS use the exact token format [id=<doc-id>].',
  'Never output a bare UUID like "文档 70147931-..." or "70147931-...".',
  'Respond in the same language as the wiki content.',
  // Some OpenAI-compatible gateways require the word "JSON" in the prompt.
  'Output the result strictly as a JSON object conforming to the provided schema.',
].join('\n');

const REVIEW_OUTPUT_SHAPE = [
  'Return ONLY a JSON object (no markdown fences, no prose) with this exact shape:',
  '{',
  '  "version": "2",',
  '  "items": [',
  '    { "id": "rev-1", "type": "missing-page", "title": ..., "detail": ..., "recommendation": ...,',
  '      "relatedDocIds": [string], "searchQueries": [string], "outline": [string] },',
  '    { "id": ..., "type": "suggestion", "title": ..., "detail": ..., "recommendation": ...,',
  '      "relatedDocIds": [string], "searchQueries": [string], "targetDocId": string|null },',
  '    { "id": ..., "type": "contradiction", "title": ..., "detail": ..., "recommendation": ...,',
  '      "relatedDocIds": [string], "searchQueries": [string] },',
  '    { "id": ..., "type": "duplicate", "title": ..., "detail": ..., "recommendation": ...,',
  '      "relatedDocIds": [string], "suggestedPrimaryId": string|null, "searchQueries": [string] }',
  '  ]',
  '}',
].join('\n');

export const NEGOTIATION_SYSTEM_PROMPT = [
  'You are producing finished, ready-to-store wiki content after a short negotiation.',
  'You are given: one review item (with your earlier recommendation), the relevant',
  'existing document bodies, optional web search findings, and the user feedback.',
  'Interpret the user feedback as follows:',
  '- "采纳" (accept) or "DeepSearch": the user ENDORSES your earlier recommendation — produce content along those lines. ("DeepSearch" also means web findings are provided below; weave them in.)',
  '- anything else is free-text intent: follow it, and let it OVERRIDE your earlier recommendation wherever they conflict.',
  'If web search findings are present, prefer those facts over guesses.',
  '',
  'Produce ONE finished markdown artifact. Pick the right "approach" for the type:',
  '- missing-page  → approach "new-page":  a complete new page; targetDocId = null.',
  '- suggestion    → approach "section":   the improved/added section to merge into the target page; targetDocId = the page it belongs to.',
  '- contradiction → approach "rewrite":   if the user keeps one page, output the corrected version of THAT page (absorb the valid parts of the other, drop stale claims); targetDocId = the kept page.',
  '                  approach "clarify":   if the user wants a clarification page, output a NEW page explaining the disagreement and when each side applies; targetDocId = null.',
  '- duplicate     → approach "merge":     a single merged page (fuse both, dedupe, keep the best parts); targetDocId = the primary page to keep.',
  '',
  'The "body" must be clean wiki-ready markdown (real content, not a description of content).',
  'Put a short note about your tradeoffs in "notes", NOT in the body.',
  'Respond in the same language as the wiki content.',
  // Some OpenAI-compatible gateways require the word "JSON" in the prompt.
  'Output the result strictly as a JSON object conforming to the provided schema.',
].join('\n');

const DRAFT_OUTPUT_SHAPE = [
  'Return ONLY a JSON object (no markdown fences, no prose) with this exact shape:',
  '{',
  '  "title": string,',
  '  "body": string,',
  '  "approach": "new-page"|"section"|"rewrite"|"clarify"|"merge",',
  '  "targetDocId": string|null,',
  '  "notes": string',
  '}',
].join('\n');

@Injectable()
export class ReviewService {
  constructor(private readonly environmentService: EnvironmentService) {}

  private createModel(): LanguageModel {
    const provider = createOpenAICompatible({
      name: 'akasha-review',
      apiKey: this.environmentService.getOpenAiApiKey(),
      baseURL: this.environmentService.getOpenAiApiUrl(),
    });
    return provider.chatModel(this.environmentService.getAiChatModel());
  }

  async reviewWiki(source: WikiSource): Promise<ReviewResult> {
    const wiki = await source.load();
    const serialized = serializeWikiForReview(wiki);

    const { text } = await generateText({
      model: this.createModel(),
      system: `${REVIEW_SYSTEM_PROMPT}\n\n${REVIEW_OUTPUT_SHAPE}`,
      prompt: serialized,
    });

    const parsedJson = extractJson(text);
    const result = reviewResultSchema.parse(parsedJson);
    return normalizeReviewResultReferences(result, wiki);
  }

  async runDeepSearch(
    search: SearchProvider,
    item: ReviewItem,
  ): Promise<SearchResult[]> {
    const all: SearchResult[] = [];
    for (const q of item.searchQueries) {
      const hits = await search.search(q);
      all.push(...hits);
    }
    return all;
  }

  async negotiateDraft(
    source: WikiSource,
    item: ReviewItem,
    feedback: string,
    searchResults: SearchResult[] = [],
  ): Promise<DraftContent> {
    const relatedDocs = await gatherRelatedDocs(source, item);
    const searchBlock = serializeSearchResults(searchResults);

    const prompt = [
      '## 待处理的 review',
      serializeReviewItem(item),
      '',
      '## 相关现有文档正文',
      serializeRelatedDocs(relatedDocs),
      ...(searchBlock ? ['', searchBlock] : []),
      '',
      '## 用户反馈',
      feedback,
    ].join('\n');

    const { text } = await generateText({
      model: this.createModel(),
      system: `${NEGOTIATION_SYSTEM_PROMPT}\n\n${DRAFT_OUTPUT_SHAPE}`,
      prompt,
    });

    const parsedJson = extractJson(text);
    return draftContentSchema.parse(parsedJson);
  }
}

export function serializeWikiForReview(wiki: StructuredWiki): string {
  const folderById = new Map(wiki.folders.map((f) => [f.id, f]));
  const folderPath = (id: string | null): string => {
    const parts: string[] = [];
    let cur = id ? folderById.get(id) : undefined;
    while (cur) {
      parts.unshift(cur.name);
      cur = cur.parentId ? folderById.get(cur.parentId) : undefined;
    }
    return parts.join('/') || '(未分类)';
  };

  const lines: string[] = [];
  lines.push(`# Structured Wiki (v${wiki.version})`);
  lines.push(
    `文件夹数: ${wiki.folders.length}  文档数: ${wiki.documents.length}`,
  );
  lines.push('');

  for (const doc of wiki.documents) {
    lines.push(`## 文档 [id=${doc.id}] ${doc.title}`);
    lines.push(`分类: ${folderPath(doc.folderId)}`);
    if (doc.tags.length) lines.push(`标签: ${doc.tags.join(', ')}`);
    lines.push(`状态: ${doc.status}  可信度: ${doc.confidence}`);
    if (doc.claims.length) {
      lines.push('观点(claims):');
      for (const c of doc.claims) {
        const srcs = c.sources
          .map((s) => `${s.origin}${s.locator ? ` (${s.locator})` : ''}`)
          .join('; ');
        lines.push(
          `  - [${c.confidence}] ${c.statement}${srcs ? `  ←溯源: ${srcs}` : ''}`,
        );
      }
    }
    lines.push('正文:');
    lines.push(doc.body);
    lines.push('');
  }

  return lines.join('\n');
}

export function extractJson(text: string): unknown {
  let s = text.trim();
  const fence = s.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fence) s = fence[1].trim();
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) {
    throw new Error(`模型返回中找不到 JSON 对象。原始返回:\n${text}`);
  }
  return JSON.parse(s.slice(start, end + 1));
}

export function normalizeReviewResultReferences(
  result: ReviewResult,
  wiki: StructuredWiki,
): ReviewResult {
  return {
    ...result,
    items: normalizeReviewItemsByDocIds(
      result.items,
      wiki.documents.map((doc) => doc.id),
    ),
  };
}

export function normalizeReviewItemsByDocIds(
  items: ReviewItem[],
  docIds: Iterable<string>,
): ReviewItem[] {
  const knownDocIds = new Set(docIds);

  return items.map((item) => ({
    ...item,
    title: normalizeKnownDocIds(item.title, knownDocIds),
    detail: normalizeKnownDocIds(item.detail, knownDocIds),
    recommendation: normalizeKnownDocIds(item.recommendation, knownDocIds),
  }));
}

export function normalizeResolvedReviewsByDocIds(
  resolvedReviews: StoredResolvedReview[],
  docIds: Iterable<string>,
): StoredResolvedReview[] {
  const normalizedItems = normalizeReviewItemsByDocIds(
    resolvedReviews.map((resolved) => resolved.item),
    docIds,
  );

  return resolvedReviews.map((resolved, index) => ({
    ...resolved,
    item: normalizedItems[index],
  }));
}

function normalizeKnownDocIds(text: string, knownDocIds: Set<string>): string {
  let normalized = text;

  for (const docId of knownDocIds) {
    const escapedDocId = escapeRegExp(docId);

    normalized = normalized.replace(
      new RegExp(`\\[id=${escapedDocId}\\]`, 'g'),
      `[id=${docId}]`,
    );
    normalized = normalized.replace(
      new RegExp(`文档\\s+${escapedDocId}`, 'g'),
      `文档 [id=${docId}]`,
    );
    normalized = normalized.replace(
      new RegExp(`(?<!\\[id=)${escapedDocId}(?!\\])`, 'g'),
      `[id=${docId}]`,
    );
  }

  return normalized;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function gatherRelatedDocs(
  source: WikiSource,
  item: ReviewItem,
): Promise<WikiDocument[]> {
  const docs: WikiDocument[] = [];
  for (const id of item.relatedDocIds) {
    const doc = await source.getDocument(id);
    if (doc) docs.push(doc);
  }
  return docs;
}

function serializeReviewItem(item: ReviewItem): string {
  const lines: string[] = [];
  lines.push(`类型: ${item.type}`);
  lines.push(`标题: ${item.title}`);
  lines.push(`报告(detail): ${item.detail}`);
  lines.push(`AI 推荐(recommendation): ${item.recommendation}`);
  lines.push(`关联文档: ${item.relatedDocIds.join(', ') || '(无)'}`);
  switch (item.type) {
    case 'missing-page':
      if (item.outline.length)
        lines.push(`建议大纲: ${item.outline.join(' / ')}`);
      break;
    case 'suggestion':
      lines.push(`建议去向: ${item.targetDocId ?? '(未定)'}`);
      break;
    case 'duplicate':
      lines.push(`建议主页: ${item.suggestedPrimaryId ?? '(未定)'}`);
      break;
  }
  return lines.join('\n');
}

function serializeRelatedDocs(docs: WikiDocument[]): string {
  if (!docs.length) return '(无相关现有文档正文)';
  return docs.map((d) => `### [id=${d.id}] ${d.title}\n${d.body}`).join('\n\n');
}

function serializeSearchResults(results: SearchResult[]): string {
  if (!results.length) return '';
  const lines = results.map(
    (r) => `- (查询「${r.query}」) ${r.title}\n  ${r.url}\n  ${r.snippet}`,
  );
  return ['## DeepSearch 联网检索结果', ...lines].join('\n');
}
