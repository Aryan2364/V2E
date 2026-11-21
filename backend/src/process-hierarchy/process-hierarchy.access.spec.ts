import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Principal } from '../access-rights/permissions.service';
import { ProcessAccessService } from './process-access.service';
import { ProcessMapService } from './process-map.service';
import { ProcessLaneService } from './process-lane.service';
import { ProcessNodeService } from './process-node.service';
import { ProcessAccessRulesService } from './process-access-rules.service';
import { ProcessArtifactService } from './process-artifact.service';
import { ProcessSnapshotService } from './process-snapshot.service';

/**
 * Process Hierarchy object-level access (backend/AUTHORIZATION.md). Visibility is
 * attachment-based (ProcessNodeAccess rules); the map owner and admins always pass.
 * Verified at the service layer after the god-service split: another org is blocked,
 * a user with no rule on the map is blocked, an allowed user passes.
 */

const ORG = 'org-1';
const MAP = 'map-1';
const NODE = 'node-1';
const principal = (userId: string, isAdmin = false): Principal => ({
  userId,
  systemRoleId: null,
  isAdmin,
  isSuperAdmin: false,
});

const OWNER = 'u-owner';
const VIEWER = 'u-viewer'; // view-level rule on NODE
const EDITOR = 'u-editor'; // edit-level rule on NODE
const OUTSIDER = 'u-outsider'; // no rule at all

function makePrisma() {
  const nodeRow = {
    id: NODE,
    map_id: MAP,
    organization_id: ORG,
    parent_node_id: null,
    created_by_user_id: OWNER,
    is_deleted: false,
    kind: 'task',
    name: 'Step',
    department_id: null,
    pool: null,
    responsible_user_id: null,
    responsible_role_id: null,
    linked_map_id: null,
  };
  const rules = [
    {
      id: 'r1',
      organization_id: ORG,
      node_id: NODE,
      node: { map_id: MAP },
      kind: 'user',
      user_id: VIEWER,
      level: 'view',
      department_id: null,
      role_id: null,
      include_sub_departments: false,
    },
    {
      id: 'r2',
      organization_id: ORG,
      node_id: NODE,
      node: { map_id: MAP },
      kind: 'user',
      user_id: EDITOR,
      level: 'edit',
      department_id: null,
      role_id: null,
      include_sub_departments: false,
    },
  ];
  const mapRow = {
    id: MAP,
    name: 'Map',
    chart_type: null,
    description: null,
    created_by_user_id: OWNER,
    created_at: new Date(),
    updated_at: new Date(),
  };
  const prisma: any = {
    employeeProfile: { findFirst: jest.fn(async () => null) },
    department: {
      findMany: jest.fn(async () => []),
      findFirst: jest.fn(async () => null),
    },
    processMap: {
      findFirst: jest.fn(async ({ where }: any) =>
        where.id === MAP && where.organization_id === ORG ? mapRow : null,
      ),
      findMany: jest.fn(async ({ where }: any) =>
        where.organization_id === ORG
          ? [
              {
                ...mapRow,
                parent_map_id: null,
                is_pinned: false,
                _count: { nodes: 1 },
              },
            ]
          : [],
      ),
      update: jest.fn(async () => ({ id: MAP })),
    },
    processNode: {
      findMany: jest.fn(async ({ where }: any) =>
        where.organization_id === ORG ? [nodeRow] : [],
      ),
      findFirst: jest.fn(async ({ where }: any) =>
        where.id === NODE &&
        where.map_id === MAP &&
        where.organization_id === ORG
          ? nodeRow
          : null,
      ),
      count: jest.fn(async () => 0),
      update: jest.fn(async () => nodeRow),
      create: jest.fn(async () => nodeRow),
    },
    processNodeAccess: {
      findMany: jest.fn(async ({ where }: any) => {
        if (where.organization_id !== ORG) return [];
        if (where.node_id?.in)
          return rules.filter((r) => where.node_id.in.includes(r.node_id));
        return rules.filter((r) => r.node_id === NODE);
      }),
      create: jest.fn(async () => rules[0]),
    },
    processArtifact: { findMany: jest.fn(async () => [{ id: 'a1' }]) },
    processSnapshot: {
      findMany: jest.fn(async () => [{ id: 's1' }]),
      create: jest.fn(),
    },
    processConnection: { create: jest.fn(), findMany: jest.fn(async () => []) },
    processLane: {
      findFirst: jest.fn(async () => null),
      findMany: jest.fn(async () => []),
    },
    $transaction: jest.fn(async (arg: any) =>
      Array.isArray(arg) ? Promise.all(arg) : arg({}),
    ),
  };
  // Any model the access paths do not care about behaves as an empty table.
  return new Proxy(prisma, {
    get: (target, prop: string) =>
      prop in target
        ? target[prop]
        : new Proxy(
            {},
            {
              get: (_t, method: string) =>
                jest.fn(async () =>
                  method === 'findMany' ? [] : method === 'count' ? 0 : null,
                ),
            },
          ),
  });
}

