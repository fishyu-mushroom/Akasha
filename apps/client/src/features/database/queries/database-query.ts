import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
  UseQueryResult,
} from "@tanstack/react-query";
import { notifications } from "@mantine/notifications";
import { useTranslation } from "react-i18next";
import { useCallback } from "react";
import { useQueryEmit } from "@/features/websocket/use-query-emit";
import {
  createProperty,
  createRow,
  createView,
  deleteProperty,
  deleteView,
  getDatabaseInfo,
  moveRow,
  queryRows,
  updateProperty,
  updateRowProperties,
  updateView,
} from "@/features/database/services/database-service";
import {
  IDatabaseInfo,
  IDatabaseRow,
  QueryRowsParams,
  QueryRowsResult,
} from "@/features/database/types/database.types";

// Everything for one database lives under ["database", databaseId] so a single
// websocket invalidate refreshes info and every row query.
export const DATABASE_KEY = (databaseId: string) => ["database", databaseId];
export const DATABASE_INFO_KEY = (databaseId: string) => [
  ...DATABASE_KEY(databaseId),
  "info",
];
export const DATABASE_ROWS_KEY = (databaseId: string) => [
  ...DATABASE_KEY(databaseId),
  "rows",
];

export function useDatabaseInfoQuery(
  databaseId?: string,
): UseQueryResult<IDatabaseInfo, Error> {
  return useQuery({
    queryKey: DATABASE_INFO_KEY(databaseId ?? ""),
    queryFn: () => getDatabaseInfo(databaseId!),
    enabled: !!databaseId,
  });
}

export function useDatabaseRowsQuery(
  params: QueryRowsParams,
  enabled = true,
): UseQueryResult<QueryRowsResult, Error> {
  return useQuery({
    queryKey: [...DATABASE_ROWS_KEY(params.databaseId), params],
    queryFn: () => queryRows(params),
    enabled: enabled && !!params.databaseId,
    placeholderData: keepPreviousData,
  });
}

/**
 * Refreshes local caches for a database and tells other clients in the space
 * to do the same.
 */
export function useDatabaseSync(databaseId: string, spaceId: string) {
  const queryClient = useQueryClient();
  const emit = useQueryEmit();

  return useCallback(() => {
    queryClient.invalidateQueries({ queryKey: DATABASE_KEY(databaseId) });
    emit({
      operation: "invalidate",
      spaceId,
      entity: ["database"],
      id: databaseId,
    });
  }, [queryClient, emit, databaseId, spaceId]);
}

function useErrorToast() {
  const { t } = useTranslation();
  return (error: any) => {
    notifications.show({
      message: error?.response?.data?.message ?? t("Something went wrong"),
      color: "red",
    });
  };
}

export function useDatabaseMutations(databaseId: string, spaceId: string) {
  const queryClient = useQueryClient();
  const sync = useDatabaseSync(databaseId, spaceId);
  const onError = useErrorToast();
  const options = { onSuccess: () => sync(), onError };

  const createPropertyMutation = useMutation({
    mutationFn: createProperty,
    ...options,
  });
  const updatePropertyMutation = useMutation({
    mutationFn: updateProperty,
    ...options,
  });
  const deletePropertyMutation = useMutation({
    mutationFn: deleteProperty,
    ...options,
  });
  const createViewMutation = useMutation({ mutationFn: createView, ...options });
  const updateViewMutation = useMutation({ mutationFn: updateView, ...options });
  const deleteViewMutation = useMutation({ mutationFn: deleteView, ...options });
  const createRowMutation = useMutation({ mutationFn: createRow, ...options });
  const moveRowMutation = useMutation({ mutationFn: moveRow, ...options });

  // Property edits are applied optimistically to every cached row query.
  const updateRowMutation = useMutation({
    mutationFn: updateRowProperties,
    onMutate: async (input) => {
      const key = DATABASE_ROWS_KEY(databaseId);
      await queryClient.cancelQueries({ queryKey: key });
      const snapshot = queryClient.getQueriesData<QueryRowsResult>({
        queryKey: key,
      });
      queryClient.setQueriesData<QueryRowsResult>({ queryKey: key }, (data) =>
        data
          ? {
              ...data,
              items: data.items.map((row) =>
                row.id === input.pageId
                  ? {
                      ...row,
                      properties: mergeProperties(
                        row.properties,
                        input.properties,
                      ),
                    }
                  : row,
              ),
            }
          : data,
      );
      return { snapshot };
    },
    onError: (error, _input, context) => {
      context?.snapshot.forEach(([key, data]) =>
        queryClient.setQueryData(key, data),
      );
      onError(error);
    },
    onSuccess: (row: IDatabaseRow) => {
      queryClient.setQueryData(["pages", row.id], (page: any) =>
        page ? { ...page, properties: row.properties } : page,
      );
      queryClient.setQueryData(["pages", row.slugId], (page: any) =>
        page ? { ...page, properties: row.properties } : page,
      );
      sync();
    },
  });

  return {
    createProperty: createPropertyMutation,
    updateProperty: updatePropertyMutation,
    deleteProperty: deletePropertyMutation,
    createView: createViewMutation,
    updateView: updateViewMutation,
    deleteView: deleteViewMutation,
    createRow: createRowMutation,
    updateRow: updateRowMutation,
    moveRow: moveRowMutation,
  };
}

export function mergeProperties(
  current: IDatabaseRow["properties"],
  patch: IDatabaseRow["properties"],
): IDatabaseRow["properties"] {
  const next = { ...current };
  for (const [key, value] of Object.entries(patch)) {
    if (
      value === null ||
      value === "" ||
      (Array.isArray(value) && value.length === 0)
    ) {
      delete next[key];
    } else {
      next[key] = value;
    }
  }
  return next;
}
