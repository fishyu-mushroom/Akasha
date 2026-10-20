import {
  IconAlignLeft,
  IconCalendar,
  IconCircleDot,
  IconHash,
  IconLink,
  IconList,
  IconProgressCheck,
  IconSquareCheck,
  IconUser,
} from "@tabler/icons-react";
import { PropertyType } from "@/features/database/types/database.types";

const ICONS: Record<PropertyType, typeof IconAlignLeft> = {
  text: IconAlignLeft,
  number: IconHash,
  select: IconCircleDot,
  multi_select: IconList,
  status: IconProgressCheck,
  date: IconCalendar,
  person: IconUser,
  checkbox: IconSquareCheck,
  url: IconLink,
};

export function PropertyTypeIcon({
  type,
  size = 14,
}: {
  type: PropertyType;
  size?: number;
}) {
  const Icon = ICONS[type] ?? IconAlignLeft;
  return <Icon size={size} stroke={1.6} aria-hidden />;
}
