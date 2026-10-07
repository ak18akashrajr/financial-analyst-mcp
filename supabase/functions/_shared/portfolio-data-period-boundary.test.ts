// Period boundaries on the server: each IST day belongs to exactly one period.
//
// transactions.date is the FULL entry timestamp in production (add_transaction_and_snapshot inserts without
// a date, so the column default now() fills it). Two consequences this file pins down:
//  - a naive string compare against a bare "YYYY-MM-DD" (`t.date <= "2026-09-30"`) is false for every trade
//    made on that day, silently dropping a period's whole last day from its closing holdings; and an
//    inclusive period.start counted a bare-dated first-day trade in both the opening holdings and the
//    period's activity;
//  - cash was compared as a bare date too, which Postgres reads as 00:00 UTC (05:30 IST), hiding the whole
//    last day's balance edits and, for an in-progress period, today's own edits.
import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  computeHoldingsFromTxns,
  endOfIstDay,
  getPeriodPerformance,
  getPortfolioValueAsOf,
  istDayString,
  listTransactions,
  txnDayIst,
  type Holding,
  type Txn,
} from "./portfolio-data.ts";

// Minimal in-memory stand-in for .from(table).select().eq().in().lte().order().limit() (string comparison,
// same as the sibling portfolio-data.test.ts).
type Rows = Record<string, unknown>[];
function makeBuilder(all: Rows) {
  let rows = [...all];
  const builder: any = {
    select: () => builder,
    eq: (c: string, v: unknown) => { rows = rows.filter((r) => r[c] === v); return builder; },
    in: (c: string, vs: unknown[]) => { const set = new Set(vs); rows = rows.filter((r) => set.has(r[c])); return builder; },
    lte: (c: string, v: unknown) => { rows = rows.filter((r) => (r[c] as string) <= (v as string)); return builder; },
    gte: (c: string, v: unknown) => { rows = rows.filter((r) => (r[c] as string) >= (v as string)); return builder; },
    order: (c: string, o?: { ascending?: boolean }) => {
      const asc = o?.ascending !== false;
      rows = [...rows].sort((a, b) => ((a[c] as string) === (b[c] as string) ? 0 : (a[c] as string) > (b[c] as string) ? (asc ? 1 : -1) : (asc ? -1 : 1)));
      return builder;
    },
    limit: (n: number) => { rows = rows.slice(0, n); return builder; },
    range: (from: number, to: number) => { rows = rows.slice(from, to + 1); return builder; },
    single: () => Promise.resolve({ data: rows[0] ?? null, error: rows[0] ? null : { message: "no rows" } }),
    then: (resolve: any) => Promise.resolve({ data: rows, error: null }).then(resolve),
  };
  return builder;
}
const fakeSb = (tables: Record<string, Rows>) =>
  ({ from: (t: string) => makeBuilder(tables[t] ?? []) }) as unknown as SupabaseClient;

const META = { TCS: { geography: "India", sector: "Tech" } };
const SYMBOL_META: Rows = [{ symbol: "TCS", geography: "India", sector: "Tech" }];
const CASH0 = { liquid: 0, vault: 0, pf: 0, creditCardDebt: 0 };
const nwh = (recorded_at: string, vault: number) => ({ recorded_at, liquid_cash: 0, vault_cash: vault, pf_balance: 0, credit_card_debt: 0 });

describe("txnDayIst / endOfIstDay", () => {
  it("passes a bare date through and converts a timestamp to its IST calendar day", () => {
    expect(txnDayIst("2026-09-30")).toBe("2026-09-30");
    expect(txnDayIst("2026-09-30T14:00:00+00:00")).toBe("2026-09-30"); // 19:30 IST, same day
    expect(txnDayIst("2026-09-30T20:30:00+00:00")).toBe("2026-10-01"); // 02:00 IST next day
    expect(txnDayIst("2026-09-30T18:29:59.999Z")).toBe("2026-09-30"); // last instant of the IST day
    expect(txnDayIst("2026-09-30T18:30:00.000Z")).toBe("2026-10-01"); // first instant of the next
  });

  it("falls back to the date prefix for something unparseable instead of throwing", () => {
    expect(txnDayIst("2026-09-30 garbage")).toBe("2026-09-30");
  });

  it("gives the last instant of an IST day as a UTC timestamp", () => {
    expect(endOfIstDay("2026-09-30")).toBe("2026-09-30T18:29:59.999Z");
  });
});

