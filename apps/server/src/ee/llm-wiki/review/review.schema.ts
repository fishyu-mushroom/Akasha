import { z } from 'zod';

export const reviewTypeSchema = z.enum([
  'missing-page',
  'suggestion',
  'contradiction',
  'duplicate',
]);
export type ReviewType = z.infer<typeof reviewTypeSchema>;

const reviewBaseFields = {
  id: z.string(),
  title: z.string(),
  detail: z.string(),
  recommendation: z.string(),
};

export const missingPageReviewSchema = z.object({
  ...reviewBaseFields,
  type: z.literal('missing-page'),
  relatedDocIds: z.array(z.string()).default([]),
  searchQueries: z.array(z.string()).default([]),
  outline: z.array(z.string()).default([]),
});

export const suggestionReviewSchema = z.object({
  ...reviewBaseFields,
  type: z.literal('suggestion'),
  relatedDocIds: z.array(z.string()).default([]),
  searchQueries: z.array(z.string()).default([]),
  targetDocId: z.string().nullable().default(null),
});

export const contradictionReviewSchema = z.object({
  ...reviewBaseFields,
  type: z.literal('contradiction'),
  relatedDocIds: z.array(z.string()).default([]),
  searchQueries: z.array(z.string()).default([]),
});

export const duplicateReviewSchema = z.object({
  ...reviewBaseFields,
  type: z.literal('duplicate'),
  relatedDocIds: z.array(z.string()).default([]),
  suggestedPrimaryId: z.string().nullable().default(null),
  searchQueries: z.array(z.string()).default([]),
});

export const reviewItemSchema = z.discriminatedUnion('type', [
  missingPageReviewSchema,
  suggestionReviewSchema,
  contradictionReviewSchema,
  duplicateReviewSchema,
]);
export type ReviewItem = z.infer<typeof reviewItemSchema>;

export const reviewResultSchema = z.object({
  version: z.literal('2').default('2'),
  items: z.array(reviewItemSchema).default([]),
});
export type ReviewResult = z.infer<typeof reviewResultSchema>;

export const reviewDocMetaSchema = z.object({
  id: z.string(),
  title: z.string(),
  sourcePageId: z.string().optional(),
});
export type ReviewDocMeta = z.infer<typeof reviewDocMetaSchema>;

export const QUICK_ACTIONS = ['DeepSearch', '采纳', '暂时跳过'] as const;
export type QuickAction = (typeof QUICK_ACTIONS)[number];

export const draftApproachSchema = z.enum([
  'new-page',
  'section',
  'rewrite',
  'clarify',
  'merge',
]);
export type DraftApproach = z.infer<typeof draftApproachSchema>;

export const draftContentSchema = z.object({
  title: z.string(),
  body: z.string(),
  approach: draftApproachSchema,
  targetDocId: z.string().nullable().default(null),
  notes: z.string().default(''),
});
export type DraftContent = z.infer<typeof draftContentSchema>;

export const appliedReviewResultSchema = z.object({
  pageId: z.string(),
  pageTitle: z.string(),
  pageSlugId: z.string(),
  spaceSlug: z.string().nullable().default(null),
  action: z.enum(['created', 'updated']),
});
export type AppliedReviewResult = z.infer<typeof appliedReviewResultSchema>;

export const searchResultSchema = z.object({
  query: z.string(),
  title: z.string(),
  url: z.string(),
  snippet: z.string(),
});
export type ReviewSearchResult = z.infer<typeof searchResultSchema>;

export const resolvedReviewSchema = z.object({
  item: reviewItemSchema,
  feedback: z.string(),
  skipped: z.boolean(),
  deepSearched: z.boolean(),
  searchResults: z.array(searchResultSchema).default([]),
  draft: draftContentSchema.nullable().default(null),
  applied: appliedReviewResultSchema.nullable().default(null),
});
export type StoredResolvedReview = z.infer<typeof resolvedReviewSchema>;

export const reviewSnapshotSchema = z.object({
  version: z.literal('2').default('2'),
  items: z.array(reviewItemSchema).default([]),
  docs: z.array(reviewDocMetaSchema).default([]),
  resolvedReviews: z.array(resolvedReviewSchema).default([]),
  discoveredAt: z.string(),
  updatedAt: z.string(),
});
export type ReviewSnapshot = z.infer<typeof reviewSnapshotSchema>;