function build() {
  const prisma = makePrisma();
  const access = new ProcessAccessService(prisma);
  const rules = new ProcessAccessRulesService(prisma, access);
  const lanes = new ProcessLaneService(prisma, access);
  return {
    prisma,
    maps: new ProcessMapService(prisma, access),
    nodes: new ProcessNodeService(prisma, access, lanes, rules),
    rules,
    artifacts: new ProcessArtifactService(prisma, access, {} as any),
    snapshots: new ProcessSnapshotService(prisma, access),
  };
}

describe('Process hierarchy access gating', () => {
  describe('map reads', () => {
    it('blocks another organisation (map not found)', async () => {
      const { maps, artifacts, snapshots } = build();
      const other = principal(OWNER);
      await expect(maps.getMap('org-2', other, MAP)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      await expect(
        artifacts.listArtifacts('org-2', other, MAP),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(
        snapshots.listSnapshots('org-2', other, MAP),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('blocks a user with no access rule on the map', async () => {
      const { maps, artifacts, snapshots } = build();
      const p = principal(OUTSIDER);
      await expect(maps.getMap(ORG, p, MAP)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      await expect(artifacts.listArtifacts(ORG, p, MAP)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      await expect(snapshots.listSnapshots(ORG, p, MAP)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('lets the owner, an admin and a user with a rule read', async () => {
      const { maps, artifacts, snapshots } = build();
      for (const p of [
        principal(OWNER),
        principal('x', true),
        principal(VIEWER),
      ]) {
        await expect(maps.getMap(ORG, p, MAP)).resolves.toMatchObject({
          id: MAP,
        });
        await expect(
          artifacts.listArtifacts(ORG, p, MAP),
        ).resolves.toHaveLength(1);
        await expect(
          snapshots.listSnapshots(ORG, p, MAP),
        ).resolves.toHaveLength(1);
      }
    });

    it('listMaps hides maps the caller cannot see and shows shared ones', async () => {
      const { maps } = build();
      expect(await maps.listMaps(ORG, principal(OUTSIDER))).toHaveLength(0);
      expect(await maps.listMaps(ORG, principal(VIEWER))).toHaveLength(1);
      expect(await maps.listMaps('org-2', principal(OWNER))).toHaveLength(0);
    });
  });

  describe('map mutations (owner/admin only)', () => {
    it('blocks a rule-holder and an outsider from renaming or snapshotting', async () => {
      const { maps, snapshots, prisma } = build();
      for (const u of [VIEWER, EDITOR, OUTSIDER]) {
        await expect(
          maps.updateMap(ORG, principal(u), MAP, { name: 'x' } as any),
        ).rejects.toBeInstanceOf(ForbiddenException);
        await expect(
          snapshots.createSnapshot(ORG, principal(u), MAP, {
            label: 'x',
          } as any),
        ).rejects.toBeInstanceOf(ForbiddenException);
      }
      expect(prisma.processMap.update).not.toHaveBeenCalled();
      expect(prisma.processSnapshot.create).not.toHaveBeenCalled();
    });

    it('blocks another organisation', async () => {
      const { maps } = build();
      await expect(
        maps.updateMap('org-2', principal(OWNER), MAP, { name: 'x' } as any),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('lets the owner and an admin rename', async () => {
      const { maps, prisma } = build();
      await maps.updateMap(ORG, principal(OWNER), MAP, {
        name: ' New ',
      });
      await maps.updateMap(ORG, principal('x', true), MAP, {
        name: 'Newer',
      });
      expect(prisma.processMap.update).toHaveBeenCalledTimes(2);
    });
  });

  describe('node reads', () => {
    it('blocks another organisation', async () => {
      const { nodes } = build();
      await expect(
        nodes.getNode('org-2', principal(OWNER), MAP, NODE),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('blocks a user without a rule on the node chain', async () => {
      const { nodes } = build();
      await expect(
        nodes.getNode(ORG, principal(OUTSIDER), MAP, NODE),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('lets the owner and a user with a view rule read the node', async () => {
      const { nodes } = build();
      for (const p of [principal(OWNER), principal(VIEWER)]) {
        await expect(nodes.getNode(ORG, p, MAP, NODE)).resolves.toMatchObject({
          id: NODE,
        });
      }
    });

    it('lists node access rules only for an editor of that node', async () => {
      const { rules } = build();
      await expect(
        rules.listNodeAccess(ORG, principal(OUTSIDER), MAP, NODE),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(
        rules.listNodeAccess(ORG, principal(VIEWER), MAP, NODE),
      ).rejects.toBeInstanceOf(ForbiddenException);
      await expect(
        rules.listNodeAccess('org-2', principal(OWNER), MAP, NODE),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(
        rules.listNodeAccess(ORG, principal(EDITOR), MAP, NODE),
      ).resolves.toBeDefined();
    });
  });

  describe('node mutations', () => {
    it('hides the node from an outsider and forbids a view-only user', async () => {
      const { nodes, prisma } = build();
      await expect(
        nodes.updateNode(ORG, principal(OUTSIDER), MAP, NODE, {
          name: 'x',
        } as any),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(
        nodes.updateNode(ORG, principal(VIEWER), MAP, NODE, {
          name: 'x',
        } as any),
      ).rejects.toBeInstanceOf(ForbiddenException);
      await expect(
        nodes.deleteNode(ORG, principal(OUTSIDER), MAP, NODE),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(
        nodes.deleteNode(ORG, principal(VIEWER), MAP, NODE),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.processNode.update).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('blocks another organisation', async () => {
      const { nodes } = build();
      await expect(
        nodes.updateNode('org-2', principal(OWNER), MAP, NODE, {
          name: 'x',
        } as any),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(
        nodes.deleteNode('org-2', principal(OWNER), MAP, NODE),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('creating a node needs map access, and under a parent needs edit on the parent', async () => {
      const { nodes } = build();
      await expect(
        nodes.createNode(ORG, principal(OUTSIDER), MAP, {
          kind: 'task',
          name: 'n',
        } as any),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(
        nodes.createNode(ORG, principal(VIEWER), MAP, {
          kind: 'task',
          name: 'n',
          parent_node_id: NODE,
        } as any),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('lets an edit-rule user and the owner update a node', async () => {
      const { nodes, prisma } = build();
      await nodes.updateNode(ORG, principal(EDITOR), MAP, NODE, {
        name: 'x',
      });
      await nodes.updateNode(ORG, principal(OWNER), MAP, NODE, {
        name: 'y',
      });
      expect(prisma.processNode.update).toHaveBeenCalledTimes(2);
    });
  });
});
