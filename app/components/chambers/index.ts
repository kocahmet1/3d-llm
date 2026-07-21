import type {
  ChamberProcessContext,
  ChamberProcessUpdater,
} from "./processShared";
import { buildEarlyProcess } from "./earlyProcesses";
import { buildAttentionProcess } from "./attentionProcesses";
import { buildLearningProcess } from "./learningProcesses";

export function buildDistinctChamberProcess(
  context: ChamberProcessContext,
): ChamberProcessUpdater | undefined {
  return (
    buildEarlyProcess(context) ??
    buildAttentionProcess(context) ??
    buildLearningProcess(context)
  );
}

export type {
  ChamberProcessContext,
  ChamberProcessUpdater,
} from "./processShared";