describe("computeHoldingsFromTxns — as-of a day includes that whole IST day", () => {
  const tx = (date: string, quantity: number): Txn => ({ symbol: "TCS", type: "BUY", quantity, price: 100, date });

  it("counts a timestamped trade made late on the as-of day, and excludes one made after IST midnight", () => {
    const txns = [tx("2026-06-01", 10), tx("2026-09-30T14:00:00+00:00", 5), tx("2026-09-30T20:30:00+00:00", 2)];
    const [h] = computeHoldingsFromTxns(txns, { TCS: 110 }, META, "2026-09-30");
    expect(h.quantity).toBe(15); // not 10 (last day dropped) and not 17 (02:00 IST Oct 1 leaked in)
  });
});

describe("getPeriodPerformance — period boundaries", () => {
  const after = new Date("2027-01-15T00:00:00Z"); // Q2 and Q3 FY2026-27 are both completed by now
  const transactions: Rows = [
    { symbol: "TCS", type: "BUY", quantity: 10, price: 100, date: "2026-06-01" },
    { symbol: "TCS", type: "BUY", quantity: 5, price: 100, date: "2026-09-30T14:00:00+00:00" }, // Q2's last day
    { symbol: "TCS", type: "BUY", quantity: 2, price: 100, date: "2026-09-30T20:30:00+00:00" }, // 02:00 IST Oct 1 → Q3
    { symbol: "TCS", type: "BUY", quantity: 1, price: 100, date: "2026-10-01" }, // bare first-day date → Q3
  ];
  const historical: Rows = [
    { symbol: "TCS", date: "2026-06-30", close: 100 },
    { symbol: "TCS", date: "2026-09-30", close: 110 }, // Q2's real last close
    { symbol: "TCS", date: "2026-10-01", close: 130 }, // Q3's first close — must not be used for Q2
    { symbol: "TCS", date: "2026-12-31", close: 150 },
  ];
  const run = (periodIndex: number, tables: Record<string, Rows> = {}, now = after, live: Holding[] = []) =>
    getPeriodPerformance(
      fakeSb({ transactions, symbol_metadata: SYMBOL_META, historical_prices: historical, net_worth_history: [], ...tables }),
      live, CASH0, "quarter", 2026, periodIndex, now,
    );

  it("includes the period's last-day trade in its closing holdings and prices it at the last-day close", async () => {
    const q2 = await run(2);
    expect(q2.startPortfolioValue).toBe(1000); // 10 × ₹100 at 2026-06-30
    expect(q2.endPortfolioValue).toBe(1650); // 15 × ₹110 at 2026-09-30 — the Oct 1 trades and ₹130 close stay out
  });

  it("opens a period exactly where the previous one closed, so a first-day trade is activity only", async () => {
    const q2 = await run(2);
    const q3 = await run(3);
    expect(q3.startPortfolioValue).toBe(q2.endPortfolioValue); // 1,650 — a shared boundary
    expect(q3.endPortfolioValue).toBe(2700); // all 18 shares × ₹150
    // The two Oct 1 trades are Q3 activity (2×100 + 1×100) and are NOT also inside its opening value.
    expect(q3.buyCount).toBe(2);
    expect(q3.netInvestedInPeriod).toBe(300);
    expect(q2.buyCount).toBe(1);
    expect(q2.netInvestedInPeriod).toBe(500);
  });

  it("keeps balance edits on their own IST day: Sep 30 evening closes Q2 and opens Q3, Oct 1 morning is Q3 only", async () => {
    const tables = {
      transactions: [],
      net_worth_history: [
        nwh("2026-06-30T10:00:00+00:00", 50000), // Jun 30 15:30 IST
        nwh("2026-09-30T14:00:00+00:00", 90000), // Sep 30 19:30 IST
        nwh("2026-10-01T04:30:00+00:00", 150000), // Oct 1 10:00 IST
      ],
    };
    const q2 = await run(2, tables);
    const q3 = await run(3, tables);
    expect(q2.startPortfolioValue).toBe(50000);
    expect(q2.endPortfolioValue).toBe(90000); // the Sep 30 evening edit is in Q2's close (it was missed before)
    expect(q3.startPortfolioValue).toBe(90000); // and Q3 opens from it
    expect(q3.endPortfolioValue).toBe(150000); // the Oct 1 edit is Q3's
  });

  it("uses the latest snapshot up to now for an in-progress period, including an edit made earlier today", async () => {
    const result = await run(
      2,
      {
        transactions: [],
        net_worth_history: [
          nwh("2026-07-10T05:00:00+00:00", 60000),
          nwh("2026-08-23T03:00:00+00:00", 77000), // today, 08:30 IST
        ],
      },
      new Date("2026-08-23T10:00:00Z"),
    );
    expect(result.status).toBe("in-progress");
    expect(result.endPortfolioValue).toBe(77000); // today's edit, not the stale 60,000
  });

  it("states the measurement points in its note", async () => {
    const q3 = await run(3);
    expect(q3.note).toContain("end of 2026-09-30");
  });
});

