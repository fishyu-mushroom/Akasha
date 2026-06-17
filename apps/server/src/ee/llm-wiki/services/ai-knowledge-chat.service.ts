import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { Workspace } from '@docmost/db/types/entity.types';
import { KNOWLEDGE_ANSWER_PROVIDER } from '../llm-wiki.constants';
import {
  KnowledgeAnswerProvider,
  KnowledgeAnswerProviderInput,
} from './knowledge-answer-provider.service';
import { KnowledgeCitationResolverService } from './knowledge-citation-resolver.service';
import { KnowledgeContextPackService } from './knowledge-context-pack.service';
import { KnowledgeRetrievalService } from './knowledge-retrieval.service';

export { KnowledgeAnswerProvider, KnowledgeAnswerProviderInput };

type AiKnowledgeChatInput = {
  workspaceId: string;
  userId: string;
  query: string;
  spaceIds: string[];
  chatContext?: string[];
  workspace?: Workspace;
};

type AiKnowledgeChatResult = {
  answer: string;
  citations: ReturnType<KnowledgeContextPackService['buildContextPack']>['citations'];
  completenessNotice: ReturnType<
    KnowledgeContextPackService['buildContextPack']
  >['completenessNotice'];
};

@Injectable()
export class AiKnowledgeChatService {
  constructor(
    private readonly retrieval: KnowledgeRetrievalService,
    private readonly contextPack: KnowledgeContextPackService,
    private readonly citationResolver: KnowledgeCitationResolverService,
    @Inject(KNOWLEDGE_ANSWER_PROVIDER)
    private readonly answerProvider: KnowledgeAnswerProvider,
  ) {}

  async chat(input: AiKnowledgeChatInput): Promise<AiKnowledgeChatResult> {
    if (input.workspace && !this.isEnabledForWorkspace(input.workspace)) {
      throw new ForbiddenException('AI knowledge chat is disabled');
    }

    const retrieval = await this.retrieval.retrieve({
      workspaceId: input.workspaceId,
      userId: input.userId,
      query: input.query,
      spaceIds: input.spaceIds,
    });
    const chunkCitations = retrieval.chunks.length
      ? await this.citationResolver.resolveForChunks({
          workspaceId: input.workspaceId,
          chunks: retrieval.chunks,
        })
      : undefined;
    const capsuleCitations =
      !chunkCitations && retrieval.capsules.length
        ? await this.citationResolver.resolveForCapsules({
            workspaceId: input.workspaceId,
            userId: input.userId,
            capsules: retrieval.capsules,
          })
        : undefined;
    const pack = this.contextPack.buildContextPack({
      chunks: chunkCitations,
      capsules: capsuleCitations,
    });
    const answer = await this.answerProvider.answer({
      query: input.query,
      context: pack.context,
      chatContext: input.chatContext,
    });

    return {
      answer,
      citations: pack.citations,
      completenessNotice: pack.completenessNotice,
    };
  }

  isEnabledForWorkspace(workspace: Workspace): boolean {
    return getWorkspaceAiChatEnabled(workspace);
  }
}

function getWorkspaceAiChatEnabled(workspace: Workspace): boolean {
  const settings = workspace.settings;
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
    return false;
  }

  const aiSettings = (settings as Record<string, unknown>).ai;
  if (
    !aiSettings ||
    typeof aiSettings !== 'object' ||
    Array.isArray(aiSettings)
  ) {
    return false;
  }

  return (aiSettings as Record<string, unknown>).chat === true;
}
