---
description: Deposit Insurance System, Solvency Backstop, and Continuity Anchor
---

# Reserve

### 1. Mandate

The Sagitta Reserve is the **deposit insurance system** of the Sagitta Protocol.

Its mandate is to guarantee depositor principal under adverse conditions, including allocation underperformance, execution failure, and **Vault system failure**. The Reserve exists to ensure that depositor funds remain whole regardless of operational, market, or infrastructure faults elsewhere in the protocol.

The Reserve functions as a **decentralized analogue to deposit insurance**, enforcing protection through capital backing rather than discretionary intervention.

***

### 2. Position Within the Sagitta System

The Sagitta Reserve operates as an independent protection layer beneath all depositor-facing systems.

* The **Sagitta Vault** records deposits and enforces accounting rules
* The **Sagitta Treasury** coordinates allocation, settlement, and monetary operations
* The **Sagitta Reserve** insures deposits and absorbs systemic losses
* The **Sagitta Escrow** executes capital deployment
* The **Autonomous Allocation Agent** evaluates strategies
* The **Sagitta Continuity Engine** governs failure response

The Reserve exists **outside allocation logic** and **outside execution paths**, serving solely as depositor protection.

***

### 3. Insurance Coverage Scope

The Reserve provides coverage against the following failure classes:

* Allocation losses exceeding Treasury-retained capital
* Execution or counterparty failure within the Escrow system
* Vault accounting or contract failure
* Stable unit failure or impairment
* Protocol-level faults triggering continuity events

Coverage applies to **depositor principal** and operates independently of depositor yield eligibility.

***

### 4. Reserve Composition

The Reserve is composed of **hard, non-correlated assets** selected for durability under systemic stress.

In the current reference implementation, the Reserve is anchored by **tokenized gold (XAUT)**. The Reserve role is asset-agnostic and may incorporate additional real-world or digital assets as defined by Treasury and continuity doctrine.

Reserve assets are isolated from allocation capital and are never deployed for yield generation.

***

### 5. Reserve Ratio Doctrine (2:1)

The Sagitta Reserve enforces a **target insurance coverage ratio of 2:1**.

For every unit of Stability Units deployed into risk-bearing allocation or held as depositor principal, the Reserve maintains two units of Reserve value.

This ratio governs:

* maximum deposit acceptance
* allocation batch sizing
* Treasury liquidity formation
* protocol growth rate

Reserve ratio enforcement ensures that deposit insurance coverage scales mechanically with system exposure.

***

### 6. Reserve Snapshotting

At the initiation of each allocation batch, the Treasury records a **snapshot of Reserve value**, denominated in Stability Units.

This snapshot establishes a baseline for:

* insurance coverage verification
* reserve-relative settlement logic
* continuity threshold monitoring

Snapshotting ensures that Reserve obligations are evaluated consistently across allocation cycles.

***

### 7. Loss Absorption and Insurance Payout

When allocation outcomes or system failures impair deployed capital, the Reserve absorbs losses according to insurance doctrine.

Loss absorption proceeds through:

* application of Treasury-retained capital
* controlled liquidation of Reserve assets
* settlement of depositor claims

Reserve payouts restore depositor principal to Vault balances or alternative custody paths as defined by continuity doctrine.

***

### 8. Reserve-Relative Yield Substitution

When active allocation underperforms while Reserve assets appreciate over the same interval, a portion of Reserve appreciation is credited to depositors as **substituted yield**.

This mechanism:

* penalizes protocol underperformance
* rewards depositor patience
* enforces alignment between allocation intelligence and protection performance

Substituted yield is capped and sourced exclusively from Reserve gains.

***

### 9. Vault Failure Protection

In the event of Vault system failure, compromise, or irrecoverable fault, the Reserve activates **deposit insurance settlement**.

Under this process:

* depositor balances are reconstructed from last valid snapshots
* Reserve assets are liquidated as required
* depositor principal is restored through alternative settlement mechanisms

Vault failure does not impair depositor claims.

***

### 10. Reserve Replenishment

The Reserve is replenished through:

* surplus Stability Units retained by the Treasury
* explicit Reserve reinforcement allocations
* controlled rebalancing of Treasury assets

Reserve replenishment is prioritized before protocol expansion or Treasury Token consolidation.

***

### 11. Interaction With Treasury Token

The Reserve operates independently of Treasury Token price, liquidity, or market perception.

Treasury Token operations may support Reserve reinforcement under defined doctrine, but Reserve solvency does not depend on token appreciation.

This separation preserves insurance integrity during token market stress.

***

### 12. Continuity Integration

The Sagitta Continuity Engine monitors Reserve health continuously.

When Reserve values approach safety thresholds, continuity doctrine may:

* suspend allocation activity
* prioritize Reserve reinforcement
* authorize controlled recapitalization
* enforce emergency contraction measures

Depositor protection remains the highest-order invariant under continuity events.

***

### 13. Standalone Interpretation

The Sagitta Reserve may be deployed independently as:

* a decentralized deposit insurance system
* a protocol-level capital insurer
* a solvency backstop for digital asset platforms
* a fiduciary protection layer for decentralized finance

The Reserve enforces depositor trust through capital, not promises.

***

### 14. Summary

The Sagitta Reserve is the **insurance foundation** of the protocol.

It:

* guarantees depositor principal
* absorbs systemic losses
* penalizes underperformance
* constrains growth through coverage discipline
* preserves continuity across failures

Sagitta does not ask depositors to trust code alone.\
It **insures them**.
