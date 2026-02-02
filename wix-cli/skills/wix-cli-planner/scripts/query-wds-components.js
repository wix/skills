#!/usr/bin/env node
// Query WDS (Wix Design System) component information from the storybook JSON
// Usage: node query-wds-components.js <component-name> [<component-name> ...]
// Example: node query-wds-components.js Button Card Input

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Get the path to the JSON file (relative to scripts directory)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const jsonPath = path.join(__dirname, '..', 'assets', 'wds-storybook.json');

// Parse command line arguments
const componentNames = process.argv.slice(2);

if (componentNames.length === 0) {
  console.error('Usage: node query-wds-components.js <component-name> [<component-name> ...]');
  console.error('Example: node query-wds-components.js Button Card Input');
  process.exit(1);
}

// Read and parse the JSON file
let data;
try {
  const jsonContent = fs.readFileSync(jsonPath, 'utf8');
  data = JSON.parse(jsonContent);
} catch (error) {
  console.error(`Error reading JSON file: ${error.message}`);
  console.error(`Expected file at: ${jsonPath}`);
  process.exit(1);
}

if (!data.items || !Array.isArray(data.items)) {
  console.error('Invalid JSON structure: expected "items" array');
  process.exit(1);
}

// Normalize component names to handle case-insensitive matching
const normalizedNames = componentNames.map(name => name.trim());
const nameSet = new Set(normalizedNames);

// Filter components by storyName
const foundComponents = data.items.filter(component => 
  nameSet.has(component.storyName)
);

// Track which components were not found
const foundNames = new Set(foundComponents.map(c => c.storyName));
const notFound = normalizedNames.filter(name => !foundNames.has(name));

// Format component information
function formatComponent(component) {
  const lines = [];
  
  lines.push(`# ${component.storyName}`);
  
  if (component.category) {
    lines.push(`Category: ${component.category}`);
  }
  
  if (component.content?.description) {
    lines.push('');
    lines.push('## Description');
    lines.push(component.content.description);
  }
  
  if (component.content?.do && component.content.do.length > 0) {
    lines.push('');
    lines.push('## Do');
    component.content.do.forEach(item => {
      lines.push(`- ${item}`);
    });
  }
  
  if (component.content?.dont && component.content.dont.length > 0) {
    lines.push('');
    lines.push('## Don\'t');
    component.content.dont.forEach(item => {
      lines.push(`- ${item}`);
    });
  }
  
  if (component.content?.featureExamples && component.content.featureExamples.length > 0) {
    lines.push('');
    lines.push('## Features');
    component.content.featureExamples.forEach(feature => {
      if (feature.title) {
        lines.push(`### ${feature.title}`);
      }
      if (feature.description) {
        lines.push(feature.description);
      }
      if (feature.example) {
        lines.push('');
        lines.push('```typescript');
        lines.push(feature.example);
        lines.push('```');
      }
      lines.push('');
    });
  }
  
  return lines.join('\n');
}

// Output results
if (foundComponents.length > 0) {
  foundComponents.forEach((component, index) => {
    if (index > 0) {
      console.log('\n' + '='.repeat(80) + '\n');
    }
    console.log(formatComponent(component));
  });
}

// Report missing components
if (notFound.length > 0) {
  console.error('\n' + '⚠'.repeat(40));
  console.error('Components not found:');
  notFound.forEach(name => {
    console.error(`  - ${name}`);
  });
  console.error('\nNote: Component names are case-sensitive and must match the storyName field exactly.');
  console.error('Available components can be found in the JSON file.');
}

// Exit with error code if any components were not found
if (notFound.length > 0) {
  process.exit(1);
}
