#!/bin/bash

# Build script for Tabocalypse Reaper website

set -e

echo "🔮 Building Tabocalypse Reaper website..."

# Create dist directory
echo "📁 Creating dist directory..."
mkdir -p dist

# Build CSS with Tailwind
echo "🎨 Building CSS..."
npx tailwindcss -i ./src/styles.css -o ./dist/styles.css --minify

# Compile TypeScript
echo "⚡ Compiling TypeScript..."
npx tsc

# Copy HTML
echo "📄 Copying HTML..."
cp src/index.html dist/

# Copy assets
echo "🖼️  Copying assets..."
cp -r assets dist/

echo "✅ Build complete! Output in dist/"
echo "🚀 Deploy the dist/ folder to GitHub Pages"
