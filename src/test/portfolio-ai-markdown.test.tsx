// Regression test for a real bug found in manual QA: markdown tables in
// assistant responses rendered as a wall of literal "|" text instead of an
// actual <table>, because react-markdown doesn't support GFM pipe-tables
// without the remark-gfm plugin. This renders the exact same
// <ReactMarkdown remarkPlugins={[remarkGfm]}> setup used in PortfolioAI.tsx
// against a sample table to confirm it now produces real table markup.
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

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
