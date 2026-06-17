import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AiChatRepo } from '@docmost/db/repos/ai-chat/ai-chat.repo';
import { SpaceMemberRepo } from '@docmost/db/repos/space/space-member.repo';
import { SpaceRepo } from '@docmost/db/repos/space/space.repo';
import { AiChat, User, Workspace } from '@docmost/db/types/entity.types';
import { PaginationOptions } from '@docmost/db/pagination/pagination-options';
import { UserRole } from '../../common/helpers/types/permission';
import { AiKnowledgeChatService } from '../llm-wiki/services/ai-knowledge-chat.service';

export type SendAiChatMessageInput = {
  workspace: Workspace;
  user: User;
  chatId?: string;
  content: string;
  mentionedPageIds?: string[];
  contextPageId?: string;
  attachmentIds?: string[];
};

export type SendAiChatMessageResult = {
  chatId: string;
  assistantMessageId: string;
  answer: string;
};

@Injectable()
export class AiChatService {
  constructor(
    private readonly aiChatRepo: AiChatRepo,
    private readonly spaceRepo: SpaceRepo,
    private readonly spaceMemberRepo: SpaceMemberRepo,
    private readonly knowledgeChat: AiKnowledgeChatService,
  ) {}

  async createChat(input: { workspaceId: string; userId: string }) {
    return this.aiChatRepo.createChat({
      workspaceId: input.workspaceId,
      creatorId: input.userId,
      title: null,
    });
  }

  async listChats(input: {
    workspaceId: string;
    userId: string;
    pagination: PaginationOptions;
  }) {
    return this.aiChatRepo.listChats(input);
  }

  async getChatInfo(input: {
    workspaceId: string;
    userId: string;
    chatId: string;
  }) {
    const chat = await this.getOwnedChat(input);
    const messages = await this.aiChatRepo.findMessages({
      workspaceId: input.workspaceId,
      chatId: input.chatId,
    });

    return { chat, messages };
  }

  async deleteChat(input: {
    workspaceId: string;
    userId: string;
    chatId: string;
  }): Promise<void> {
    await this.getOwnedChat(input);
    await this.aiChatRepo.softDeleteChat(input);
  }

  async updateChatTitle(input: {
    workspaceId: string;
    userId: string;
    chatId: string;
    title: string;
  }): Promise<void> {
    await this.getOwnedChat(input);
    await this.aiChatRepo.updateChatTitle(input);
  }

  async searchChats(input: {
    workspaceId: string;
    userId: string;
    query: string;
  }) {
    return this.aiChatRepo.searchChats(input);
  }

  async sendMessage(
    input: SendAiChatMessageInput,
  ): Promise<SendAiChatMessageResult> {
    const content = input.content.trim();
    if (!content && !input.attachmentIds?.length) {
      throw new BadRequestException('Message content is required');
    }

    const chat = input.chatId
      ? await this.getOwnedChat({
          workspaceId: input.workspace.id,
          userId: input.user.id,
          chatId: input.chatId,
        })
      : await this.aiChatRepo.createChat({
          workspaceId: input.workspace.id,
          creatorId: input.user.id,
          title: buildTitle(content),
        });

    const previousMessages = input.chatId
      ? await this.aiChatRepo.findMessages({
          workspaceId: input.workspace.id,
          chatId: chat.id,
          limit: 20,
        })
      : [];

    await this.aiChatRepo.addMessage({
      workspaceId: input.workspace.id,
      chatId: chat.id,
      userId: input.user.id,
      role: 'user',
      content,
      toolCalls: null,
      metadata: buildUserMetadata(input) as never,
    });

    const spaceIds = await this.getDefaultReadableSpaceIds({
      workspaceId: input.workspace.id,
      user: input.user,
    });

    const answer = await this.knowledgeChat.chat({
      workspaceId: input.workspace.id,
      userId: input.user.id,
      query: content,
      spaceIds,
      chatContext: previousMessages
        .filter((message) => message.content)
        .slice(-8)
        .map((message) => `${message.role}: ${message.content}`),
      workspace: input.workspace,
    });

    const assistantMessage = await this.aiChatRepo.addMessage({
      workspaceId: input.workspace.id,
      chatId: chat.id,
      userId: null,
      role: 'assistant',
      content: answer.answer,
      toolCalls: null,
      metadata: {
        citations: answer.citations,
        completenessNotice: answer.completenessNotice,
      } as never,
    });

    return {
      chatId: chat.id,
      assistantMessageId: assistantMessage.id,
      answer: answer.answer,
    };
  }

  private async getOwnedChat(input: {
    workspaceId: string;
    userId: string;
    chatId: string;
  }): Promise<AiChat> {
    const chat = await this.aiChatRepo.findChatByIdForUser(input);
    if (!chat) {
      throw new NotFoundException('Chat not found');
    }

    return chat;
  }

  private async getDefaultReadableSpaceIds(input: {
    workspaceId: string;
    user: User;
  }): Promise<string[]> {
    if (input.user.role === UserRole.OWNER) {
      const spaces = await this.spaceRepo.getSpacesInWorkspace(input.workspaceId, {
        limit: 100,
      } as PaginationOptions);
      return spaces.items.map((space) => space.id);
    }

    return this.spaceMemberRepo.getUserSpaceIds(input.user.id);
  }
}

function buildTitle(content: string): string {
  const title = content.replace(/\s+/g, ' ').trim();
  return title.length > 60 ? `${title.slice(0, 57)}...` : title || 'New chat';
}

function buildUserMetadata(input: SendAiChatMessageInput) {
  const metadata: Record<string, unknown> = {};
  if (input.mentionedPageIds?.length) {
    metadata.mentionedPageIds = input.mentionedPageIds;
  }
  if (input.contextPageId) {
    metadata.contextPageId = input.contextPageId;
  }
  if (input.attachmentIds?.length) {
    metadata.attachmentIds = input.attachmentIds;
  }

  return Object.keys(metadata).length ? metadata : null;
}
