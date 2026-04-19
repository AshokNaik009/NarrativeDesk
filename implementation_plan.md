# Fix Approval Expiration Logic and UI Enhancements

## Goal Description

The current HITL approval flow often returns the error **"approval has expired"** even when the user attempts to approve or reject a pending approval. This is due to an incorrect expiration check in the state machine.

Additionally, the UI has a persistent chat pane that the user wants removed. Instead, a hover‑able button should appear in the top‑right corner that, when clicked, opens the chat modal.

## User Review Required

- Confirm the desired styling for the new hover button (color, icon, size).
- Approve the addition of a new endpoint `/approvals/:id/expire` to force expiration handling (optional).

## Open Questions

> [!IMPORTANT] 
> **Expiration handling:** Should we automatically extend the expiration when a user attempts an action after expiry, or should we surface a clear “expired” UI state with a retry option?

> [!IMPORTANT] 
> **Chat UI:** Do you want the chat modal to appear as a fullscreen overlay or a centered dialog? Any preferred animation?

## Proposed Changes

---
### State Machine (`src/hitl/ApprovalStateMachine.ts`)
- Correct the expiration guard: currently the condition `if (action !== "expire" && now >= state.expiresAt)` mistakenly returns an error even for valid actions before expiry.
- Change to `if (now >= state.expiresAt && action !== "expire")` and handle expiration as a separate transition.
- Add a helper `canTransition(state, action)` to centralise validation.
- Export a new function `expireIfNeeded(state, now)` that returns `{ expired: true }` when appropriate.

---
### Server Endpoints (`src/server.ts`)
- Update `/approvals/:id/approve`, `/reject`, and `/edit` to first call `expireIfNeeded`. If the approval is expired, respond with `{ error: "approval has expired", status: 410 }` (Gone) and a UI‑friendly message.
- Add optional endpoint `POST /approvals/:id/expire` that forces expiration (admin use).
- Adjust error handling to differentiate between validation errors and expiration.

---
### UI Adjustments (`src/dashboard/views/approvals.html`)
- Remove the `<div id="chat"...>` section entirely.
- Insert a hover‑able button in the header:
  ```html
  <button id="chat-toggle" class="chat-btn" title="Open Chat">
    <svg ...>/* chat icon */</svg>
  </button>
  ```
- Add a hidden modal container `#chat-modal` that will be populated via HTMX when the button is clicked.
- Use CSS for hover effect (scale, subtle shadow) and dark‑mode‑compatible colors.

---
### Front‑end Script (`src/dashboard/views/approvals.html` or a new `chat.js`)
- Attach a click listener to `#chat-toggle` that loads `/chat` via HTMX into `#chat-modal` and displays it.
- Ensure the modal can be closed by clicking outside or pressing Esc.

---
### Styling (`src/dashboard/views/approvals.html`)
- Add a small CSS block for `.chat-btn` with glass‑morphism background, smooth transition, and hover scaling.
- Ensure the button sits in the top‑right corner with adequate z‑index.

---
### Tests (`src/hitl/__tests__/ApprovalStateMachine.test.ts`)
- Add tests for the corrected expiration logic.
- Add integration test for the new endpoint flow.

## Verification Plan

### Automated Tests
- Run existing unit tests (`npm test`).
- Execute the new state‑machine tests.
- Use `curl` in a temporary script to hit the approve/reject endpoints with an expired approval and verify the 410 response.

### Manual Verification
- Launch the dev server (`npm run dev`).
- Open the dashboard, verify the chat button appears, hover effect works, and the modal loads.
- Create a pending approval with a short `expires_at` (e.g., 5 seconds), attempt to approve after expiry, and confirm the UI shows the proper error message.

---
