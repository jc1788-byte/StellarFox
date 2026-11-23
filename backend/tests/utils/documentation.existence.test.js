/**
 * Test to verify that essential documentation files exist.
 * This test ensures that documentation completeness is maintained.
 */

const fs = require('fs');
const path = require('path');

describe('Documentation Existence', () => {
  const docsDir = path.resolve(__dirname, '../../../docs');
  const standardsPath = path.resolve(__dirname, '../../../docs/CODE_DOCUMENTATION_STANDARDS.md');
  const checkerPath = path.resolve(__dirname, '../../../scripts/check-code-documentation.py');
  const rustdocCheckerPath = path.resolve(__dirname, '../../../contracts/scripts/check_rustdoc.py');

  test('deployment guide exists', () => {
    const deploymentGuidePath = path.join(docsDir, 'deployment-guide.md');
    expect(fs.existsSync(deploymentGuidePath)).toBe(true);
  });

  test('troubleshooting guide exists', () => {
    const troubleshootingGuidePath = path.join(docsDir, 'troubleshooting-guide.md');
    expect(fs.existsSync(troubleshootingGuidePath)).toBe(true);
  });

  test('README contains documentation links', () => {
    const readmePath = path.resolve(__dirname, '../../../README.md');
    const readmeContent = fs.readFileSync(readmePath, 'utf8');
    expect(readmeContent).toContain('[Deployment Guide](docs/deployment-guide.md)');
    expect(readmeContent).toContain('[Troubleshooting Guide](docs/troubleshooting-guide.md)');
  });

  test('code documentation standards exist', () => {
    expect(fs.existsSync(standardsPath)).toBe(true);
    const standards = fs.readFileSync(standardsPath, 'utf8');
    expect(standards).toContain('Required coverage');
    expect(standards).toContain('TSDoc/JSDoc format');
    expect(standards).toContain('Rustdoc format');
  });

  test('code documentation validators exist', () => {
    expect(fs.existsSync(checkerPath)).toBe(true);
    expect(fs.existsSync(rustdocCheckerPath)).toBe(true);
  });

  test('root package exposes documentation commands', () => {
    const packagePath = path.resolve(__dirname, '../../../package.json');
    const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
    expect(packageJson.scripts['docs:check']).toBeDefined();
    expect(packageJson.scripts['docs:coverage']).toBeDefined();
  });
});