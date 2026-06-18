import { Injectable } from '@nestjs/common';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { embed, EmbeddingModel } from 'ai';
import { createOllama } from 'ai-sdk-ollama';
import { EnvironmentService } from '../../../integrations/environment/environment.service';

export interface KnowledgeEmbeddingProvider {
  embedQuery(query: string): Promise<number[] | null>;
}

@Injectable()
export class ConfiguredKnowledgeEmbeddingProvider
  implements KnowledgeEmbeddingProvider
{
  constructor(private readonly environmentService: EnvironmentService) {}

  async embedQuery(query: string): Promise<number[] | null> {
    const driver = this.environmentService.getAiDriver();
    const model = this.createEmbeddingModel(driver);
    if (!driver || !model || query.trim().length === 0) {
      return null;
    }

    try {
      const result = await embed({
        model,
        value: query,
      });
      return result.embedding;
    } catch {
      return null;
    }
  }

  private createEmbeddingModel(driver?: string): EmbeddingModel | undefined {
    const modelName = this.environmentService.getAiEmbeddingModel();
    if (!driver || !modelName) {
      return undefined;
    }

    switch (driver) {
      case 'openai': {
        return createOpenAI({
          apiKey: this.environmentService.getOpenAiApiKey(),
          baseURL: this.environmentService.getOpenAiApiUrl(),
        }).embeddingModel(modelName);
      }
      case 'openai-compatible': {
        return createOpenAICompatible({
          name: 'openai-compatible',
          apiKey: this.environmentService.getOpenAiApiKey(),
          baseURL: this.environmentService.getOpenAiApiUrl(),
        }).embeddingModel(modelName);
      }
      case 'gemini': {
        return createGoogleGenerativeAI({
          apiKey: this.environmentService.getGeminiApiKey(),
        }).textEmbeddingModel(modelName);
      }
      case 'ollama': {
        return createOllama({
          baseURL: this.environmentService.getOllamaApiUrl(),
        }).textEmbeddingModel(modelName);
      }
      default:
        return undefined;
    }
  }
}