describe("listTransactions — inclusive range on IST days", () => {
  const transactions: Rows = [
    { symbol: "TCS", type: "BUY", quantity: 1, price: 100, date: "2026-09-29T10:00:00+00:00" },
    { symbol: "TCS", type: "BUY", quantity: 2, price: 100, date: "2026-09-30T14:00:00+00:00" }, // 19:30 IST on the end date
    { symbol: "INFY", type: "SELL", quantity: 1, price: 50, date: "2026-09-30T20:30:00+00:00" }, // 02:00 IST Oct 1
    { symbol: "TCS", type: "BUY", quantity: 4, price: 100, date: "2026-10-01" }, // bare date, next day
  ];
  const sb = () => fakeSb({ transactions });
  const now = new Date("2026-12-01T00:00:00Z");

  it("includes trades made on the end date, and excludes ones after IST midnight", async () => {
    const r = await listTransactions(sb(), undefined, "2026-09-29", "2026-09-30", now);
    expect(r.transactions.map((t) => t.quantity)).toEqual([1, 2]);
    expect(r.buyCount).toBe(2);
    expect(r.sellCount).toBe(0); // the 02:00 IST Oct 1 sell is Oct 1's
    expect(r.netInvested).toBe(300);
  });

  it("includes a trade made on the start date and keeps returning the original date string", async () => {
    const r = await listTransactions(sb(), undefined, "2026-09-30", "2026-10-01", now);
    expect(r.transactions.map((t) => t.date)).toEqual([
      "2026-09-30T14:00:00+00:00",
      "2026-09-30T20:30:00+00:00",
      "2026-10-01",
    ]);
  });

  it("still filters by symbol", async () => {
    const r = await listTransactions(sb(), "INFY", "2026-09-01", "2026-10-31", now);
    expect(r.transactions).toHaveLength(1);
    expect(r.sellCount).toBe(1);
  });
});

describe("getPortfolioValueAsOf — whole as-of day", () => {
  it("includes a balance snapshot recorded later on the as-of day, but not one from the next IST day", async () => {
    const sb = fakeSb({
      transactions: [],
      symbol_metadata: [],
      historical_prices: [],
      net_worth_history: [
        nwh("2026-09-29T10:00:00+00:00", 80000),
        nwh("2026-09-30T14:00:00+00:00", 90000), // 19:30 IST on the as-of day
        nwh("2026-10-01T04:30:00+00:00", 150000), // the next IST day
      ],
    });
    const result = await getPortfolioValueAsOf(sb, "2026-09-30");
    expect(result.vaultCash).toBe(90000);
  });
});

