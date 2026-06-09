import { Injectable } from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB } from '@docmost/db/types/kysely.types';
import { jsonObjectFrom } from 'kysely/helpers/postgres';

@Injectable()
export class ApiKeyRepo {
  constructor(@InjectKysely() private readonly db: KyselyDB) {}

  async findById(id: string, workspaceId: string) {
    return this.db
      .selectFrom('apiKeys')
      .selectAll()
      .where('id', '=', id)
      .where('workspaceId', '=', workspaceId)
      .where('deletedAt', 'is', null)
      .executeTakeFirst();
  }

  async findUserKeys(creatorId: string, workspaceId: string, pagination: { limit: number; after?: string }) {
    let query = this.db
      .selectFrom('apiKeys as ak')
      .selectAll('ak')
      .select((eb) =>
        jsonObjectFrom(
          eb.selectFrom('users').select(['id', 'name', 'email', 'avatarUrl']).whereRef('users.id', '=', 'ak.creatorId'),
        ).as('creator'),
      )
      .where('ak.creatorId', '=', creatorId)
      .where('ak.workspaceId', '=', workspaceId)
      .where('ak.deletedAt', 'is', null)
      .orderBy('ak.createdAt', 'desc')
      .limit(pagination.limit + 1);

    if (pagination.after) {
      query = query.where('ak.id', '<', pagination.after);
    }
    return query.execute();
  }

  async findWorkspaceKeys(workspaceId: string, pagination: { limit: number; after?: string }) {
    let query = this.db
      .selectFrom('apiKeys as ak')
      .selectAll('ak')
      .select((eb) =>
        jsonObjectFrom(
          eb.selectFrom('users').select(['id', 'name', 'email', 'avatarUrl']).whereRef('users.id', '=', 'ak.creatorId'),
        ).as('creator'),
      )
      .where('ak.workspaceId', '=', workspaceId)
      .where('ak.deletedAt', 'is', null)
      .orderBy('ak.createdAt', 'desc')
      .limit(pagination.limit + 1);

    if (pagination.after) {
      query = query.where('ak.id', '<', pagination.after);
    }
    return query.execute();
  }

  async create(data: { name: string; creatorId: string; workspaceId: string; expiresAt?: Date | null }) {
    return this.db
      .insertInto('apiKeys')
      .values({
        name: data.name,
        creatorId: data.creatorId,
        workspaceId: data.workspaceId,
        expiresAt: data.expiresAt ?? null,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async updateName(id: string, workspaceId: string, name: string) {
    return this.db
      .updateTable('apiKeys')
      .set({ name, updatedAt: new Date() })
      .where('id', '=', id)
      .where('workspaceId', '=', workspaceId)
      .where('deletedAt', 'is', null)
      .returningAll()
      .executeTakeFirst();
  }

  async softDelete(id: string, workspaceId: string) {
    return this.db
      .updateTable('apiKeys')
      .set({ deletedAt: new Date() })
      .where('id', '=', id)
      .where('workspaceId', '=', workspaceId)
      .executeTakeFirst();
  }

  async updateLastUsed(id: string) {
    await this.db
      .updateTable('apiKeys')
      .set({ lastUsedAt: new Date() })
      .where('id', '=', id)
      .execute();
  }
}
