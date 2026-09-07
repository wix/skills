'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { readEntityByRef } = require('./domain-knowledge.js');

const SCHEMA_VERSION = 1;

function normalizePathPresence(verifiedPaths = []) {
  return verifiedPaths
    .filter((entry) => entry && entry.path && entry.present !== false)
    .map((entry) => entry.path);
}

function createContractLedgerProposalFromStoresVerification(artifact) {
  if (!artifact || typeof artifact !== 'object') {
    throw new Error('verification artifact is required');
  }
  if (artifact.command !== 'stores subscription-create') {
    throw new Error(`unsupported verification command: ${artifact.command || '<missing>'}`);
  }
  const verifiedPaths = normalizePathPresence(artifact.verifiedPaths);
  return {
    schemaVersion: SCHEMA_VERSION,
    proposalId: `stores-product-subscription-create-${(artifact.timestamp || new Date().toISOString()).slice(0, 10)}`,
    status: artifact.status === 'passed' ? 'proposed' : 'blocked',
    sourceVerification: {
      command: artifact.command,
      artifactPath: artifact.artifactPath || null,
      targetSiteIdentifier: artifact.targetSiteIdentifier || null,
      timestamp: artifact.timestamp || null,
      probeRecordId: artifact.probeRecordId || null,
    },
    targetRef: 'stores/product',
    fieldContract: {
      domain: 'stores',
      entity: 'product',
      surface: 'catalog-v3',
      operation: 'createProduct',
      path: 'product.subscriptionDetails',
      verificationLevel: 'live-create-and-readback',
      lastVerified: artifact.timestamp ? artifact.timestamp.slice(0, 10) : null,
      verifiedBy: artifact.targetSiteIdentifier || artifact.sourceRunId || 'live-verification',
      requiredPaths: verifiedPaths.filter((entry) => entry !== 'product.subscriptionDetails.subscriptions[].id'),
      constraints: Array.isArray(artifact.constraintsDiscovered)
        ? artifact.constraintsDiscovered.map((constraint) => ({ ...constraint }))
        : [],
      readback: {
        'product.subscriptionDetails': verifiedPaths.includes('product.subscriptionDetails') ? 'returned-after-create' : 'unverified',
        'product.subscriptionDetails.subscriptions[].id': verifiedPaths.includes('product.subscriptionDetails.subscriptions[].id') ? 'server-assigned' : 'unverified',
      },
    },
  };
}

function proposalKey(proposal) {
  const contract = proposal && proposal.fieldContract;
  return [
    proposal && proposal.targetRef,
    contract && contract.surface,
    contract && contract.operation,
    contract && contract.path,
  ].join('|');
}

function contractKey(contract, entity) {
  return [
    `${contract.domain || (entity && entity.domain)}/${contract.entity || (entity && entity.entity)}`,
    contract.surface,
    contract.operation,
    contract.path,
  ].join('|');
}

function promotedContractForProposal(domainsDir, proposal) {
  if (!proposal || !proposal.targetRef || !proposal.fieldContract) return null;
  const entity = readEntityByRef(domainsDir, proposal.targetRef);
  return (entity.fieldContracts || []).find((contract) => contractKey(contract, entity) === proposalKey(proposal)) || null;
}

function isProposalPromoted(domainsDir, proposal) {
  let promoted;
  try {
    promoted = promotedContractForProposal(domainsDir, proposal);
  } catch (error) {
    return false;
  }
  if (!promoted) return false;
  const expected = proposal.fieldContract || {};
  return promoted.verificationLevel === expected.verificationLevel;
}

function readJsonIfExists(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeProposal(filePath, proposal) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(proposal, null, 2)}\n`);
  return proposal;
}

function validateContractPromotion({ domainsDir, verificationArtifacts = [], proposalArtifacts = [] } = {}) {
  const errors = [];
  const proposals = proposalArtifacts
    .map((artifactPath) => ({ artifactPath, proposal: readJsonIfExists(artifactPath) }))
    .filter((entry) => entry.proposal);
  const proposalsByVerification = new Map();
  for (const { proposal, artifactPath } of proposals) {
    const sourcePath = proposal.sourceVerification && proposal.sourceVerification.artifactPath;
    if (sourcePath) proposalsByVerification.set(path.resolve(sourcePath), { proposal, artifactPath });
  }

  for (const artifactPath of verificationArtifacts) {
    const artifact = readJsonIfExists(artifactPath);
    if (!artifact || artifact.status !== 'passed') continue;
    if (artifact.command !== 'stores subscription-create') continue;
    const proposalEntry = proposalsByVerification.get(path.resolve(artifactPath));
    if (!proposalEntry) {
      errors.push(`${artifactPath}: passed verification is missing contract-ledger proposal`);
      continue;
    }
    const { proposal } = proposalEntry;
    if (proposal.status === 'deferred' || proposal.deferralReason) continue;
    if (!isProposalPromoted(domainsDir, proposal)) {
      errors.push(`${proposalEntry.artifactPath}: proposal is not promoted into shared target ledger`);
    }
  }

  return { ok: errors.length === 0, errors };
}

module.exports = {
  SCHEMA_VERSION,
  createContractLedgerProposalFromStoresVerification,
  promotedContractForProposal,
  isProposalPromoted,
  validateContractPromotion,
  writeProposal,
};
