---
description: Quantitative Analytical Intelligence Layer for Capital Evaluation
---

# Autonomous Allocation Agent

### 1. Mandate

The Autonomous Allocation Agent (AAA) is the quantitative analytical intelligence layer of the **Sagitta Protocol**.

Its mandate is to evaluate allocation opportunities, model risk and performance outcomes, and produce structured, explainable intelligence for capital routing decisions—while operating strictly within system-defined doctrine, constraints, and survivability guarantees.

The Autonomous Allocation Agent **informs decisions**.\
The Treasury **commits capital**.

AAA exists to ensure that all risk-bearing decisions are taken consciously, evaluated rigorously, and justified relative to protection mechanisms.

***

### 2. Position Within the Sagitta System

The Autonomous Allocation Agent operates as a **non-custodial, non-executing analytical office** within the Sagitta system architecture.

System roles are explicitly separated:

* The **Vault** records deposits and enforces accounting invariants
* The **Treasury** forms liquidity, sizes batches, allocates capital, and settles outcomes
* The **Reserve** provides insurance coverage and absorbs underperformance
* The **Escrow** executes capital deployment under Treasury authority
* The **Autonomous Allocation Agent** evaluates strategies and outcomes
* The **Continuity Engine** governs behavior under failure and crisis states

AAA exists **upstream of execution and downstream of policy**, translating policy-defined strategy space into actionable intelligence without authority to move capital.

***

### 3. Scope of Analysis

The Autonomous Allocation Agent evaluates candidate allocation strategies across multiple analytical dimensions, including:

* expected return distributions
* volatility, drawdown, and tail risk characteristics
* liquidity, duration, and exit sensitivity
* counterparty, execution, and operational risk
* correlation with Reserve and Treasury assets
* historical, simulated, and regime-conditioned performance

Analysis is performed across time horizons aligned with Treasury batch cadence and continuity posture.

***

### 4. Quantitative Foundation

AAA is grounded in **institutional quantitative finance methodologies** employed by professional asset managers, risk desks, and portfolio construction teams.

Its analytical core operationalizes established practices, including:

* factor-based return attribution
* volatility and drawdown modeling
* correlation and covariance analysis
* scenario and regime simulation
* risk-adjusted performance metrics
* capital efficiency and duration modeling

The agent does not invent financial theory.\
It **scales** disciplined quantitative reasoning under constraint.

***

### 5. Human–Quant–Machine Alignment

Sagitta treats quantitative intelligence as a **shared discipline**, not a replacement for fiduciary judgment.

AAA operates in alignment with:

* established quantitative finance principles
* domain expertise from professional quants
* Treasury-defined risk, solvency, and continuity doctrine

Human oversight informs:

* model selection and validation
* constraint and guardrail design
* evaluation criteria and exclusions
* interpretation of edge cases

Machine intelligence contributes:

* scale and consistency
* simulation depth across regimes
* pattern recognition under bounded authority

This alignment ensures that AAA remains **disciplined, explainable, and fiduciary-aligned**.

***

### 6. Determinism, Guardrails, and Authority

AAA operates under **deterministic guardrails** defined by system doctrine.

* No model—statistical or ML-based—may override Treasury constraints
* No learning process may mutate invariants or guarantees
* Authority is explicitly gated by allocator class

Allocator capability progresses through authority levels (v1–v6), where **people qualify for authority** rather than purchasing features. Higher authority introduces broader decision space, not relaxed discipline.

***

### 7. Strategy Evaluation Framework

AAA operates through a **scenario-driven evaluation framework**.

For each candidate strategy, the agent:

* simulates performance across varied market regimes
* evaluates sensitivity to shocks and discontinuities
* estimates impact on Treasury balance sheet and Reserve ratios
* compares outcomes relative to passive Reserve performance

Evaluation outputs are normalized into comparable metrics to support disciplined Treasury decision-making.

***

### 8. Reserve-Relative Intelligence

Reserve-relative benchmarking is a **core analytical dimension** of AAA.

All active strategies are evaluated against Reserve asset performance over equivalent intervals. Risk-taking must be justified relative to passive protection.

Strategies that fail to demonstrate superior risk-adjusted outcomes relative to protection mechanisms are deprioritized by design.

This aligns analytical incentives with fiduciary preservation rather than speculative yield chasing.

***

### 9. Interaction With the Treasury

AAA produces **rankings, evaluations, and explanatory intelligence** for Treasury review.

Treasury decisions incorporate:

* agent evaluations and confidence bounds
* Reserve coverage constraints
* liquidity and duration requirements
* system continuity posture

AAA does not initiate allocations, adjust batch sizing, or execute transactions. Its role is strictly advisory.

***

### 10. Learning, Feedback, and Adaptation

AAA updates its analytical models using **realized batch outcomes**.

Settled performance feeds back into:

* risk estimation models
* correlation assumptions
* scenario weighting
* strategy ranking heuristics

