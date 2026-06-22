export type ReviewType =
  | "missing-page"
  | "suggestion"
  | "contradiction"
  | "duplicate";

interface ReviewItemBase {
  id: string;
  title: string;
  detail: string;
  recommendation: string;
  relatedDocIds: string[];
  searchQueries: string[];
}

export interface MissingPageReviewItem extends ReviewItemBase {
  type: "missing-page";
  outline: string[];
}

export interface SuggestionReviewItem extends ReviewItemBase {
  type: "suggestion";
  targetDocId: string | null;
}

export interface ContradictionReviewItem extends ReviewItemBase {
  type: "contradiction";
}

export interface DuplicateReviewItem extends ReviewItemBase {
  type: "duplicate";
  suggestedPrimaryId: string | null;
}

export type ReviewItem =
  | MissingPageReviewItem
  | SuggestionReviewItem
  | ContradictionReviewItem
  | DuplicateReviewItem;

export interface ReviewDocMeta {
  id: string;
  title: string;
  sourcePageId?: string;
}

export interface ReviewSnapshot {
  version: "2";
  items: ReviewItem[];
  docs: ReviewDocMeta[];
  resolvedReviews: ResolvedReview[];
  discoveredAt: string;
  updatedAt: string;
}

export type DraftApproach =
  | "new-page"
  | "section"
  | "rewrite"
  | "clarify"
  | "merge";

export interface DraftContent {
  title: string;
  body: string;
  approach: DraftApproach;
  targetDocId: string | null;
  notes: string;
}

export interface AppliedReviewResult {
  pageId: string;
  pageTitle: string;
  pageSlugId: string;
  spaceSlug: string | null;
  action: "created" | "updated";
}

export interface SearchResult {
  query: string;
  title: string;
  url: string;
  snippet: string;
}

export interface ResolvedReview {
  item: ReviewItem;
  feedback: string;
  skipped: boolean;
  deepSearched: boolean;
  searchResults: SearchResult[];
  draft: DraftContent | null;
  applied: AppliedReviewResult | null;
}
