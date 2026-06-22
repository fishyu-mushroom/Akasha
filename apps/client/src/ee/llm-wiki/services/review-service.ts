import type {
  ResolvedReview,
  ReviewDocMeta,
  ReviewItem,
  ReviewSnapshot,
} from "../types/review.types";

export async function loadReviewSnapshot(params: {
  spaceId: string;
}): Promise<ReviewSnapshot | null> {
  const response = await fetch("/api/llm-wiki/review/load", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(params),
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }

  return normalizeReviewSnapshot(unwrapApiData(await response.json()));
}

export async function discoverReview(params: {
  spaceId: string;
  limit?: number;
}): Promise<ReviewSnapshot> {
  const response = await fetch("/api/llm-wiki/review/discover", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(params),
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }

  return normalizeReviewSnapshot(unwrapApiData(await response.json()));
}

export async function negotiateReview(params: {
  spaceId: string;
  item: ReviewItem;
  feedback: string;
}): Promise<ResolvedReview> {
  const response = await fetch("/api/llm-wiki/review/negotiate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(params),
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }

  return unwrapApiData(await response.json()) as ResolvedReview;
}

function normalizeReviewSnapshot(value: unknown): ReviewSnapshot | null {
  if (value === null) return null;
  const record = isRecord(value) ? value : {};
  const items = Array.isArray(record.items) ? record.items : [];
  const docs = Array.isArray(record.docs) ? record.docs : [];
  const resolvedReviews = Array.isArray(record.resolvedReviews)
    ? record.resolvedReviews
    : [];
  return {
    version: "2",
    items: items.filter(isRecord) as unknown as ReviewItem[],
    docs: docs
      .filter(isRecord)
      .map(
        (doc): ReviewDocMeta => ({
          id: typeof doc.id === "string" ? doc.id : "",
          title: typeof doc.title === "string" ? doc.title : "",
          sourcePageId:
            typeof doc.sourcePageId === "string" ? doc.sourcePageId : undefined,
        }),
      )
      .filter((doc) => Boolean(doc.id)),
    resolvedReviews: resolvedReviews.filter(
      isRecord,
    ) as unknown as ResolvedReview[],
    discoveredAt:
      typeof record.discoveredAt === "string" ? record.discoveredAt : "",
    updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : "",
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function unwrapApiData(value: unknown): unknown {
  if (!isRecord(value)) return value;
  return "data" in value ? value.data : value;
}

async function readErrorMessage(response: Response): Promise<string> {
  const fallback = `HTTP error ${response.status}`;
  try {
    const body = await response.json();
    if (body?.message) {
      return Array.isArray(body.message)
        ? body.message.join(", ")
        : body.message;
    }
  } catch {
    return fallback;
  }
  return fallback;
}
