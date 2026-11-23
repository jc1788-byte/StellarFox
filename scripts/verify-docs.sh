#!/bin/bash
# Verification script for documentation completeness
# Checks that essential documentation files exist and are referenced in README

set -e

echo "Verifying documentation completeness..."

# Check deployment guide
if [ ! -f "docs/deployment-guide.md" ]; then
  echo "ERROR: docs/deployment-guide.md not found"
  exit 1
fi
echo "✓ docs/deployment-guide.md exists"

# Check troubleshooting guide
if [ ! -f "docs/troubleshooting-guide.md" ]; then
  echo "ERROR: docs/troubleshooting-guide.md not found"
  exit 1
fi
echo "✓ docs/troubleshooting-guide.md exists"

# Check ADR documentation
if [ ! -f "docs/adr/README.md" ]; then
  echo "ERROR: docs/adr/README.md not found"
  exit 1
fi
echo "✓ docs/adr/README.md exists"

if [ ! -f "docs/adr/0000-template.md" ]; then
  echo "ERROR: docs/adr/0000-template.md not found"
  exit 1
fi
echo "✓ docs/adr/0000-template.md exists"

# Check README for links
if ! grep -q "\[Deployment Guide\](docs/deployment-guide.md)" README.md; then
  echo "ERROR: README.md does not contain link to deployment guide"
  exit 1
fi
echo "✓ README.md contains deployment guide link"

if ! grep -q "\[Troubleshooting Guide\](docs/troubleshooting-guide.md)" README.md; then
  echo "ERROR: README.md does not contain link to troubleshooting guide"
  exit 1
fi
echo "✓ README.md contains troubleshooting guide link"

if ! grep -q "\[Architecture Decision Records\](docs/adr/README.md)" README.md; then
  echo "ERROR: README.md does not contain link to architecture decision records"
  exit 1
fi
echo "✓ README.md contains architecture decision records link"

echo "All documentation checks passed."
exit 0