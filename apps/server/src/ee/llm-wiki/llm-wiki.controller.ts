import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { createHash } from 'crypto';
import { Queue } from 'bullmq';
import { User, Workspace } from '@docmost/db/types/entity.types';
import { AuthUser } from '../../common/decorators/auth-user.decorator';
import { AuthWorkspace } from '../../common/decorators/auth-workspace.decorator';
import { AuditEvent, AuditResource } from '../../common/events/audit-events';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { UserRole } from '../../common/helpers/types/permission';
import {
  AUDIT_SERVICE,
  IAuditService,
} from '../../integrations/audit/audit.service';
import { QueueJob, QueueName } from '../../integrations/queue/constants';
import {
  DEFAULT_KNOWLEDGE_COMPILER_VERSION,
  DEFAULT_KNOWLEDGE_PROMPT_VERSION,
} from './llm-wiki.constants';
import { CompileSpacesDto } from './dto/compile-spaces.dto';
import { AdminKnowledgeDiagnosticsDto } from './dto/admin-diagnostics.dto';
import { ImportCompileResultDto } from './dto/import-compile-result.dto';
import { KnowledgeGraphDto } from './dto/knowledge-graph.dto';
import { QueryKnowledgeDto } from './dto/query-knowledge.dto';
import { AiKnowledgeChatService } from './services/ai-knowledge-chat.service';
import { KnowledgeDiagnosticsService } from './services/knowledge-diagnostics.service';
import { KnowledgeGraphService } from './services/knowledge-graph.service';
import { KnowledgeImportService } from './services/knowledge-import.service';

@UseGuards(JwtAuthGuard)
@Controller('llm-wiki')
export class LlmWikiController {
  constructor(
    private readonly chatService: AiKnowledgeChatService,
    @Inject(AUDIT_SERVICE) private readonly auditService: IAuditService,
    private readonly importService: KnowledgeImportService,
    private readonly diagnosticsService: KnowledgeDiagnosticsService,
    private readonly graphService: KnowledgeGraphService,
    @InjectQueue(QueueName.AI_QUEUE) private readonly aiQueue: Queue,
  ) {}

  @HttpCode(HttpStatus.OK)
  @Post('query')
  async queryKnowledge(
    @Body() dto: QueryKnowledgeDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    if (!this.chatService.isEnabledForWorkspace(workspace)) {
      throw new ForbiddenException('AI knowledge chat is disabled');
    }

    const result = await this.chatService.chat({
      workspaceId: workspace.id,
      userId: user.id,
      query: dto.query,
      spaceIds: dto.spaceIds,
      chatContext: dto.chatContext,
      workspace,
    });

    this.auditService.log({
      event: AuditEvent.KNOWLEDGE_QUERY,
      resourceType: AuditResource.KNOWLEDGE,
      resourceId: workspace.id,
      metadata: {
        queryHash: hashQuery(dto.query),
        spaceIds: dto.spaceIds,
        citationCount: result.citations.length,
      },
    });

    return result;
  }

  @Get('graph')
  async getGraph(
    @Query() dto: KnowledgeGraphDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    if (!this.chatService.isEnabledForWorkspace(workspace)) {
      throw new ForbiddenException('AI knowledge chat is disabled');
    }

    return this.graphService.getSpaceGraph({
      workspaceId: workspace.id,
      userId: user.id,
      spaceId: dto.spaceId,
      limit: dto.limit,
    });
  }

  @HttpCode(HttpStatus.OK)
  @Post('admin/compile-spaces')
  async compileSpaces(
    @Body() dto: CompileSpacesDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    if (!this.chatService.isEnabledForWorkspace(workspace)) {
      throw new ForbiddenException('AI knowledge chat is disabled');
    }

    if (user.role !== UserRole.OWNER && user.role !== UserRole.ADMIN) {
      throw new ForbiddenException('AI knowledge compile is restricted to admins');
    }

    const spaceIds = unique(dto.spaceIds);
    for (const spaceId of spaceIds) {
      await this.aiQueue.add(QueueJob.KNOWLEDGE_COMPILE_SPACE, {
        workspaceId: workspace.id,
        spaceId,
      });
    }

    this.auditService.log({
      event: AuditEvent.KNOWLEDGE_COMPILE_QUEUED,
      resourceType: AuditResource.KNOWLEDGE,
      resourceId: workspace.id,
      metadata: {
        spaceIds,
        queuedSpaceCount: spaceIds.length,
      },
    });

    return { queuedSpaceCount: spaceIds.length };
  }

  @HttpCode(HttpStatus.OK)
  @Post('admin/diagnostics')
  async getDiagnostics(
    @Body() dto: AdminKnowledgeDiagnosticsDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    if (!this.chatService.isEnabledForWorkspace(workspace)) {
      throw new ForbiddenException('AI knowledge chat is disabled');
    }

    if (user.role !== UserRole.OWNER && user.role !== UserRole.ADMIN) {
      throw new ForbiddenException(
        'AI knowledge diagnostics is restricted to admins',
      );
    }

    return this.diagnosticsService.getWorkspaceDiagnostics({
      workspaceId: workspace.id,
      spaceIds: dto.spaceIds,
      limit: dto.limit,
    });
  }

  @HttpCode(HttpStatus.OK)
  @Post('admin/import-compile-result')
  async importCompileResult(
    @Body() dto: ImportCompileResultDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    if (!this.chatService.isEnabledForWorkspace(workspace)) {
      throw new ForbiddenException('AI knowledge chat is disabled');
    }

    if (user.role !== UserRole.OWNER && user.role !== UserRole.ADMIN) {
      throw new ForbiddenException('AI knowledge import is restricted to admins');
    }

    const result = await this.importService.importCompileResult({
      input: {
        workspaceId: workspace.id,
        spaceId: dto.spaceId,
        compilerVersion:
          dto.compilerVersion ?? DEFAULT_KNOWLEDGE_COMPILER_VERSION,
        promptVersion: dto.promptVersion ?? DEFAULT_KNOWLEDGE_PROMPT_VERSION,
        sources: dto.sources,
      },
      artifacts: dto.artifacts,
    });

    this.auditService.log({
      event: AuditEvent.KNOWLEDGE_IMPORT,
      resourceType: AuditResource.KNOWLEDGE,
      resourceId: dto.spaceId,
      metadata: {
        artifactCount: dto.artifacts.length,
        sourceCount: dto.sources.length,
        importedArtifactCount: result.importedArtifactCount,
        quarantinedArtifactCount: result.quarantinedArtifactCount,
      },
    });

    return result;
  }
}

function hashQuery(query: string): string {
  return `sha256:${createHash('sha256').update(query).digest('hex')}`;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
