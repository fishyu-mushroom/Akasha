import { Fragment, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Anchor,
  Badge,
  Button,
  Container,
  Group,
  Loader,
  Paper,
  Select,
  Stack,
  Text,
  Textarea,
  TextInput,
  Title,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { IconCheck, IconSearch, IconX } from "@tabler/icons-react";
import { Helmet } from "react-helmet-async";
import { useTranslation } from "react-i18next";
import { getAppName } from "@/lib/config";
import { useGetSpacesQuery } from "@/features/space/queries/space-query";
import useCurrentUser from "@/features/user/hooks/use-current-user";
import {
  discoverReview,
  loadReviewSnapshot,
  negotiateReview,
} from "../services/review-service";
import type {
  ResolvedReview,
  ReviewDocMeta,
  ReviewItem,
  ReviewSnapshot,
  ReviewType,
} from "../types/review.types";

const TYPE_LABEL: Record<ReviewType, string> = {
  "missing-page": "缺页",
  suggestion: "改进建议",
  contradiction: "冲突",
  duplicate: "重合",
};

const TYPE_COLOR: Record<ReviewType, string> = {
  "missing-page": "blue",
  suggestion: "teal",
  contradiction: "red",
  duplicate: "orange",
};

const FEEDBACK_DEEPSEARCH = "DeepSearch";
const FEEDBACK_ACCEPT = "采纳";
const FEEDBACK_SKIP = "暂时跳过";

type ItemState = {
  pending: boolean;
  resolved?: ResolvedReview;
  freeText: string;
};

const ARTIFACT_LIMIT = 200;

export default function ReviewPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { data: currentUser } = useCurrentUser();
  const { data: spacesData, isLoading: spacesLoading } = useGetSpacesQuery({
    limit: 100,
  });
  const spaces = spacesData?.items ?? [];
  const spaceOptions = useMemo(
    () => spaces.map((space) => ({ value: space.id, label: space.name })),
    [spaces],
  );

  const [spaceId, setSpaceId] = useState<string | null>(null);
  const [items, setItems] = useState<ReviewItem[] | null>(null);
  const [docMap, setDocMap] = useState<Record<string, ReviewDocMeta>>({});
  const [states, setStates] = useState<Record<string, ItemState>>({});

  useEffect(() => {
    if (spaceId || spaceOptions.length === 0) return;
    const email = currentUser?.user?.email?.toLowerCase();
    const personal = email
      ? spaceOptions.find((opt) => opt.label.toLowerCase().includes(email))
      : undefined;
    setSpaceId(personal?.value ?? spaceOptions[0].value);
  }, [spaceId, spaceOptions, currentUser]);

  useEffect(() => {
    setItems(null);
    setDocMap({});
    setStates({});
  }, [spaceId]);

  const snapshotQuery = useQuery({
    queryKey: ["review-snapshot", spaceId],
    queryFn: () => loadReviewSnapshot({ spaceId: spaceId! }),
    enabled: !!spaceId,
  });

  useEffect(() => {
    if (snapshotQuery.isSuccess && snapshotQuery.data) {
      applySnapshot(snapshotQuery.data, setItems, setDocMap, setStates);
    }
  }, [snapshotQuery.data, snapshotQuery.isSuccess]);

  const discoverMutation = useMutation({
    mutationFn: discoverReview,
    onSuccess: (snapshot) => {
      if (spaceId) {
        queryClient.setQueryData(["review-snapshot", spaceId], snapshot);
      }
      applySnapshot(snapshot, setItems, setDocMap, setStates);
      if (snapshot.items.length === 0) {
        notifications.show({ message: t("No review items found") });
      }
    },
    onError: (error) => {
      notifications.show({ color: "red", message: error.message });
    },
  });

  const patchState = (id: string, patch: Partial<ItemState>) => {
    setStates((prev) => ({
      ...prev,
      [id]: { pending: false, freeText: "", ...prev[id], ...patch },
    }));
  };

  const resolveItem = async (item: ReviewItem, feedback: string) => {
    if (!spaceId) return;
    patchState(item.id, { pending: true });
    try {
      const resolved = await negotiateReview({ spaceId, item, feedback });
      patchState(item.id, { pending: false, resolved });
      queryClient.setQueryData(
        ["review-snapshot", spaceId],
        (snapshot: ReviewSnapshot | null | undefined) =>
          upsertResolvedSnapshot(snapshot, resolved),
      );
    } catch (error) {
      patchState(item.id, { pending: false });
      notifications.show({
        color: "red",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const handleDiscover = () => {
    if (!spaceId) return;
    discoverMutation.mutate({ spaceId, limit: ARTIFACT_LIMIT });
  };

  const hasSnapshot = Boolean(snapshotQuery.data);
  const orderedItems = useMemo(() => {
    if (!items) return [];

    return items
      .map((item, index) => ({
        item,
        index,
        resolved: Boolean(states[item.id]?.resolved),
      }))
      .sort((left, right) => {
        if (left.resolved === right.resolved) {
          return left.index - right.index;
        }
        return left.resolved ? 1 : -1;
      });
  }, [items, states]);

  return (
    <Container size="md" py="lg">
      <Helmet>
        <title>
          {t("Review")} - {getAppName()}
        </title>
      </Helmet>

      <Stack gap="lg">
        <div>
          <Title order={2}>{t("Review")}</Title>
          <Text c="dimmed" size="sm">
            {t(
              "Let AI review the structured wiki of a space, then decide each item.",
            )}
          </Text>
        </div>

        <Group align="flex-end">
          <Select
            label={t("Space")}
            placeholder={t("Select a space")}
            data={spaceOptions}
            value={spaceId}
            onChange={setSpaceId}
            searchable
            disabled={
              spacesLoading ||
              discoverMutation.isPending ||
              snapshotQuery.isLoading
            }
            style={{ flex: 1 }}
          />
          <Button
            onClick={handleDiscover}
            loading={discoverMutation.isPending}
            disabled={!spaceId || snapshotQuery.isLoading}
          >
            {t(hasSnapshot ? "Re-review" : "Start review")}
          </Button>
        </Group>

        {snapshotQuery.isLoading && !discoverMutation.isPending && (
          <Group justify="center" py="xl">
            <Loader size="sm" />
            <Text c="dimmed">{t("Loading saved review ...")}</Text>
          </Group>
        )}

        {discoverMutation.isPending && (
          <Group justify="center" py="xl">
            <Loader size="sm" />
            <Text c="dimmed">{t("AI is reviewing the wiki ...")}</Text>
          </Group>
        )}

        {items?.length === 0 && !discoverMutation.isPending && (
          <Alert icon={<IconCheck size={18} />} color="green">
            {t("AI found nothing worth reviewing.")}
          </Alert>
        )}

        {items && items.length > 0 && (
          <Stack gap="md">
            {orderedItems.map(({ item, index }) => (
              <ReviewItemCard
                key={item.id}
                item={item}
                index={index}
                docMap={docMap}
                state={states[item.id]}
                onFreeTextChange={(v) => patchState(item.id, { freeText: v })}
                onDeepSearch={() => resolveItem(item, FEEDBACK_DEEPSEARCH)}
                onAccept={() => resolveItem(item, FEEDBACK_ACCEPT)}
                onSkip={() => resolveItem(item, FEEDBACK_SKIP)}
                onSubmitFreeText={() =>
                  resolveItem(item, states[item.id]?.freeText?.trim() || "")
                }
              />
            ))}
          </Stack>
        )}
      </Stack>
    </Container>
  );
}

function applySnapshot(
  snapshot: ReviewSnapshot,
  setItems: (items: ReviewItem[] | null) => void,
  setDocMap: (value: Record<string, ReviewDocMeta>) => void,
  setStates: (value: Record<string, ItemState>) => void,
) {
  setItems(snapshot.items);
  setDocMap(Object.fromEntries(snapshot.docs.map((doc) => [doc.id, doc])));
  setStates(buildStatesFromResolvedReviews(snapshot.resolvedReviews));
}

function buildStatesFromResolvedReviews(
  resolvedReviews: ResolvedReview[],
): Record<string, ItemState> {
  return Object.fromEntries(
    resolvedReviews.map((resolved) => [
      resolved.item.id,
      {
        pending: false,
        freeText: "",
        resolved,
      },
    ]),
  );
}

function upsertResolvedSnapshot(
  snapshot: ReviewSnapshot | null | undefined,
  resolved: ResolvedReview,
): ReviewSnapshot | null {
  if (!snapshot) return snapshot ?? null;

  const resolvedReviews = [
    ...snapshot.resolvedReviews.filter(
      (entry) => entry.item.id !== resolved.item.id,
    ),
    resolved,
  ];

  return {
    ...snapshot,
    resolvedReviews,
    updatedAt: new Date().toISOString(),
  };
}

function DocLink({
  docId,
  docMap,
  size = "xs",
}: {
  docId: string;
  docMap: Record<string, ReviewDocMeta>;
  size?: "xs" | "sm";
}) {
  const meta = docMap[docId];
  const label = meta?.title || `${docId.slice(0, 8)}…`;

  if (meta?.sourcePageId) {
    return (
      <Anchor
        href={`/p/${meta.sourcePageId}`}
        target="_blank"
        rel="noopener noreferrer"
        size={size}
      >
        {label}
      </Anchor>
    );
  }

  return (
    <Text component="span" size={size} c={meta?.title ? undefined : "dimmed"}>
      {label}
    </Text>
  );
}

function ReviewRichText({
  text,
  docMap,
}: {
  text: string;
  docMap: Record<string, ReviewDocMeta>;
}) {
  const parts = splitDocReferences(text);

  return (
    <Text size="sm" c="dimmed" style={{ whiteSpace: "pre-wrap" }}>
      {parts.map((part, index) =>
        part.type === "text" ? (
          <Fragment key={`text-${index}`}>{part.value}</Fragment>
        ) : (
          <DocLink
            key={`doc-${index}-${part.docId}`}
            docId={part.docId}
            docMap={docMap}
            size="sm"
          />
        ),
      )}
    </Text>
  );
}

function ReviewItemCard({
  item,
  index,
  docMap,
  state,
  onFreeTextChange,
  onDeepSearch,
  onAccept,
  onSkip,
  onSubmitFreeText,
}: {
  item: ReviewItem;
  index: number;
  docMap: Record<string, ReviewDocMeta>;
  state?: ItemState;
  onFreeTextChange: (value: string) => void;
  onDeepSearch: () => void;
  onAccept: () => void;
  onSkip: () => void;
  onSubmitFreeText: () => void;
}) {
  const { t } = useTranslation();
  const pending = state?.pending ?? false;
  const resolved = state?.resolved;
  const done = Boolean(resolved);

  return (
    <Paper
      withBorder
      radius="md"
      p="md"
      bg={done ? "var(--mantine-color-gray-0)" : undefined}
      style={{
        opacity: done ? 0.78 : 1,
        transition: "opacity 120ms ease",
      }}
    >
      <Stack gap="xs">
        <Group gap="xs">
          <Text fw={700}>#{index + 1}</Text>
          <Badge color={TYPE_COLOR[item.type]} variant="light">
            {TYPE_LABEL[item.type]}
          </Badge>
          {done && (
            <Badge color="gray" variant="outline">
              {t("Reviewed")}
            </Badge>
          )}
          <Text
            fw={600}
            c={done ? "dimmed" : undefined}
            td={done ? "line-through" : undefined}
          >
            {item.title}
          </Text>
        </Group>

        <div>
          <Text size="sm" fw={600}>
            {t("Report")}
          </Text>
          <ReviewRichText text={item.detail} docMap={docMap} />
        </div>
        <div>
          <Text size="sm" fw={600}>
            {t("AI recommendation")}
          </Text>
          <ReviewRichText text={item.recommendation} docMap={docMap} />
        </div>
        {item.relatedDocIds.length > 0 && (
          <Group gap={6} align="center">
            <Text size="xs" c="dimmed">
              {t("Related docs")}:
            </Text>
            {item.relatedDocIds.map((id, i) => (
              <Group key={id} gap={4} align="center">
                {i > 0 && (
                  <Text size="xs" c="dimmed">
                    、
                  </Text>
                )}
                <DocLink docId={id} docMap={docMap} />
              </Group>
            ))}
          </Group>
        )}
        {item.type === "missing-page" && item.outline.length > 0 && (
          <Text size="xs" c="dimmed">
            {t("Suggested outline")}: {item.outline.join(" / ")}
          </Text>
        )}
        {item.type === "suggestion" && (
          <Group gap={6} align="center">
            <Text size="xs" c="dimmed">
              {t("Suggested merge target")}:
            </Text>
            {item.targetDocId ? (
              <DocLink docId={item.targetDocId} docMap={docMap} />
            ) : (
              <Text size="xs" c="dimmed">
                {t("(undecided)")}
              </Text>
            )}
          </Group>
        )}
        {item.type === "duplicate" && (
          <Group gap={6} align="center">
            <Text size="xs" c="dimmed">
              {t("Suggested primary")}:
            </Text>
            {item.suggestedPrimaryId ? (
              <DocLink docId={item.suggestedPrimaryId} docMap={docMap} />
            ) : (
              <Text size="xs" c="dimmed">
                {t("(undecided)")}
              </Text>
            )}
          </Group>
        )}

        {done ? (
          <ResolvedBlock resolved={resolved!} docMap={docMap} />
        ) : pending ? (
          <Group gap="xs" mt="xs">
            <Loader size="xs" />
            <Text size="xs" c="dimmed">
              {t("AI is generating the draft ...")}
            </Text>
          </Group>
        ) : (
          <>
            <Group gap="xs" mt="xs">
              <Button
                size="xs"
                variant="light"
                leftSection={<IconSearch size={14} />}
                onClick={onDeepSearch}
              >
                {t("DeepSearch")}
              </Button>
              <Button
                size="xs"
                color="green"
                leftSection={<IconCheck size={14} />}
                onClick={onAccept}
              >
                {t("Accept")}
              </Button>
              <Button
                size="xs"
                variant="default"
                leftSection={<IconX size={14} />}
                onClick={onSkip}
              >
                {t("Skip")}
              </Button>
            </Group>

            <Group gap="xs" align="flex-end">
              <TextInput
                placeholder={t("Or type your own feedback ...")}
                value={state?.freeText ?? ""}
                onChange={(e) => onFreeTextChange(e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (state?.freeText?.trim() ?? "")) {
                    onSubmitFreeText();
                  }
                }}
                style={{ flex: 1 }}
              />
              <Button
                size="sm"
                variant="subtle"
                onClick={onSubmitFreeText}
                disabled={!(state?.freeText?.trim() ?? "")}
              >
                {t("Submit")}
              </Button>
            </Group>
          </>
        )}
      </Stack>
    </Paper>
  );
}

function splitDocReferences(text: string) {
  const parts: Array<
    { type: "text"; value: string } | { type: "doc"; docId: string }
  > = [];
  const pattern = /\[id=([0-9a-fA-F-]{36})\]/g;
  let lastIndex = 0;

  for (const match of text.matchAll(pattern)) {
    const start = match.index ?? 0;
    if (start > lastIndex) {
      parts.push({ type: "text", value: text.slice(lastIndex, start) });
    }

    const docId = match[1];
    if (docId) {
      parts.push({ type: "doc", docId });
    }
    lastIndex = start + match[0].length;
  }

  if (lastIndex < text.length) {
    parts.push({ type: "text", value: text.slice(lastIndex) });
  }

  return parts.length > 0 ? parts : [{ type: "text", value: text }];
}

function ResolvedBlock({
  resolved,
  docMap,
}: {
  resolved: ResolvedReview;
  docMap: Record<string, ReviewDocMeta>;
}) {
  const { t } = useTranslation();

  if (resolved.skipped || !resolved.draft) {
    return (
      <Alert color="gray" mt="xs" icon={<IconX size={16} />}>
        {t("Skipped, no draft produced.")}
      </Alert>
    );
  }

  const draft = resolved.draft;
  return (
    <Paper bg="var(--mantine-color-gray-0)" radius="sm" p="sm" mt="xs">
      <Stack gap="xs">
        <Group gap="xs">
          {resolved.applied && (
            <Badge color="teal" variant="filled">
              {t("Applied")}
            </Badge>
          )}
          <Badge color="green" variant="filled">
            {t("Draft ready")}
          </Badge>
          <Badge variant="outline">{draft.approach}</Badge>
          {resolved.deepSearched && (
            <Badge color="blue" variant="light">
              {t("DeepSearch")} · {resolved.searchResults.length}
            </Badge>
          )}
          <Group gap={4} align="center">
            <Text size="xs" c="dimmed">
              {t("Target")}:
            </Text>
            {draft.targetDocId ? (
              <DocLink docId={draft.targetDocId} docMap={docMap} />
            ) : (
              <Text size="xs" c="dimmed">
                {t("(new page)")}
              </Text>
            )}
          </Group>
        </Group>
        {resolved.applied && (
          <Group gap={6} align="center">
            <Text size="xs" c="dimmed">
              {resolved.applied.action === "created"
                ? t("Created page")
                : t("Updated page")}
              :
            </Text>
            <Anchor
              size="xs"
              href={`/p/${resolved.applied.pageId}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              {resolved.applied.pageTitle}
            </Anchor>
          </Group>
        )}
        {draft.notes && (
          <Text size="xs" c="dimmed">
            {t("Tradeoff")}: {draft.notes}
          </Text>
        )}
        <Text size="sm" fw={600}>
          {draft.title}
        </Text>
        <Textarea
          value={draft.body}
          readOnly
          autosize
          minRows={4}
          maxRows={20}
          styles={{ input: { fontFamily: "monospace", fontSize: "12px" } }}
        />
      </Stack>
    </Paper>
  );
}
