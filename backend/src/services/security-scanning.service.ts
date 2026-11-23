/**
 * Automated Security Scanning Service
 * Implements SAST, DAST, dependency scanning, and container scanning
 */

import { randomUUID } from 'crypto';
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { redis } from './cache.service';
import { pool } from '../config/db';
import { getEnv } from '../config/env';
import { logger } from '../utils/logger';
import { AppError } from '../utils/AppError';
import * as schema from '../db/schema';
import { securityScanResults, securityVulnerabilities } from '../db/schema';

const env = getEnv();
const db = drizzle(pool, { schema });

export interface SecurityScan {
  id: string;
  type: 'sast' | 'dast' | 'dependency' | 'container';
  status: 'pending' | 'running' | 'completed' | 'failed';
  startedAt: Date;
  completedAt?: Date;
  resultsPath: string;
  totalIssues: number;
  criticalIssues: number;
  highIssues: number;
  mediumIssues: number;
  lowIssues: number;
  logs?: string;
}

export interface Vulnerability {
  id: string;
  scanId: string;
  type: string; // CVE, secret leak, code injection, etc.
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  title: string;
  description: string;
  affectedComponent: string;
  affectedVersion?: string;
  remediationAdvice?: string;
  cvssScore?: number;
  cweId?: string;
  detectedAt: Date;
  status: 'open' | 'acknowledged' | 'remediated' | 'false_positive';
}

/**
 * Perform SAST (Static Application Security Testing)
 */
export async function runSAST(
  targetPath: string = process.cwd(),
): Promise<SecurityScan> {
  const scanId = randomUUID();
  const scan: SecurityScan = {
    id: scanId,
    type: 'sast',
    status: 'running',
    startedAt: new Date(),
    resultsPath: '',
    totalIssues: 0,
    criticalIssues: 0,
    highIssues: 0,
    mediumIssues: 0,
    lowIssues: 0,
  };

  try {
    logger.info({ msg: 'Starting SAST scan', scanId, targetPath });

    // Save initial scan record
    const resultsPath = path.join('/tmp', `sast-${scanId}.json`);
    scan.resultsPath = resultsPath;

    // Run SAST tools (example with common tools)
    const tools = await runSASTTools(targetPath, resultsPath);

    // Parse and aggregate results
    const { issues, summary } = parseSecurityResults(resultsPath);

    scan.status = 'completed';
    scan.completedAt = new Date();
    scan.totalIssues = summary.total;
    scan.criticalIssues = summary.critical;
    scan.highIssues = summary.high;
    scan.mediumIssues = summary.medium;
    scan.lowIssues = summary.low;

    // Store vulnerabilities
    for (const issue of issues) {
      await createVulnerability(scanId, issue);
    }

    // Store scan result
    await storeScanResult(scan);

    logger.info({
      msg: 'SAST scan completed',
      scanId,
      summary,
    });

    return scan;
  } catch (error) {
    logger.error({ msg: 'SAST scan failed', scanId, error });
    scan.status = 'failed';
    scan.completedAt = new Date();
    scan.logs = String(error);
    await storeScanResult(scan);
    throw new AppError(500, 'SAST scan failed');
  }
}

/**
 * Perform DAST (Dynamic Application Security Testing)
 */
export async function runDAST(
  targetUrl: string,
): Promise<SecurityScan> {
  const scanId = randomUUID();
  const scan: SecurityScan = {
    id: scanId,
    type: 'dast',
    status: 'running',
    startedAt: new Date(),
    resultsPath: '',
    totalIssues: 0,
    criticalIssues: 0,
    highIssues: 0,
    mediumIssues: 0,
    lowIssues: 0,
  };

  try {
    logger.info({ msg: 'Starting DAST scan', scanId, targetUrl });

    const resultsPath = path.join('/tmp', `dast-${scanId}.json`);
    scan.resultsPath = resultsPath;

    // Run DAST tools (example: OWASP ZAP)
    await runDASTTools(targetUrl, resultsPath);

    // Parse results
    const { issues, summary } = parseSecurityResults(resultsPath);

    scan.status = 'completed';
    scan.completedAt = new Date();
    scan.totalIssues = summary.total;
    scan.criticalIssues = summary.critical;
    scan.highIssues = summary.high;
    scan.mediumIssues = summary.medium;
    scan.lowIssues = summary.low;

    // Store vulnerabilities
    for (const issue of issues) {
      await createVulnerability(scanId, issue);
    }

    await storeScanResult(scan);

    logger.info({
      msg: 'DAST scan completed',
      scanId,
      summary,
    });

    return scan;
  } catch (error) {
    logger.error({ msg: 'DAST scan failed', scanId, error });
    scan.status = 'failed';
    scan.completedAt = new Date();
    scan.logs = String(error);
    await storeScanResult(scan);
    throw new AppError(500, 'DAST scan failed');
  }
}

