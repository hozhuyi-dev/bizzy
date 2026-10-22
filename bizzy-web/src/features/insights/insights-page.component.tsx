import { useMemo } from "react";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { cn } from "cn";
import { InsightsQuery } from "./insights.query";
import { formatChange, formatShare, insightsTotals } from "./insights.util";
import type { ReactNode } from "react";
import type { InsightsMonth, InsightsView } from "./insights.types";
import type { ChartConfig } from "~/components/ui/chart";
import { ExpensesQuery } from "~/features/expenses/expenses.query";
import { totalsByCategory } from "~/features/expenses/expenses.util";
import { PageHeader } from "~/components/shared/layout/page-header/page-header.component";
import { LoadingState } from "~/components/shared/feedback/loading-state/loading-state.component";
import { useQuip } from "~/components/shared/feedback/quip/quip.hook";
import { ErrorMessage } from "~/components/shared/feedback/error-message/error-message.component";
import { Badge } from "~/components/ui/badge";
import { Card, CardContent } from "~/components/ui/card";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "~/components/ui/chart";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "~/components/ui/select";
import { formatHours, formatMonth } from "~/core/utils/date.util";
import { formatCents } from "~/core/utils/money.util";
import { QUIPS } from "~/core/constants/quips.constant";

// Bars: 4px rounded data end, anchored to the baseline.
const BAR_RADIUS: [number, number, number, number] = [4, 4, 0, 0];

const shortMonth = (month: string) => formatMonth(month).split(" ")[0] ?? month;
const axisCents = (cents: number) => formatCents(cents).replace(/\.00$/, "");
const monthLabel = (_: unknown, payload: ReadonlyArray<{ payload?: { month?: string } }>) =>
  formatMonth(String(payload[0]?.payload?.month ?? ""));

const moneyConfig = {
  receivedCents: { label: "Received", color: "var(--chart-1)" },
  spentCents: { label: "Spent", color: "var(--chart-2)" },
} satisfies ChartConfig;

const sessionsConfig = {
  returning: { label: "Returning clients", color: "var(--chart-1)" },
  newSessions: { label: "New clients", color: "var(--chart-2)" },
} satisfies ChartConfig;

interface InsightsPageProps {
  year: number;
  onYearChange: (year: number) => void;
}

/**
 * A calendar year of the practice, Malaysia's tax year: what came in, what
 * went out and what was left, how busy it was, and where the money went,
 * by the tax return's categories. Money is as received; what prepaid
 * packages still owe in sessions sits beside it.
 */
