import { writeFileSync } from 'fs';
writeFileSync('dist/cjs/package.json', '{"type":"commonjs"}\n');
