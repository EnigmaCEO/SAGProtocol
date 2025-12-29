---
description: Execution Authority, Capital Isolation Layer, and Compliance Boundary
---

# Escrow

### 1. Mandate

The Sagitta Escrow is the **execution and settlement authority** of the Sagitta Protocol.

Its mandate is to deploy capital into approved allocation strategies, custody assets during execution, and return results to the Treasury for settlement. Escrow exists to separate **capital movement** from **capital decision-making**, ensuring that execution risk, counterparty exposure, and operational complexity remain isolated from depositor-facing systems.

Escrow moves capital.\
It does not define policy, evaluate strategy, or determine risk posture.

***

### 2. Position Within the Sagitta Protocol

The Sagitta Escrow operates as a **downstream execution layer** within the protocol.

* The **Sagitta Vault** records depositor balances and ownership
* The **Sagitta Treasury** forms liquidity, defines allocation batches, and settles outcomes
* The **Sagitta Reserve** insures deposits and absorbs systemic losses
* The **Autonomous Allocation Agent** evaluates strategies and risk
* The **Sagitta Escrow** executes allocation and holds capital in motion
* The **Sagitta Continuity Engine** governs failure response

Escrow exists at the boundary between protocol intent and external markets.

***

### 3. Capital Isolation Doctrine

The Sagitta Escrow enforces **capital isolation**.

Each allocation batch is routed into a dedicated Escrow context that:

* segregates assets by batch
* isolates execution exposure
* prevents cross-contamination between strategies
* preserves deterministic settlement

Isolation ensures that failure or underperformance in one execution path does not propagate across the system.

***

### 4. Scope of Execution

Escrow executes allocation across **on-chain and off-chain venues**, including:

* on-chain staking protocols
* decentralized liquidity venues
* centralized or regulated custodians
* managed portfolios and counterparties

Execution paths are authorized by the Treasury and informed by the Autonomous Allocation Agent. Escrow adapts execution mechanics to venue-specific requirements while preserving batch integrity.

***

### 5. Custody and Asset Handling

During execution, the Sagitta Escrow functions as a **temporary custodian** of deployed capital.

Custody responsibilities include:

* holding Stability Units and acquired assets
* managing execution-specific keys and permissions
* enforcing asset segregation and accounting
* preparing assets for settlement return

Custody authority is limited to the duration and scope of execution.

***

### 6. Compliance Boundary

The Sagitta Escrow serves as the protocol’s **compliance and jurisdictional boundary**.

Escrow enables:

* interaction with regulated counterparties
* adherence to jurisdiction-specific requirements
* execution through compliant custodial frameworks

This separation allows the protocol to integrate with institutional venues without imposing compliance logic on Vault, Treasury, or Reserve systems.

***

### 7. Settlement and Reporting

At the conclusion of each allocation batch, Escrow:

* reconciles all executed positions
* converts outcomes into Stability Units
* prepares settlement reports
* returns assets to the Treasury

Settlement outputs are deterministic and batch-scoped, enabling transparent reconciliation and auditability.

***

### 8. Interaction With the Treasury

The Sagitta Escrow operates under **Treasury authorization**.

The Treasury defines:

* batch size
* approved strategies
* capital routing instructions
* settlement expectations

Escrow executes within these parameters and returns results without modifying allocation intent.

***

### 9. Interaction With the Reserve

The Sagitta Escrow does not access Reserve assets directly.

In loss or failure scenarios:

* Escrow reports execution outcomes
* Treasury evaluates settlement
* Reserve absorbs losses according to insurance doctrine

This separation preserves Reserve independence and integrity.

***

### 10. Failure Containment

Escrow failures are **contained by design**.

Failure modes may include:

* execution venue failure
* counterparty default
* operational disruption

Capital isolation and batch scoping ensure that such failures affect only the active execution context. Recovery paths are coordinated by the Continuity Engine.

***

### 11. Continuity Integration

The Sagitta Continuity Engine monitors Escrow health and execution integrity.

Under continuity events, Escrow may:

* halt execution
* freeze capital movement
* return assets prematurely
* shift execution paths

These actions preserve depositor protection and system solvency.

***

### 12. Standalone Deployment

The Sagitta Escrow is deployable as a standalone execution and custody layer.

It may operate as:

* a capital execution service for protocols
* a batch-based custody system
* a compliant bridge between decentralized treasuries and institutional venues
* an execution abstraction for fiduciary capital

Standalone operation preserves separation between decision intelligence and capital movement.

***

### 13. Summary

The Sagitta Escrow is the **execution spine** of the protocol.

It:

* isolates capital during execution
* adapts to diverse venues and jurisdictions
* preserves batch integrity
* contains operational risk
* returns outcomes for deterministic settlement

Sagitta separates intelligence from movement, policy from execution, and protection from exposure.

The Escrow ensures that **capital moves deliberately, transparently, and safely**.
