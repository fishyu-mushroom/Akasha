import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Anchor,
  Badge,
  Button,
  Container,
  Group,
  Loader,
  MultiSelect,
  Stack,
  Table,
  Text,
  Title,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  IconAlertTriangle,
  IconArrowLeft,
  IconDatabaseSearch,
  IconRefresh,
} from "@tabler/icons-react";
import { Helmet } from "react-helmet-async";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { getAppName } from "@/lib/config";
import { useGetSpacesQuery } from "@/features/space/queries/space-query";
import {
  compileKnowledgeSpaces,
  getKnowledgeDiagnostics,
} from "../services/knowledge-service";
import classes from "../styles/knowledge-admin.module.css";

const DIAGNOSTICS_LIMIT = 50;

export default function KnowledgeAdminPage() {
  const { t } = useTranslation();
  const [spaceIds, setSpaceIds] = useState<string[]>([]);
  const { data: spacesData, isLoading: spacesLoading } = useGetSpacesQuery({
    limit: 100,
  });
  const spaces = spacesData?.items ?? [];
  const spaceOptions = useMemo(
    () => spaces.map((space) => ({ value: space.id, label: space.name })),
    [spaces],
  );

  useEffect(() => {
    if (spaceIds.length === 0 && spaceOptions.length > 0) {
      setSpaceIds(spaceOptions.map((space) => space.value));
    }
  }, [spaceIds.length, spaceOptions]);

  const diagnosticsQuery = useQuery({
    queryKey: ["knowledge-diagnostics", spaceIds],
    queryFn: () =>
      getKnowledgeDiagnostics({
        spaceIds,
        limit: DIAGNOSTICS_LIMIT,
      }),
    enabled: spaceIds.length > 0,
    refetchInterval: 5000,
  });

  const compileMutation = useMutation({
    mutationFn: compileKnowledgeSpaces,
    onSuccess: (data) => {
      notifications.show({
        message: t("Knowledge update queued", {
          count: data.queuedSpaceCount,
        }),
      });
      void diagnosticsQuery.refetch();
    },
    onError: (error) => {
      notifications.show({
        color: "red",
        message: error.message,
      });
    },
  });

  const pages = diagnosticsQuery.data?.pages ?? [];
  const jobs = diagnosticsQuery.data?.jobs ?? [];

  return (
    <>
      <Helmet>
        <title>
          {t("Knowledge diagnostics")} - {getAppName()}
        </title>
      </Helmet>

      <Container size="xl" pt="xl" pb="xl">
        <Stack gap="lg">
          <Group justify="space-between" align="center">
            <Group gap="sm">
              <IconDatabaseSearch size={24} stroke={1.8} />
              <Title order={1} size="h3">
                {t("Knowledge diagnostics")}
              </Title>
            </Group>
            <Group gap="sm">
              <Button
                component={Link}
                to="/knowledge"
                variant="default"
                leftSection={<IconArrowLeft size={16} />}
              >
                {t("Back")}
              </Button>
              <Button
                variant="default"
                leftSection={<IconRefresh size={16} />}
                loading={diagnosticsQuery.isFetching}
                disabled={spaceIds.length === 0}
                onClick={() => void diagnosticsQuery.refetch()}
              >
                {t("Refresh")}
              </Button>
              <Button
                leftSection={<IconRefresh size={16} />}
                loading={compileMutation.isPending}
                disabled={spaceIds.length === 0}
                onClick={() => compileMutation.mutate({ spaceIds })}
              >
                {t("Update knowledge")}
              </Button>
            </Group>
          </Group>

          <section className={classes.panel}>
            <MultiSelect
              data={spaceOptions}
              value={spaceIds}
              onChange={setSpaceIds}
              label={t("Spaces")}
              searchable
              clearable
              disabled={spacesLoading}
            />
          </section>

          {diagnosticsQuery.isError && (
            <Alert color="red" icon={<IconAlertTriangle size={18} />}>
              {diagnosticsQuery.error.message}
            </Alert>
          )}

          <section className={classes.panel}>
            <Group justify="space-between" mb="md">
              <Title order={2} size="h4">
                {t("Recent pages")}
              </Title>
              {diagnosticsQuery.isLoading && <Loader size="sm" />}
            </Group>

            <Table.ScrollContainer minWidth={980}>
              <Table highlightOnHover verticalSpacing="sm">
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>{t("Page")}</Table.Th>
                    <Table.Th>{t("Space")}</Table.Th>
                    <Table.Th>{t("Updated")}</Table.Th>
                    <Table.Th>{t("Text")}</Table.Th>
                    <Table.Th>{t("Source")}</Table.Th>
                    <Table.Th>{t("Capsule")}</Table.Th>
                    <Table.Th>{t("Chunk")}</Table.Th>
                    <Table.Th>{t("State")}</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {pages.length === 0 ? (
                    <Table.Tr>
                      <Table.Td colSpan={8}>
                        <Text className={classes.emptyText}>
                          {t("No pages")}
                        </Text>
                      </Table.Td>
                    </Table.Tr>
                  ) : (
                    pages.map((page) => (
                      <Table.Tr key={page.pageId}>
                        <Table.Td>
                          <Anchor
                            component={Link}
                            to={`/s/${page.spaceSlug}/p/${page.slugId}`}
                            className={classes.pageLink}
                          >
                            {page.title || page.slugId}
                          </Anchor>
                          <Text className={classes.mono} c="dimmed">
                            {page.pageId}
                          </Text>
                        </Table.Td>
                        <Table.Td>{page.spaceName}</Table.Td>
                        <Table.Td>{formatDate(page.updatedAt)}</Table.Td>
                        <Table.Td>{page.textLength}</Table.Td>
                        <Table.Td>
                          <CountBadge value={page.knowledgeSourceCount} />
                        </Table.Td>
                        <Table.Td>
                          <CountBadge value={page.knowledgePageSourceCount} />
                        </Table.Td>
                        <Table.Td>
                          <CountBadge value={page.knowledgeChunkCount} />
                        </Table.Td>
                        <Table.Td>
                          <Group gap="xs">
                            {page.deletedAt ? (
                              <Badge color="red" variant="light">
                                {t("Deleted")}
                              </Badge>
                            ) : page.knowledgeChunkCount > 0 ? (
                              <Badge color="green" variant="light">
                                {t("Compiled")}
                              </Badge>
                            ) : (
                              <Badge color="gray" variant="light">
                                {t("Missing")}
                              </Badge>
                            )}
                            {page.staleSourceCount > 0 && (
                              <Badge color="yellow" variant="light">
                                {t("Stale")}
                              </Badge>
                            )}
                          </Group>
                        </Table.Td>
                      </Table.Tr>
                    ))
                  )}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          </section>

          <section className={classes.panel}>
            <Group justify="space-between" mb="md">
              <Title order={2} size="h4">
                {t("AI queue")}
              </Title>
              <Badge variant="light">{jobs.length}</Badge>
            </Group>

            <Table.ScrollContainer minWidth={900}>
              <Table highlightOnHover verticalSpacing="sm">
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>{t("Job")}</Table.Th>
                    <Table.Th>{t("State")}</Table.Th>
                    <Table.Th>{t("Space")}</Table.Th>
                    <Table.Th>{t("Pages")}</Table.Th>
                    <Table.Th>{t("Updated")}</Table.Th>
                    <Table.Th>{t("Error")}</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {jobs.length === 0 ? (
                    <Table.Tr>
                      <Table.Td colSpan={6}>
                        <Text className={classes.emptyText}>
                          {t("No matching jobs")}
                        </Text>
                      </Table.Td>
                    </Table.Tr>
                  ) : (
                    jobs.map((job) => (
                      <Table.Tr key={`${job.name}:${job.id}`}>
                        <Table.Td>
                          <Text fw={600}>{job.name}</Text>
                          <Text className={classes.mono} c="dimmed">
                            {job.id}
                          </Text>
                        </Table.Td>
                        <Table.Td>
                          <Badge color={jobStateColor(job.state)} variant="light">
                            {job.state}
                          </Badge>
                        </Table.Td>
                        <Table.Td>
                          <Text className={classes.mono}>
                            {job.spaceId || "-"}
                          </Text>
                        </Table.Td>
                        <Table.Td>{job.pageIds.length}</Table.Td>
                        <Table.Td>
                          {formatTimestamp(job.finishedOn ?? job.processedOn ?? job.timestamp)}
                        </Table.Td>
                        <Table.Td>{job.failedReason || "-"}</Table.Td>
                      </Table.Tr>
                    ))
                  )}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          </section>
        </Stack>
      </Container>
    </>
  );
}

function CountBadge({ value }: { value: number }) {
  return (
    <Badge color={value > 0 ? "green" : "gray"} variant="light">
      {value}
    </Badge>
  );
}

function formatDate(value: string): string {
  if (!value) return "-";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatTimestamp(value?: number): string {
  if (!value) return "-";
  return formatDate(new Date(value).toISOString());
}

function jobStateColor(state: string): string {
  if (state === "completed") return "green";
  if (state === "failed") return "red";
  if (state === "active") return "blue";
  if (state === "delayed") return "yellow";
  return "gray";
}
