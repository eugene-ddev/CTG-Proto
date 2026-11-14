// Отпечаток логики (src/core + src/data): клиент сверяет его с сервером при входе — совпал, значит обе стороны
// считают по одним правилам. Алгоритм тот же, что в CTG-Proto-Backend/scripts/sync-core.mjs — менять вместе.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const SKIP = [/__tests__/, /README\.md$/, /core[\\/]save\.ts$/];
const DIRS = ['core', 'data'];
const sha1 = (text) => crypto.createHash('sha1').update(text).digest('hex');

function listFiles(dir, base = dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (SKIP.some((re) => re.test(full))) return [];
    return entry.isDirectory() ? listFiles(full, base) : [path.relative(base, full).split(path.sep).join('/')];
  });
}

export function coreDigest(root) {
  const lines = [];
  for (const dir of DIRS)
    for (const rel of listFiles(path.join(root, 'src', dir))) {
      const text = fs.readFileSync(path.join(root, 'src', dir, rel), 'utf8').replace(/\r\n/g, '\n');
      lines.push(`${dir}/${rel}:${sha1(text)}`);
    }
  return sha1(lines.sort().join('\n')).slice(0, 12);
}
