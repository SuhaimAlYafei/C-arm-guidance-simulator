import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const appPath = path.resolve(__dirname, '../src/App.jsx');

const oldUrl = 'https://c-arm-guidance-simulator.onrender.com/synthetic-xray';
const newUrl = 'https://c-arm-synthetic-xray.onrender.com/synthetic-xray';

let source = fs.readFileSync(appPath, 'utf8');

if (source.includes(newUrl)) {
  console.log('Synthetic X-ray endpoint is already using the lightweight Render service.');
  process.exit(0);
}

if (!source.includes(oldUrl)) {
  console.error('Could not find the old synthetic X-ray endpoint in App.jsx. No changes made.');
  process.exit(1);
}

source = source.split(oldUrl).join(newUrl);
fs.writeFileSync(appPath, source, 'utf8');
console.log('Switched synthetic X-ray endpoint to:', newUrl);
