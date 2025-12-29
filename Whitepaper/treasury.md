---
description: Liquidity Brain, Monetary Authority, and Settlement Engine
---

# Treasury

### 1. Mandate

The Sagitta Treasury is the **liquidity brain and monetary authority** of the Sagitta Protocol.

Its mandate is to coordinate capital, stabilize value, and enforce solvency by translating depositor capital into structured allocation outcomes through disciplined monetary and liquidity operations.

The Treasury governs:

* liquidity flows,
* allocation batch formation,
* reserve enforcement,
* yield settlement,
* and the lifecycle of the protocol’s monetary instruments.

The Treasury exists to ensure that **capital, value, and safety remain coherent under all market conditions**.

***

### 2. Position Within the Sagitta System

The Sagitta Treasury occupies the central coordination role in the protocol.

* The **Sagitta Vault** records deposits and preserves depositor principal.
* The **Sagitta Treasury** converts deposits into allocation batches and monetary actions.
* The **Sagitta Reserve** provides collateral backing and yield insurance.
* The **Sagitta Escrow** executes capital deployment on-chain and off-chain.
* The **Autonomous Allocation Agent** evaluates strategies and performance.
* The **Sagitta Continuity Engine** governs survival behavior under systemic stress.

The Treasury is the **integration point** where accounting, markets, allocation, settlement, and continuity converge.

***

### 3. Role-Token Doctrine

Sagitta treats tokens as **functional roles**, not identities.

A token is an implementation of a role within the system.\
The role is canonical.\
The token is replaceable.

This doctrine ensures that:

* token failure does not imply protocol failure,
* migrations do not require protocol redesign,
* continuity is preserved across issuers, chains, and jurisdictions.

The Treasury operates exclusively on **role-defined instruments**.

***

### 4. Treasury Token Authority

The Sagitta Treasury has exclusive authority over the **Treasury Token**.

The Treasury Token is the protocol’s endogenous monetary coordination instrument. It is used to:

* align protocol value with productive capital outcomes,
* enforce reserve discipline,
* finalize allocation batch settlement.

The Treasury controls:

* issuance of the Treasury Token,
* retirement (burning) of the Treasury Token,
* open-market purchases of the Treasury Token,
* open-market sales of the Treasury Token.

All Treasury Token operations are **rule-bound, batch-scoped, and auditable**.

The Treasury Token’s identity may change over time. Its **role does not**.

***

### 5. Stability Unit Definition

The **Stability Unit** is the protocol’s primary accounting and settlement unit.

It is used for:

* establishing value of Vault deposits,
* allocation batch sizing,
* yield accounting,
* reserve ratio measurement,
* depositor yield distribution.

The Stability Unit represents _stable purchasing power_, not allegiance to a specific issuer or asset.

The Treasury operates on the assumption that any specific Stability Unit implementation may fail. Unit substitution is governed by continuity doctrine and does not impair depositor principal.

***

### 6. Batch-Based Liquidity Formation

The Treasury operates on **discrete allocation batches**, a weekly cadence by default.

For each batch:

1. The Treasury observes the aggregate value of eligible Vault deposits denominated in the Stability Unit.
2. It allocates a corresponding amount of Stability Units equal to that value.
3. The batch is isolated as a closed accounting envelope.
4. Capital is routed for deployment through the Sagitta Escrow.

Each batch has:

* defined inputs,
* defined deployment paths,
* defined settlement conditions.

Batches do not overlap and are settled independently.

***

### 7. Liquidity Routing and Capital Deployment

The Treasury routes batch capital based on scale and strategy profile:

* **Small and mid-scale deposits** are routed to approved on-chain staking pools.
* **Institutional-scale deposits** are routed to off-chain managed portfolios through the Escrow system.

Routing decisions are informed by performance data and strategy evaluation supplied by the Autonomous Allocation Agent while remaining constrained by reserve requirements and safety ratios.

The Treasury continuously tracks deployed capital, exposure, and performance across all active batches.

***

### 8. Profit and Loss Accounting

The Treasury maintains continuous profit and loss accounting across all deployed capital.

For each batch, it records:

* allocated Stability Units,
* realized returns,
* unrealized positions,
* costs and fees,
* net Stability Unit outcome.

Profit and loss data directly informs:

