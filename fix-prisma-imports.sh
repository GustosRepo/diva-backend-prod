#!/bin/bash

# Find all JS files that import PrismaClient incorrectly
echo "🔍 Searching for Prisma imports in your backend..."
FILES=$(grep -rl "import { PrismaClient } from \"@prisma/client\"" src/)

if [ -z "$FILES" ]; then
  echo "✅ No incorrect Prisma imports found. You're good to go!"
  exit 0
fi

# Update each file to use the correct CommonJS import method
echo "⚙️  Updating Prisma imports to work with Node.js 18+ and ESM..."

for FILE in $FILES; do
  echo "✏️  Fixing: $FILE"
  sed -i.bak 's|import { PrismaClient } from "@prisma/client";|import pkg from "@prisma/client";\nconst { PrismaClient } = pkg;|' "$FILE"
done

echo "🚀 Fix applied! Restart your server with: npm run dev"