// Audit M22: "today" must be the IST day. The UTC date lags IST by a day between 00:00 and 05:30 IST.
describe("istDayString — today is the IST calendar day (audit M22)", () => {
  it("rolls to the next day at 18:30 UTC (midnight IST), not at 00:00 UTC", () => {
    expect(istDayString(new Date("2026-10-31T18:29:59.999Z"))).toBe("2026-10-31"); // 23:59:59 IST
    expect(istDayString(new Date("2026-10-31T18:30:00.000Z"))).toBe("2026-11-01"); // 00:00:00 IST
  });

  it("agrees with the UTC date for the rest of the IST day", () => {
    expect(istDayString(new Date("2026-11-01T00:00:00Z"))).toBe("2026-11-01"); // 05:30 IST
    expect(istDayString(new Date("2026-11-01T12:00:00Z"))).toBe("2026-11-01");
  });

  it("handles month, year and leap-day boundaries", () => {
    expect(istDayString(new Date("2026-12-31T20:00:00Z"))).toBe("2027-01-01");
    expect(istDayString(new Date("2028-02-28T19:00:00Z"))).toBe("2028-02-29");
  });
});

describe("listTransactions — default range uses the IST month (audit M22)", () => {
  const transactions: Rows = [
    { symbol: "TCS", type: "BUY", quantity: 1, price: 100, date: "2026-10-15T10:00:00+00:00" },
    { symbol: "TCS", type: "BUY", quantity: 3, price: 100, date: "2026-10-31T19:00:00+00:00" }, // 00:30 IST Nov 1
  ];
  // 01:30 IST on 1 Nov 2026 is still 20:00 UTC on 31 Oct.
  const justAfterIstMidnight = new Date("2026-10-31T20:00:00Z");

  it("with no dates, at 01:30 IST on 1 Nov, returns November — not the previous month", async () => {
    const r = await listTransactions(fakeSb({ transactions }), undefined, undefined, undefined, justAfterIstMidnight);
    expect(r.endDate).toBe("2026-11-01");
    expect(r.startDate).toBe("2026-11-01"); // 1st of November, not 2026-10-01
    expect(r.transactions.map((t) => t.quantity)).toEqual([3]); // the 00:30 IST trade; October's is out
  });

  it("is unchanged once UTC has caught up to the same IST day", async () => {
    const r = await listTransactions(fakeSb({ transactions }), undefined, undefined, undefined, new Date("2026-11-01T06:00:00Z"));
    expect(r.endDate).toBe("2026-11-01");
    expect(r.transactions.map((t) => t.quantity)).toEqual([3]);
  });
});

describe("getPeriodPerformance — resolves the period from the IST day (audit M22)", () => {
  const transactions: Rows = [{ symbol: "TCS", type: "BUY", quantity: 10, price: 100, date: "2026-06-01" }];
  const historical: Rows = [{ symbol: "TCS", date: "2026-06-30", close: 100 }];
  const run = (now: Date) =>
    getPeriodPerformance(
      fakeSb({ transactions, symbol_metadata: SYMBOL_META, historical_prices: historical, net_worth_history: [] }),
      [], CASH0, "quarter", undefined, undefined, now,
    );

  it("at 01:30 IST on 1 Oct, resolves Q3 (in progress) rather than the completed Q2", async () => {
    // 20:00 UTC on 30 Sep is 01:30 IST on 1 Oct. UTC "today" said 30 Sep, i.e. Q2, already marked completed.
    const r = await run(new Date("2026-09-30T20:00:00Z"));
    expect(r.periodKey).toContain("Q3");
    expect(r.status).toBe("in-progress");
  });

  it("still resolves Q2 earlier on the same UTC date, before IST midnight", async () => {
    const r = await run(new Date("2026-09-30T10:00:00Z")); // 15:30 IST on 30 Sep
    expect(r.periodKey).toContain("Q2");
    expect(r.status).toBe("in-progress");
  });
});
