import { spawn } from 'node:child_process';

export function runProcess(command, args, { signal, cwd, env, maxOutput = 24 * 1024 * 1024, onLog = () => {}, timeout = 15 * 60 * 1000 } = {}) {
  return new Promise((resolve, reject) => {
    let out = '', err = '', failure;
    const child = spawn(command, args, { cwd, env, signal, timeout, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const consume = type => chunk => {
      if (type === 'out') out += chunk.toString('utf8'); else err += chunk.toString('utf8');
      onLog(chunk.toString('utf8'));
      if (out.length + err.length > maxOutput) { failure = new Error('A saída da ferramenta ultrapassou o limite de segurança.'); child.kill(); }
    };
    child.stdout.on('data', consume('out')); child.stderr.on('data', consume('err'));
    child.once('error', error => { failure = error; });
    child.once('close', (code, killedBy) => {
      if (failure) reject(failure);
      else if (code !== 0) reject(new Error(`A ferramenta terminou com ${killedBy || `código ${code}`}. ${err.slice(-1800) || out.slice(-1800)}`));
      else resolve({ stdout: out, stderr: err, code });
    });
  });
}
