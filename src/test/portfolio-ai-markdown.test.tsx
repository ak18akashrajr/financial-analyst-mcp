// Regression test for a real bug found in manual QA: markdown tables in assistant responses
// rendered as a wall of literal "|" text instead of an actual <table>, because react-markdown
// doesn't support GFM pipe-tables without the remark-gfm plugin. Plus coverage for
// AssistantMarkdown's presentation layer on top of that (styled table cards, sign-colored numeric
// cells, callout blockquotes) — see src/components/portfolio-ai/AssistantMarkdown.tsx.
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { AssistantMarkdown } from "@/components/portfolio-ai/AssistantMarkdown";

const SAMPLE_TABLE = `
| Symbol | Qty | Value (₹) |
| --- | --- | --- |
| GOLDBEES.NS | 207 | 25,543.80 |
| NIFTYBEES.NS | 496 | 138,795.68 |
`;

describe("assistant markdown table rendering", () => {
  it("parses a GFM pipe table into real <table>/<th>/<td> elements", () => {
    render(<ReactMarkdown remarkPlugins={[remarkGfm]}>{SAMPLE_TABLE}</ReactMarkdown>);
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Symbol" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "NIFTYBEES.NS" })).toBeInTheDocument();
  });

  it("without remark-gfm, the same table falls back to plain text (documents the bug)", () => {
    render(<ReactMarkdown>{SAMPLE_TABLE}</ReactMarkdown>);
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
});

describe("AssistantMarkdown", () => {
  it("still renders GFM tables as real table markup", () => {
    render(<AssistantMarkdown content={SAMPLE_TABLE} />);
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Value (₹)" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "25,543.80" })).toBeInTheDocument();
  });

  it("right-aligns numeric-looking cells", () => {
    render(<AssistantMarkdown content={SAMPLE_TABLE} />);
    expect(screen.getByRole("cell", { name: "25,543.80" }).className).toMatch(/text-right/);
  });

  it("colors a leading '+' cell as a gain and a leading '-' cell as a loss", () => {
    const table = `
| Symbol | Change |
| --- | --- |
| GOLDBEES.NS | +2.3% |
| NIFTYBEES.NS | -1.1% |
`;
    render(<AssistantMarkdown content={table} />);
    expect(screen.getByRole("cell", { name: "+2.3%" }).className).toMatch(/text-emerald-500/);
    expect(screen.getByRole("cell", { name: "-1.1%" }).className).toMatch(/text-rose-500/);
  });

  it("leaves a plain unsigned cell uncolored", () => {
    render(<AssistantMarkdown content={SAMPLE_TABLE} />);
    const cell = screen.getByRole("cell", { name: "207" });
    expect(cell.className).not.toMatch(/text-emerald-500|text-rose-500/);
  });

  it("renders a blockquote as a styled callout", () => {
    render(<AssistantMarkdown content="> Heads up: this concentration exceeds your limit." />);
    const quote = screen.getByText(/Heads up/).closest("blockquote");
    expect(quote).not.toBeNull();
    expect(quote!.className).toMatch(/border-primary\/40/);
  });

  it("renders plain prose (no table) unchanged, just text", () => {
    render(<AssistantMarkdown content="Your portfolio is well diversified." />);
    expect(screen.getByText("Your portfolio is well diversified.")).toBeInTheDocument();
  });
});
