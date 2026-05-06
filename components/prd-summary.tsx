"use client";

import type {PrdData} from "@/lib/prd";

import {CircleCheckFill, CircleExclamation, ListUl, SquareDashedCircle} from "@gravity-ui/icons";
import {KPI, KPIGroup} from "@heroui-pro/react";

const completion = (prd: PrdData) =>
  prd.totals.all === 0 ? 0 : Math.round((prd.totals.done / prd.totals.all) * 100);

export function PrdSummary({prd}: {prd: PrdData}) {
  const completionValue = completion(prd);

  return (
    <KPIGroup className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <KPI>
        <KPI.Header>
          <KPI.Icon status="success">
            <ListUl />
          </KPI.Icon>
          <KPI.Title>Stories</KPI.Title>
        </KPI.Header>
        <KPI.Content>
          <KPI.Value maximumFractionDigits={0} value={prd.totals.all} />
        </KPI.Content>
        <KPI.Footer className="text-sm text-muted">
          {prd.requests.length} request{prd.requests.length === 1 ? "" : "s"}
        </KPI.Footer>
      </KPI>

      <KPI>
        <KPI.Header>
          <KPI.Icon status="warning">
            <SquareDashedCircle />
          </KPI.Icon>
          <KPI.Title>Em Andamento</KPI.Title>
        </KPI.Header>
        <KPI.Content>
          <KPI.Value maximumFractionDigits={0} value={prd.totals.in_progress} />
        </KPI.Content>
        <KPI.Footer className="text-sm text-muted">
          {prd.totals.pending} pendente{prd.totals.pending === 1 ? "" : "s"}
        </KPI.Footer>
      </KPI>

      <KPI>
        <KPI.Header>
          <KPI.Icon status="success">
            <CircleCheckFill />
          </KPI.Icon>
          <KPI.Title>Conclusao</KPI.Title>
        </KPI.Header>
        <KPI.Content>
          <KPI.Value maximumFractionDigits={0} style="percent" value={completionValue / 100} />
          <KPI.Progress status="success" value={completionValue} />
        </KPI.Content>
      </KPI>

      <KPI>
        <KPI.Header>
          <KPI.Icon status={prd.totals.failed + prd.totals.blocked > 0 ? "danger" : "success"}>
            <CircleExclamation />
          </KPI.Icon>
          <KPI.Title>Atencao</KPI.Title>
        </KPI.Header>
        <KPI.Content>
          <KPI.Value maximumFractionDigits={0} value={prd.totals.failed + prd.totals.blocked} />
        </KPI.Content>
        <KPI.Footer className="text-sm text-muted">
          {prd.totals.blocked} bloqueada{prd.totals.blocked === 1 ? "" : "s"}
        </KPI.Footer>
      </KPI>
    </KPIGroup>
  );
}
