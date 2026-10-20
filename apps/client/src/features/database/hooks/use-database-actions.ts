import { useCallback } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { buildPageUrl } from "@/features/page/page.utils";
import { useDatabaseMutations } from "@/features/database/queries/database-query";
import {
  DatabaseViewConfig,
  IDatabaseProperty,
  IDatabaseRow,
  IDatabaseView,
  PropertyConfig,
  PropertyValue,
} from "@/features/database/types/database.types";

/** Shared row/property/view actions for every database view. */
export function useDatabaseActions(databaseId: string, spaceId: string) {
  const mutations = useDatabaseMutations(databaseId, spaceId);
  const navigate = useNavigate();
  const { spaceSlug } = useParams();

  const updateCell = useCallback(
    (row: IDatabaseRow, propertyId: string, value: PropertyValue) =>
      mutations.updateRow.mutate({
        pageId: row.id,
        properties: { [propertyId]: value },
      }),
    [mutations.updateRow],
  );

  const updatePropertyConfig = useCallback(
    (property: IDatabaseProperty, config: PropertyConfig) =>
      mutations.updateProperty.mutateAsync({
        propertyId: property.id,
        config,
      }),
    [mutations.updateProperty],
  );

  const createRow = useCallback(
    (properties?: Record<string, PropertyValue>, title?: string) =>
      mutations.createRow.mutateAsync({ databaseId, properties, title }),
    [mutations.createRow, databaseId],
  );

  const openRow = useCallback(
    (row: Pick<IDatabaseRow, "slugId" | "title">) =>
      navigate(buildPageUrl(spaceSlug, row.slugId, row.title ?? undefined)),
    [navigate, spaceSlug],
  );

  const updateViewConfig = useCallback(
    (view: IDatabaseView, patch: Partial<DatabaseViewConfig>) =>
      mutations.updateView.mutate({
        viewId: view.id,
        config: { ...view.config, ...patch },
      }),
    [mutations.updateView],
  );

  return {
    mutations,
    updateCell,
    updatePropertyConfig,
    createRow,
    openRow,
    updateViewConfig,
  };
}

export type DatabaseActions = ReturnType<typeof useDatabaseActions>;
