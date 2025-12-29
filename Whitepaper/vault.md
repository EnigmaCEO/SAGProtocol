---
description: Principal-Protected Deposit, Accounting, and Ownership Infrastructure
---

# Vault

### 1. Mandate

The Sagitta Vault is the accounting authority of the Sagitta system.

Its mandate is singular and absolute:

**Depositor principal is preserved across allocation activity, execution failure, governance failure, and systemic market disruption.**

Sagitta treats principal as sovereign capital. Yield is conditional and subordinate. The Vault therefore exists as a correctness-first accounting and ownership system whose function is to remain enforceable when other systems degrade or fail.

Every subsystem in Sagitta operates downstream of this mandate.

***

### 2. System Role

The Vault is the canonical source of truth for depositor balances and ownership claims.

It records deposits, enforces principal protection, and maintains an append-only accounting state. It exposes verifiable read access to downstream systems while retaining exclusive authority over balance mutation.

Allocation engines, execution layers, AI components, and governance mechanisms consume Vault state but do not control it.

The Vault is a fixed point within the architecture.

***

### 3. Enforced Invariants

The Vault enforces the following invariants continuously and without exception.

#### Principal Preservation

Recorded depositor principal is immutable. Balance transitions never reduce principal.

#### Accounting Finality

All accounting entries are append-only. Historical records are permanent and auditable.

#### Execution Independence

External protocol behavior, chain conditions, and execution venue outcomes do not directly affect Vault balances.

#### Unit Abstraction

Balances are modeled independently of any single currency, enabling controlled unit substitution while preserving depositor proportionality.

These invariants are enforced structurally and do not rely on discretionary control.

***

### 4. DAO-Configurable Vault Instances

Sagitta supports multiple independent Vault instances.

Each instance represents a parameterized deployment governed by a DAO or institutional operator. Instance configuration establishes policy boundaries applied uniformly to all deposits within that Vault.

Instance parameters include:

* Accepted deposit units
* Commitment period policy
* Withdrawal eligibility rules
* Yield attribution rules
* Ownership representation (receipt-based or account-based)
* State visibility model

Configuration defines liquidity and representation policy while preserving invariant enforcement. All Vault instances share identical safety guarantees.

Vault instance configuration includes system fee parameters governing receipt-based ownership representation.

***

### 5. Commitment Period Definition

Each Vault instance enforces a commitment period that governs withdrawal eligibility.

Sagitta’s default configuration establishes a **12-month commitment period**, aligning depositor expectations with long-horizon fiduciary allocation.

Commitment periods are configurable per instance and support zero-lock configurations.

Commitment policy defines **withdrawal timing** only. It does not alter principal preservation, accounting finality, or continuity behavior.

***

### 6. Multi-Currency and Unit-Agnostic Accounting

The Vault accepts deposits in multiple approved units.

Internally, the Vault models each deposit as:

* Principal value
* Unit identifier
* Ownership claim
* Commitment state
* Yield eligibility state

Accounting is unit-agnostic. The Vault does not assume permanence of any currency.

When a unit becomes invalid, the Vault transitions balances to a successor unit under pre-committed continuity doctrine. Depositor ownership proportions remain intact. Principal value is preserved. Yield attribution resumes only after accounting stability is restored.

***

### 7. Yield Attribution Model

The Vault implements a realization-based yield model.

Yield is recorded only after realization and validation by downstream systems. Yield attribution is additive and discretionary at the policy level. Yield may be suspended without impairing principal.

The Vault records yield events; it does not generate them.

***

### 8. NFT Deposit Receipts

Vault instances may represent deposit ownership through **non-fungible deposit receipts**.

Each receipt is a cryptographic certificate of claim bound to a specific deposit position. The Vault remains the accounting authority; the receipt represents ownership.

Receipt metadata binds to:

* Deposit identifier
* Principal amount and unit
* Commitment parameters
* Yield eligibility
* Withdrawal rights

Receipt transfer transfers ownership of the deposit claim without altering Vault balances or bypassing instance policy.

***

#### 8.1 Settlement and Burn Semantics

Upon withdrawal of an unlocked deposit position, the corresponding receipt is **burned**.

The burn event constitutes final settlement and extinguishes the ownership claim. No receipt remains valid after redemption.

***

#### 8.2 Receipt Constraints

Deposit receipts encode ownership representation exclusively.

They do not create leverage, confer governance authority, bypass commitment rules, or alter Vault accounting behavior.

***

### 8.3 System Fees and Receipt Minting Costs

Vault instances that enable NFT deposit receipts enforce a **system-level fee** associated with receipt issuance.

This fee is defined at the DAO or operator level and applies uniformly to all deposits within the Vault instance. Its purpose is to cover the on-chain and operational costs associated with receipt minting, storage, lifecycle management, and settlement (burn) events.

Key properties of the system fee:

* The fee is **deterministic and disclosed at deposit time**
* The fee is **instance-specific** and configurable by governance
* The fee applies only when receipt-based ownership representation is enabled
* The fee does not affect depositor principal recorded in the Vault
* The fee is collected outside of Vault principal accounting

The system fee is treated as **infrastructure cost recovery**, not yield extraction. It does not introduce variable incentives, speculative dynamics, or performance coupling.

Receipt minting, transfer, and burn events are therefore economically sustainable without entangling Vault accounting with protocol revenue logic.

***

### 9. Confidentiality Model

The Vault supports both public-state and confidential-state deployments.

In confidential-state deployments, depositor balances and receipt metadata are protected while accounting correctness remains verifiable and auditable by authorized parties.

Confidentiality is a deployment property integrated at the accounting layer.

Transparency in Sagitta is defined as **verifiable correctness**, not universal exposure.

***

### 10. Governance Authority Boundaries

Governance configures Vault instances and forward-looking policy parameters.

Governance authority does not extend to:

* Principal preservation
* Historical accounting state
* Invariant enforcement
* Continuity doctrine execution

The Vault remains enforceable under adversarial or failed governance conditions.

***

### 11. Continuity Behavior

During systemic disruption:

* Accounting state remains accessible
* Principal remains preserved
* Yield attribution may be suspended
* Ownership claims remain enforceable
* Withdrawal eligibility follows commitment policy

The Vault maintains deterministic behavior under all continuity scenarios.

***

### 12. Standalone Deployment

The Sagitta Vault operates independently of the broader Sagitta Protocol.

It is deployable as a principal-protected custody and accounting system for:

* DAO treasuries
* Institutional capital programs
* Reserve-backed financial instruments
* Long-duration fiduciary capital pools

The Vault provides enforceable principal preservation, configurable liquidity policy, unit-agnostic accounting, and optional receipt-based ownership representation.

***

### 13. Summary

The Sagitta Vault defines the financial ground truth of the system.

It is configurable without compromising safety.\
It is private without obscuring correctness.\
It is composable without introducing fragility.

All other Sagitta systems operate downstream of this authority.

<br>
