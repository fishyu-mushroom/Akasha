import { useState } from "react";
import { Checkbox, Popover, UnstyledButton } from "@mantine/core";
import { IUser } from "@/features/user/types/user.types";
import {
  IDatabaseProperty,
  PropertyConfig,
  PropertyValue as Value,
} from "@/features/database/types/database.types";
import { PropertyValue } from "./property-value";
import { PropertyEditor } from "./property-editor";
import classes from "./database.module.css";

interface PropertyCellProps {
  property: IDatabaseProperty;
  value: Value | undefined;
  editable: boolean;
  members?: Map<string, IUser>;
  onChange: (value: Value) => void;
  onUpdateConfig?: (config: PropertyConfig) => Promise<unknown>;
}

/** A property value that opens its editor in a popover when clicked. */
export function PropertyCell({
  property,
  value,
  editable,
  members,
  onChange,
  onUpdateConfig,
}: PropertyCellProps) {
  const [opened, setOpened] = useState(false);

  if (property.type === "checkbox") {
    return (
      <div className={classes.cell}>
        <Checkbox
          size="xs"
          checked={Boolean(value)}
          disabled={!editable}
          aria-label={property.name}
          onChange={(e) => onChange(e.currentTarget.checked || null)}
        />
      </div>
    );
  }

  const display = (
    <PropertyValue property={property} value={value} members={members} />
  );

  if (!editable) {
    return <div className={classes.cell}>{display}</div>;
  }

  return (
    <Popover
      opened={opened}
      onChange={setOpened}
      position="bottom-start"
      shadow="md"
      trapFocus
      withinPortal
    >
      <Popover.Target>
        <UnstyledButton
          className={classes.cell}
          aria-label={property.name}
          onClick={() => setOpened((o) => !o)}
        >
          {display}
        </UnstyledButton>
      </Popover.Target>
      <Popover.Dropdown p="xs">
        {opened && (
          <PropertyEditor
            property={property}
            value={value}
            onChange={onChange}
            onClose={() => setOpened(false)}
            onUpdateConfig={onUpdateConfig}
          />
        )}
      </Popover.Dropdown>
    </Popover>
  );
}
