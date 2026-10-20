import { Badge, Checkbox, Group, Text } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { getWorkspaceMembers } from "@/features/workspace/services/workspace-service";
import { CustomAvatar } from "@/components/ui/custom-avatar";
import { IUser } from "@/features/user/types/user.types";
import {
  DateValue,
  IDatabaseProperty,
  PropertyValue as Value,
  SelectOption,
} from "@/features/database/types/database.types";
import {
  formatDateValue,
  formatNumber,
  getOptions,
} from "@/features/database/utils/database.utils";

/** Workspace members keyed by id, for rendering person values. */
export function useMemberMap(): Map<string, IUser> {
  const { data } = useQuery({
    queryKey: ["workspaceMembers", "database-person-map"],
    queryFn: () => getWorkspaceMembers({ limit: 100 }),
    staleTime: 5 * 60 * 1000,
  });
  return new Map((data?.items ?? []).map((user) => [user.id, user]));
}

export function OptionBadge({ option }: { option?: SelectOption }) {
  if (!option) return null;
  return (
    <Badge
      color={option.color ?? "gray"}
      variant="light"
      radius="sm"
      tt="none"
      fw={500}
      style={{ maxWidth: "100%" }}
    >
      {option.name}
    </Badge>
  );
}

interface PropertyValueProps {
  property: IDatabaseProperty;
  value: Value | undefined;
  members?: Map<string, IUser>;
}

/** Read-only rendering of a property value. */
export function PropertyValue({ property, value, members }: PropertyValueProps) {
  if (value === null || value === undefined) {
    return property.type === "checkbox" ? (
      <Checkbox checked={false} readOnly size="xs" tabIndex={-1} />
    ) : null;
  }

  switch (property.type) {
    case "text":
      return (
        <Text size="sm" lineClamp={1}>
          {String(value)}
        </Text>
      );
    case "url":
      return (
        <Text
          size="sm"
          lineClamp={1}
          component="a"
          href={String(value)}
          target="_blank"
          rel="noopener noreferrer"
          c="blue"
          td="underline"
          onClick={(e) => e.stopPropagation()}
        >
          {String(value)}
        </Text>
      );
    case "number":
      return (
        <Text size="sm" ta="right" w="100%">
          {formatNumber(value as number, property.config?.numberFormat)}
        </Text>
      );
    case "checkbox":
      return (
        <Checkbox checked={Boolean(value)} readOnly size="xs" tabIndex={-1} />
      );
    case "select":
    case "status": {
      const option = getOptions(property).find((o) => o.id === value);
      return <OptionBadge option={option} />;
    }
    case "multi_select": {
      const options = getOptions(property);
      return (
        <Group gap={4} wrap="nowrap" style={{ overflow: "hidden" }}>
          {(value as string[]).map((id) => (
            <OptionBadge key={id} option={options.find((o) => o.id === id)} />
          ))}
        </Group>
      );
    }
    case "date":
      return <Text size="sm">{formatDateValue(value as DateValue)}</Text>;
    case "person":
      return (
        <Group gap={6} wrap="nowrap" style={{ overflow: "hidden" }}>
          {(value as string[]).map((id) => {
            const user = members?.get(id);
            return (
              <Group key={id} gap={4} wrap="nowrap">
                <CustomAvatar
                  avatarUrl={user?.avatarUrl}
                  name={user?.name ?? "?"}
                  size={20}
                />
                <Text size="sm" lineClamp={1}>
                  {user?.name ?? ""}
                </Text>
              </Group>
            );
          })}
        </Group>
      );
    default:
      return null;
  }
}
