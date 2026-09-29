# CakeCity — System Issues, Solutions & Robustness Specification

Received 2026-09-28. This is the authoritative spec for the recipe-matching,
chef tap-logging, inventory-verification and request/directive work.
Predecessor docs kept for history: `cakecity-master-blueprint.md`,
`cakecity-recipe-verification-spec.md`, `cakecity-pos-fix-list.md`.
`cakecity-spec-gap-analysis.md` was written *by the agent* at ddd3e66 and is a
self-audit, not a source of truth.

---

## 1. Purpose

This document consolidates the workflow and architectural problems identified in the current CakeCity POS/management system and defines the agreed solutions.

The objective is not simply to change individual screens. The objective is to make CakeCity behave like a reliable operational system where:

* Cashiers enter customer/order information quickly.
* The system determines the appropriate recipe automatically.
* Chefs receive a simple, actionable production sheet.
* Chef logging requires minimal manual data entry.
* Inventory records actual ingredient usage and verifies stock movement.
* Inventory and the owner have a structured communication mechanism.
* The owner can issue operational directives and receive requests from departments.
* Every important operational action has a traceable status and history.
* Role boundaries remain clear.
* The backend remains the source of truth rather than individual dashboards.

---

# 2. Core Operational Flow

The intended architecture should follow this general pipeline:

```text
CUSTOMER
   │
   ▼
CASHIER
   │
   │ Cake description
   │ Flavor
   │ Size
   │ Customer details
   │ Pickup/delivery information
   ▼
BACKEND
   │
   │ Automatic recipe matching
   ▼
BEST-MATCHED RECIPE
   │
   ▼
CHEF
   │
   │ Suggested ingredient ranges
   │ Tap actual ranges
   │ Mark unused ingredients
   │ Add extra ingredients
   ▼
INVENTORY VERIFICATION
   │
   │ Verify actual usage
   │ Confirm stock movement
   ▼
INVENTORY
   │
   ▼
ORDER COMPLETION
```

A separate operational communication system runs alongside this:

```text
OWNER
 ↕
REQUESTS / DIRECTIVES
 ↕
DEPARTMENTS
```

This communication mechanism should not replace the operational workflow above. It should coordinate it.

---

# 3. Issue: Cashier Manually Selects a Recipe

## Problem

The cashier should not be responsible for determining which internal recipe should be used.

A cashier knows the customer's requested cake characteristics, such as:

* Flavor
* Size
* Type/style where applicable
* Other customer-facing specifications

The cashier should not need to understand the internal recipe database.

A manual recipe selector introduces unnecessary decisions and creates the possibility of:

* Selecting the wrong recipe.
* Searching through recipes.
* Selecting an outdated or inappropriate recipe.
* Choosing between multiple technically similar recipes.
* Exposing internal kitchen logic to the cashier.

## Solution

Remove recipe selection from the cashier workflow.

The cashier enters the cake characteristics normally.

The backend automatically determines the most appropriate recipe.

### Intended flow

```text
Cashier enters:
Chocolate
10 inch
     │
     ▼
Recipe Matcher
     │
     ▼
Best matching recipe
     │
     ▼
Order stores internal recipe reference
```

The recipe ID may still be stored internally for traceability, but the cashier does not manually select it.

## Implementation

The recipe matcher should live in the backend rather than inside the frontend.

Conceptually:

```text
cake flavor
+
cake size
+
other applicable characteristics
        │
        ▼
recipe matching logic
        │
        ▼
best recipe
```

The same backend rule should be used regardless of which frontend creates the order.

## Important rule

Do not expose:

* Recipe dropdowns
* Recipe search
* Recipe IDs
* Recipe candidate lists
* Recipe selection screens

to the cashier.

---

# 4. Issue: Chef Receives Too Much Recipe Complexity

## Problem

The chef should not be forced to decide between multiple recipe candidates.

Once the backend has determined the best recipe, the chef should receive one clear suggested production list.