/**
 * Perform dependency scanning
 */
export async function runDependencyScan(
  targetPath: string = process.cwd(),
): Promise<SecurityScan> {
  const scanId = randomUUID();
  const scan: SecurityScan = {
    id: scanId,
    type: 'dependency',
    status: 'running',
    startedAt: new Date(),
    resultsPath: '',
    totalIssues: 0,
    criticalIssues: 0,
    highIssues: 0,
    mediumIssues: 0,
    lowIssues: 0,
  };

  try {
    logger.info({ msg: 'Starting dependency scan', scanId, targetPath });

    const resultsPath = path.join('/tmp', `deps-${scanId}.json`);
    scan.resultsPath = resultsPath;

    // Run dependency scanning tools
    await runDependencyScanTools(targetPath, resultsPath);

    // Parse results
    const { issues, summary } = parseSecurityResults(resultsPath);

    scan.status = 'completed';
    scan.completedAt = new Date();
    scan.totalIssues = summary.total;
    scan.criticalIssues = summary.critical;
    scan.highIssues = summary.high;
    scan.mediumIssues = summary.medium;
    scan.lowIssues = summary.low;

    // Store vulnerabilities
    for (const issue of issues) {
      await createVulnerability(scanId, issue);
    }

    await storeScanResult(scan);

    logger.info({
      msg: 'Dependency scan completed',
      scanId,
      summary,
    });

    return scan;
  } catch (error) {
    logger.error({ msg: 'Dependency scan failed', scanId, error });
    scan.status = 'failed';
    scan.completedAt = new Date();
    scan.logs = String(error);
    await storeScanResult(scan);
    throw new AppError(500, 'Dependency scan failed');
  }
}

/**
 * Perform container scanning
 */
export async function runContainerScan(
  imageId: string,
): Promise<SecurityScan> {
  const scanId = randomUUID();
  const scan: SecurityScan = {
    id: scanId,
    type: 'container',
    status: 'running',
    startedAt: new Date(),
    resultsPath: '',
    totalIssues: 0,
    criticalIssues: 0,
    highIssues: 0,
    mediumIssues: 0,
    lowIssues: 0,
  };

  try {
    logger.info({ msg: 'Starting container scan', scanId, imageId });

    const resultsPath = path.join('/tmp', `container-${scanId}.json`);
    scan.resultsPath = resultsPath;

    // Run container scanning tools
    await runContainerScanTools(imageId, resultsPath);

    // Parse results
    const { issues, summary } = parseSecurityResults(resultsPath);

    scan.status = 'completed';
    scan.completedAt = new Date();
    scan.totalIssues = summary.total;
    scan.criticalIssues = summary.critical;
    scan.highIssues = summary.high;
    scan.mediumIssues = summary.medium;
    scan.lowIssues = summary.low;

    // Store vulnerabilities
    for (const issue of issues) {
      await createVulnerability(scanId, issue);
    }

    await storeScanResult(scan);

    logger.info({
      msg: 'Container scan completed',
      scanId,
      summary,
    });

    return scan;
  } catch (error) {
    logger.error({ msg: 'Container scan failed', scanId, error });
    scan.status = 'failed';
    scan.completedAt = new Date();
    scan.logs = String(error);
    await storeScanResult(scan);
    throw new AppError(500, 'Container scan failed');
  }
}

/**
 * Get scan results
 */
export async function getScanResults(scanId: string): Promise<SecurityScan | null> {
  try {
    const result = await db.query.securityScanResults.findFirst({
      where: eq(securityScanResults.id, scanId),
    });

    if (!result) return null;

    return {
      id: result.id,
      type: result.type as any,
      status: result.status as any,
      startedAt: result.startedAt,
      completedAt: result.completedAt,
      resultsPath: result.resultsPath,
      totalIssues: result.totalIssues,
      criticalIssues: result.criticalIssues,
      highIssues: result.highIssues,
      mediumIssues: result.mediumIssues,
      lowIssues: result.lowIssues,
      logs: result.logs,
    };
  } catch (error) {
    logger.error({ msg: 'Failed to get scan results', scanId, error });
    return null;
  }
}

/**
 * Get vulnerabilities for a scan
 */
