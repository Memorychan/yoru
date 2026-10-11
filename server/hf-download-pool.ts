import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { resolve } from 'node:path';
interface Task {
  command: Record<string, unknown>;
  resolve: (value: Record<string, unknown>) => void;
  reject: (error: Error) => void;
  queuedAt: number;
}
interface Slot {
  child?: ChildProcessWithoutNullStreams;
  task?: Task;
  timer?: NodeJS.Timeout;
  output: string;
}
const slots: Slot[] = Array.from({ length: 4 }, () => ({ output: '' }));
const waiting: Task[] = [];
function fail(slot: Slot, message: string) {
  const task = slot.task;
  clearTimeout(slot.timer);
  slot.task = undefined;
  const child = slot.child;
  slot.child = undefined;
  slot.output = '';
  child?.kill();
  task?.reject(new Error(message));
  pump();
}
function start(slot: Slot) {
  const child = spawn(
    process.env.PYTHON_BIN || 'python',
    [resolve('scripts/hf-storage.py'), '--serve'],
    {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    },
  );
  slot.child = child;
  child.stderr.on('data', () => {}); // Never expose SDK diagnostics or signed URLs.
  child.stdin.on('error', () => {
    if (slot.child === child) fail(slot, 'HF download connection closed.');
  });
  child.on('error', () => {
    if (slot.child === child)
      fail(slot, 'HF download service could not start. Check Python configuration.');
  });
  child.on('close', () => {
    if (slot.child === child) fail(slot, 'HF download service stopped. Retry playback.');
  });
  child.stdout.on('data', (chunk) => {
    if (slot.child !== child) return;
    slot.output += chunk.toString();
    const newline = slot.output.indexOf('\n');
    if (newline < 0) {
      if (slot.output.length > 65536) fail(slot, 'Invalid HF download response.');
      return;
    }
    const line = slot.output.slice(0, newline);
    slot.output = slot.output.slice(newline + 1);
    const task = slot.task;
    if (!task) return;
    try {
      const result = JSON.parse(line);
      clearTimeout(slot.timer);
      slot.task = undefined;
      if (result.ok === false) {
        // A failed Rust/Xet session can retain its previous task error.
        slot.child = undefined;
        slot.output = '';
        child.kill();
      }
      task.resolve(result);
      pump();
    } catch {
      fail(slot, 'Invalid HF download response.');
    }
  });
}
function pump() {
  for (const [index, slot] of slots.entries()) {
    if (slot.task || !waiting.length) continue;
    // Keep two workers available for actual playback, including jumps far ahead.
    const next = waiting.findIndex((task) => !task.command.prefetch || index < 2);
    if (next < 0) continue;
    let task = waiting.splice(next, 1)[0];
    while (Date.now() - task.queuedAt > 30000) {
      task.reject(new Error('Playback download queue timed out.'));
      if (!waiting.length) break;
      const nextWaiting = waiting.findIndex((item) => !item.command.prefetch || index < 2);
      if (nextWaiting < 0) break;
      task = waiting.splice(nextWaiting, 1)[0];
    }
    if (Date.now() - task.queuedAt > 30000) continue;
    slot.task = task;
    if (!slot.child) start(slot);
    slot.timer = setTimeout(
      () => fail(slot, 'HF segment download timed out. Retry playback.'),
      20000,
    );
    slot.child!.stdin.write(JSON.stringify(task.command) + '\n');
  }
}
export function pooledDownload(command: Record<string, unknown>): Promise<Record<string, unknown>> {
  return new Promise((resolveResult, reject) => {
    if (waiting.length >= 32)
      return reject(new Error('Playback download queue is busy. Retry shortly.'));
    const task = { command, resolve: resolveResult, reject, queuedAt: Date.now() };
    if (command.prefetch) waiting.push(task);
    else {
      const background = waiting.findIndex((item) => item.command.prefetch);
      waiting.splice(background < 0 ? waiting.length : background, 0, task);
    }
    pump();
  });
}
process.once('exit', () => {
  for (const slot of slots) slot.child?.kill();
});