Showing multiple possible recipes transfers a backend decision back to the chef and defeats automatic matching.

## Solution

The chef receives:

**One suggested ingredient list based on the matched recipe.**

For example:

```text
CHOCOLATE CAKE — 10"

Suggested ingredients

Flour
Sugar
Cocoa
Eggs
Butter
Cream
```

The chef's job is to record what was actually used, not to determine which recipe the system should have selected.

---

# 5. Issue: Chef Manually Enters Quantities

## Problem

The existing/manual approach requires the chef to type numerical quantities or even calculate/select midpoint values.

For example, the system may provide a range:

```text
500–600 g
```

but the chef is expected to enter something such as:

```text
550
```

This is inefficient.

It creates:

* Extra typing.
* Mental calculation.
* More opportunities for input errors.
* Slower logging.
* Unnecessary interaction with the keyboard.
* Poor suitability for a busy kitchen environment.

The chef should be logging production, not performing data-entry calculations.

## Solution

Remove manual quantity entry from the normal chef workflow.

The chef should interact primarily through tappable ranges.

Example:

```text
FLOUR

[ 400–500 g ] [ 500–600 g ] [ 600–700 g ]
```

The chef simply taps the applicable range.

There should be no requirement to calculate a midpoint.

---

# 6. Chef Range-Based Logging

## Desired Interaction

Each ingredient should present appropriate selectable ranges derived from the recipe/system rules.

Example:

```text
FLOUR

┌──────────┐ ┌──────────┐ ┌──────────┐
│ 400–500g │ │ 500–600g │ │ 600–700g │
└──────────┘ └──────────┘ └──────────┘
```

The selected option becomes the chef's recorded usage observation.

The interface should make the selected state obvious.

Example:

```text
FLOUR

[ 400–500g ] [ ✓ 500–600g ] [ 600–700g ]
```

## Important

The chef should not need to type:

```text
550
```

simply because the range is:

```text
500–600
```

The system should preserve the range selection.

---

# 7. Existing Recipe Min/Max Data

The system already has recipe concepts involving ingredient quantities/ranges.

The new implementation should reuse the existing recipe structure rather than creating an entirely separate recipe subsystem.

Where the recipe already contains:

```text
minimum quantity
maximum quantity
```

those values should participate in generating the chef's suggested ranges.

The implementation should therefore extend the existing recipe/ingredient structures rather than duplicate them.

---

# 8. Chef Must Be Able to Handle Real-World Deviations

A recipe is a recommendation, not a guarantee that the chef will use exactly the suggested ingredients.

The chef therefore needs three basic capabilities:

### A. Select a suggested range

```text
Flour
[ ✓ 500–600g ]
```

### B. Mark an ingredient as unused

If an ingredient was suggested but not used:

```text
Cocoa
[ NOT USED ]
```

### C. Add an ingredient that was not suggested

For example:

```text
+ Add ingredient
```

Then:

```text
Ingredient: Vanilla
Quantity/range: selected through the appropriate input
```

The normal workflow should remain fast, while exceptions remain possible.

---

# 9. Issue: Inventory Should Not Immediately Deduct Stock From a Guess

## Problem

The chef's initial log represents what the chef believes/records was used.

It should not automatically be treated as an unquestionable stock transaction.

Otherwise a mistake in chef logging can directly produce an incorrect inventory deduction.

## Solution

Separate:

**Chef usage logging**

from:

**Inventory verification**

The workflow becomes:

```text
Recipe suggestion
      ↓
Chef records actual usage/ranges
      ↓
Usage record created
      ↓
Inventory reviews/verifies
      ↓
Verified quantity
      ↓
Stock movement
```

This provides a control point before inventory is permanently affected.

---

# 10. Inventory Verification

Inventory should be able to see the ingredients associated with the production record and verify the actual quantities.

The system should distinguish between:

```text
ESTIMATED / LOGGED
```

and:

```text
VERIFIED
```

Only the verified state should trigger the definitive inventory stock movement.

## Important safeguards

The backend should prevent:

* Double verification.
* Repeated stock deduction.
* Verification of an already finalized usage record.
* Stock movement being created twice from the same production event.

A production usage record should have a clear lifecycle.

Example:

```text
PENDING
   ↓
CHEF_LOGGED
   ↓
INVENTORY_VERIFIED
   ↓
STOCK_MOVED
   ↓
FINALIZED
```

---

# 11. Issue: No Structured Owner ↔ Inventory Communication

## Problem

The owner and inventory department currently lack a formal operational communication mechanism.

This creates a gap when inventory needs something from the owner.

For example:

> Inventory needs 25 kg of sugar.

The system should not require the employee to communicate this informally.

There needs to be a proper business record.

---

# 12. Inventory → Owner Request System

Inventory should be able to create a structured request.

Example:

```text
REQUEST #REQ-0041

From:
Inventory

To:
Owner

Request:
Procure ingredient

Ingredient:
Sugar

Quantity:
25 kg

Reason:
Stock below reorder level

Priority:
Normal

Status:
Pending
```

The owner can then:

```text
[ APPROVE ]
[ REJECT ]
[ REQUEST CLARIFICATION ]
```

The request should retain its history.

---

# 13. Owner → Inventory Directive System

The communication must work in the opposite direction as well.

The owner should be able to issue an operational directive.

Example:

```text
DIRECTIVE #DIR-0042

From:
Owner

To:
Inventory

Task:
Source ingredient

Ingredient:
Cocoa powder

Quantity:
20 kg

Priority:
Normal

Deadline:
30 September

Status:
Issued
```

Inventory then handles the task.

Possible lifecycle:

```text
ISSUED
  ↓
ACCEPTED
  ↓
IN PROGRESS
  ↓
COMPLETED
```

The inventory employee should explicitly close the directive after completing it.

---

# 14. Requests and Directives Should Not Be Chat

The system should not become a WhatsApp-style internal messaging application.

Operational communication should be represented as structured records.

Every request/directive should have information such as:

```text
ID
Type
Sender
Recipient
Department
Created by
Created at
Subject
Description
Related entity
Priority
Status
Response
Completed by
Completed at
```

This gives CakeCity accountability and traceability.

---

# 15. Generalize the Communication System

Although the immediate problem is owner ↔ inventory, the implementation should not hard-code the feature exclusively for inventory.

The underlying mechanism should support authorized communication between roles/departments.

Examples:

```text
Inventory → Owner
Request procurement

Chef → Owner
Request new ingredient

Owner → Inventory
Source ingredient

Owner → Chef
Prioritize production

Owner → Cashier
Correct/verify order
```

The system therefore becomes a reusable:

**Request & Directive Engine**

rather than a collection of unrelated communication features.

---

# 16. Request/Directive State Machine

The backend should own the status transitions.

A request could follow:

```text
DRAFT
  ↓
SUBMITTED
  ↓
PENDING_REVIEW
  ├── REJECTED
  ├── CLARIFICATION_REQUIRED
  └── APPROVED
          ↓
       ACTION
          ↓
      COMPLETED
```

A directive could follow:

```text
ISSUED
  ↓
ACKNOWLEDGED
  ↓
IN_PROGRESS
  ↓
COMPLETED
```

Where appropriate:

```text
CANCELLED
```

should be available as a terminal state.

The frontend should not arbitrarily modify statuses. The backend should enforce valid transitions.

---

# 17. Auditability

Important operational actions should leave a history.

For example:

```text
REQ-0041

09:10 — Inventory created request
09:32 — Owner reviewed request
09:34 — Owner approved request
10:05 — Inventory started procurement
14:20 — Inventory completed request
14:21 — System recorded completion
```

This becomes especially important for:

* Inventory changes
* Procurement
* Owner directives
* Recipe selection
* Production logging
* Stock verification
* Order status changes

