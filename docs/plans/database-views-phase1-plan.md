# Database 一期方案（表格 / 看板 / 日历）

日期：2026-10-20　分支：`feat/database-views`

## 1. 目标与范围

在 Akasha 中提供 Notion 式的轻量 Database：一个数据库是一个特殊页面，每一行是它的子页面，行上挂结构化属性，同一份数据可用多种视图展示。

一期做：

- 属性类型：标题（即 `pages.title`）、文本、数字、单选、多选、状态、日期、人员、复选框、URL、创建时间、更新时间、创建人。
- 视图：表格、看板（按单选/状态分组）、日历（按日期属性）。
- 每个视图独立保存过滤、排序、分组、可见列、列宽。
- 行即页面：点开行就是普通页面编辑器，上方显示属性面板；评论、历史、协作、权限全部复用。
- 侧边栏可新建数据库；行页面不出现在侧边栏树中。

一期不做：Formula、Relation/Rollup、时间线、画廊、列级权限、MCP 数据库工具、Notion CSV 导入、编辑器内嵌视图节点（列为 M7 可选）、数据库复制。

一期硬性边界：**数据库容器页与所有行页面都不进入知识编译**（见 §5）。

参考：规格对齐 Notion 公开 API 的 property/filter/sort 结构；交互可参考 Twenty（AGPL，NestJS+React）。上游 Docmost 的 Bases 是商业功能，不参考其代码。

## 2. 数据模型

### 2.1 pages 新增列

| 列 | 类型 | 说明 |
|---|---|---|
| `type` | `varchar(16) not null default 'page'` | `'page' \| 'database'`，CHECK 约束 |
| `database_id` | `uuid null references pages(id) on delete cascade` | 非空即为该数据库的行；行的 `parent_page_id` 同样指向数据库 |
| `properties` | `jsonb not null default '{}'` | 行属性值，key 为属性 id |

索引：`(database_id) where database_id is not null and deleted_at is null`；`properties` 建 GIN（`jsonb_path_ops`）。

### 2.2 新表

`database_properties`：`id uuid pk, workspace_id, database_id → pages(id) cascade, name varchar(200), type varchar(32), config jsonb default '{}', position varchar, created_at, updated_at`。`config` 存选项（`{options:[{id,name,color,group?}]}`）、数字格式等。

`database_views`：`id uuid pk, workspace_id, database_id → pages(id) cascade, name varchar(200), type varchar(16)（table|board|calendar）, config jsonb default '{}', position varchar, created_at, updated_at`。

`config` 结构：

```ts
interface DatabaseViewConfig {
  filter?: { and?: FilterCondition[]; or?: FilterCondition[] }; // 一期单层
  sorts?: { property: string; direction: 'asc' | 'desc' }[];   // ≤5
  groupBy?: string;            // board：select/status 属性 id
  dateProperty?: string;       // calendar：date 属性 id
  visibleProperties?: string[];
  propertyWidths?: Record<string, number>;
}
interface FilterCondition { property: string; operator: string; value?: unknown }
```

`title`、`created_time`、`updated_time`、`created_by` 是系统属性，属性 id 用固定保留值（`__title` 等），值取自 pages 列，不写入 `properties`。

### 2.3 属性值格式

| 类型 | 值 |
|---|---|
| text / url | `string` |
| number | `number` |
| select / status | 选项 id `string` |
| multi_select | 选项 id `string[]` |
| date | `{ start: string; end?: string }`（`YYYY-MM-DD` 或 ISO 时间） |
| person | 用户 id `string[]` |
| checkbox | `boolean` |

写入时服务端按属性类型校验并规范化，非法值拒绝。删除选项时清理行上的引用；删除属性时从所有行 `properties` 中移除该 key（`properties - id`）。

### 2.4 限制

单库 5000 行、50 个属性、20 个视图；单属性 100 个选项；过滤 20 条、排序 5 条。

## 3. 后端

新模块 `apps/server/src/core/database/`（controller、service、dto、filter 编译器），仓库 `apps/server/src/database/repos/database/`。路由沿用 `@Controller('databases')` + POST body 风格。

### 3.1 接口

| 路由 | 说明 |
|---|---|
| `POST /databases/create` | `{spaceId, parentPageId?, title?}`：建 `type='database'` 页面 + 默认属性（状态）+ 默认表格视图 |
| `POST /databases/info` | 返回属性列表、视图列表、权限 |
| `POST /databases/properties/create\|update\|delete\|reorder` | 属性管理 |
| `POST /databases/views/create\|update\|delete\|reorder` | 视图管理（含 config） |
| `POST /databases/rows/query` | `{databaseId, viewId?, filter?, sorts?, offset, limit≤200}` → `{items, total}` |
| `POST /databases/rows/create` | `{databaseId, title?, properties?, position?}` |
| `POST /databases/rows/update-properties` | `{pageId, properties}`：部分合并（`properties \|\| patch`） |
| `POST /databases/rows/move` | 看板拖拽：`{pageId, position, properties?}`，一次请求同时改分组和顺序 |

行删除、恢复、标题修改复用 `/pages/delete`、`/pages/restore`、`/pages/update`。

### 3.2 权限

所有接口先取数据库页面，再走现有链路：读用 `PageAccessService.validateCanView`，写用 `validateCanEdit`；agent 请求走 `AgentAccessService`。行权限继承数据库页（行是其子页面），M2 需用测试确认受限页面继承在行上成立。查询接口只返回调用者可见的行。

### 3.3 过滤与排序编译

`database-query.builder.ts`：把 `config.filter/sorts` 编译成 Kysely 表达式。

