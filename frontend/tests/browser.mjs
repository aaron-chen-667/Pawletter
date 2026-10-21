import {existsSync} from 'node:fs';
let playwright;
try {playwright=await import('playwright-core');}
catch {playwright=await import('../../.preview-tools.local/node_modules/playwright-core/index.mjs');}
const candidates=[
  process.env.BROWSER_PATH,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/chromium',
  '/usr/bin/google-chrome',
].filter(Boolean);
const executablePath=candidates.find(existsSync);
if(!executablePath)throw new Error('Set BROWSER_PATH to your Chrome or Edge executable.');
export async function launchBrowser(options={}){return playwright.chromium.launch({executablePath,headless:true,args:['--no-proxy-server',...(options.args||[])]});}