Adaptation improves analytical accuracy while remaining fully bounded by Treasury doctrine, Reserve discipline, and continuity constraints.

Learning refines judgment—it does not expand authority.

***

### 11. Explainability and Auditability

All AAA outputs are **quant-native, explainable, and auditable**.

For each recommendation, the agent produces:

* rationale summaries
* contributing factors
* comparative metrics
* confidence and uncertainty assessments

All outputs are logged, versioned, and reviewable by Treasury operators, auditors, and governance processes.

***

### 12. Independence From Execution and Custody

AAA does not custody assets, hold keys, or interface directly with execution venues.

This separation:

* reduces attack surface
* prevents intelligence from becoming execution authority
* preserves fiduciary clarity

Analytical intelligence is intentionally isolated from capital movement.

***

### 13. Continuity and Degradation Behavior

Under continuity events, AAA adapts its analytical posture without altering capital guarantees.

Possible modes include:

* conservative strategy filtering
* stress-prioritized evaluation
* reduced recommendation bandwidth
* full analysis suspension during emergency states

AAA obeys system posture set by the Continuity Engine.

***

### 14. Standalone Deployment

The Autonomous Allocation Agent is deployable as a **standalone analytical system**, independent of custody and execution.

It may operate as:

* a portfolio evaluation engine
* a risk modeling service
* an allocation intelligence layer for funds or protocols
* a decision-support system for fiduciary capital managers

Standalone deployment preserves analytical independence and institutional applicability.

***

### 15. Summary

The Autonomous Allocation Agent strengthens allocation decisions through disciplined quantitative intelligence.

It:

* evaluates risk and performance under constraint
* benchmarks strategies against protection
* adapts through bounded feedback
* produces explainable, auditable reasoning

Sagitta treats intelligence as **advisory**, capital as **disciplined**, and protection as **invariant**.

AAA exists to ensure that risk is taken consciously, justified continuously, and never confused with authority.



### Sandbox Mode vs Agent Mode

The Autonomous Allocation Agent operates under two distinct analytical postures: **Sandbox Mode** and **Agent Mode**.\
These modes govern **how intelligence is produced, contextualized, and persisted**, not whether capital is deployed.

Both modes remain strictly non-custodial and non-executing.

***

#### Sandbox Mode (Exploratory Analysis)

Sandbox Mode is the default analytical posture for users without production decision authority or when operating in exploratory contexts.

In Sandbox Mode, AAA functions as a **static evaluation engine**:

* Strategies are evaluated independently of live Treasury state
* Results are generated from cached or simulated data
* No persistent belief state is maintained across evaluations
* No historical feedback loops influence subsequent outputs

Sandbox Mode is designed for:

* policy exploration
* comparative strategy testing
* education and familiarization
* pre-qualification analysis

Outputs are informative but **non-authoritative**. They do not accumulate context, adapt across time, or express longitudinal confidence.

Sandbox Mode enables breadth without responsibility.

***

#### Agent Mode (Persistent Decision Intelligence)

Agent Mode is available only to users or systems with explicit **decision authority qualification**.

In Agent Mode, AAA operates as a **persistent analytical agent** across discrete evaluation ticks aligned to Treasury cadence.

Key characteristics:

* Maintains a bounded internal belief state derived from prior evaluations
* Incorporates realized outcomes from settled batches into future analysis
* Updates regime context, correlation assumptions, and confidence weighting between ticks
* Operates within fixed doctrine, constraints, and continuity posture

Agent Mode does **not** imply autonomy over capital.\
It implies **continuity of reasoning**.

The agent evolves its analytical perspective over time while remaining fully constrained by Treasury-defined policy and Reserve discipline.

***

#### Tick-Based Evaluation and Human Intervention

Agent Mode operates on scheduled evaluation ticks (e.g., weekly), corresponding to Treasury review and batch cycles.

Between ticks:

* Treasury operators may adjust portfolios, constraints, or policy parameters
* These changes are incorporated as updated context at the next evaluation
* The agent does not retroactively modify prior conclusions

At each tick, AAA produces a fresh evaluation informed by:

* current policy state
* updated market data
* accumulated analytical history
* system continuity posture

This preserves **human primacy in decision-making** while allowing analytical intelligence to compound responsibly over time.

***

#### Mode Separation and Safeguards

Sandbox Mode and Agent Mode are intentionally separated to prevent:

* unqualified users from generating authoritative-looking outputs
* accidental carryover of exploratory assumptions into production analysis
* erosion of accountability boundaries

Agent Mode is gated by authority, not convenience.\
Sandbox Mode is permissive by design.

***

#### Summary

Sandbox Mode enables exploration without consequence.\
Agent Mode enables continuity without autonomy.

Together, they allow the Autonomous Allocation Agent to serve both as a **learning instrument** and a **fiduciary-grade de**
