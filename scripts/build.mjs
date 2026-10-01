/**
 * Build: assemble the static client into ./dist.
 *
 *   client/*  -> dist/
 *   shared/*  -> dist/shared/   (the browser imports the same map/physics/protocol
 *                                modules the server uses, so they can never drift)
 *
 * No bundler needed: the client uses native ES modules.
 */
import { rmSync, cpSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');

if (existsSync(dist)) rmSync(dist, { recursive: true, force: true });
cpSync(join(root, 'client'), dist, { recursive: true });
cpSync(join(root, 'shared'), join(dist, 'shared'), { recursive: true });

console.log('Built client into dist/');
