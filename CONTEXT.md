# Waterline

Shows what a drug costs at each point in the US supply chain, and specifically whether a pharmacy loses money filling a given prescription. Primary user: an independent pharmacist deciding whether to stock a drug.

## Language

### Drug identity

**NDC-11**:
The canonical drug identifier everywhere in this project — an 11-digit zero-padded digit string with no dashes (labeler 5 + product 4 + package 2). Every dataset join happens on this exact form; source files each mangle it differently (NADAC strips leading zeros, FDA uses variable-width dashed segments, SDUD keeps it correct).
_Avoid_: NDC (ambiguous about format), product code, package code

**Crosswalk**:
The `dim_drug` dimension mapping every NDC-11 to its ingredient, brand name, strength, form, route, labeler, and application number. Every other dataset resolves through it.

**Seed NDCs**:
The ~50 programmatically selected NDCs guaranteed to have both acquisition and reimbursement data (top SDUD spend ∩ current NADAC, plus the ten MFP drugs). Tier-1 loads are filtered to them.

### Prices and margin

**Acquisition cost**:
What a pharmacy paid the wholesaler per unit, as measured by NADAC.
_Avoid_: cost, wholesale price, list price

**Reimbursement**:
What Medicaid paid the pharmacy back per unit (SDUD total amount reimbursed ÷ units reimbursed). Pre-rebate and includes the dispensing fee.
_Avoid_: payment, revenue

**Margin**:
Reimbursement minus acquisition cost, per unit. Always gross and pre-rebate; the gap also contains the PBM's spread.

**Underwater**:
A drug whose margin is negative — the pharmacy loses money on every fill.

**Waterline**:
The zero line the margin crosses.

**Pricing unit**:
The EA / ML / GM basis NADAC and SDUD share. Margin math is only valid within one pricing unit; Part D and FSS use other bases and are benchmarks only.

**Benchmark**:
A context price shown next to the margin but never used in margin math: Part D average spending per dosage unit, VA FSS per-unit price.

**MFP**:
Maximum fair price — Medicare's negotiated price (published per 30-day supply), first cycle of ten drugs effective 2026-01-01.

### Table ownership

**Postgres-only table**:
`users`, `notes`. Contains PII, no analytical value, never replicated.

**CDC-owned table**:
`dim_drug`, `watchlist`, `price_events`, `product_events`. Written only
in Postgres; ClickPipes owns the ClickHouse copies and will overwrite any
direct write to them. `product_events` is deliberately PII-free.

**Fact table**:
ClickHouse-only bulk history loaded direct from files (`nadac_weekly`, `sdud_quarterly`, `partd_spending`, `fss_prices`, `mfp_2026`, `orange_book`). Never routed through Postgres.

### Live layer

**Price event**:
One week-over-week NADAC change for one NDC-11, written to Postgres and carried to ClickHouse by CDC.

**Product event**:
One immutable user action: signup, drug view, watch add, or watch remove. It is
written to Postgres and carried to ClickHouse by CDC. Known dimensions are
typed; never include email, note content, raw search text, IP address, or user
agent.

**Product analytics**:
Usage metrics queried from `product_analytics.events`, the PII-free ClickHouse
projection over the CDC-owned, immutable `product_events` table.

**Watchlist**:
The NDCs a user tracks, each with a percent-change threshold.

**Alert**:
A price event on a watched NDC-11 whose percent change exceeds the threshold.

**Replay**:
Accelerated re-insertion of historical price events into Postgres to demonstrate the live CDC path.
