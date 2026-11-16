'use client';
// Package entry "flythrough/react": <Flythrough>, a thin React component
// around <fly-through>, and the JSX types for the element itself. Never
// imported by the player; `react` is an optional peer dependency for this
// entry only. Importing it on a server touches neither window nor document:
// the player is loaded in an effect, in the browser, after React has matched
// a server-rendered page (the player moves the cards into its stage).
//
// Props are the element's attributes in camelCase, `stops` and `legs` as
// arrays. They are written to the element as attributes, so what the player
// takes live (flythrough.ts, applyChanges) is live through the props. What
// it reads at the start only (src, mode) and a different set of direct
// children make a new player: the element's key is made of them, so React
// builds one. Every direct child counts, not only the cards: the player
// moves cards, moments and the poster into its stage, and React, adding or
// taking out one of them or a neighbour, asks the element for a child that
// is no longer there (a NotFoundError that blanked the page).
// When the visitor was inside the tour that is replaced, the page goes to
// the new one's top, so it opens as on a fresh visit: the old place means
// nothing in the new tour, and a browser that anchors the scroll would keep
// what is below the player in view, leaving the visitor past it.
// Events are props too, bound with addEventListener after mount: React does
// not bind a custom element's event props on a page a server rendered.
import { Children, Fragment, createElement, forwardRef, isValidElement, useCallback, useEffect, useRef } from 'react';
import type { CSSProperties, ForwardedRef, ReactNode } from 'react';
import type { Flythrough as FlythroughElement, ProgressDetail, Stop, StopDetail } from './flythrough.js';

export type { FlythroughElement, ProgressDetail, Stop, StopDetail };

export interface FlythroughProps {
  src: string;
  // The stops as data; or leave it out and write each stop on its card.
  stops?: Stop[];
  legs?: number[];
  intro?: boolean;
  autoscroll?: 'auto' | 'off';
  returnToFirst?: 'on' | 'off';
  snap?: 'off';
  glide?: 'fixed' | 'scaled';
  reach?: number;
  hold?: number;
  length?: number;
  fit?: 'cover' | 'contain';
  mode?: 'auto' | 'scrub' | 'stills';
  loadingText?: string;
  barLabel?: string;
  bar?: 'off';
  // "off": load the player without GSAP (the entry flythrough/no-gsap).
  // Read once, when the component mounts.
  gsap?: 'off';
  className?: string;
  style?: CSSProperties;
  id?: string;
  // The cards and moments, as direct children.
  children?: ReactNode;
  onReady?: (event: CustomEvent<null>) => void;
  onProgress?: (event: CustomEvent<ProgressDetail>) => void;
  onStop?: (event: CustomEvent<StopDetail>) => void;
}

// What tells each direct child apart, in order: a card its id, any other
// element the key React gives it by its place (one that is not rendered has
// none), text that it is there, not what it says (React makes a node for
// every string but the empty one and for a number, and writes new words into
// the same node). Through fragments. A child component that itself renders
// nothing at one time and an element at another cannot be seen from here
// (README).
function childIds(children: ReactNode): string[] {
  return Children.toArray(children).flatMap((child): string[] => {
    // No key starts like this one: React's all begin with a dot.
    if (!isValidElement(child)) return typeof child === 'object' || child === '' ? [] : ['\ttext'];
    const given = child.props as { 'data-stop'?: unknown; children?: ReactNode };
    if (child.type === Fragment) return childIds(given.children);
    return [typeof given['data-stop'] === 'string' ? given['data-stop'] : `\t${child.key}`];
  });
}

function setRef(ref: ForwardedRef<FlythroughElement>, node: FlythroughElement | null) {
  if (typeof ref === 'function') ref(node);
  else if (ref) ref.current = node;
}

export const Flythrough = forwardRef<FlythroughElement, FlythroughProps>(function Flythrough(props, ref) {
  const { src, stops, legs, intro, autoscroll, returnToFirst, snap, glide, reach, hold, length, fit, mode, loadingText, barLabel, bar, gsap, className, style, id, children } = props;
  const element = useRef<FlythroughElement | null>(null);
  const handlers = useRef(props);
  handlers.current = props;
  // Whether the track is scrolling under the screen (the player's own
  // progress says), and whether a player has been here before this one.
  const inside = useRef(false);
  const replaced = useRef(false);
  // What makes it another player: React builds a new element when this changes.
  const key = [src, mode ?? '', ...(stops ?? []).map((s) => s.id), '', ...childIds(children)].join('\n');

  // One function for the life of the component: React calls a new ref
  // function with null and then the element on every render.
  const bind = useCallback(
    (node: FlythroughElement | null) => {
      element.current = node;
      setRef(ref, node);
    },
    [ref],
  );

  useEffect(() => {
    void (gsap === 'off' ? import('./no-gsap.js') : import('./index.js'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const node = element.current;
    if (!node) return;
    if (replaced.current && inside.current && handlers.current.autoscroll !== 'off') window.scrollTo({ top: node.getBoundingClientRect().top + window.scrollY, behavior: 'instant' });
    replaced.current = true;
    inside.current = false;
    const off = new AbortController();
    const signal = { signal: off.signal };
    node.addEventListener('flythrough-ready', (e) => handlers.current.onReady?.(e), signal);
    node.addEventListener(
      'flythrough-progress',
      (e) => {
        inside.current = e.detail.position > 0 && e.detail.position < 1;
        handlers.current.onProgress?.(e);
      },
      signal,
    );
    node.addEventListener('flythrough-stop', (e) => handlers.current.onStop?.(e), signal);
    return () => off.abort();
  }, [key]);

  return createElement(
    'fly-through',
    {
      key,
      ref: bind,
      src,
      stops: stops && JSON.stringify(stops),
      legs: legs && legs.join(' '),
      // Bare when on, absent when off, in every React version.
      intro: intro ? '' : undefined,
      autoscroll,
      'return-to-first': returnToFirst,
      snap,
      glide,
      reach,
      hold,
      length,
      fit,
      mode,
      'loading-text': loadingText,
      'bar-label': barLabel,
      bar,
      class: className,
      style,
      id,
    },
    children,
  );
});

// The element's own attributes, for writing <fly-through> in JSX without the
// component: under the names they are written with (src/flythrough.ts).
export interface FlythroughAttributes {
  src: string;
  stops?: string; // JSON.stringify(stops); or write each stop on its card
  intro?: boolean;
  autoscroll?: 'auto' | 'off';
  'return-to-first'?: 'on' | 'off';
  snap?: 'off';
  glide?: 'fixed' | 'scaled';
  reach?: number | string;
  legs?: string; // JSON.stringify(legs), or "0.45 1.3 1.7"
  hold?: number | string;
  length?: number | string;
  fit?: 'cover' | 'contain';
  mode?: 'auto' | 'scrub' | 'stills';
  'loading-text'?: string;
  'bar-label'?: string;
  bar?: 'off';
  class?: string;
}
// No event props on the element (onflythrough-ready ...): React 19 binds
// them only on an element it creates in the browser, not on one it takes
// over from a server's HTML. The component above binds them itself.

// React's types are named in full here: an import at the top of the file
// cannot be named from inside this block in the built .d.ts.
declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      'fly-through': import('react').DetailedHTMLProps<import('react').HTMLAttributes<FlythroughElement>, FlythroughElement> & FlythroughAttributes;
    }
  }
}