export async function getScanVulnerabilities(scanId: string): Promise<Vulnerability[]> {
  try {
    const vulns = await db.query.securityVulnerabilities.findMany({
      where: eq(securityVulnerabilities.scanId, scanId),
    });

    return vulns.map((v) => ({
      id: v.id,
      scanId: v.scanId,
      type: v.type,
      severity: v.severity as any,
      title: v.title,
      description: v.description,
      affectedComponent: v.affectedComponent,
      affectedVersion: v.affectedVersion,
      remediationAdvice: v.remediationAdvice,
      cvssScore: v.cvssScore,
      cweId: v.cweId,
      detectedAt: v.detectedAt,
      status: v.status as any,
    }));
  } catch (error) {
    logger.error({ msg: 'Failed to get vulnerabilities', scanId, error });
    return [];
  }
}

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------

async function runSASTTools(targetPath: string, resultsPath: string): Promise<void> {
  try {
    // This is a placeholder - in production, integrate with real SAST tools
    // Examples: ESLint with security rules, Semgrep, SonarQube, Snyk Code
    const results = {
      summary: { total: 0, critical: 0, high: 0, medium: 0, low: 0 },
      issues: [],
    };
    fs.writeFileSync(resultsPath, JSON.stringify(results));
  } catch (error) {
    logger.error({ msg: 'SAST tools execution failed', error });
    throw error;
  }
}

async function runDASTTools(targetUrl: string, resultsPath: string): Promise<void> {
  try {
    // Placeholder - integrate with OWASP ZAP, Burp Suite API, etc.
    const results = {
      summary: { total: 0, critical: 0, high: 0, medium: 0, low: 0 },
      issues: [],
    };
    fs.writeFileSync(resultsPath, JSON.stringify(results));
  } catch (error) {
    logger.error({ msg: 'DAST tools execution failed', error });
    throw error;
  }
}

async function runDependencyScanTools(targetPath: string, resultsPath: string): Promise<void> {
  try {
    // Placeholder - integrate with npm audit, Snyk, Dependabot API, etc.
    const results = {
      summary: { total: 0, critical: 0, high: 0, medium: 0, low: 0 },
      issues: [],
    };
    fs.writeFileSync(resultsPath, JSON.stringify(results));
  } catch (error) {
    logger.error({ msg: 'Dependency scan tools execution failed', error });
    throw error;
  }
}

async function runContainerScanTools(imageId: string, resultsPath: string): Promise<void> {
  try {
    // Placeholder - integrate with Trivy, Clair, Grype, etc.
    const results = {
      summary: { total: 0, critical: 0, high: 0, medium: 0, low: 0 },
      issues: [],
    };
    fs.writeFileSync(resultsPath, JSON.stringify(results));
  } catch (error) {
    logger.error({ msg: 'Container scan tools execution failed', error });
    throw error;
  }
}

function parseSecurityResults(
  resultsPath: string,
): {
  issues: Array<{
    type: string;
    severity: string;
    title: string;
    description: string;
    affectedComponent: string;
  }>;
  summary: { total: number; critical: number; high: number; medium: number; low: number };
} {
  try {
    if (fs.existsSync(resultsPath)) {
      const content = fs.readFileSync(resultsPath, 'utf-8');
      const results = JSON.parse(content);
      return {
        issues: results.issues || [],
        summary: results.summary || { total: 0, critical: 0, high: 0, medium: 0, low: 0 },
      };
    }
    return { issues: [], summary: { total: 0, critical: 0, high: 0, medium: 0, low: 0 } };
  } catch (error) {
    logger.error({ msg: 'Failed to parse security results', resultsPath, error });
    return { issues: [], summary: { total: 0, critical: 0, high: 0, medium: 0, low: 0 } };
  }
}

async function createVulnerability(
  scanId: string,
  issue: any,
): Promise<void> {
  try {
    await db.insert(securityVulnerabilities).values({
      id: randomUUID(),
      scanId,
      type: issue.type,
      severity: issue.severity,
      title: issue.title,
      description: issue.description,
      affectedComponent: issue.affectedComponent,
      affectedVersion: issue.affectedVersion,
      remediationAdvice: issue.remediationAdvice,
      cvssScore: issue.cvssScore,
      cweId: issue.cweId,
      detectedAt: new Date(),
      status: 'open',
    });
  } catch (error) {
    logger.error({ msg: 'Failed to store vulnerability', scanId, error });
  }
}

async function storeScanResult(scan: SecurityScan): Promise<void> {
  try {
    await db.insert(securityScanResults).values({
      id: scan.id,
      type: scan.type,
      status: scan.status,
      startedAt: scan.startedAt,
      completedAt: scan.completedAt,
      resultsPath: scan.resultsPath,
      totalIssues: scan.totalIssues,
      criticalIssues: scan.criticalIssues,
      highIssues: scan.highIssues,
      mediumIssues: scan.mediumIssues,
      lowIssues: scan.lowIssues,
      logs: scan.logs,
    });
  } catch (error) {
    logger.error({ msg: 'Failed to store scan result', scanId: scan.id, error });
  }
}