export function InsightsPage({ year, onYearChange }: InsightsPageProps) {
  const insights = InsightsQuery.useYear(year);
  const years = insights.data?.years ?? [year];

  return (
    <>
      <PageHeader
        title="Insights"
        toolbar={
          <Select
            items={years.map((y) => ({ value: String(y), label: String(y) }))}
            value={String(year)}
            onValueChange={(value) => value && onYearChange(Number(value))}
          >
            <SelectTrigger aria-label="Year" className="w-28">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {years.map((y) => (
                <SelectItem key={y} value={String(y)}>
                  {y}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      />

      {insights.isPending ? (
        <LoadingState />
      ) : insights.error ? (
        <ErrorMessage>{insights.error.message}</ErrorMessage>
      ) : (
        <div className={cn("transition-opacity", insights.isPlaceholderData && "opacity-60")}>
          <Insights view={insights.data} />
        </div>
      )}
    </>
  );
}

function Insights({ view }: { view: InsightsView }) {
  const totals = useMemo(() => insightsTotals(view), [view]);
  const sessions = useMemo(
    () => view.months.map((m) => ({ month: m.month, returning: m.sessions - m.newSessions, newSessions: m.newSessions })),
    [view.months],
  );
  const span = view.months.length === 12 ? "" : ` to ${shortMonth(view.months.at(-1)?.month ?? "")}`;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile
          label={`Received${span}`}
          value={formatCents(totals.receivedCents)}
          detail={
            totals.receivedChange === undefined
              ? `${totals.sessions} sessions`
              : `${formatChange(totals.receivedChange)} on the same months of ${view.year - 1}`
          }
        />
        <StatTile
          label="Spent"
          value={formatCents(totals.spentCents)}
          detail={`${formatShare(totals.spentCents, totals.receivedCents)} of received`}
        />
        <StatTile
          label="Left"
          value={formatCents(totals.leftCents)}
          detail={`${formatShare(totals.leftCents, totals.receivedCents)} kept`}
        />
        <StatTile
          label="Prepaid, still owed"
          value={formatHours(view.prepaidMinutes / 60)}
          detail={`${formatCents(view.prepaidCents)} in package hours, as of today`}
        />
      </div>

      <ChartCard title="Money in and out" subtitle="Received and spent each month; the tooltip says what was left.">
        <ChartContainer config={moneyConfig} className="aspect-auto h-64 w-full">
          <BarChart data={view.months} barGap={2} accessibilityLayer>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="month" tickFormatter={shortMonth} tickLine={false} axisLine={false} />
            <YAxis tickFormatter={axisCents} tickLine={false} axisLine={false} width={72} />
            <ChartTooltip
              content={
                <ChartTooltipContent
                  labelFormatter={monthLabel}
                  formatter={(value, name, item, index) => {
                    const row = item.payload as InsightsMonth;
                    return (
                      <>
                        <MoneyRow
                          color={`var(--color-${String(name)})`}
                          label={moneyConfig[name as keyof typeof moneyConfig].label}
                          cents={Number(value)}
                        />
                        {/* After the last series, spent. */}
                        {index === 1 && <MoneyRow label="Left" cents={row.receivedCents - row.spentCents} />}
                      </>
                    );
                  }}
                />
              }
            />
            <ChartLegend content={<ChartLegendContent />} />
            <Bar dataKey="receivedCents" fill="var(--color-receivedCents)" radius={BAR_RADIUS} />
            <Bar dataKey="spentCents" fill="var(--color-spentCents)" radius={BAR_RADIUS} />
          </BarChart>
        </ChartContainer>
        <details className="text-sm">
          <summary className="cursor-pointer text-muted-foreground">Show as a table</summary>
          <table className="mt-2 w-full tabular-nums">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th className="py-1 font-normal">Month</th>
                <th className="py-1 text-right font-normal">Received</th>
                <th className="py-1 text-right font-normal">Spent</th>
                <th className="py-1 text-right font-normal">Left</th>
                <th className="py-1 text-right font-normal">Sessions</th>
              </tr>
            </thead>
            <tbody>
              {view.months.map((m) => (
                <tr key={m.month} className="border-t">
                  <td className="py-1">{formatMonth(m.month)}</td>
                  <td className="py-1 text-right">{formatCents(m.receivedCents)}</td>
                  <td className="py-1 text-right">{formatCents(m.spentCents)}</td>
                  <td className="py-1 text-right">{formatCents(m.receivedCents - m.spentCents)}</td>
                  <td className="py-1 text-right">{m.sessions}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      </ChartCard>

      <div className="grid gap-4 md:grid-cols-2">
        <ChartCard title="Sessions" subtitle={`${totals.sessions} this year; new clients are those in their first month.`}>
          <ChartContainer config={sessionsConfig} className="aspect-auto h-56 w-full">
            <BarChart data={sessions} accessibilityLayer>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="month" tickFormatter={shortMonth} tickLine={false} axisLine={false} />
              <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={32} />
              <ChartTooltip content={<ChartTooltipContent labelFormatter={monthLabel} />} />
              <ChartLegend content={<ChartLegendContent />} />
              {/* A 2px gap of the card between the stacked parts. */}
              <Bar dataKey="returning" stackId="sessions" fill="var(--color-returning)" stroke="var(--card)" strokeWidth={2} />
              <Bar
                dataKey="newSessions"
                stackId="sessions"
                fill="var(--color-newSessions)"
                stroke="var(--card)"
                strokeWidth={2}
                radius={BAR_RADIUS}
              />
            </BarChart>
          </ChartContainer>
        </ChartCard>

        <ChartCard title="Where the money went" subtitle="Spent by the tax return's categories.">
          <SpendingByCategory byCategory={view.spentByCategory} spentCents={totals.spentCents} year={view.year} />
        </ChartCard>
      </div>
    </div>
  );
}

function MoneyRow({ color, label, cents }: { color?: string; label: string; cents: number }) {
  return (
    <div className="flex w-full items-center gap-2">
      <span className="size-2.5 shrink-0 rounded-xs" style={{ backgroundColor: color }} />
      <span className="flex-1 text-muted-foreground">{label}</span>
      <span className="font-medium text-foreground tabular-nums">{formatCents(cents)}</span>
    </div>
  );
}

/** The year's spending by category, largest first, each as a bar of the whole. */
function SpendingByCategory({
  byCategory,
  spentCents,
  year,
}: {
  byCategory: Record<string, number>;
  spentCents: number;
  year: number;
}) {
  const catalogue = ExpensesQuery.useCatalogue();
  const quip = useQuip(QUIPS.insightsSpending);
  if (!catalogue.data) return <LoadingState />;
  const rows = totalsByCategory(byCategory, catalogue.data);
  if (rows.length === 0) {
    return (
      <div className="flex flex-col gap-0.5 text-sm">
        <span className="font-medium">{quip}</span>
        <span className="text-muted-foreground">No expenses in {year}.</span>
      </div>
    );
  }
  return (
    <ul className="flex flex-col gap-3">
      {rows.map(({ category, cents }) => (
        <li key={category.id} className="flex flex-col gap-1 text-sm">
          <span className="flex items-baseline justify-between gap-2">
            <span className="flex min-w-0 flex-wrap items-center gap-1.5">
              <span className="truncate">{category.name}</span>
              {category.capital && <Badge variant="info">Capital allowance</Badge>}
            </span>
            <span className="shrink-0 tabular-nums">
              {formatCents(cents)}
              <span className="text-muted-foreground"> · {formatShare(cents, spentCents)}</span>
            </span>
          </span>
          <span className="h-2 rounded-full bg-muted">
            <span className="block h-2 rounded-full bg-chart-2" style={{ width: `${Math.max((cents / spentCents) * 100, 1)}%` }} />
          </span>
        </li>
      ))}
    </ul>
  );
}

function StatTile({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <Card size="sm">
      <CardContent className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">{label}</span>
        <span className="text-xl font-semibold tabular-nums">{value}</span>
        <span className="text-xs text-muted-foreground">{detail}</span>
      </CardContent>
    </Card>
  );
}

function ChartCard({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-3">
        <div>
          <h2 className="font-medium">{title}</h2>
          {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
        </div>
        {children}
      </CardContent>
    </Card>
  );
}
