// Package entry "flythrough/vue": <Flythrough>, a thin Vue component around
// <fly-through>. Never imported by the player; `vue` is an optional peer
// dependency for this entry only. Importing it on a server touches neither
// window nor document: the player is loaded in onMounted, in the browser,
// after Vue has matched a server-rendered page (the player moves the cards
// into its stage).
//
// Props are the element's attributes in camelCase, `stops` and `legs` as
// arrays. They are written to the element as attributes, so what the player
// takes live (flythrough.ts, applyChanges) is live through the props. What
// it reads at the start only (src, mode) and a different set of nodes in
// the slot make a new player: the element's key is made of them, so Vue
// builds one. Every node counts, not only the cards: the player moves
// cards, moments and the poster into its stage, and Vue, putting a node
// back next to one of them (a v-if), asks the element for a child that is
// no longer there. When
// the visitor was inside the tour that is replaced, the page goes to the new
// one's top, so it opens as on a fresh visit: the old place means nothing in
// the new tour, and a browser that anchors the scroll would keep what is
// below the player in view, leaving the visitor past it. The
// element is made with h(), so a project needs no isCustomElement setting.
// Events are emitted (ready, progress, stop) from listeners added after
// mount. The element itself is exposed as `element`.
import { Fragment, defineComponent, h, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { PropType, VNode } from 'vue';
import type { Flythrough as FlythroughElement, ProgressDetail, Stop, StopDetail } from './flythrough.js';

export type { FlythroughElement, ProgressDetail, Stop, StopDetail };

// What a template ref on the component gives: the element itself is under
// `element` (null until mounted).
export interface FlythroughRef {
  element: FlythroughElement | null;
}

// What tells each node of the default slot apart, in order: a card its id,
// anything else its kind and key (a v-if that is off leaves a comment,
// another kind than the element it stands for). Through v-for's fragments.
function childIds(nodes: VNode[]): string[] {
  return nodes.flatMap((node) => {
    if (node.type === Fragment && Array.isArray(node.children)) return childIds(node.children as VNode[]);
    const id = node.props?.['data-stop'];
    const kind = typeof node.type === 'string' ? node.type : typeof node.type === 'symbol' ? node.type.description : '';
    return [typeof id === 'string' ? id : `\t${kind}\t${String(node.key ?? '')}`];
  });
}

export const Flythrough = defineComponent({
  name: 'Flythrough',
  props: {
    src: { type: String, required: true },
    // The stops as data; or leave it out and write each stop on its card.
    stops: Array as PropType<Stop[]>,
    legs: Array as PropType<number[]>,
    intro: Boolean,
    autoscroll: String as PropType<'auto' | 'off'>,
    returnToFirst: String as PropType<'on' | 'off'>,
    snap: String as PropType<'off'>,
    glide: String as PropType<'fixed' | 'scaled'>,
    reach: Number,
    hold: Number,
    length: Number,
    fit: String as PropType<'cover' | 'contain'>,
    mode: String as PropType<'auto' | 'scrub' | 'stills'>,
    loadingText: String,
    barLabel: String,
    bar: String as PropType<'off'>,
    // "off": load the player without GSAP (the entry flythrough/no-gsap).
    // Read once, when the component mounts.
    gsap: String as PropType<'off'>,
  },
  emits: {
    ready: (_event: CustomEvent<null>) => true,
    progress: (_event: CustomEvent<ProgressDetail>) => true,
    stop: (_event: CustomEvent<StopDetail>) => true,
  },
  setup(props, { slots, emit, expose }) {
    const element = ref<FlythroughElement | null>(null);
    expose({ element });

    onMounted(() => {
      void (props.gsap === 'off' ? import('./no-gsap.js') : import('./index.js'));
    });

    // The element changes when its key does: listen on the one that is there.
    let off: AbortController | undefined;
    // Whether the track is scrolling under the screen (the player's own
    // progress says), and whether a player has been here before this one.
    let inside = false;
    let replaced = false;
    watch(
      element,
      (node) => {
        off?.abort();
        if (!node) return;
        if (replaced && inside && props.autoscroll !== 'off') window.scrollTo({ top: node.getBoundingClientRect().top + window.scrollY, behavior: 'instant' });
        replaced = true;
        inside = false;
        off = new AbortController();
        const signal = { signal: off.signal };
        node.addEventListener('flythrough-ready', (e) => emit('ready', e), signal);
        node.addEventListener(
          'flythrough-progress',
          (e) => {
            inside = e.detail.position > 0 && e.detail.position < 1;
            emit('progress', e);
          },
          signal,
        );
        node.addEventListener('flythrough-stop', (e) => emit('stop', e), signal);
      },
      { flush: 'post' },
    );
    onBeforeUnmount(() => off?.abort());

    return () => {
      const cards = slots.default?.() ?? [];
      // What makes it another player: Vue builds a new element when this changes.
      const key = [props.src, props.mode ?? '', ...(props.stops ?? []).map((s) => s.id), '', ...childIds(cards)].join('\n');
      return h(
        'fly-through',
        {
          key,
          ref: element,
          src: props.src,
          stops: props.stops && JSON.stringify(props.stops),
          legs: props.legs && props.legs.join(' '),
          // Bare when on, absent when off.
          intro: props.intro ? '' : undefined,
          autoscroll: props.autoscroll,
          'return-to-first': props.returnToFirst,
          snap: props.snap,
          glide: props.glide,
          reach: props.reach,
          hold: props.hold,
          length: props.length,
          fit: props.fit,
          mode: props.mode,
          'loading-text': props.loadingText,
          'bar-label': props.barLabel,
          bar: props.bar,
        },
        cards,
      );
    };
  },
});
