import { useRef, useState } from "react";
import { Group, Text } from "@mantine/core";
import { IconFileDescription, IconPlus } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import {
  IDatabaseInfo,
  IDatabaseRow,
  IDatabaseView,
  SYSTEM_PROPERTIES,
} from "@/features/database/types/database.types";
import { visibleProperties } from "@/features/database/utils/database.utils";
import { DatabaseActions } from "@/features/database/hooks/use-database-actions";
import { useDatabaseSync } from "@/features/database/queries/database-query";
import { PropertyCell } from "../property-cell";
import { useMemberMap } from "../property-value";
import { PropertyTypeIcon } from "../property-type-icon";
import {
  AddPropertyButton,
  PropertyHeaderMenu,
} from "../property-header-menu";
import { RowTitle } from "../row-title";
import classes from "../database.module.css";

const TITLE_WIDTH = 280;
const DEFAULT_WIDTH = 180;

interface TableViewProps {
  info: IDatabaseInfo;
  view: IDatabaseView;
  rows: IDatabaseRow[];
  editable: boolean;
  actions: DatabaseActions;
}

export function TableView({
  info,
  view,
  rows,
  editable,
  actions,
}: TableViewProps) {
  const { t } = useTranslation();
  const members = useMemberMap();
  const sync = useDatabaseSync(info.database.id, info.database.spaceId);
  const columns = visibleProperties(view, info.properties);
  const savedWidths = view.config.propertyWidths ?? {};
  const [widths, setWidths] = useState<Record<string, number>>({});
  const widthOf = (id: string, fallback: number) =>
    widths[id] ?? savedWidths[id] ?? fallback;

  const resizeRef = useRef<{ id: string; startX: number; start: number }>();
  const startResize = (id: string, fallback: number) => (e: React.MouseEvent) => {
    e.preventDefault();
    resizeRef.current = { id, startX: e.clientX, start: widthOf(id, fallback) };
    const onMove = (ev: MouseEvent) => {
      const r = resizeRef.current;
      if (!r) return;
      const next = Math.max(60, Math.min(1000, r.start + ev.clientX - r.startX));
      setWidths((w) => ({ ...w, [r.id]: next }));
    };
    const onUp = (ev: MouseEvent) => {
      const r = resizeRef.current;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      resizeRef.current = undefined;
      if (!r || !editable) return;
      const next = Math.max(60, Math.min(1000, r.start + ev.clientX - r.startX));
      actions.updateViewConfig(view, {
        propertyWidths: { ...savedWidths, [r.id]: Math.round(next) },
      });
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const hideColumn = (id: string) =>
    actions.updateViewConfig(view, {
      visibleProperties: columns.map((p) => p.id).filter((c) => c !== id),
    });

  const createProperty = async (name: string, type: any) => {
    const property = await actions.mutations.createProperty.mutateAsync({
      databaseId: info.database.id,
      name,
      type,
    });
    actions.updateViewConfig(view, {
      visibleProperties: [...columns.map((p) => p.id), property.id],
    });
  };

  const addRow = async () => {
    const row = await actions.createRow();
    actions.openRow(row);
  };

  return (
    <div className={classes.tableWrapper}>
      <table className={classes.table}>
        <colgroup>
          <col style={{ width: widthOf(SYSTEM_PROPERTIES.TITLE, TITLE_WIDTH) }} />
          {columns.map((p) => (
            <col key={p.id} style={{ width: widthOf(p.id, DEFAULT_WIDTH) }} />
          ))}
          <col style={{ width: 48 }} />
        </colgroup>
        <thead>
          <tr>
            <th scope="col">
              <div className={classes.headerButton}>
                <IconFileDescription size={14} stroke={1.6} aria-hidden />
                {t("Name")}
              </div>
              <span
                className={classes.resizer}
                role="separator"
                aria-orientation="vertical"
                onMouseDown={startResize(SYSTEM_PROPERTIES.TITLE, TITLE_WIDTH)}
              />
            </th>
            {columns.map((property) => (
              <th scope="col" key={property.id}>
                <PropertyHeaderMenu
                  property={property}
                  editable={editable}
                  onRename={(name) =>
                    actions.mutations.updateProperty.mutate({
                      propertyId: property.id,
                      name,
                    })
                  }
                  onSort={(direction) =>
                    actions.updateViewConfig(view, {
                      sorts: [{ property: property.id, direction }],
                    })
                  }
                  onHide={() => hideColumn(property.id)}
                  onDelete={() =>
                    actions.mutations.deleteProperty.mutate(property.id)
                  }
                >
                  <button type="button" className={classes.headerButton}>
                    <PropertyTypeIcon type={property.type} />
                    <Text size="sm" truncate>
                      {property.name}
                    </Text>
                  </button>
                </PropertyHeaderMenu>
                <span
                  className={classes.resizer}
                  role="separator"
                  aria-orientation="vertical"
                  onMouseDown={startResize(property.id, DEFAULT_WIDTH)}
                />
              </th>
            ))}
            <th scope="col">
              {editable && (
                <Group justify="center">
                  <AddPropertyButton onCreate={createProperty} />
                </Group>
              )}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td>
                <RowTitle
                  row={row}
                  editable={editable}
                  onOpen={() => actions.openRow(row)}
                  onRenamed={sync}
                />
              </td>
              {columns.map((property) => (
                <td key={property.id}>
                  <PropertyCell
                    property={property}
                    value={row.properties[property.id]}
                    editable={editable}
                    members={members}
                    onChange={(value) =>
                      actions.updateCell(row, property.id, value)
                    }
                    onUpdateConfig={(config) =>
                      actions.updatePropertyConfig(property, config)
                    }
                  />
                </td>
              ))}
              <td />
            </tr>
          ))}
        </tbody>
      </table>
      {editable && (
        <button type="button" className={classes.newRow} onClick={addRow}>
          <Group gap={6}>
            <IconPlus size={14} />
            {t("New")}
          </Group>
        </button>
      )}
    </div>
  );
}
