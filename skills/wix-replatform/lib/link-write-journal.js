'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');

function createLinkWriteJournal(projectDir, runId) {
  const root = path.join(projectDir, 'execution', 'link-write-journal');
  const filename = (recordId, intentKey) => path.join(root, `${createHash('sha256').update([runId, recordId, intentKey].join('\0')).digest('hex')}.json`);
  const save = async (file, row) => {
    await fs.mkdir(root, { recursive: true });
    const temporary = `${file}.${process.pid}.tmp`;
    await fs.writeFile(temporary, `${JSON.stringify(row, null, 2)}\n`);
    await fs.rename(temporary, file);
  };
  return {
    async findCompleted(recordId, intentKey) {
      try {
        const row = JSON.parse(await fs.readFile(filename(recordId, intentKey), 'utf8'));
        return row.status === 'complete' ? row : null;
      } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    },
    async findOpen(recordId, intentKey) {
      try {
        const row = JSON.parse(await fs.readFile(filename(recordId, intentKey), 'utf8'));
        return row.status === 'open' ? row : null;
      } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    },
    async start(recordId, baseRevision, changes, intentKey) {
      if (!intentKey) throw new Error('link write intent key required');
      const file = filename(recordId, intentKey);
      const row = { runId, recordId, intentKey, baseRevision, changes, status: 'open' };
      await save(file, row);
      return row;
    },
    async complete(row) {
      await save(filename(row.recordId, row.intentKey), { ...row, status: 'complete', completedAt: new Date().toISOString() });
    },
  };
}

module.exports = { createLinkWriteJournal };
