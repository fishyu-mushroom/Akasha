import { SpaceMemberRepo } from './space-member.repo';

type QueryCall = {
  method: string;
  args: unknown[];
};

class FakeKyselyQuery {
  readonly calls: QueryCall[] = [];

  constructor(private readonly result: unknown[] = []) {}

  selectFrom(...args: unknown[]) {
    this.calls.push({ method: 'selectFrom', args });
    return this;
  }

  select(...args: unknown[]) {
    this.calls.push({ method: 'select', args });
    return this;
  }

  where(...args: unknown[]) {
    this.calls.push({ method: 'where', args });
    return this;
  }

  innerJoin(...args: unknown[]) {
    this.calls.push({ method: 'innerJoin', args });
    return this;
  }

  unionAll(query: unknown) {
    this.calls.push({ method: 'unionAll', args: [query] });
    return this;
  }

  async execute() {
    this.calls.push({ method: 'execute', args: [] });
    return this.result;
  }
}

function createRepo(query: FakeKyselyQuery) {
  return new SpaceMemberRepo(query as never, undefined, undefined, undefined);
}

describe('SpaceMemberRepo.findUserSpaceRolesForSpaces', () => {
  it('returns an empty array without querying when spaceIds is empty', async () => {
    const query = new FakeKyselyQuery();
    const repo = createRepo(query);

    await expect(
      repo.findUserSpaceRolesForSpaces({ userId: 'user-1', spaceIds: [] }),
    ).resolves.toEqual([]);

    expect(query.calls).toEqual([]);
  });

  it('queries direct and group roles for all requested spaces in one call', async () => {
    const rows = [
      { userId: 'user-1', spaceId: 'space-1', role: 'reader' },
      { userId: 'user-1', spaceId: 'space-2', role: 'writer' },
    ];
    const query = new FakeKyselyQuery(rows);
    const repo = createRepo(query);

    await expect(
      repo.findUserSpaceRolesForSpaces({
        userId: 'user-1',
        spaceIds: ['space-1', 'space-2'],
      }),
    ).resolves.toEqual(rows);

    expect(query.calls).toEqual(
      expect.arrayContaining([
        { method: 'selectFrom', args: ['spaceMembers'] },
        { method: 'where', args: ['userId', '=', 'user-1'] },
        { method: 'where', args: ['spaceId', 'in', ['space-1', 'space-2']] },
        { method: 'unionAll', args: [query] },
        { method: 'execute', args: [] },
      ]),
    );
  });
});
