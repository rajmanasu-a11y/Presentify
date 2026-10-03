// Copies the PDF viewer's fonts and decoders next to the built app (served at /pdfjs/),
// so documents render without any internet access.
import { cpSync, mkdirSync } from 'node:fs';
const from = new URL('../node_modules/pdfjs-dist/', import.meta.url);
const to = new URL('../dist/pdfjs/', import.meta.url);
mkdirSync(to, { recursive: true });
for (const dir of ['standard_fonts', 'cmaps', 'wasm', 'iccs']) {
  cpSync(new URL(`${dir}/`, from), new URL(`${dir}/`, to), { recursive: true });
}
console.log('PDF viewer resources copied to dist/pdfjs/');
