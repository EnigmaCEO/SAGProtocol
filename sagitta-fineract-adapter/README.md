# Sagitta Fineract Adapter

TypeScript client for validating Sagitta Banking integration with a local Apache Fineract development instance. The primary integration surface is Fineract Fixed Deposit Accounts mapped into Sagitta term deposit records, with an opt-in lifecycle demo that proves the full fixed-deposit flow end-to-end.

---

## Table of contents

- [Local Fineract setup](#local-fineract-setup)
- [Adapter setup](#adapter-setup)
- [Commands](#commands)
  - [Read-only smoke test](#read-only-smoke-test)
  - [Opt-in lifecycle demo](#opt-in-lifecycle-demo)
  - [Reserve gate standalone check](#reserve-gate-standalone-check)
  - [Available reserve gate check](#available-reserve-gate-check)
  - [Clean demo output](#clean-demo-output)
- [Reserve accounting — total, committed, and available](#reserve-accounting--total-committed-and-available)
- [Reserve gate](#reserve-gate)
- [Receipt output](#receipt-output)
- [Active deposit registry](#active-deposit-registry)
- [Fineract field notes](#fineract-field-notes)
- [Next production milestone](#next-production-milestone)
- [Troubleshooting](#troubleshooting)

---

## Local Fineract setup

This workspace uses `../Fineract`, cloned from the official Apache Fineract repository. Its current `develop` checkout uses the official `docker-compose-development.yml` stack.

**Prerequisites:**

- Docker Desktop running with Docker Compose v2.
- Git.
- Java 21. This Fineract checkout configures an exact Gradle Java 21 toolchain; Java 22 alone is not enough for the image build.

**Windows PowerShell setup and first build:**

```powershell
cd ..\Fineract
$env:JAVA_HOME = "$env:USERPROFILE\.jdks\jdk-21.0.11+10"
$env:Path = "$env:JAVA_HOME\bin;$env:Path"
$env:FINERACT_USER = "1000"
$env:FINERACT_GROUP = "1000"
docker plugin install grafana/loki-docker-driver:latest --alias loki --grant-all-permissions
.\gradlew.bat :fineract-provider:jibDockerBuild -x test
docker compose -f docker-compose-development.yml up -d
```

The Loki plugin installation is a one-time prerequisite of the official development compose file. If it is already installed Docker reports that and it can be skipped.

The initial startup creates the database and applies Liquibase migrations. On a new Windows Docker volume it can take tens of minutes. From this adapter directory, monitor it with:

```powershell
.\scripts\logs-fineract.ps1
.\scripts\healthcheck-fineract.ps1
```

Subsequent lifecycle commands:

```powershell
.\scripts\start-fineract.ps1
.\scripts\stop-fineract.ps1
```

The stop script preserves database volumes. Use explicit Docker volume removal only when intentionally resetting local data.

**Local URLs:**

| Service | URL |
|---|---|
| Health | <https://localhost:8443/fineract-provider/actuator/health> |
| Swagger UI | <https://localhost:8443/fineract-provider/swagger-ui/index.html> |
| OpenAPI JSON | <https://localhost:8443/fineract-provider/fineract.json> |
| API base | <https://localhost:8443/fineract-provider/api/v1> |

Fineract presents a self-signed certificate locally. Open the health URL in a browser once and accept the warning. The adapter bypasses certificate validation only when configured for a localhost URL.

Default development authentication:

```text
username: mifos
password: password
tenant:   default
```

---

## Adapter setup

```powershell
cd sagitta-fineract-adapter
Copy-Item .env.example .env
npm install
npm run typecheck
npm run smoke
```

Default `.env` values:

```dotenv
FINERACT_BASE_URL=https://localhost:8443/fineract-provider/api/v1
FINERACT_TENANT_ID=default
FINERACT_USERNAME=mifos
FINERACT_PASSWORD=password
FINERACT_SSL_INSECURE=true

CREATE_TEST_DATA=false
SAGITTA_TEST_CLIENT_NAME=SAGITTA_TEST CLIENT
SAGITTA_TEST_DEPOSIT_AMOUNT=1000
SAGITTA_TEST_FIXED_YIELD_APY=0.06
SAGITTA_TEST_TERM_MONTHS=12
SAGITTA_TEST_RESERVE_AMOUNT=100
SAGITTA_TEST_COVERAGE_RATIO=1.25
```

`FINERACT_SSL_INSECURE=true` is rejected for non-localhost API URLs. Do not disable TLS certificate verification for deployed environments.

---

## Commands

### Read-only smoke test

```powershell
npm run smoke
```

Connects to Fineract, reads health / offices / products / accounts. **Creates no Fineract data regardless of `CREATE_TEST_DATA`.** Safe to run at any time.

### Opt-in lifecycle demo

```powershell
npm run demo:fd-lifecycle
```

Requires `CREATE_TEST_DATA=true` in `.env` (the script checks and exits 1 otherwise). The `npm run demo:fd-lifecycle` script sets this flag automatically via `cross-env` — just run it.

What the demo does, step by step:

| Step | Description |
|---:|---|
| 1 | Reserve capacity gate (`env` mode: local formula; `onchain` mode: calls `navReserveUsd()` on Arc) |
| 2 | Find or create test client (`SAGITTA_TEST CLIENT`) |
| 3 | Find or create test fixed deposit product (`SAGITTA_TEST_FD_PRODUCT`) |
| 4 | Find in-flight FD account for this client+product, or create a new one |
| 5 | Approve the account (skipped if already approved/active) |
| 6 | Activate the account (skipped if already active) |
| 7 | Fetch final account state |
| 8 | Map to Sagitta term deposit shape |
| 9 | Write receipt to `out/sagitta-fineract-fixed-deposit-demo.json` |

The script is **idempotent**: running it a second time finds the existing client, product, and active account and skips creation/approval/activation steps.

All created Fineract records use the `SAGITTA_TEST` prefix so they are easy to identify and clean up separately from production data.

### Reserve gate standalone check (env mode)

```powershell
npm run demo:reserve-check
```

Runs the reserve capacity gate formula against your current `.env` values without touching Fineract or any RPC endpoint. Exits 0 if approved, exits 1 if rejected. Useful for iterating on coverage ratio and deposit amount before running the full lifecycle.

### On-chain reserve gate check

```powershell
npm run demo:reserve-onchain
```

Reads `navReserveUsd()` directly from the deployed ReserveController on Arc, then runs the gate formula. Does **not** touch Fineract. Requires `ARC_RPC_URL` in `.env`.

Exits 0 if approved, exits 1 if rejected or if the RPC call fails.

### Available reserve gate check

```powershell
npm run demo:reserve-available
```

The committed-reserve-aware gate check. Combines:

1. **Total reserve** — `navReserveUsd()` from the on-chain ReserveController (or `SAGITTA_TEST_RESERVE_AMOUNT` in env mode).
2. **Committed reserve** — sum of required reserves for all active Sagitta-backed FDs, read from `out/sagitta-active-deposits-registry.json`.
3. **Available reserve** — `navReserveUsd − committedReserveUsd`.
4. **Gate decision** — approves only if `availableReserveUsd ≥ requiredReserveUsd` for the new deposit.

Does **not** touch Fineract. Writes a receipt to `out/sagitta-reserve-available-receipt.json`.

**Fail-closed:** exits 1 (no approval) if the committed reserve registry cannot be read or parsed.

```powershell
# env mode (default): navReserveUsd from SAGITTA_TEST_RESERVE_AMOUNT
npm run demo:reserve-available

# on-chain mode: navReserveUsd from ReserveController on Arc
RESERVE_GATE_SOURCE=onchain npm run demo:reserve-available

# test a larger deposit against the available reserve
SAGITTA_TEST_DEPOSIT_AMOUNT=5000 npm run demo:reserve-available
```

### Clean demo output

```powershell
npm run clean:out
```

Deletes the `out/` directory. Does not touch Fineract data.

---

## Reserve accounting — total, committed, and available

The Sagitta reserve has three layers. Understanding all three is required before approving a new fixed deposit.

### Total reserve (`navReserveUsd`)

The gross USD value held in the Sagitta protocol treasury, as reported by `ReserveController.navReserveUsd()` on-chain.

- Sourced via a view call to the deployed ReserveController contract.
- Normalised to a USD float with 6 decimal places (USDC-like).
- Always the starting point for reserve capacity calculations.

### Committed reserve (`committedReserveUsd`)

The portion of the total reserve that has **already been earmarked** to cover the promised yield on active Sagitta-backed fixed deposits. Each active deposit claims:

```
requiredReserveUsd  = principalAmountUsd
                      × fixedYieldApy
                      × (termMonths / 12)
                      × coverageRatio
```

Committed reserve is the sum of `requiredReserveUsd` across all active and approved-not-yet-active FDs tracked in the active deposit registry.

### Available reserve (`availableReserveUsd`)

The portion of the total reserve that is **free to back a new deposit**:

```
availableReserveUsd = navReserveUsd − committedReserveUsd
```

The gate approves a new deposit only when:

```
availableReserveUsd ≥ requiredReserveUsd  (for the new deposit)
```

Checking total reserve alone would double-count capacity that is already promised to existing depositors. The available reserve gate prevents that.

### Why three layers matter

| Scenario | Total reserve | Committed | Available | Gate |
|---|---|---|---|---|
| No active deposits | $500,000 | $0 | $500,000 | Large deposits pass |
| 10 active 12-month 6% $10k deposits | $500,000 | $750 | $499,250 | Effectively the same |
| 1000 active deposits, reserve fully committed | $500,000 | $500,000 | $0 | All new deposits **rejected** |
| Committed > total (reserve depleted) | $40,000 | $75,000 | −$35,000 | All new deposits **rejected** |

### Receipt shape

`demo:reserve-available` writes `out/sagitta-reserve-available-receipt.json`:

```jsonc
"reserveGate": {
  "navReserveUsd": 500000,           // total on-chain reserve
  "committedReserveUsd": 75,         // earmarked for existing active FDs
  "availableReserveUsd": 499925,     // free to back new deposits
  "requestedDepositAmountUsd": 1000, // new deposit principal
  "requiredReserveUsd": 75,          // reserve required for the new deposit
  "approved": true                   // availableReserveUsd ≥ requiredReserveUsd
}
```

---

## Reserve gate

The reserve gate runs before the FD account approval step. It answers: *does the Sagitta treasury hold enough **available** reserve to cover the promised yield for the full deposit term?*

**Formula (confirmed with product spec):**

```
promisedYield            = depositAmount × fixedYieldApy × (termMonths / 12)
requiredReserve          = promisedYield × coverageRatio
maxSupportedDeposit      = (reserveAmountUsd × 12) / (fixedYieldApy × termMonths × coverageRatio)
approved                 = reserveAmountUsd ≥ requiredReserve
```

**Default config (gives a passing gate):**

| Variable | Value | Meaning |
|---|---|---|
| `SAGITTA_TEST_DEPOSIT_AMOUNT` | `1000` | $1,000 principal |
| `SAGITTA_TEST_FIXED_YIELD_APY` | `0.06` | 6 % annual yield |
| `SAGITTA_TEST_TERM_MONTHS` | `12` | 12-month term |
| `SAGITTA_TEST_RESERVE_AMOUNT` | `100` | $100 reserve (env mode only) |
| `SAGITTA_TEST_COVERAGE_RATIO` | `1.25` | 125 % coverage |
| Promised yield | `$60` | $1,000 × 6 % × 1 |
| Required reserve | `$75` | $60 × 1.25 |
| Gate decision | **APPROVED** | $100 ≥ $75 ✓ |

To test a **rejection** in env mode: set `SAGITTA_TEST_DEPOSIT_AMOUNT=5000` (promisedYield=$300, requiredReserve=$375 > $100).

---

## On-chain reserve gate

Set `RESERVE_GATE_SOURCE=onchain` to replace the `.env` stub with a live read from the deployed ReserveController contract.

### How it works

| Mode | `RESERVE_GATE_SOURCE` | Reserve source | RPC call |
|---|---|---|---|
| Demo (default) | `env` | `SAGITTA_TEST_RESERVE_AMOUNT` in `.env` | None |
| Production | `onchain` | `navReserveUsd()` on Arc ReserveController | 1 view call |

**Contract details:**

| Field | Value |
|---|---|
| Contract | `ReserveController` |
| Address (Arc) | `0x23856AAcc3BCC07D25FDbc4D0aa54f6F6C5f78cd` |
| Function | `navReserveUsd() → uint256` |
| Decimals | 6 (USDC-like) |
| ABI source | `frontend/src/lib/abis/ReserveController.json` |

### Configuration

```dotenv
RESERVE_GATE_SOURCE=onchain
ARC_RPC_URL=https://rpc.testnet.arc.network
RESERVE_CONTROLLER_ADDRESS=0x23856AAcc3BCC07D25FDbc4D0aa54f6F6C5f78cd
```

### Fail-closed behaviour

When `RESERVE_GATE_SOURCE=onchain`:

- If `ARC_RPC_URL` is not set → error before any Fineract call.
- If the RPC call fails (network error, wrong chain, contract not found) → Fineract approval is **blocked**. The lifecycle script exits 1. There is **no silent fallback to the `.env` stub**.
- The gate decision, contract address, raw value, and `readAt` timestamp are all recorded in the receipt.

### Receipt shape (on-chain mode)

```jsonc
"reserveGate": {
  "source": "on-chain",
  "contract": "0x23856AAcc3BCC07D25FDbc4D0aa54f6F6C5f78cd",
  "readAt": "2026-05-27T05:00:00.000Z",
  "reserveAmountUsd": 12345.67,
  "requestedDepositAmountUsd": 1000,
  "fixedYieldApy": 0.06,
  "termMonths": 12,
  "promisedYield": 60,
  "requiredReserve": 75,
  "coverageRatio": 1.25,
  "maxSupportedDepositAmountUsd": 164609,
  "approved": true
}
```

### Circle / Arc settlement dependency

The reserve gate is the first gate in the settlement pipeline:

```
navReserveUsd() approved
    ↓
Fineract FD account approved + activated
    ↓
Circle USDC transfer (circleTransferId)
    ↓
Arc on-chain settlement (arcTxHash, treasuryBatchId)
    ↓
Settlement evidence written back to Fineract datatable + note
```

Circle and Arc settlement should only run after this gate approves. Never initiate a Circle transfer against a rejected or unverified reserve position.

---

## Receipt output

Every `npm run demo:fd-lifecycle` run writes:

```
out/sagitta-fineract-fixed-deposit-demo.json
```

The receipt includes:

```jsonc
{
  "demoRunAt": "ISO timestamp",
  "fineractClientId": 1,
  "fineractProductId": 2,
  "fineractAccountId": 1,
  "clientCreated": false,          // true on first run
  "productCreated": false,         // true on first run
  "accountCreated": false,         // true on first run
  "accountStatusBeforeApproval": "active",
  "accountStatusAfterApproval":  "active",
  "accountStatusAfterActivation": "active",
  "reserveGate": {
    "source": "env",               // "on-chain" when RESERVE_GATE_SOURCE=onchain
    "contract": null,              // contract address when source="on-chain"
    "readAt": null,                // ISO timestamp when source="on-chain"
    "reserveAmountUsd": 100,
    "requestedDepositAmountUsd": 1000,
    "fixedYieldApy": 0.06,
    "termMonths": 12,
    "promisedYield": 60,
    "requiredReserve": 75,
    "coverageRatio": 1.25,
    "maxSupportedDepositAmountUsd": 1333.33,
    "approved": true
  },
  "sagittaTermDeposit": {
    "externalCore": "fineract",
    "fineractAccountId": 1,
    "clientId": 1,
    "productId": 2,
    "currency": "USD",
    "principalAmount": 1000,
    "depositTerm": { "value": 12, "unit": "Months" },
    "interestRate": 6,
    "status": "Active",
    "submittedOnDate": "2026-05-26",
    "approvedOnDate": "2026-05-26",
    "activatedOnDate": "2026-05-26",
    "maturityDate": "2027-05-26",
    "sagittaStatus": "active"
  },
  "settlementEvidence": {
    "circleTransferId": null,
    "arcTxHash": null,
    "treasuryBatchId": null,
    "escrowExecutionOrderId": null,
    "allocationPlanHash": null,
    "settlementStatus": "not_started"
  }
}
```

---

## Active deposit registry

`src/committedReserve.ts` reads the list of active Sagitta-backed FDs from a local JSON registry file. This is the source of truth for committed reserve accounting.

### Default path

```
out/sagitta-active-deposits-registry.json
```

Override with the `COMMITTED_RESERVE_REGISTRY` environment variable (absolute or relative path).

### Registry format

```jsonc
[
  {
    "sagittaTermDepositId": "sagitta-fd-1",   // Sagitta-internal identifier
    "fineractAccountId": 1,                    // Fineract FD account id
    "principalAmountUsd": 1000,                // deposit principal in USD
    "fixedYieldApy": 0.06,                     // promised APY (decimal; 0.06 = 6 %)
    "termMonths": 12,                          // deposit term in months
    "coverageRatio": 1.25,                     // reserve coverage ratio
    "status": "active"                         // "active" or "approved_not_active"
  }
]
```

Only entries with `status` equal to `"active"` or `"approved_not_active"` contribute to committed reserve. Closed, matured, or rejected entries are ignored.

### Fallback behaviour

If the registry file does not exist, `committedReserve.ts` falls back to reading `out/sagitta-fineract-fixed-deposit-demo.json` (the lifecycle receipt) and deriving the single active deposit from it. If neither file exists, committed reserve is treated as **zero** (first-ever deposit scenario).

### Fail-closed

If the registry file **exists** but cannot be read or parsed (permissions error, malformed JSON, wrong type), `readCommittedReserve()` **throws**. The caller must block the Fineract approval. This prevents a silently stale or corrupt registry from permitting over-commitment.

---

## Fineract field notes

These fields were confirmed by probing the live local Fineract instance (2026-05-26). They differ from what the Swagger UI suggests in a few cases.

| Context | Field | Confirmed value |
|---|---|---|
| FD Product – deposit term type | `minDepositTermTypeId` / `maxDepositTermTypeId` | `2` = Months |
| FD Product – chart date | `dateFormat` must be inside each chart object, NOT at top level | `"dd MMMM yyyy"` |
| FD Product – description | Mandatory field; blank rejected with 400 | `string` |
| FD Product – accounting | `accountingRule: 1` = NONE; no GL accounts required for demo | — |
| FD Product – chart slabs | `fromPeriod` must start at `1`; 0 triggers `chart.slabs.range.start.incorrect` | — |
| Client creation | `legalFormId` is mandatory (confirmed from `/clients/template`) | `1` = Person |
| FD Account – period freq | `depositPeriodFrequencyId` (not `depositPeriodFrequency`) | `2` = Months |
| Approve command | Body uses `approvedOnDate` with `dateFormat: "yyyy-MM-dd"` | ISO format |
| Activate command | Body uses `activatedOnDate` with `dateFormat: "yyyy-MM-dd"` | ISO format |
| Account response – product id | Field is `depositProductId` (not `savingsProductId`) | `number` |
| Account response – period unit | Field is `depositPeriodFrequency.value` (not `.description`) | `"Months"` |

---

## Next production milestone

The next step is writing Sagitta settlement evidence **back into Fineract** after a Circle transfer and Arc on-chain settlement are completed. Candidate extension points (to be validated against the Fineract API):

| Approach | Fineract API | Notes |
|---|---|---|
| External ID | `PUT /fixeddepositaccounts/{id}` with `externalId` | Simple string tag per account |
| Notes / comments | `POST /notes` | Free-text; survives audit trail |
| Datatables | `POST /datatables/{table}/{entityId}` | Structured key-value; preferred for machine-readable settlement data |
| Document attachment | `POST /fixeddepositaccounts/{id}/documents` | Binary receipt PDF |

The `settlementEvidence` object in the receipt is the placeholder for the production writeback:

```json
{
  "circleTransferId": null,
  "arcTxHash": null,
  "treasuryBatchId": null,
  "escrowExecutionOrderId": null,
  "allocationPlanHash": null,
  "settlementStatus": "not_started"
}
```

Deployed Arc contract addresses (Sagitta `arc.json`):

| Contract | Address |
|---|---|
| Treasury | `0x2776824AAC4D8B800B61aa03706753D9dE9bC1f6` |
| ReserveController | `0x23856AAcc3BCC07D25FDbc4D0aa54f6F6C5f78cd` |
| InvestmentEscrow | `0x74Fc5691994875aD4943Be2aD4a3e58B1bA11316` |

---

## Troubleshooting

- **Docker not running:** open Docker Desktop and wait until `docker info` succeeds.
- **Port `8443` busy:** run `Get-NetTCPConnection -LocalPort 8443` and stop or reconfigure the conflicting service.
- **Missing tenant header:** all authenticated API requests must include `Fineract-Platform-TenantId: default`.
- **Self-signed certificate:** use `FINERACT_SSL_INSECURE=true` for localhost; `curl.exe --insecure` for manual checks.
- **Fineract still starting:** initial Liquibase migrations take time; watch `.\scripts\logs-fineract.ps1`.
- **`demo:fd-lifecycle` exits without CREATE_TEST_DATA:** the script enforces `CREATE_TEST_DATA=true`; the npm script sets it via `cross-env` automatically.
- **Reserve gate rejected:** lower `SAGITTA_TEST_DEPOSIT_AMOUNT` or raise `SAGITTA_TEST_RESERVE_AMOUNT`; the gate records its decision in the receipt even if the demo continues.
- **Gradle requests Java 21:** set `JAVA_HOME` to a Java 21 JDK before invoking `.\gradlew.bat`.
- **FD product validation 400:** see [Fineract field notes](#fineract-field-notes) for confirmed field names. Common pitfalls: missing `description`, `dateFormat` at wrong level, `minDepositTermType` vs `minDepositTermTypeId`.