---

# 18. Role Responsibilities

## Cashier

Responsible for:

* Customer information
* Cake description
* Flavor
* Size
* Pickup/delivery information
* Payment/order information

Not responsible for:

* Choosing internal recipes
* Managing ingredient quantities
* Selecting inventory deductions
* Deciding production recipes

---

## Chef

Responsible for:

* Viewing assigned production work
* Following the suggested recipe
* Recording actual ingredient usage
* Selecting ranges
* Marking unused ingredients
* Adding unexpected ingredients
* Completing production logging
* Raising requests when necessary

Not responsible for:

* Choosing between recipe candidates
* Manually calculating recipe midpoints
* Directly controlling stock deductions

---

## Inventory

Responsible for:

* Stock management
* Ingredient verification
* Stock movements
* Procurement/sourcing
* Reviewing production usage
* Creating procurement requests
* Executing approved owner directives

---

## Owner

Responsible for:

* Operational oversight
* Approving/rejecting requests
* Issuing directives
* Monitoring departments
* Reviewing exceptions
* Authorizing procurement where required
* Seeing system-wide operational information

---

# 19. Backend as the Source of Truth

A recurring principle across all of these changes is:

**Do not put business-critical decisions exclusively in the frontend.**

The backend should determine/enforce:

* Recipe matching
* Authorization
* Valid status transitions
* Request permissions
* Directive permissions
* Inventory verification
* Stock movement
* Duplicate prevention
* Order state
* Audit history

The frontend should primarily provide the appropriate interface for each role.

---

# 20. Robustness Requirements

The revised system should protect against common operational failures.

### Duplicate operations

Prevent:

```text
same stock movement twice
same verification twice
same request completion twice
```

### Unauthorized operations

A cashier should not be able to perform inventory verification.

Inventory should not be able to approve its own owner-level request unless explicitly authorized by the role model.

### Invalid transitions

Do not allow:

```text
COMPLETED → IN_PROGRESS
```

unless there is a specifically defined correction/reopening workflow.

### Missing data

Required information should be validated by the backend.

### Stale data

Where two users can modify the same operational record, the backend should prevent silent overwrites.

---

# 21. Recommended Data Relationships

The implementation should conceptually connect:

```text
CUSTOM ORDER
    │
    └── matched recipe
            │
            └── recipe ingredients
                    │
                    ▼
              production usage
                    │
                    ▼
             chef selections
                    │
                    ▼
          inventory verification
                    │
                    ▼
              stock movement
```

Separately:

```text
USER / ROLE
      │
      ▼
REQUEST / DIRECTIVE
      │
      ▼
DEPARTMENT
      │
      ▼
ACTION / RESOLUTION
      │
      ▼
AUDIT HISTORY
```

Where useful, requests should reference the operational object that caused them.

For example:

```text
Request
 └── relatedIngredientId
```

or:

```text
Request
 └── relatedOrderId
```

rather than relying entirely on free-form text.

---

# 22. Frontend Design Principle

The interface should reflect the actual job being performed.

### Cashier

Fast order-entry interface.

```text
CUSTOMER
CAKE
FLAVOR
SIZE
DATE
PAYMENT
```

No internal kitchen complexity.

### Chef

Fast production interface.

```text
ORDER
   ↓
INGREDIENT
   ↓
TAP RANGE
   ↓
NEXT INGREDIENT
```

Minimal typing.

### Inventory

Verification and stock-control interface.

```text
STOCK
USAGE
REQUESTS
DIRECTIVES
PROCUREMENT
VERIFICATION
```

### Owner

Management and command interface.

```text
ORDERS
PRODUCTION
INVENTORY
REQUESTS
DIRECTIVES
FINANCE
ALERTS
AUDIT
```

---

# 23. Final Target Architecture

The resulting CakeCity operational model should be:

```text
                    ┌─────────────┐
                    │    OWNER    │
                    └──────┬──────┘
                           │
                 REQUESTS / DIRECTIVES
                           │
          ┌────────────────┼────────────────┐
          │                │                │
          ▼                ▼                ▼
      CASHIER            CHEF          INVENTORY
          │                │                │
          │                │                │
          ▼                │                │
   Cake description       │                │
          │                │                │
          ▼                │                │
   AUTOMATIC RECIPE        │                │
       MATCHING            │                │
          │                │                │
          └───────────────►│                │
                           ▼                │
                    Suggested ranges        │
                           │                │
                           ▼                │
                    Chef logs usage         │
                           │                │
                           └───────────────►│
                                            ▼
                                  Inventory verification
                                            │
                                            ▼
                                      Stock movement
```

---

# 24. Implementation Priority

The changes should be implemented in this order:

### Phase 1 — Recipe matching

1. Remove manual recipe selection from cashier UI.
2. Implement/centralize automatic recipe matching in backend.
3. Store matched recipe internally on the order.
4. Ensure the matched recipe generates the chef's suggested ingredients.

### Phase 2 — Chef workflow

1. Remove manual quantity entry.
2. Generate selectable ranges.
3. Allow one range selection per applicable ingredient.
4. Allow `Not Used`.
5. Allow adding unexpected ingredients.
6. Preserve chef usage records for inventory verification.

### Phase 3 — Inventory verification

1. Separate chef logging from stock deduction.
2. Implement/retain explicit verification.
3. Prevent duplicate verification.
4. Prevent duplicate stock movements.
5. Maintain verified usage history.

### Phase 4 — Request & Directive Engine

1. Create generic request/directive model.
2. Add authorization rules.
3. Add status state machines.
4. Add owner approval/rejection.
5. Add department acknowledgement/completion.
6. Add audit history.
7. Connect requests to relevant operational entities.

### Phase 5 — Owner dashboard

Add a unified operational area for:

```text
Pending Requests
Active Directives
Inventory Exceptions
Production Exceptions
Low Stock
Pending Verifications
Overdue Tasks
```

The owner should be able to identify what requires attention without manually inspecting every department.

---

# 25. Acceptance Criteria

The redesign should be considered successful when:

### Cashier

* Cashier can create a cake order without selecting a recipe.
* Backend automatically chooses the applicable recipe.
* Internal recipe information is hidden from normal cashier workflow.

### Chef

* Chef does not have to type quantities for normal ingredient logging.
* Chef can select predefined ranges by tapping.
* Chef can mark ingredients unused.
* Chef can add unexpected ingredients.
* Chef sees one recommended recipe/ingredient set rather than multiple recipe candidates.
* Logging is fast enough to be practical during production.

### Inventory

* Chef logging does not immediately create an irreversible stock deduction.
* Inventory can verify usage.
* A verified usage cannot accidentally deduct stock twice.
* Inventory can create structured requests to the owner.
* Inventory can receive and complete owner directives.

### Owner

* Owner can see pending requests.
* Owner can approve/reject requests.
* Owner can request clarification.
* Owner can issue directives.
* Owner can track whether directives have been acknowledged and completed.
* Owner can inspect the history of important operational actions.

### System

* Permissions are enforced server-side.
* Important status changes are validated server-side.
* Operational records have audit history.
* Related orders, recipes, ingredients, usage records, requests, directives, and stock movements remain traceable.
* The system does not rely on informal communication for important operational decisions.

---

# 26. Guiding Principle

The overall redesign can be reduced to one principle:

> **Employees should describe what happened; CakeCity should handle the complexity behind it.**

The cashier describes the customer's cake.

The system determines the recipe.

The chef records what was actually used through fast selections.

Inventory verifies the usage.

The owner authorizes and directs operational work.

And the backend maintains the relationships, permissions, stock movements, statuses, and audit trail.

This keeps the interfaces simple while making the underlying system significantly more controlled and robust.