- 属性 id 必须属于该数据库，否则 400；运算符按类型白名单校验。
- 只用参数化值：`properties->>${id}`、`(properties->>${id})::numeric`、`properties->${id} @> ${json}`；不拼接任何用户字符串。
- 运算符：text `equals/contains/is_empty/is_not_empty`；number `= ≠ > ≥ < ≤ is_empty`；select/status `equals/not_equals/is_empty`；multi_select/person `contains/not_contains/is_empty`；date `on/before/after/on_or_before/on_or_after/is_empty`；checkbox `equals`。
- 排序空值放最后，最终以 `position, id` 兜底保证稳定分页。
- 日历视图查询带日期区间条件，按月拉取。

### 3.4 与现有页面逻辑的衔接

- `PageService.create`：父页面是数据库时自动设 `database_id`，保证任何入口建出的子页都是合法行。
- `getSidebarPages` 及子节点判断（`withHasChildren`）排除 `database_id is not null` 的页面；数据库自身照常显示在树中。
- `movePage` / `movePageToSpace`：拒绝把普通页面移入数据库或把行移出数据库（一期只能在数据库内建行）；整个数据库可整体移动。
- `duplicatePage`：遇到数据库返回 400（一期不支持复制）。
- 删除/恢复：数据库作为页面子树，现有级联逻辑覆盖行；`database_properties/views` 随硬删除级联。

### 3.5 实时

属性/视图/行变更后，前端按现有模式 `emit({operation:'invalidate', spaceId, entity:['database', databaseId]})`，其他客户端失效对应 query。行正文仍走 Yjs。属性单元格为"后写覆盖"。

## 4. 前端

新目录 `apps/client/src/features/database/`：`services/`、`queries/`、`types/`、`components/`。

- `pages/page/page.tsx`：`page.type === 'database'` 时渲染 `DatabaseView`（标题 + 视图标签栏 + 工具栏 + 视图），否则走原编辑器；行页面在编辑器上方渲染 `RowPropertiesPanel`。
- 表格：自研，Mantine + `@tanstack/react-virtual` 虚拟滚动；单元格按类型编辑器（文本输入、数字、`Select`/`MultiSelect`、`@mantine/dates` 日期、成员选择、复选框）；列头菜单（改名、改类型、隐藏、排序、删除）、列宽拖拽。
- 看板：按分组属性列出列，复用已有的 `@atlaskit/pragmatic-drag-and-drop` 做卡片拖拽，落点计算 fractional position，调用 `rows/move`。
- 日历：基于 `date-fns` 自研月视图网格，拖动卡片改日期，点击空白日期新建行。
- 工具栏：过滤、排序、属性可见性弹层；改动即保存到当前视图（有编辑权限时）。
- 侧边栏新建菜单加"数据库"；数据库节点用独立图标。
- i18n：`zh-CN` 与 `en-US` 同步新增 key。

不引入新依赖。

## 5. 与知识编译的边界

一期规则：`type='database'` 的页面和 `database_id is not null` 的行页面一律不进知识编译。

统一谓词：在 `apps/server/src/database/repos/llm-wiki/` 下新增 `knowledge-page-eligibility.ts`，导出 SQL 片段 `knowledgeEligiblePageSql(alias)` = `alias.type = 'page' AND alias.database_id IS NULL`，以及 TS 版 `isKnowledgeEligiblePage(page)`。所有入口只引用它。

接入点：

1. `knowledge-space-execution.repo.ts` `initializeRun`（全量与强制重建的页面列表）。
2. `knowledge-space-compilation.repo.ts`：`scheduleIncrementalCompileForPages`、`markDelayedPageForImmediateCompilation`、`requestIncrementalCompileForPages`、`forceResetAndCreateRun` 中枚举 pages 的 SQL。
3. `PageRepo.findPagesForKnowledgeExport` / `findPagesByIdsForKnowledgeExport`（导出层兜底）。
4. `knowledge-source-retirement.service.ts`：判断"仍在范围内"时加入谓词，使页面变为行后其旧知识被下线。

`page.listener.ts` 与协作持久化的入队可以不改：入队后在上述 SQL 层被过滤，结果一致且只有一处真相。

后续开放：改谓词并加库级开关；属性只写入知识块 metadata，不进入 `effectiveKnowledgeHash`。

## 6. 里程碑

| | 内容 | 验证 |
|---|---|---|
| M1 | 迁移（pages 三列 + 两表 + 索引 + 约束）、`migration:codegen`、`entity.types.ts` | 迁移 spec；up/down 可回滚 |
| M2 | 数据库/属性/视图/行 API、值校验、权限 | service/controller 单测 |
| M3 | 过滤排序编译器 | 每类型每运算符单测，含注入用例 |
| M4 | 页面逻辑衔接（§3.4）+ 知识编译排除（§5） | 回归测试：含数据库的空间，编译 run 页面清单不含数据库与行；行化页面触发下线 |
| M5 | 前端：数据库页、表格视图、属性面板、新建入口、i18n | 前端类型检查 + 组件测试 |
| M6 | 看板、日历、过滤排序工具栏、实时失效 | 手工走查 |
| M7（可选） | 编辑器内嵌视图节点（editor-ext + 客户端 + 服务端 `tiptapExtensions` 同步注册） | — |

每个里程碑完成后跑：`pnpm --filter ./apps/server test -- <pattern>`、服务端 `tsc --noEmit`、`pnpm --filter ./apps/client exec tsc --noEmit`。

## 7. 风险

- 行权限继承：受限页面的继承逻辑若只看 `parent_page_id` 链则天然成立，M2 需测试确认。
- 迁移在大表 `pages` 上加列：`add column ... default` 在 PG11+ 为元数据操作，GIN 索引建议 `CONCURRENTLY`（迁移需拆为非事务执行，或接受短锁）。
- 已有页面若被手动设为数据库子页的历史数据：一期无此路径，无需迁移数据。