* batch settlement,
* reserve enforcement,
* future batch sizing,
* yield eligibility.

***

### 9. Batch Settlement and Treasury Token Buyback

At batch conclusion:

1. All capital is reconciled into realized Stability Unit outcomes.
2. The Treasury executes **Treasury Token buybacks** using realized value.
3. Purchased Treasury Tokens are **burned**, finalizing the batch.

The burn event is the settlement boundary.\
A batch is not finalized until Treasury Token retirement occurs.

This mechanism:

* converts productive capital outcomes into token scarcity,
* anchors Treasury Token value to realized performance,
* prevents perpetual monetary expansion,
* aligns protocol success with depositor outcomes.

***

#### 10. Reserve-Relative Settlement for Negative Allocation Outcomes

For each allocation batch, the Sagitta Treasury records a **snapshot of Reserve value**, denominated in Stability Units, at the time the batch is formed.

At batch settlement, the Treasury evaluates allocation performance relative to this Reserve snapshot.

When an allocation batch returns fewer Stability Units than deployed, the Treasury applies a **reserve-relative settlement rule**:

* Allocation underperformance is assessed against Reserve performance over the same interval
* If the Reserve has appreciated in Stability Unit terms, a defined portion of that appreciation is credited to eligible Vault deposits as substituted yield
* The substituted yield is capped by Treasury doctrine and sourced exclusively from Reserve gains

This mechanism ensures that depositor outcomes reflect **relative capital performance**, not absolute allocation results.

When active allocation underperforms passive Reserve protection, value flows toward depositors and away from protocol surplus.

***

#### 11. Protocol Accountability and Capital Discipline

Reserve-relative settlement operates as an explicit **protocol accountability mechanism**.

* Reserve drawdowns resulting from substituted yield reduce protocol surplus
* Reduced surplus tightens future allocation capacity
* Allocation intelligence is incentivized to outperform the Reserve over time

This creates a self-correcting feedback loop that favors capital preservation over yield chasing.

Reserve-relative settlement is suspended only when Reserve values approach minimum safety thresholds defined by continuity doctrine. Depositor principal protection remains invariant.

***

### 12. Reserve Ratio Enforcement (2:1)

The Treasury enforces a **Reserve collateralization target of 2:1**.

For every unit of deployed, risk-bearing capital, two units of Reserve value are maintained.

Reserve enforcement occurs through:

* batch sizing adjustments,
* Treasury Token market operations,
* direct Reserve rebalancing actions.

Reserve discipline is mechanical and continuous.

***

### 13. Reserve Rebalancing and Hard Backstops

The Treasury operates a rebalancing mechanism that includes liquidation of Reserve assets when required.

Reserve drawdowns are triggered to:

* restore collateralization ratios,
* absorb allocation underperformance,
* preserve depositor principal,
* maintain protocol solvency.

Reserve assets are treated as a **last-line stability mechanism**, not a yield engine.

***

### 14. Yield Distribution to Vault Deposits

After batch settlement:

* net Stability Unit yield is calculated,
* yield is distributed proportionally to eligible Vault deposits,
* principal remains intact.

Yield distribution is authorized by the Treasury and accounted for by the Vault.

Yield may be positive or zero depending on batch results.

***

### 15. Interaction With the Autonomous Allocation Agent

The Autonomous Allocation Agent evaluates candidate strategies before and during batch formation.

It provides:

* simulations,
* risk analysis,
* performance comparisons,
* explanatory reasoning.

The Treasury remains the authority that commits capital.\
The agent informs allocation quality without exercising control.

***

### 16. Governance Interaction

Governance establishes **policy parameters** that shape Treasury behavior.

Governance defines:

* batch cadence,
* reserve targets,
* eligible strategy classes,
* risk tolerance ranges.

Governance does not intervene in operational execution or monetary settlement.

This separation preserves discipline and continuity.

***

### 17. Behavior Under Stress

Under adverse or unstable conditions, the Treasury adopts a **preservation posture**.

In such states:

* batch formation may pause,
* allocation capacity contracts,
* Treasury Token issuance tightens,
* buybacks prioritize reserve restoration,
* yield distribution may be suspended.

The Treasury shifts from optimization to **survival coordination**.

***

### 18. Determinism and Auditability

All Treasury behavior is:

