import { TRAINING_STATIONS } from "./trainingTrace";
import type {
  BranchSide,
  DetailMode,
  RideMode,
} from "./worldTypes";

export interface AssistantAppToolDefinition {
  readonly type: "function";
  readonly name: string;
  readonly description: string;
  readonly parameters: Readonly<Record<string, unknown>>;
}

export type AssistantAppCommand =
  | {
      readonly kind: "navigate_chamber";
      readonly destination: string;
    }
  | {
      readonly kind: "set_journey_playback";
      readonly action: "play" | "pause" | "restart";
    }
  | {
      readonly kind: "set_detail_mode";
      readonly mode: DetailMode;
    }
  | {
      readonly kind: "set_ride_mode";
      readonly mode: RideMode;
    }
  | {
      readonly kind: "choose_branch";
      readonly side: BranchSide;
    }
  | {
      readonly kind: "control_data_preparation";
      readonly action: "play" | "pause" | "restart";
    };

export type AssistantAppCommandParseResult =
  | {
      readonly ok: true;
      readonly command: AssistantAppCommand;
    }
  | {
      readonly ok: false;
      readonly error: string;
    };

const RELATIVE_CHAMBER_DESTINATIONS = [
  "next",
  "previous",
  "first",
  "last",
] as const;

const JOURNEY_ACTIONS = ["play", "pause", "restart"] as const;
const DETAIL_MODES = ["story", "structure", "math", "code"] as const;
const RIDE_MODES = ["overview", "explore"] as const;
const BRANCH_SIDES = ["left", "right"] as const;
const DATA_PREPARATION_ACTIONS = ["play", "pause", "restart"] as const;

export const ASSISTANT_CHAMBER_IDS = Object.freeze(
  TRAINING_STATIONS.map((station) => station.id),
);

const CHAMBER_DESTINATIONS = Object.freeze([
  ...RELATIVE_CHAMBER_DESTINATIONS,
  ...ASSISTANT_CHAMBER_IDS,
]);
const CHAMBER_DIRECTORY = TRAINING_STATIONS.map(
  (station) => `${station.id} = ${station.title}`,
).join("; ");

export function resolveAssistantChamberIndex(
  currentIndex: number,
  destination: string,
): number | null {
  const lastIndex = TRAINING_STATIONS.length - 1;
  const safeCurrentIndex = Math.min(
    lastIndex,
    Math.max(0, Math.round(currentIndex)),
  );

  if (destination === "next") {
    return Math.min(lastIndex, safeCurrentIndex + 1);
  }
  if (destination === "previous") {
    return Math.max(0, safeCurrentIndex - 1);
  }
  if (destination === "first") return 0;
  if (destination === "last") return lastIndex;

  const stationIndex = TRAINING_STATIONS.findIndex(
    (station) => station.id === destination,
  );
  return stationIndex >= 0 ? stationIndex : null;
}

function functionTool(
  name: string,
  description: string,
  propertyName: string,
  propertyDescription: string,
  values: readonly string[],
): AssistantAppToolDefinition {
  return Object.freeze({
    type: "function" as const,
    name,
    description,
    parameters: Object.freeze({
      type: "object",
      additionalProperties: false,
      properties: Object.freeze({
        [propertyName]: Object.freeze({
          type: "string",
          enum: values,
          description: propertyDescription,
        }),
      }),
      required: Object.freeze([propertyName]),
    }),
  });
}

/**
 * Reversible, application-owned controls available to the voice guide.
 * The model never receives a generic click, selector, URL, or script tool.
 */
export const ASSISTANT_APP_TOOLS: readonly AssistantAppToolDefinition[] =
  Object.freeze([
    functionTool(
      "navigate_chamber",
      `Move the visitor to a chamber when they explicitly ask to go, move, continue, return, or navigate. Use one tool call per requested move. Do not use this merely to explain another chamber. Chamber directory: ${CHAMBER_DIRECTORY}.`,
      "destination",
      "Use next, previous, first, or last for relative navigation; otherwise use the exact stable chamber ID.",
      CHAMBER_DESTINATIONS,
    ),
    functionTool(
      "set_journey_playback",
      "Play, pause, or restart the guided journey when the visitor explicitly asks.",
      "action",
      "The requested journey playback action.",
      JOURNEY_ACTIONS,
    ),
    functionTool(
      "set_detail_mode",
      "Change the lesson explanation tab when the visitor asks for story, structural, mathematical, or code detail.",
      "mode",
      "The detail mode to display.",
      DETAIL_MODES,
    ),
    functionTool(
      "set_ride_mode",
      "Change the overall experience between a guided overview ride and free exploration.",
      "mode",
      "The ride mode to activate.",
      RIDE_MODES,
    ),
    functionTool(
      "choose_branch",
      "Choose the left or right route only when the current chamber offers a branch and the visitor asks to choose it.",
      "side",
      "The branch side to choose.",
      BRANCH_SIDES,
    ),
    functionTool(
      "control_data_preparation",
      "Play, pause, or restart the data-preparation sequence. Use only in the Corpus & Data Preparation chamber.",
      "action",
      "The requested data-preparation playback action.",
      DATA_PREPARATION_ACTIONS,
    ),
  ]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyProperty(
  value: Record<string, unknown>,
  propertyName: string,
) {
  const keys = Object.keys(value);
  return keys.length === 1 && keys[0] === propertyName;
}

function enumValue<T extends string>(
  value: Record<string, unknown>,
  propertyName: string,
  allowed: readonly T[],
): T | null {
  if (!hasOnlyProperty(value, propertyName)) return null;
  const candidate = value[propertyName];
  return typeof candidate === "string" &&
    (allowed as readonly string[]).includes(candidate)
    ? (candidate as T)
    : null;
}

function invalidArguments(toolName: string) {
  return {
    ok: false as const,
    error: `Invalid arguments for ${toolName}.`,
  };
}

/**
 * Runtime validation remains authoritative even though the same constraints
 * are supplied to the model as JSON Schema.
 */
export function parseAssistantAppCommand(
  toolName: string,
  args: unknown,
): AssistantAppCommandParseResult {
  if (!isRecord(args)) return invalidArguments(toolName);

  if (toolName === "navigate_chamber") {
    const destination = enumValue(
      args,
      "destination",
      CHAMBER_DESTINATIONS,
    );
    return destination
      ? { ok: true, command: { kind: toolName, destination } }
      : invalidArguments(toolName);
  }

  if (toolName === "set_journey_playback") {
    const action = enumValue(args, "action", JOURNEY_ACTIONS);
    return action
      ? { ok: true, command: { kind: toolName, action } }
      : invalidArguments(toolName);
  }

  if (toolName === "set_detail_mode") {
    const mode = enumValue(args, "mode", DETAIL_MODES);
    return mode
      ? { ok: true, command: { kind: toolName, mode } }
      : invalidArguments(toolName);
  }

  if (toolName === "set_ride_mode") {
    const mode = enumValue(args, "mode", RIDE_MODES);
    return mode
      ? { ok: true, command: { kind: toolName, mode } }
      : invalidArguments(toolName);
  }

  if (toolName === "choose_branch") {
    const side = enumValue(args, "side", BRANCH_SIDES);
    return side
      ? { ok: true, command: { kind: toolName, side } }
      : invalidArguments(toolName);
  }

  if (toolName === "control_data_preparation") {
    const action = enumValue(args, "action", DATA_PREPARATION_ACTIONS);
    return action
      ? { ok: true, command: { kind: toolName, action } }
      : invalidArguments(toolName);
  }

  return {
    ok: false,
    error: "That app control is not available.",
  };
}
