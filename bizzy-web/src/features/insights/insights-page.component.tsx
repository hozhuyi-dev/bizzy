import { useMemo } from "react";
import { Bar, BarChart, CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import {
  change,
  monthTotals,
  monthlySeries,
  summarize,
  topClients,
  yearlySeries,
} from "./insights.metrics";
import type { ReactNode } from "react";
import type { Basis } from "./insights.metrics";
import type { ChartConfig } from "~/components/ui/chart";
import { ClientsQuery } from "~/features/clients/clients.query";
import { PackagesQuery } from "~/features/packages/packages.query";
import { creditsLeft } from "~/features/packages/packages.types";
import { PageHeader } from "~/components/shared/page-header/page-header.component";
import { Loading, useQuip } from "~/components/shared/quip/quip.component";
import { Card, CardContent } from "~/components/ui/card";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "~/components/ui/chart";
import { Tabs, TabsList, TabsTrigger } from "~/components/ui/tabs";
import { addMonths, formatMonth, monthKey } from "~/core/utils/date.util";
import { formatCents } from "~/core/utils/money.util";
import { queryMatch } from "~/core/utils/query.util";
import { QUIPS } from "~/core/constants/quips.constant";

// Bars: 4px rounded data end, anchored to the baseline.
const BAR_RADIUS: [number, number, number, number] = [4, 4, 0, 0];

const shortMonth = (month: string) => formatMonth(month).split(" ")[0] ?? month;

/** Tooltip rows for money series: the chart data is in cents. */
function moneyRow(value: unknown, name: unknown, config: ChartConfig): ReactNode {
  const key = String(name);
  return (
    <div className="flex w-full items-center gap-2">
      <span className="size-2.5 shrink-0 rounded-xs" style={{ backgroundColor: `var(--color-${key})` }} />
      <span className="flex-1 text-muted-foreground">{config[key]?.label ?? key}</span>
      <span className="font-medium text-foreground tabular-nums">{formatCents(Number(value))}</span>
    </div>
  );
}

interface InsightsPageProps {
  basis: Basis;
  onBasisChange: (basis: Basis) => void;
}

export function InsightsPage({ basis, onBasisChange }: InsightsPageProps) {
  const clients = ClientsQuery.useList();
  const packages = PackagesQuery.useList();

  return (
    <>
      <PageHeader
        title="Insights"
        toolbar={
          <Tabs value={basis} onValueChange={(value) => onBasisChange(value as Basis)}>
            <TabsList>
              <TabsTrigger value="received">Money received</TabsTrigger>
              <TabsTrigger value="earned">Earned</TabsTrigger>
            </TabsList>
          </Tabs>
        }
      />

      {queryMatch(clients, {
        pending: () => <Loading />,
        error: (error) => (
          <p role="alert" className="text-sm text-destructive">
            {error.message}
          </p>
        ),
        success: (data) => (
          <Insights
            clients={data}
            basis={basis}
            credits={(packages.data ?? []).reduce(
              (sum, p) => {
                const left = creditsLeft(p);
                return {
                  count: sum.count + left,
                  cents: sum.cents + Math.round((p.priceCents / p.sessions) * left),
                };
              },
              { count: 0, cents: 0 },
            )}
          />
        ),
      })}
    </>
  );
}

interface InsightsProps {
  clients: Parameters<typeof monthTotals>[0];
  basis: Basis;
  credits: { count: number; cents: number };
}

function Insights({ clients, basis, credits }: InsightsProps) {
  const now = monthKey(new Date());
  const totals = useMemo(() => monthTotals(clients), [clients]);
  const months = useMemo(() => monthlySeries(totals, basis, now, 12), [totals, basis, now]);
  const years = useMemo(() => yearlySeries(totals, basis), [totals, basis]);
  const top = useMemo(
    () => topClients(clients, basis, addMonths(now, -11), now),
    [clients, basis, now],
  );

  const thisYear = summarize(totals, basis, addMonths(now, -11), now);
  const lastYear = summarize(totals, basis, addMonths(now, -23), addMonths(now, -12));
  const thisMonth = months.at(-1);
  const yearChange = change(thisYear.cents, lastYear.cents);

  const revenueConfig = {
    cents: { label: "Last 12 months", color: "var(--chart-1)" },
    lastYearCents: { label: "Year before", color: "var(--chart-5)" },
  } satisfies ChartConfig;
  const yearConfig = { cents: { label: "Total", color: "var(--chart-1)" } } satisfies ChartConfig;
  const sessionsConfig = { sessions: { label: "Sessions", color: "var(--chart-1)" } } satisfies ChartConfig;
  const avgConfig = { avgCents: { label: "Per session", color: "var(--chart-1)" } } satisfies ChartConfig;
  const clientsConfig = {
    activeClients: { label: "Seen", color: "var(--chart-1)" },
    newClients: { label: "New", color: "var(--chart-2)" },
  } satisfies ChartConfig;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile
          label={thisMonth ? formatMonth(thisMonth.month) : "This month"}
          value={formatCents(thisMonth?.cents ?? 0)}
          detail={`${thisMonth?.sessions ?? 0} sessions`}
        />
        <StatTile
          label="Last 12 months"
          value={formatCents(thisYear.cents)}
          detail={
            yearChange === undefined
              ? `${thisYear.sessions} sessions`
              : `${yearChange >= 0 ? "▲" : "▼"} ${Math.abs(Math.round(yearChange * 100))}% on the year before`
          }
        />
        <StatTile
          label="Home visits"
          value={thisYear.sessions ? `${Math.round((thisYear.homeSessions / thisYear.sessions) * 100)}%` : "—"}
          detail={`${thisYear.homeSessions} of ${thisYear.sessions} sessions, 12 months`}
        />
        <StatTile
          label="Prepaid, not yet used"
          value={`${credits.count} sessions`}
          detail={`${formatCents(credits.cents)} still owed in sessions`}
        />
      </div>

      <ChartCard title="Revenue by month" subtitle="Grey is the same month a year earlier.">
        <ChartContainer config={revenueConfig} className="aspect-auto h-64 w-full">
          <BarChart data={months} barGap={2} accessibilityLayer>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="month" tickFormatter={shortMonth} tickLine={false} axisLine={false} />
            <YAxis tickFormatter={(v: number) => formatCents(v).replace(/\.00$/, "")} tickLine={false} axisLine={false} width={72} />
            <ChartTooltip
              content={
                <ChartTooltipContent
                  labelFormatter={(_, payload) => formatMonth(String(payload[0]?.payload?.month ?? ""))}
                  formatter={(value, name) => moneyRow(value, name, revenueConfig)}
                />
              }
            />
            <ChartLegend content={<ChartLegendContent />} />
            <Bar dataKey="lastYearCents" fill="var(--color-lastYearCents)" radius={BAR_RADIUS} />
            <Bar dataKey="cents" fill="var(--color-cents)" radius={BAR_RADIUS} />
          </BarChart>
        </ChartContainer>
        <details className="text-sm">
          <summary className="cursor-pointer text-muted-foreground">Show as a table</summary>
          <table className="mt-2 w-full tabular-nums">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th className="py-1 font-normal">Month</th>
                <th className="py-1 text-right font-normal">Amount</th>
                <th className="py-1 text-right font-normal">Year before</th>
                <th className="py-1 text-right font-normal">Sessions</th>
              </tr>
            </thead>
            <tbody>
              {months.map((m) => (
                <tr key={m.month} className="border-t">
                  <td className="py-1">{formatMonth(m.month)}</td>
                  <td className="py-1 text-right">{formatCents(m.cents)}</td>
                  <td className="py-1 text-right">{formatCents(m.lastYearCents)}</td>
                  <td className="py-1 text-right">{m.sessions}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      </ChartCard>

      <div className="grid gap-4 md:grid-cols-2">
        <ChartCard title="Sessions by month">
          <ChartContainer config={sessionsConfig} className="aspect-auto h-52 w-full">
            <BarChart data={months} accessibilityLayer>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="month" tickFormatter={shortMonth} tickLine={false} axisLine={false} />
              <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={32} />
              <ChartTooltip
                content={<ChartTooltipContent labelFormatter={(_, p) => formatMonth(String(p[0]?.payload?.month ?? ""))} />}
              />
              <Bar dataKey="sessions" fill="var(--color-sessions)" radius={BAR_RADIUS} />
            </BarChart>
          </ChartContainer>
        </ChartCard>

        <ChartCard title="Average earned per session" subtitle="Splits growth into more sessions vs higher fees.">
          <ChartContainer config={avgConfig} className="aspect-auto h-52 w-full">
            <LineChart data={months} accessibilityLayer>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="month" tickFormatter={shortMonth} tickLine={false} axisLine={false} />
              <YAxis tickFormatter={(v: number) => formatCents(v).replace(/\.00$/, "")} tickLine={false} axisLine={false} width={64} domain={["auto", "auto"]} />
              <ChartTooltip
                content={
                  <ChartTooltipContent
                    labelFormatter={(_, p) => formatMonth(String(p[0]?.payload?.month ?? ""))}
                    formatter={(value, name) => moneyRow(value, name, avgConfig)}
                  />
                }
              />
              <Line dataKey="avgCents" stroke="var(--color-avgCents)" strokeWidth={2} dot={{ r: 4 }} connectNulls />
            </LineChart>
          </ChartContainer>
        </ChartCard>

        <ChartCard title="Clients by month" subtitle="Seen at least once, and seen for the first time.">
          <ChartContainer config={clientsConfig} className="aspect-auto h-52 w-full">
            <LineChart data={months} accessibilityLayer>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="month" tickFormatter={shortMonth} tickLine={false} axisLine={false} />
              <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={32} />
              <ChartTooltip
                content={<ChartTooltipContent labelFormatter={(_, p) => formatMonth(String(p[0]?.payload?.month ?? ""))} />}
              />
              <ChartLegend content={<ChartLegendContent />} />
              <Line dataKey="activeClients" stroke="var(--color-activeClients)" strokeWidth={2} dot={{ r: 4 }} />
              <Line dataKey="newClients" stroke="var(--color-newClients)" strokeWidth={2} dot={{ r: 4 }} />
            </LineChart>
          </ChartContainer>
        </ChartCard>

        <ChartCard title="Revenue by year">
          <ChartContainer config={yearConfig} className="aspect-auto h-52 w-full">
            <BarChart data={years} accessibilityLayer>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="year" tickLine={false} axisLine={false} />
              <YAxis tickFormatter={(v: number) => formatCents(v).replace(/\.00$/, "")} tickLine={false} axisLine={false} width={80} />
              <ChartTooltip content={<ChartTooltipContent formatter={(value, name) => moneyRow(value, name, yearConfig)} />} />
              <Bar dataKey="cents" fill="var(--color-cents)" radius={BAR_RADIUS} maxBarSize={56} />
            </BarChart>
          </ChartContainer>
        </ChartCard>
      </div>

      <ChartCard title="Top clients, last 12 months" subtitle="How much of the business rests on a few clients.">
        {top.length === 0 ? (
          <TopClientsEmpty />
        ) : (
          <ul className="flex flex-col gap-2">
            {top.map((client) => (
              <li key={client.id} className="grid grid-cols-[minmax(0,10rem)_1fr_auto] items-center gap-3 text-sm">
                <span className="truncate">{client.name}</span>
                <span className="h-2 rounded-full bg-muted">
                  <span
                    className="block h-2 rounded-full bg-chart-1"
                    style={{ width: `${Math.max(client.share * 100, 1)}%` }}
                  />
                </span>
                <span className="text-right tabular-nums">
                  {formatCents(client.cents)}
                  <span className="text-muted-foreground"> · {Math.round(client.share * 100)}%</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </ChartCard>
    </div>
  );
}

function StatTile({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <Card size="sm">
      <CardContent className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">{label}</span>
        <span className="text-xl font-semibold">{value}</span>
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

/** Left-aligned to sit with the card's other content. */
function TopClientsEmpty() {
  const quip = useQuip(QUIPS.insightsTopClients);
  return (
    <div className="flex flex-col gap-0.5 text-sm">
      <span className="font-medium">{quip}</span>
      <span className="text-muted-foreground">No sessions in the last 12 months.</span>
    </div>
  );
}
