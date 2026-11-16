// The host page's script on the entry without GSAP (page.ts says what the
// page is). Nothing here or in page.ts imports gsap.
import '../../src/no-gsap.js';
import { run } from './page.js';

run(null);
