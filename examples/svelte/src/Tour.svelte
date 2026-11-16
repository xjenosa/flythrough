<script lang="ts">
  import { onMount, type Snippet } from 'svelte';
  import type { Flythrough, Stop } from 'flythrough';
  import 'flythrough/style.css';

  let { src, stops, children }: { src: string; stops: Stop[]; children: Snippet } = $props();
  let player: Flythrough | undefined = $state();
  let ready = $state(false);
  let at: string | null = $state(null);

  // Loaded in the browser, after Svelte has matched the page: the player
  // moves the cards into its own stage.
  onMount(() => {
    void import('flythrough');
  });

  function onStop(e: HTMLElementEventMap['flythrough-stop']) {
    at = e.detail.active ? e.detail.id : null;
  }
</script>

<fly-through bind:this={player} {src} stops={JSON.stringify(stops)} intro onflythrough-ready={() => (ready = true)} onflythrough-stop={onStop}>
  {@render children()}
</fly-through>
<p class="tour-status">{ready ? (at ?? 'between stops') : 'loading'}</p>
<button type="button" onclick={() => player?.goToStop(0)}>Back to the first stop</button>
