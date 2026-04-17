import { describe, it, expect } from "vitest";
import { transition, checkExpiration } from "../ApprovalStateMachine.js";
import type { ApprovalState } from "../ApprovalStateMachine.js";

const now = new Date("2025-01-15T12:00:00Z");
const futureExpiry = new Date("2025-01-15T12:15:00Z");
const pastExpiry = new Date("2025-01-15T11:45:00Z");

function makePendingState(overrides: Partial<ApprovalState> = {}): ApprovalState {
  return {
    id: "test-id",
    status: "pending",
    expiresAt: futureExpiry,
    ...overrides,
  };
}

describe("transition", () => {
  describe("valid transitions from pending", () => {
    it("approve with tag succeeds", () => {
      const result = transition(makePendingState(), "approve", now, "strong_thesis");
      expect(result.success).toBe(true);
      if (result.success) expect(result.newStatus).toBe("approved");
    });

    it("reject with tag succeeds", () => {
      const result = transition(makePendingState(), "reject", now, "weak_thesis");
      expect(result.success).toBe(true);
      if (result.success) expect(result.newStatus).toBe("rejected");
    });

    it("edit with tag and size succeeds", () => {
      const result = transition(makePendingState(), "edit", now, "size_too_large", 3);
      expect(result.success).toBe(true);
      if (result.success) expect(result.newStatus).toBe("edited");
    });

    it("expire succeeds without tag", () => {
      const result = transition(makePendingState(), "expire", now);
      expect(result.success).toBe(true);
      if (result.success) expect(result.newStatus).toBe("expired");
    });
  });

  describe("terminal states block transitions", () => {
    it("cannot approve from approved", () => {
      const state = makePendingState({ status: "approved" });
      const result = transition(state, "reject", now, "tag");
      expect(result.success).toBe(false);
    });

    it("cannot reject from rejected", () => {
      const state = makePendingState({ status: "rejected" });
      const result = transition(state, "approve", now, "tag");
      expect(result.success).toBe(false);
    });

    it("cannot approve from expired", () => {
      const state = makePendingState({ status: "expired" });
      const result = transition(state, "approve", now, "tag");
      expect(result.success).toBe(false);
    });

    it("cannot act on edited state", () => {
      const state = makePendingState({ status: "edited" });
      const result = transition(state, "approve", now, "tag");
      expect(result.success).toBe(false);
    });
  });

  describe("validation rules", () => {
    it("fails approve without tag", () => {
      const result = transition(makePendingState(), "approve", now);
      expect(result.success).toBe(false);
      if (!result.success) expect(result.error).toContain("tag is required");
    });

    it("fails reject without tag", () => {
      const result = transition(makePendingState(), "reject", now);
      expect(result.success).toBe(false);
    });

    it("fails edit without size", () => {
      const result = transition(makePendingState(), "edit", now, "size_too_large");
      expect(result.success).toBe(false);
      if (!result.success) expect(result.error).toContain("edited size");
    });

    it("fails edit with zero size", () => {
      const result = transition(makePendingState(), "edit", now, "size_too_large", 0);
      expect(result.success).toBe(false);
    });

    it("fails edit with negative size", () => {
      const result = transition(makePendingState(), "edit", now, "size_too_large", -1);
      expect(result.success).toBe(false);
    });
  });

  describe("expiration enforcement", () => {
    it("blocks approve on expired approval", () => {
      const state = makePendingState({ expiresAt: pastExpiry });
      const result = transition(state, "approve", now, "tag");
      expect(result.success).toBe(false);
      if (!result.success) expect(result.error).toContain("expired");
    });

    it("blocks reject on expired approval", () => {
      const state = makePendingState({ expiresAt: pastExpiry });
      const result = transition(state, "reject", now, "tag");
      expect(result.success).toBe(false);
    });

    it("allows expire action on expired approval", () => {
      const state = makePendingState({ expiresAt: pastExpiry });
      const result = transition(state, "expire", now);
      expect(result.success).toBe(true);
    });
  });

  describe("idempotency", () => {
    it("approving an already-approved state succeeds", () => {
      const state = makePendingState({ status: "approved" });
      const result = transition(state, "approve", now, "tag");
      expect(result.success).toBe(true);
      if (result.success) expect(result.newStatus).toBe("approved");
    });

    it("rejecting an already-rejected state succeeds", () => {
      const state = makePendingState({ status: "rejected" });
      const result = transition(state, "reject", now, "tag");
      expect(result.success).toBe(true);
      if (result.success) expect(result.newStatus).toBe("rejected");
    });

    it("expiring an already-expired state succeeds", () => {
      const state = makePendingState({ status: "expired" });
      const result = transition(state, "expire", now);
      expect(result.success).toBe(true);
    });
  });
});

describe("checkExpiration", () => {
  it("returns true for past-due pending approval", () => {
    const state = makePendingState({ expiresAt: pastExpiry });
    expect(checkExpiration(state, now)).toBe(true);
  });

  it("returns false for not-yet-expired pending approval", () => {
    const state = makePendingState({ expiresAt: futureExpiry });
    expect(checkExpiration(state, now)).toBe(false);
  });

  it("returns false for already-approved state even if past expiry", () => {
    const state = makePendingState({ status: "approved", expiresAt: pastExpiry });
    expect(checkExpiration(state, now)).toBe(false);
  });
});
