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
const badAutoRoot = path.join(root, 'bad-auto');
const badAnalyticsRoot = path.join(root, 'bad-analytics');
const goodRoot = path.join(root, 'good');
const autoRoot = path.join(root, 'auto');
const hybridRoot = path.join(root, 'hybrid');
fs.mkdirSync(badRoot);
fs.mkdirSync(badAutoRoot);
fs.mkdirSync(badAnalyticsRoot);
fs.mkdirSync(goodRoot);
fs.mkdirSync(autoRoot);
fs.mkdirSync(hybridRoot);

function write(directory, fileName, content) {
  fs.writeFileSync(path.join(directory, fileName), content);
}

try {
  write(
    badRoot,
    '.dashboard-route.json',
    JSON.stringify({
      route: 'custom-table-panel',
      sourceCount: 1,
      sources: ['Order Exceptions'],
      fallbackCategory: 'multi-source',
      firstUnsupportedCapability: 'OR filters with an elapsed-time predicate',
      checkedReference: 'auto-patterns-dashboard/views.md',
      whyDataAdaptationCannotSolve: 'The date comparison is complex',
    }),
  );
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
    <SidePanel.Footer><button>Close</button></SidePanel.Footer>
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
    'BrokenMetrics.tsx',
    `export default function BrokenMetrics() {
  return <Box>
    <Card><StatisticsWidget items={[{ value: '1', description: 'Active' }]} /></Card>
    <StatisticsWidget items={[{ value: '2', description: 'At risk' }]} />
  </Box>;
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
    badRoot,
    'BrokenSelectionTable.tsx',
    `export default function BrokenSelectionTable() {
  const handleSelectionChanged = (selection) => {
    setSelectedIds((selection.selectedRows ?? []).map((row) => row._id));
  };
  return <Table showSelection selectedIds={selectedIds} onSelectionChanged={handleSelectionChanged} />;
}`,
  );

  write(
    badAutoRoot,
    '.dashboard-route.json',
    JSON.stringify({
      route: 'auto-patterns',
      sourceCount: 1,
      sources: ['Order Exceptions'],
      secondary: 'SidePanel detail via row action',
      detailSurface: 'side-panel',
      detailSurfaceReason: 'Preserve table context while inspecting one exception',
    }),
  );

  write(
    badAnalyticsRoot,
    '.dashboard-route.json',
    JSON.stringify({
      route: 'analytics',
      sourceCount: 1,
      sources: ['Subscriptions'],
      regionOwners: {
        collection: 'custom-wds-table',
        metrics: 'wds-statistics-widget',
        chart: 'custom-chart',
        detail: null,
      },
      firstUnsupportedCapability: 'Chart region is not supported by Auto Patterns',
      checkedReference: 'DASHBOARD_AUTO_PATTERNS_PLAYBOOK.md',
    }),
  );
  write(
    badAnalyticsRoot,
    'SubscriptionHealth.tsx',
    `export default function SubscriptionHealth() {
  return <><StatisticsWidget items={items} /><Card><Bar data={chartData} /></Card><Table data={rows} columns={columns}><Table.Content /></Table></>;
}`,
  );
  write(
    badAutoRoot,
    'patterns.json',
    JSON.stringify({
      components: [{
        type: 'collectionPage',
        onRowClick: { type: 'custom', id: 'openOrderDetail' },
      }],
    }),
  );
  write(
    badAutoRoot,
    'OrderExceptions.tsx',
    `import { AutoPatternsApp } from '@wix/auto-patterns';
export const openOrderDetail = ({ actionParams }) => ({
  label: 'View details',
  biName: 'view-details',
  onClick: () => { void actionParams; },
});
export default function OrderExceptions() {
  return <AutoPatternsApp />;
}`,
  );

  write(
    goodRoot,
    '.dashboard-route.json',
    JSON.stringify({
      route: 'custom-table-panel',
      sourceCount: 2,
      sources: ['Orders', 'Customers'],
      fallbackCategory: 'multi-source',
      secondary: 'SidePanel detail via row action',
      detailSurface: 'side-panel',
      detailSurfaceReason: 'Moderate detail while preserving table context',
    }),
  );
  write(
    goodRoot,
    'Dashboard.tsx',
    `function DashboardSidePanelHost({ children }) {
  return <div style={{ position: 'fixed', top: 0, right: 0, bottom: 0, zIndex: 1000, display: 'flex', alignItems: 'stretch' }}>{children}</div>;
}
export default function Dashboard() {
  const [selectedIds, setSelectedIds] = useState([]);
  const [selectedItem, setSelectedItem] = useState(null);
  return <>
    <Table showSelection selectedIds={selectedIds} onSelectionChanged={setSelectedIds} onRowClick={(row) => setSelectedItem(row)} isRowActive={(row) => row.id === selectedItem?.id} columns={[{ width: '82%' }, { width: '18%' }]}>
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

  write(
    autoRoot,
    '.dashboard-route.json',
    JSON.stringify({
      route: 'auto-patterns',
      sourceCount: 1,
      sources: ['Order Exceptions'],
      secondary: null,
      dataAdaptation: 'Maintain needsAttention and exceptionType',
      fallbackCategory: null,
      firstUnsupportedCapability: null,
      checkedReference: 'auto-patterns-dashboard/views.md',
    }),
  );
  write(autoRoot, 'patterns.json', JSON.stringify({ collection: { id: 'order-exceptions' } }));
  write(
    autoRoot,
    'OrderExceptions.tsx',
    `import { AutoPatternsApp } from '@wix/auto-patterns';
export default function OrderExceptions() {
  return <AutoPatternsApp />;
}`,
  );

  write(
    hybridRoot,
    '.dashboard-route.json',
    JSON.stringify({
      route: 'analytics',
      sourceCount: 1,
      sources: ['Subscriptions'],
      regionOwners: {
        collection: 'auto-patterns',
        metrics: 'wds-statistics-widget',
        chart: 'custom-chart',
        detail: null,
      },
      firstUnsupportedCapability: 'Chart region is not supported by Auto Patterns',
      checkedReference: 'auto-patterns-dashboard/custom-sections-override.md',
    }),
  );
  write(hybridRoot, 'patterns.json', JSON.stringify({ collection: { id: 'subscriptions' } }));
  write(
    hybridRoot,
    'SubscriptionHealth.tsx',
    `import { AutoPatternsApp } from '@wix/auto-patterns';
export default function SubscriptionHealth() {
  return <AutoPatternsApp><StatisticsWidget items={items} /><Card><Bar data={chartData} /></Card></AutoPatternsApp>;
}`,
  );

  const bad = spawnSync(process.execPath, [auditPath, badRoot], { encoding: 'utf8' });
  const badOutput = `${bad.stdout}\n${bad.stderr}`;
  const expectedRules = ['RT-02', 'RT-04', 'RT-05', 'CT-08', 'CT-10', 'CT-11', 'CT-12', 'TP-01', 'TP-03', 'TP-05', 'TP-08', 'TP-10', 'TP-11', 'TP-14', 'AN-11', 'AN-13'];
  const missedRules = expectedRules.filter((rule) => !badOutput.includes(rule));
  if (bad.status === 0 || missedRules.length) {
    console.error('Dashboard audit self-test failed to reject the bad fixture.');
    if (missedRules.length) console.error(`Missing rules: ${missedRules.join(', ')}`);
    console.error(badOutput.trim());
    process.exit(1);
  }

  const badAuto = spawnSync(process.execPath, [auditPath, badAutoRoot], { encoding: 'utf8' });
  const badAutoOutput = `${badAuto.stdout}\n${badAuto.stderr}`;
  const missedAutoRules = ['AP-07', 'AP-08'].filter((rule) => !badAutoOutput.includes(rule));
  if (badAuto.status === 0 || missedAutoRules.length) {
    console.error('Dashboard audit self-test failed to reject the broken Auto Patterns detail route.');
    if (missedAutoRules.length) console.error(`Missing rules: ${missedAutoRules.join(', ')}`);
    console.error(badAutoOutput.trim());
    process.exit(1);
  }

  const badAnalytics = spawnSync(process.execPath, [auditPath, badAnalyticsRoot], { encoding: 'utf8' });
  const badAnalyticsOutput = `${badAnalytics.stdout}\n${badAnalytics.stderr}`;
  if (badAnalytics.status === 0 || !badAnalyticsOutput.includes('RT-06')) {
    console.error('Dashboard audit self-test failed to reject analytics fallback that unnecessarily replaces an Auto Patterns table.');
    console.error(badAnalyticsOutput.trim());
    process.exit(1);
  }

  const good = spawnSync(process.execPath, [auditPath, goodRoot], { encoding: 'utf8' });
  if (good.status !== 0) {
    console.error('Dashboard audit self-test rejected the good fixture.');
    console.error(`${good.stdout}\n${good.stderr}`.trim());
    process.exit(1);
  }

  const auto = spawnSync(process.execPath, [auditPath, autoRoot], { encoding: 'utf8' });
  if (auto.status !== 0) {
    console.error('Dashboard audit self-test rejected the Auto Patterns fixture.');
    console.error(`${auto.stdout}\n${auto.stderr}`.trim());
    process.exit(1);
  }

  const hybrid = spawnSync(process.execPath, [auditPath, hybridRoot], { encoding: 'utf8' });
  if (hybrid.status !== 0) {
    console.error('Dashboard audit self-test rejected the valid Auto Patterns collection with supplemental analytics regions.');
    console.error(`${hybrid.stdout}\n${hybrid.stderr}`.trim());
    process.exit(1);
  }

  console.log('Dashboard audit self-test passed: bad routes, native panel controls, and unnecessary custom analytics tables rejected; custom, Auto Patterns, and hybrid fixtures accepted.');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
