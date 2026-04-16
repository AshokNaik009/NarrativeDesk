import { ApprovalAction, ApprovalStatus } from "../types.js";

export interface ApprovalState {
  id: string;
  status: ApprovalStatus;
  expiresAt: Date;
  tag?: string;
  editedSizePct?: number;
}

export type TransitionResult =
  | { success: true; newStatus: ApprovalStatus }
  | { success: false; error: string };

const VALID_TRANSITIONS: Record<ApprovalStatus, ApprovalAction[]> = {
  pending: ["approve", "reject", "edit", "expire"],
  approved: [],
  rejected: [],
  edited: [],
  expired: [],
};

const ACTION_TO_STATUS: Record<ApprovalAction, ApprovalStatus> = {
  approve: "approved",
  reject: "rejected",
  edit: "edited",
  expire: "expired",
};

export function transition(
  state: ApprovalState,
  action: ApprovalAction,
  now: Date,
  tag?: string,
  editedSizePct?: number
): TransitionResult {
  // Idempotency: if already in the target terminal state, succeed silently
  const targetStatus = ACTION_TO_STATUS[action];
  if (state.status === targetStatus) {
    return { success: true, newStatus: state.status };
  }

  // Check valid transitions
  const allowed = VALID_TRANSITIONS[state.status];
  if (!allowed.includes(action)) {
    return { success: false, error: `cannot ${action} from ${state.status}` };
  }

  // Check expiration
  if (action !== "expire" && now >= state.expiresAt) {
    return { success: false, error: "approval has expired" };
  }

  // Tag required on terminal transitions (except expire)
  if (action !== "expire" && !tag) {
    return { success: false, error: `tag is required for ${action} action` };
  }

  // Edit must include a size
  if (action === "edit" && (editedSizePct === undefined || editedSizePct <= 0)) {
    return { success: false, error: "edited size must be provided and positive" };
  }

  return { success: true, newStatus: targetStatus };
}

export function checkExpiration(state: ApprovalState, now: Date): boolean {
  return state.status === "pending" && now >= state.expiresAt;
}
