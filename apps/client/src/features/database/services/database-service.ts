import api from "@/lib/api-client";
import {
  DatabaseViewConfig,
  IDatabaseInfo,
  IDatabaseProperty,
  IDatabaseRow,
  IDatabaseView,
  PropertyConfig,
  PropertyType,
  PropertyValue,
  QueryRowsParams,
  QueryRowsResult,
  ViewType,
} from "@/features/database/types/database.types";

export async function createDatabase(data: {
  spaceId: string;
  parentPageId?: string;
  title?: string;
  defaultNames?: {
    view?: string;
    status?: string;
    todo?: string;
    inProgress?: string;
    done?: string;
  };
}): Promise<IDatabaseInfo> {
  const req = await api.post<IDatabaseInfo>("/databases/create", data);
  return req.data;
}

export async function getDatabaseInfo(
  databaseId: string,
): Promise<IDatabaseInfo> {
  const req = await api.post<IDatabaseInfo>("/databases/info", { databaseId });
  return req.data;
}

export async function createProperty(data: {
  databaseId: string;
  name: string;
  type: PropertyType;
  config?: PropertyConfig;
}): Promise<IDatabaseProperty> {
  const req = await api.post<IDatabaseProperty>(
    "/databases/properties/create",
    data,
  );
  return req.data;
}

export async function updateProperty(data: {
  propertyId: string;
  name?: string;
  config?: PropertyConfig;
  position?: string;
}): Promise<IDatabaseProperty> {
  const req = await api.post<IDatabaseProperty>(
    "/databases/properties/update",
    data,
  );
  return req.data;
}

export async function deleteProperty(propertyId: string): Promise<void> {
  await api.post("/databases/properties/delete", { propertyId });
}

export async function createView(data: {
  databaseId: string;
  name: string;
  type: ViewType;
  config?: DatabaseViewConfig;
}): Promise<IDatabaseView> {
  const req = await api.post<IDatabaseView>("/databases/views/create", data);
  return req.data;
}

export async function updateView(data: {
  viewId: string;
  name?: string;
  config?: DatabaseViewConfig;
  position?: string;
}): Promise<IDatabaseView> {
  const req = await api.post<IDatabaseView>("/databases/views/update", data);
  return req.data;
}

export async function deleteView(viewId: string): Promise<void> {
  await api.post("/databases/views/delete", { viewId });
}

export async function queryRows(
  params: QueryRowsParams,
): Promise<QueryRowsResult> {
  const req = await api.post<QueryRowsResult>("/databases/rows/query", params);
  return req.data;
}

export async function createRow(data: {
  databaseId: string;
  title?: string;
  properties?: Record<string, PropertyValue>;
}): Promise<IDatabaseRow> {
  const req = await api.post<IDatabaseRow>("/databases/rows/create", data);
  return req.data;
}

export async function updateRowProperties(data: {
  pageId: string;
  properties: Record<string, PropertyValue>;
}): Promise<IDatabaseRow> {
  const req = await api.post<IDatabaseRow>(
    "/databases/rows/update-properties",
    data,
  );
  return req.data;
}

export async function moveRow(data: {
  pageId: string;
  afterPageId?: string;
  beforePageId?: string;
  properties?: Record<string, PropertyValue>;
}): Promise<IDatabaseRow> {
  const req = await api.post<IDatabaseRow>("/databases/rows/move", data);
  return req.data;
}
