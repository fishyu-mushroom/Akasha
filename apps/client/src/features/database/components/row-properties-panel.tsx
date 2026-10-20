import { Anchor, Group, Text } from "@mantine/core";
import { IconDatabase } from "@tabler/icons-react";
import { Link, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { usePageQuery } from "@/features/page/queries/page-query";
import { buildPageUrl } from "@/features/page/page.utils";
import { useDatabaseInfoQuery } from "@/features/database/queries/database-query";
import { useDatabaseActions } from "@/features/database/hooks/use-database-actions";
import { IDatabaseRow } from "@/features/database/types/database.types";
import { PropertyCell } from "./property-cell";
import { useMemberMap } from "./property-value";
import { PropertyTypeIcon } from "./property-type-icon";
import classes from "./database.module.css";

interface RowPropertiesPanelProps {
  pageId: string;
  databaseId: string;
  editable: boolean;
}

/** Shows a database row's properties above the page body. */
export function RowPropertiesPanel({
  pageId,
  databaseId,
  editable,
}: RowPropertiesPanelProps) {
  const { t } = useTranslation();
  const { spaceSlug } = useParams();
  const { data: page } = usePageQuery({ pageId });
  const { data: info } = useDatabaseInfoQuery(databaseId);
  const members = useMemberMap();
  const actions = useDatabaseActions(databaseId, info?.database.spaceId ?? "");

  if (!page || !info) return null;
  const row = page as unknown as IDatabaseRow;
  const properties = row.properties ?? {};

  return (
    <div className={classes.propertiesPanel}>
      <Group gap={6} mb={6}>
        <IconDatabase size={14} stroke={1.6} aria-hidden />
        <Anchor
          component={Link}
          size="xs"
          c="dimmed"
          to={buildPageUrl(
            spaceSlug,
            info.database.slugId,
            info.database.title,
          )}
        >
          {info.database.title || t("untitled")}
        </Anchor>
      </Group>
      {info.properties.map((property) => (
        <div className={classes.propertyRow} key={property.id}>
          <div className={classes.propertyName}>
            <PropertyTypeIcon type={property.type} />
            <Text size="sm" truncate>
              {property.name}
            </Text>
          </div>
          <PropertyCell
            property={property}
            value={properties[property.id]}
            editable={editable}
            members={members}
            onChange={(value) => actions.updateCell(row, property.id, value)}
            onUpdateConfig={(config) =>
              actions.updatePropertyConfig(property, config)
            }
          />
        </div>
      ))}
    </div>
  );
}
