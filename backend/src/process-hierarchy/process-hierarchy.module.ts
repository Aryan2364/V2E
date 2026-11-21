import { Module } from '@nestjs/common';
import { ProcessHierarchyController } from './process-hierarchy.controller';
import { ProcessAccessService } from './process-access.service';
import { ProcessMapService } from './process-map.service';
import { ProcessLaneService } from './process-lane.service';
import { ProcessNodeService } from './process-node.service';
import { ProcessConnectionService } from './process-connection.service';
import { ProcessArtifactService } from './process-artifact.service';
import { ProcessAccessRulesService } from './process-access-rules.service';
import { ProcessSnapshotService } from './process-snapshot.service';
import { ProcessReviewService } from './process-review.service';
import { ProcessTemplateService } from './process-template.service';
import { ProcessNodeCopyService } from './process-node-copy.service';

/**
 * Process Hierarchy — BPMN-lite recursive process explorer.
 * PrismaModule, StorageModule (R2Service) and AccessRightsModule are global, so no
 * imports are needed. The attachment-based access engine lives in ProcessAccessService.
 * DI graph is acyclic: Template -> Copy -> (Node -> Lane, AccessRules), Snapshot; Review -> (none).
 */
@Module({
  controllers: [ProcessHierarchyController],
  providers: [
    ProcessAccessService,
    ProcessMapService,
    ProcessLaneService,
    ProcessNodeService,
    ProcessConnectionService,
    ProcessArtifactService,
    ProcessAccessRulesService,
    ProcessSnapshotService,
    ProcessReviewService,
    ProcessTemplateService,
    ProcessNodeCopyService,
  ],
})
export class ProcessHierarchyModule {}
