---
description: Constitutional Guarantees of the Sagitta Protocol
---

# System Invariants

### Purpose

System Invariants define the **non-negotiable properties** of the Sagitta Protocol.

They describe conditions that remain true across all operating states, market regimes, governance changes, and continuity events. These invariants govern system behavior and constrain all subsystems, upgrades, and policy decisions.

No mechanism, optimization, or authority supersedes these guarantees.

***

### Invariant I — Depositor Principal Protection

Depositor principal is preserved across all protocol states.

Principal protection is enforced through a capitalized Reserve that functions as deposit insurance, including coverage for allocation underperformance, execution failure, asset impairment, and Vault system failure.

Depositor balances are restored through deterministic settlement and Reserve-backed mechanisms.

***

### Invariant II — Insurance-Constrained Growth

Protocol growth is bounded by insured capacity.

Deposit acceptance, allocation sizing, and liquidity formation scale proportionally with Reserve coverage. Expansion occurs only as insured capacity increases through retained performance or explicit Reserve reinforcement.

Growth reflects solvency rather than demand.

***

### Invariant III — Protocol-Level Loss Accountability

Losses are absorbed at the protocol level.

Allocation underperformance is reconciled through an ordered absorption framework involving yield variability, Treasury-retained capital, and Reserve assets. Downside responsibility remains with system capital rather than depositors.

Risk-taking produces consequence.

***

### Invariant IV — Reserve Supremacy

The Reserve holds primacy over optimization.

Allocation decisions, monetary operations, and capital routing remain subordinate to Reserve health and coverage ratios. When Reserve integrity is threatened, allocation activity contracts and continuity actions engage.

Protection precedes performance.

***

### Invariant V — Deterministic Settlement

All allocation outcomes settle deterministically.

Capital deployment occurs in discrete batches with defined initiation, execution, and settlement boundaries. Outcomes are reconciled through rule-based processes rather than discretionary intervention.

Settlement remains auditable, predictable, and final.

***

### Invariant VI — Role-Based Dependency Design

All critical dependencies are defined by role.

Currencies, tokens, assets, execution venues, intelligence layers, and governance authorities are treated as replaceable implementations of functional roles. Each role maintains defined responsibilities and substitution paths.

No single dependency is indispensable.

***

### Invariant VII — Separation of Authority

No subsystem holds unilateral control over depositor exposure.

Custody, allocation intelligence, execution, insurance, monetary authority, and continuity governance operate within isolated scopes. Authority is layered to prevent risk concentration and conflict of interest.

System safety emerges from separation.

***

### Invariant VIII — Continuity Supremacy

Continuity overrides optimization.

Under failure or stress conditions, the Sagitta Continuity Engine governs evacuation, substitution, degradation, and reconstitution. Continuity actions preserve depositor protection and system solvency before restoring normal operation.

Survival is enforced by design.

***

### Invariant IX — Token Optionality

Tokens are instruments, not dependencies.

Treasury Tokens and governance mechanisms operate as role-based tools within defined doctrine. Protocol solvency, depositor protection, and continuity remain independent of token price, liquidity, or market sentiment.

Value signaling does not equal survivability.

***

### Invariant X — Governance Constraint

Governance operates within protocol law.

Governance defines parameters, thresholds, and doctrine but does not override system invariants. Emergency authority, continuity actions, and protection mechanisms remain bounded by predefined rules.

Governance participates in the system.\
It does not redefine it.

***

### Invariant XI — Survivability Under Component Failure

The protocol survives the failure of any single subsystem.

Vault, Treasury, Reserve, Allocation Intelligence, Escrow, tokens, governance, and infrastructure components are designed for isolation and replacement. Failure triggers containment, evacuation, and substitution rather than collapse.

Sagitta remains operational through reconstitution.

***

### Invariant XII — Fiduciary Alignment by Structure

Fiduciary alignment is enforced structurally.

Principal protection, loss accountability, reserve-relative discipline, and constrained growth operate continuously through protocol law. Fiduciary behavior persists independently of operator intent or market conditions.

Trust emerges from structure.

***

### Closing Declaration

These invariants define Sagitta’s identity.

All subsystems, upgrades, and integrations must preserve them. Any change that violates an invariant constitutes a protocol failure condition.

Sagitta does not rely on favorable markets, benevolent governance, or perpetual confidence.

It relies on **law, capital, and continuity**.
