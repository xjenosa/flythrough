// The host page's script on the default entry (page.ts says what the page
// is): the entry imported at the top, as a site imports it.
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import '../../src/index.js';
import { run } from './page.js';

gsap.registerPlugin(ScrollTrigger);
run({ gsap, ScrollTrigger });
