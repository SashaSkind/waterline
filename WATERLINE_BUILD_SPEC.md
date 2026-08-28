# Waterline — build spec

A hackathon project for ClickHouse's Postgres-to-ClickHouse replication theme.

**Time budget: 4.5 hours.** This is the single most important constraint in this document. When any instruction here conflicts with shipping something demoable, ship the demoable thing.

---

## 1. What we are building

Waterline shows what a drug costs at each point in the supply chain, and specifically whether a pharmacy loses money filling a given prescription.

Two public federal datasets, joined on the drug's NDC code:

- **NADAC** tells us what a pharmacy paid the wholesaler for a drug.
- **Medicaid SDUD** tells us what Medicaid paid that pharmacy back.

The difference is the pharmacy's gross margin. When it is negative, the pharmacy is "underwater" on that drug. Hence the name.

Around that core we add context columns: what Medicare Part D spent, what the VA negotiated, and whether the drug got an IRA negotiated price in 2026.

**Primary user: an independent pharmacist.** They have a real decision (stock it or don't) and a reason to return weekly when new prices post. Journalists and patients can use it too, but do not design for them.

---

## 2. Stack

| Layer | Choice |
|---|---|
| App | Next.js (App Router, TypeScript) |
| Deploy | Vercel |
| Charts | Recharts |
| Styling | Tailwind |
| Loaders | Python scripts, run locally, never deployed |
| OLTP | Postgres (ClickHouse Cloud managed, Mini tier) |
| OLAP | ClickHouse Cloud |
| Replication | ClickPipes Postgres CDC |

Loaders live in `/loaders` and are a separate concern from the app. They use `pandas` or `duckdb` for CSV work, `psycopg` for Postgres, `clickhouse-connect` for ClickHouse.

The app uses `pg` and `@clickhouse/client`.

---

## 3. Architecture rules

These are decided. Do not relitigate them mid-build.

### Three groups of tables

**Postgres only.** `users`, `notes`. No analytical value, contains PII, never replicated.

**In both, replicated by CDC.** `dim_drug`, `watchlist`, `price_events`. Written in Postgres, copied to ClickHouse by ClickPipes. **Never write to the ClickHouse copies directly** — CDC owns them and will overwrite you.

**ClickHouse only, loaded directly from files.** `nadac_weekly`, `sdud_quarterly`, `fss_prices`, `mfp_2026`, `partd_spending`, `orange_book`, `margin_mv`.

### Why bulk history does not go through Postgres

Loading millions of immutable historical rows into Postgres means every row passes through the write-ahead log. On a Mini instance that is slow, and a replication slot that falls behind lets WAL accumulate, which can take the database down. Historical facts load direct to ClickHouse from files. Only operational tables ride the pipe.

This split is also how real deployments work, so it is a point in our favour if a judge asks.

### App connections

Two direct connections: Postgres for writes, ClickHouse for analytical reads. This is easier to debug than routing everything through one connection.

If time remains at the end, add `pg_clickhouse` and move one or two read queries onto it, behind a feature flag, keeping the direct client as fallback. This is worth doing because it is the part of the ClickHouse integration nobody else will demo, but it is not worth doing at hour two.

---

## 4. Data sources

### 4.1 FDA NDC Directory — build this first

The crosswalk. Every other dataset joins through it. It has no prices.

Download from FDA's NDC Directory page (look up the current download URL; it publishes a zipped `product.txt` and `package.txt`). Roughly 100k products, a few MB.

Fields we need: `productndc`, `proprietaryname`, `nonproprietaryname`, `labelername`, `dosageformname`, `routename`, `active_numerator_strength`, `active_ingred_unit`, `applicationnumber`, `marketingcategory`, `startmarketingdate`.

`package.txt` carries the 11-digit NDC. NADAC and SDUD use NDC-11 with no dashes. **Normalize every NDC to an 11-digit zero-padded string with no dashes, everywhere, in every loader.** Inconsistent NDC formatting is the single most likely thing to silently break this project.

### 4.2 NADAC — what the pharmacy pays

`https://data.medicaid.gov/dataset/fbb83258-11c7-47f5-8b18-5f8e79f7e704` (2026 file; there is one dataset per calendar year, and the site exposes a datastore query API with column filters so you can pull a subset over HTTP).

Grain: one row per NDC-11 per effective date. Around 25k–30k active NDCs per week. Updated weekly; the monthly refresh lands the first Monday on or after the 15th.

Columns: `ndc`, `ndc_description`, `nadac_per_unit`, `effective_date`, `pricing_unit` (EA / ML / GM), `pharmacy_type_indicator`, `otc`, `explanation_code`, `classification_for_rate_setting` (B / G), `corresponding_generic_drug_nadac_per_unit`, `corresponding_generic_drug_effective_date`, `as_of_date`.

There is also a **week-to-week comparison file** carrying `old_nadac_per_unit`, `percent_change` and `primary_reason`. Grab it — it gives us the alert logic for free.

Caveat to surface in the UI: since December 2024, monthly generic NADAC updates use a three-month moving average, so a flat generic price may be smoothing rather than a genuinely flat price.

### 4.3 Medicaid SDUD — what Medicaid paid back

`https://data.medicaid.gov/dataset/61729e5a-7aa8-448c-8903-ba3e0cd0ea3c` (2024 file; one dataset per year).

Grain: state × quarter × NDC-11 × utilization type (FFS or MCO).

Columns: `utilization_type`, `state`, `ndc`, `labeler_code`, `product_code`, `package_size`, `year`, `quarter`, `suppression_used`, `product_name`, `units_reimbursed`, `number_of_prescriptions`, `total_amount_reimbursed`, `medicaid_amount_reimbursed`, `non_medicaid_amount_reimbursed`.

Reimbursement per unit is `total_amount_reimbursed / units_reimbursed`. Same NDC, same unit basis as NADAC, directly comparable.

Caveats: amounts are **pre-rebate**, so they overstate what the state really paid, most on expensive brands. Small cell counts are suppressed. Start at 2008 or later; the non-Medicaid field is unreliable before Q4 2007.

### 4.4 Medicare Part D Spending by Drug — context column

From `data.cms.gov`, "Medicare Part D Spending by Drug". There is also a quarterly version, which is better if we want recency.

Grain: brand name × generic name × manufacturer × year, with an "Overall" row per drug. Around 4,000 drugs. Wide format, one column block per year (`Tot_Spndng_YYYY`, `Tot_Dsg_Unts_YYYY`, average spending per dosage unit, etc.) — **unpivot it to long on load.**

**This dataset has no NDC.** CMS already rolled up to brand and generic name across all strengths and forms. So it joins to `dim_drug` by name, not code, and the match is fuzzy. Budget slack for this and treat a failed match as "no data" rather than an error.

Also: an asterisk in `Brnd_Name` means the per-unit figure mixes routes of administration with different unit pricing. Exclude those rows from any headline number.

Spending is gross drug cost including dispensing fee and sales tax, not net of manufacturer rebates.

### 4.5 VA Federal Supply Schedule — the government benchmark

`https://www.va.gov/opal/nac/fss/pharmprices.asp`

A current snapshot, not a time series. Carries NDC, product name, package description, vendor, FSS price, and Big Four price where disclosed. Prices are **per package**, so divide by package size for a unit price before comparing to NADAC. The file layout is unfriendly; budget an hour if it fights back, and drop it rather than blow the budget.

### 4.6 IRA maximum fair prices — the 2026 marker

`https://www.cms.gov/initiatives/medicare-prescription-drug-affordability/overview/medicare-drug-price-negotiation-program/selected-drugs-negotiated-prices`

Ten drugs, effective January 1 2026, from the first negotiation cycle. Fifteen more selected for 2027. This is ten rows — hardcode it if scraping is any trouble at all.

Its job is a badge on ten drug pages plus a vertical marker on the chart. That marker is the single most topical thing in the demo.

### 4.7 FDA Orange Book — generic entry dates

Look up the current Orange Book data files download on FDA.gov. We need the products file and the approval dates. Join to `dim_drug` on `applicationnumber`.

Its only job: give us the date the first ANDA (generic) was approved for a drug, so the chart can show a vertical line where the price collapses.

---

## 5. Schemas

### Postgres

```sql
CREATE TABLE dim_drug (
  ndc11               TEXT PRIMARY KEY,
  ndc_product         TEXT,
  ingredient          TEXT,
  strength            TEXT,
  strength_unit       TEXT,
  dosage_form         TEXT,
  route               TEXT,
  brand_name          TEXT,
  labeler             TEXT,
  is_generic          BOOLEAN,
  application_number  TEXT,
  start_marketing     DATE,
  updated_at          TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE users (
  user_id     BIGSERIAL PRIMARY KEY,
  email       TEXT,
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE watchlist (
  watch_id      BIGSERIAL PRIMARY KEY,
  user_id       BIGINT,
  ndc11         TEXT,
  threshold_pct NUMERIC DEFAULT 5.0,
  added_at      TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE notes (
  note_id     BIGSERIAL PRIMARY KEY,
  user_id     BIGINT,
  ndc11       TEXT,
  body        TEXT,
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE price_events (
  event_id        BIGSERIAL PRIMARY KEY,
  ndc11           TEXT,
  effective_date  DATE,
  nadac_per_unit  NUMERIC,
  prev_per_unit   NUMERIC,
  pct_change      NUMERIC,
  ingested_at     TIMESTAMPTZ DEFAULT now()
);
```

Seed exactly one user. No auth.

### ClickHouse

```sql
CREATE TABLE nadac_weekly (
  ndc11 String, effective_date Date, nadac_per_unit Decimal(18,5),
  pricing_unit LowCardinality(String), classification LowCardinality(String),
  otc UInt8, explanation_code LowCardinality(String),
  corresponding_generic_per_unit Nullable(Decimal(18,5))
) ENGINE = ReplacingMergeTree ORDER BY (ndc11, effective_date);

CREATE TABLE sdud_quarterly (
  ndc11 String, state LowCardinality(String), year UInt16, quarter UInt8,
  utilization_type LowCardinality(String),
  units_reimbursed Decimal(18,3), number_of_prescriptions UInt32,
  total_amount_reimbursed Decimal(18,2),
  medicaid_amount_reimbursed Decimal(18,2), suppression_used UInt8
) ENGINE = ReplacingMergeTree ORDER BY (ndc11, year, quarter, state, utilization_type);

CREATE TABLE partd_spending (
  brand_name String, generic_name String, manufacturer String, year UInt16,
  total_spending Decimal(20,2), total_dosage_units Decimal(20,3),
  avg_spending_per_unit Decimal(18,5), total_claims UInt64, total_benes UInt64,
  multi_route_flag UInt8
) ENGINE = ReplacingMergeTree ORDER BY (generic_name, brand_name, manufacturer, year);

CREATE TABLE fss_prices (
  ndc11 String, product_name String, vendor String, package_size Decimal(18,3),
  fss_price Decimal(18,4), big_four_price Nullable(Decimal(18,4)),
  fss_per_unit Decimal(18,5)
) ENGINE = ReplacingMergeTree ORDER BY ndc11;

CREATE TABLE mfp_2026 (
  generic_name String, brand_name String, mfp Decimal(18,2),
  unit_description String, effective_date Date
) ENGINE = ReplacingMergeTree ORDER BY generic_name;

CREATE TABLE orange_book (
  application_number String, ingredient String, first_generic_approval Date
) ENGINE = ReplacingMergeTree ORDER BY application_number;
```

`dim_drug`, `watchlist` and `price_events` arrive in ClickHouse via the ClickPipe. Do not create them by hand.

### The margin view

The core query, materialized so the drug page and top-ten list are point lookups rather than scans:

```
margin_mv(ndc11, state, year, quarter,
          acq_per_unit, reimb_per_unit, margin_per_unit, margin_pct)
```

`acq_per_unit` is the NADAC price in effect at the midpoint of that quarter. `reimb_per_unit` is `total_amount_reimbursed / units_reimbursed`. Only join rows where `units_reimbursed > 0` and `suppression_used = 0`.

---

## 6. Load plan

Two tiers. **Ship tier 1, then load tier 2 only if the app already works.**

### Tier 1 — demo data, load in the first hour

- Full FDA NDC Directory (small, no reason to filter).
- **50 NDCs**, selected programmatically, not hardcoded: take the top NDCs by `total_amount_reimbursed` from the most recent SDUD quarter, keep only those that also appear in the latest NADAC file, and take the top 50. This guarantees every seed drug has data on both sides.
- Force-include any NDCs matching the ten IRA negotiated drugs by ingredient name, so the MFP marker has something to sit on.
- For those NDCs: 2 years of NADAC weekly, 2 years of SDUD quarterly.
- All of `mfp_2026` (ten rows). FSS and Orange Book filtered to the seed NDCs.

This is a few hundred thousand rows. Loads in minutes.

### Tier 2 — widen, only when the app runs end to end

Same loader, `ndc_filter=None`, 2 years of everything, all NDCs. A few million rows.

**Write every loader with the filter parameter from the start:**

```python
def load_nadac(years: list[int], ndc_filter: set[str] | None = None) -> None: ...
```

Tier 1 passes the set. Tier 2 passes `None`. Same code path, no rewrite at hour four when you are tired.

All ClickHouse tables are ReplacingMergeTree on the natural key, so re-running a loader over a wider set is idempotent. Never worry about dedupe.

### Staging

Download the raw archives to disk **before the event**. Do not plan to pull hundreds of MB over venue wifi. Check the hackathon rules — most restrict code written beforehand, not data staged beforehand.

---

## 7. Features, in build order

Build these in order. Each one should work before starting the next.

**F1. Drug search.** Input accepts brand name, generic name, or a pasted NDC. All three resolve through `dim_drug` to the same drug page. Autocomplete if free, plain submit if not.

**F2. Drug page — the price stack.** For one drug, show:
- Acquisition cost per unit (NADAC), with `pricing_unit` and effective date
- Medicaid reimbursement per unit, with state and quarter
- **The margin**, per unit and per typical fill. Negative renders red.
- Part D average spending per unit (context)
- VA FSS per unit (context)
- IRA MFP badge if the drug is one of the ten

Missing data renders as "no data", never as zero.

**F3. Top ten worst margins.** The homepage. Precomputed from `margin_mv`, loads instantly, filterable brand vs generic, each row links to its drug page. This exists so the demo does not open on an empty search box.

**F4. Watchlist and alerts.** Add a drug to the watchlist (writes to Postgres). When a `price_events` row lands for a watched NDC exceeding its threshold, an alert appears in the UI within seconds. Alert shows drug, old and new per-unit cost, percent change, and whether the margin flipped negative.

**F5. Live replay.** A script that inserts historical NADAC weekly changes into Postgres `price_events` at accelerated speed. CDC carries them to ClickHouse. The drug page, the top-ten list and the alert feed all update in place. Server-sent events from a route handler, or 2-second polling if SSE fights back.

**F6. History chart.** Recharts. NADAC weekly line and SDUD quarterly step line for one drug, with the band between them shaded. Vertical markers for first generic approval (Orange Book) and for the January 2026 MFP effective date where applicable.

**F7. State comparison.** Sorted bar chart of per-unit Medicaid reimbursement by state for one NDC in one quarter. Note which states are suppressed.

**F8. Deploy to Vercel.** Not last. Deploy a hello-world at hour one, redeploy continuously.

If time runs out, F1–F5 plus deploy is a complete demo. F6 and F7 are the first things to drop.

---

## 8. UI notes

Design for a pharmacist at a counter, not for a data scientist. Big numbers, few words.

The margin number is the hero of the drug page. Everything else is supporting.

**Show the caveats in the interface, not in a footnote.** Directly under the margin number, in small text:

> Medicaid amounts are pre-rebate and include the dispensing fee, so this is gross margin. The gap also contains the PBM's spread, which no public data separates out.

Teams that hand-wave this get taken apart in Q&A. Stating it plainly demonstrates domain understanding.

Include a small "how to read this" panel explaining the supply chain: pharmacy buys from wholesaler (NADAC sees this), payer reimburses pharmacy (SDUD and Part D see this), manufacturer rebates payer (confidential), wholesaler pays manufacturer (not public).

---

## 9. Hour plan

**0:00–0:20 — Infrastructure.** Provision the ClickHouse Cloud service and the managed Postgres service (Mini tier), same cloud provider, same region. Create the ClickPipe from the ClickHouse service's Data Sources tab, pointing at Postgres, selecting only `dim_drug`, `watchlist`, `price_events`. Do this on empty tables. Insert one row by hand and watch it appear in ClickHouse. That round trip is the proof the architecture works and you want it now, not at hour three.

Deploy a hello-world Next.js app to Vercel in the same window.

**0:20–1:00 — Crosswalk.** Load the FDA NDC Directory, build `dim_drug` in Postgres, verify the ClickPipe replicated it. Select the 50 seed NDCs. **Verify the join resolves for all 50 before writing any more code.** If it does not, the NDC normalization is wrong and everything downstream will be silently wrong.

**1:00–1:40 — Tier 1 data.** Load 2 years of NADAC and SDUD for the seed NDCs into ClickHouse. Build `margin_mv`. Run the margin query in the ClickHouse console and eyeball the numbers. Some should be negative. If none are, something is wrong.

**1:40–2:50 — App core.** F1, F2, F3. Search, drug page, top ten. Deploy.

**2:50–3:30 — The live layer.** F4 and F5. Watchlist, alerts, replay script. This is what makes the CDC pipe load-bearing, so do not skip it for a prettier chart.

**3:30–4:00 — Widen and chart.** Kick off the tier 2 load in a background shell. While it runs, build F6. Then F7 if the clock allows.

**4:00–4:30 — Rehearse.** Deploy final. Run the demo three times end to end. Fix what breaks. Do not start anything new.

---

## 10. Demo script

Ninety seconds, rehearsed until boring.

1. Land on the homepage. Top ten worst margins is already on screen. "These are drugs where pharmacies lose money on every fill."
2. Click one. Show the price stack: pharmacy paid this, Medicaid paid back that, the gap is negative.
3. Show the chart. Point at the generic entry marker. "The gap collapses right here, when the first generic was approved."
4. Show an IRA drug with the January 2026 marker. "This is Medicare's first negotiated price, in effect this year."
5. Add a drug to the watchlist.
6. Start the replay. New price events stream in, the top ten reshuffles, the watchlist alert fires. "That row was written to Postgres. It's in ClickHouse and on screen in seconds."
7. One sentence on the architecture: app writes to Postgres, ClickPipes replicates to ClickHouse, twenty million rows of history load direct because pushing them through the WAL would be reckless.

---

## 11. Gotchas

**NDC formatting** is the number one risk. 11 digits, zero-padded, no dashes, everywhere, no exceptions. The FDA file uses a different segmentation than NADAC. Write one normalization function and use it in every loader.

**Unit mismatch.** NADAC's `pricing_unit` (EA/ML/GM) and SDUD's unit type line up. Part D's "dosage unit" does not, because CMS already collapsed strengths. FSS is per package. Do the rigorous math only on the NADAC-to-SDUD pair and present Part D and FSS as clearly labelled benchmarks.

**Part D name matching** is the second biggest risk. Normalize aggressively (lowercase, strip punctuation, match on generic name first). Treat a miss as "no data".

**Do not write to replicated ClickHouse tables.** CDC will overwrite you and you will lose twenty minutes wondering why the fix vanished.

**Delete both cloud services after the event.** Hackathon bills that keep running for a month are a well-known tax.

---

## 12. Non-goals

Not in scope, do not build unless everything above is done and deployed:

- Real authentication or multiple users
- Manufacturing cost estimates (not public; the whole reason we anchored on the acquisition-to-reimbursement gap instead)
- Hospital price transparency data
- CSV export
- LLM-generated summaries
- Mobile-specific layouts
- Tests

---

## 13. Name

**Waterline.** The point where margin crosses zero. Replace any placeholder occurrences before deploying.
