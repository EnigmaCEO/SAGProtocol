---
description: Continuity-Governed Response Mapping
---

# Failure / Threat Matrix

### Purpose

The Failure / Threat Matrix defines how the Sagitta Protocol responds to adverse conditions across financial, technical, and governance domains.

Each failure class is mapped to a governing authority and a deterministic outcome. The matrix demonstrates that **no failure mode results in depositor principal loss or uncontrolled system collapse**.

This matrix describes **what happens**, not **how it is implemented**.

***

### Threat Classification Matrix

| Failure / Threat Class                | Description                                                                    | Governing Authority          | System Response                                                            | Depositor Outcome                         |
| ------------------------------------- | ------------------------------------------------------------------------------ | ---------------------------- | -------------------------------------------------------------------------- | ----------------------------------------- |
| **Allocation Underperformance**       | Allocation batch returns less capital than deployed                            | Treasury + Reserve           | Ordered loss absorption; reserve-relative settlement                       | Principal preserved; yield adjusted       |
| **Sustained Allocation Failure**      | Repeated underperformance across batches                                       | Treasury + Reserve + AAA     | Allocation contraction; strategy restriction; reserve prioritization       | Principal preserved                       |
| **Stablecoin Depeg**                  | Stability Unit deviates materially from peg                                    | Continuity Engine            | Currency substitution; valuation normalization                             | Principal preserved in substituted unit   |
| **Reserve Asset Volatility**          | Reserve asset correlation or valuation shift                                   | Reserve + Continuity Engine  | Coverage recalibration; reserve reinforcement                              | Principal preserved                       |
| **Vault Contract Failure**            | Vault accounting or contract fault                                             | Continuity Engine + Reserve  | State reconstruction; insured restoration                                  | Principal restored                        |
| **Escrow Execution Failure**          | Counterparty or venue failure during execution                                 | Escrow + Continuity Engine   | Capital recall; execution isolation; substitution                          | Principal preserved                       |
| **Treasury Token Market Attack**      | Liquidity manipulation or hostile market activity                              | Treasury + Continuity Engine | Token isolation; lifecycle restriction                                     | Allocation continues; principal preserved |
| **Treasury Token Governance Capture** | Token-based governance attack                                                  | Continuity Engine            | Governance scope restriction; authority freeze                             | Principal preserved                       |
| **DAO Governance Deadlock**           | Governance paralysis or quorum failure                                         | Continuity Engine            | Continuity authority enforcement                                           | Principal preserved                       |
| **Oracle Failure**                    | Pricing or data feed disruption                                                | Continuity Engine            | Oracle substitution; conservative valuation                                | Principal preserved                       |
| **Infrastructure Failure**            | Chain halt, RPC failure, or network outage                                     | Continuity Engine            | Execution halt; evacuation; reconstitution                                 | Principal preserved                       |
| **Multi-Component Failure**           | Concurrent subsystem failures                                                  | Continuity Engine            | Evacuation; degradation; phased recovery                                   | Principal preserved                       |
| **Catastrophic System Event**         | Extreme external or systemic shock                                             | Continuity Engine            | Full evacuation; reserve enforcement; reconstitution                       | Principal preserved                       |
| **Blockchain Failure**                | Chain halt, consensus failure, censorship, or irrecoverable network disruption | Continuity Engine            | Execution halt; asset evacuation; chain substitution; state reconstitution | Principal preserved                       |

***

### Interpretation Guidance

* **Governing Authority** indicates which system enforces response
* **System Response** reflects doctrine-level action, not execution detail
* **Depositor Outcome** remains invariant across all threat classes

This matrix demonstrates that **every identified failure mode resolves to containment, substitution, or recovery**, never depositor impairment.

***

### Design Implication

Sagitta does not optimize for uninterrupted yield.

It optimizes for:

* capital preservation
* deterministic response
* survivability under stress

Failure is treated as a **managed state**, not an exception.

***

### Closing Statement

This matrix operationalizes the Sagitta System Invariants.

It ensures that:

* risk is bounded
* authority is predefined
* outcomes are predictable

Sagitta does not ask what happens _if_ things fail.

It defines **what happens when they do**.
