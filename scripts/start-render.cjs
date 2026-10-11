// Lightweight starter for Render (Web + API + Gateway only, <512MB RAM)
const { spawn } = require('node:child_process');
const path = require('node:path');

const children = new Map();
let stopping = false;

function launch(name, bin, args, env = {}) {
  const p = spawn(bin, args, { stdio: 'inherit', env: { ...process.env, ...env } });
  children.set(name, p);
  p.on('error', (err) => {
    console.error([] failed to start:, err);
    void stop(1);
  });
  p.on('exit', (code) => {
    children.delete(name);
    if (!stopping && code !== 0) {
      console.error([] exited with code ; shutting down.);
      void stop(code || 1);
    }
  });
  return p;
}

async function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  console.log('Shutting down services...');
  for (const [name, p] of children) {
    p.kill('SIGTERM');
  }
  setTimeout(() => process.exit(code), 5000);
}

process.on('SIGINT', () => void stop());
process.on('SIGTERM', () => void stop());

async function main() {
  console.log('=== Starting Yoru on Render (Playback & Web Mode) ===');

  const port = process.env.PORT || '3000';
  const apiPort = process.env.API_PORT || '4000';
  const gatewayPort = process.env.GATEWAY_PORT || '4001';

  // 1. Launch NestJS API on localhost:4000
  console.log(Starting API on 127.0.0.1:...);
  launch('api', process.execPath, ['dist/server/main.js'], {
    PORT: apiPort,
    HOST: '127.0.0.1'
  });

  // 2. Launch Media Gateway on localhost:4001
  console.log(Starting Media Gateway on 127.0.0.1:...);
  launch('gateway', process.execPath, ['dist/server/gateway.js'], {
    GATEWAY_PORT: gatewayPort,
    HOST: '127.0.0.1'
  });

  // 3. Launch Next.js Web on public Render PORT
  console.log(Starting Next.js frontend on port ...);
  const nextBin = path.join(__dirname, '../node_modules/next/dist/bin/next');
  launch('web', process.execPath, [nextBin, 'start', '-p', port, '-H', '0.0.0.0'], {
    API_INTERNAL_URL: http://127.0.0.1:,
    GATEWAY_INTERNAL_URL: http://127.0.0.1:
  });
}

main().catch((err) => {
  console.error('Fatal start error:', err);
  process.exit(1);
});