* batch-defined,
* rule-governed,
* deterministic,
* externally auditable.

Capital flows, monetary actions, reserve movements, and yield outcomes are fully reconstructible from system records.

***

### 19. Treasury Token Lifecycle

The Sagitta Treasury Token operates under a **defined lifecycle** that governs how it participates in capital formation, balance-sheet consolidation, and long-term protocol operation. The lifecycle reflects the protocol’s progression from externally financed growth to internally capitalized sovereignty.

The Treasury Token is a **role-token**. Its function is defined by protocol doctrine and exercised by the Sagitta Treasury in coordination with Reserve and Continuity systems.

***

#### 20. Phase I — Capital Formation

**Role:** Liquidity Formation Instrument

In the capital formation phase, the Treasury Token enables the Sagitta Treasury to acquire Stability Units used to initiate allocation batches.

During this phase:

* Treasury Token issuance converts future protocol productivity into present liquidity
* Allocation capacity expands under Reserve discipline
* Early participants gain exposure to protocol outcomes
* Real returns begin accumulating on the Treasury balance sheet

The objective of this phase is **initial capitalization and operational activation**.

***

#### 21. Phase II — Balance-Sheet Transition

**Role:** Liability Consolidation Instrument

As retained Stability Units accumulate through successful allocation cycles, the Treasury enters a balance-sheet transition phase.

During this phase:

* Allocation funding increasingly originates from retained capital
* Treasury Token issuance declines organically
* Buybacks and burns convert realized performance into reduced external claims
* Solvency and Reserve strength increase with each completed cycle

The Treasury Token functions as a **mechanism for converting performance into structural strength**.

The objective of this phase is **internalization of capital and reduction of financing dependency**.

***

#### 22. Phase III — Maturity

**Role:** Residual Claim, Value Signal, and Recapitalization Instrument

In the maturity phase, the Sagitta Protocol operates as a **balance-sheet funded system**. Allocation batches are financed primarily through Treasury-held Stability Units and protected by Reserve assets.

During this phase:

* Allocation efficiency increases due to lower capital formation costs
* Reserve reinforcement becomes the dominant use of surplus capital
* Treasury Token supply stabilizes at a reduced level
* Buybacks occur selectively as surplus conditions allow

The Treasury Token serves as:

* a residual claim on future excess performance
* a value signal reflecting protocol health and discipline
* an economically aligned governance instrument
* a recapitalization tool available under continuity doctrine

The objective of this phase is **sovereign operation with retained optionality**.

***

### 23. Treasury Token Behavior in Maturity

When operating in a balance-sheet funded state, Treasury policy allocates surplus Stability Units according to the following priority order:

1. **Reserve Ratio Reinforcement**\
   Surplus capital strengthens the Reserve to maintain target collateralization levels, including acquisition of hard Reserve assets.
2. **Continuity Capital**\
   Treasury-held Stability Units ensure uninterrupted operation across adverse market conditions.
3. **Operational Liquidity**\
   Capital is retained to fund future allocation batches without reliance on external financing.
4. **Treasury Token Buybacks**\
   When surplus remains beyond solvency and continuity requirements, Treasury Tokens are acquired and retired to consolidate claims.

Treasury Token issuance is exercised as a **recapitalization function** within defined doctrine when required by system conditions.

***

### 24. Lifecycle Adaptability

The Treasury Token lifecycle is **directional and adaptive**.

The Sagitta Continuity Engine coordinates lifecycle transitions in response to system conditions, enabling controlled shifts between phases to preserve depositor protection, Reserve integrity, and protocol continuity.

Lifecycle adaptability ensures the protocol remains resilient across growth, consolidation, and stress environments.

***

### 25. Summary

The Sagitta Treasury is the protocol’s liquidity brain and monetary authority.\
It forms allocation liquidity, deploys capital in discrete batches, and settles outcomes under explicit doctrine.

\
The Treasury manages the lifecycle of the Treasury Token and the Stability Unit, treating tokens as swappable roles rather than fixed dependencies.\
Allocation results are evaluated relative to the Reserve, with underperformance penalized at the protocol level.

\
Surplus capital is retained, consolidated, or redirected to enforce solvency and continuity.\
As retained capital grows, the Treasury transitions the protocol toward balance-sheet funded operation.
