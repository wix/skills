#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const auditPath = path.join(scriptDirectory, 'audit-dashboard-code.mjs');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wix-dashboard-audit-'));
const badRoot = path.join(root, 'bad');
const goodRoot = path.join(root, 'good');
fs.mkdirSync(badRoot);
fs.mkdirSync(goodRoot);

function write(directory, fileName, content) {
  fs.writeFileSync(path.join(directory, fileName), content);
}

try {
  write(
    badRoot,
    'SessionsTable.tsx',
    `export default function SessionsTable() {
  return <Table onRowClick={() => {}} columns={[
    { width: '55%' }, { width: '50%' }, { width: '0' }
  ]}>
    {!loading && sessions.length === 0 && (
      <EmptyState title="No sessions found"><TextButton>Clear filters</TextButton></EmptyState>
    )}
    <Table.Content />
  </Table>;
}`,
  );
  write(
    badRoot,
    'SessionDetail.tsx',
    `export default function SessionDetail() {
  return <SidePanel skin="floating">
    <SidePanel.Header title="Session"><Badge>Overbooked</Badge></SidePanel.Header>
    <SidePanel.Content>Details</SidePanel.Content>
    <SidePanel.Divider />
    <SidePanel.Content>Coach</SidePanel.Content>
  </SidePanel>;
}`,
  );
  write(
    badRoot,
    'CapacityPlanner.tsx',
    `import SessionDetail from './SessionDetail';
export default function CapacityPlanner() {
  return <><Page /><SessionDetail /></>;
}`,
  );
  write(
    badRoot,
    'BrokenAnalytics.tsx',
    `export default function BrokenAnalytics() {
  const options = { responsive: true, maintainAspectRatio: true };
  return <Card><Box height="260px"><Bar options={options} /></Box></Card>;
}`,
  );
  write(
    badRoot,
    'InteractiveTable.tsx',
    `export default function InteractiveTable() {
  return <Table isRowActive={() => false} columns={[{ width: '82%' }, { width: '18%' }]}>
    <TableActionCell primaryAction={{ text: 'View', visibility: 'always' }} />
  </Table>;
}`,
  );
  write(
    badRoot,
    'BrokenEmptyStateTable.tsx',
    `export default function BrokenEmptyStateTable() {
  return <Table data={rows} columns={columns}>
    {!hasSource && <Table.EmptyState title="No records" />}
    {!hasFiltered && hasSource && <Table.EmptyState title="No results" />}
  </Table>;
}`,
  );

  write(
    goodRoot,
    'Dashboard.tsx',
    `function DashboardSidePanelHost({ children }) {
  return <div style={{ position: 'fixed', top: 0, right: 0, bottom: 0, zIndex: 1000, display: 'flex', alignItems: 'stretch' }}>{children}</div>;
}
export default function Dashboard() {
  return <>
    <Table onRowClick={() => {}} isRowActive={() => false} columns={[{ width: '82%' }, { width: '18%' }]}>
      <TableActionCell primaryAction={{ text: 'View', onClick: () => {} }} />
    </Table>
    <DashboardSidePanelHost>
      <SidePanel skin="floating">
        <SidePanel.Header title="Session" />
        <SidePanel.Content><Badge>Overbooked</Badge><Divider /></SidePanel.Content>
        <SidePanel.Footer><Button priority="secondary">Close</Button></SidePanel.Footer>
      </SidePanel>
    </DashboardSidePanelHost>
  </>;
}`,
  );

  const bad = spawnSync(process.execPath, [auditPath, badRoot], { encoding: 'utf8' });
  const badOutput = `${bad.stdout}\n${bad.stderr}`;
  const expectedRules = ['CT-10', 'CT-11', 'TP-01', 'TP-03', 'TP-05', 'TP-08', 'TP-10', 'TP-11', 'AN-11'];
  const missedRules = expectedRules.filter((rule) => !badOutput.includes(rule));
  if (bad.status === 0 || missedRules.length) {
    console.error('Dashboard audit self-test failed to reject the bad fixture.');
    if (missedRules.length) console.error(`Missing rules: ${missedRules.join(', ')}`);
    console.error(badOutput.trim());
    process.exit(1);
  }

  const good = spawnSync(process.execPath, [auditPath, goodRoot], { encoding: 'utf8' });
  if (good.status !== 0) {
    console.error('Dashboard audit self-test rejected the good fixture.');
    console.error(`${good.stdout}\n${good.stderr}`.trim());
    process.exit(1);
  }

  console.log('Dashboard audit self-test passed: bad composition rejected, documented composition accepted.');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
