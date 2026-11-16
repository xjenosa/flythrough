<script setup lang="ts">
import { computed } from 'vue';
// #region imports
import { ref } from 'vue';
import { Flythrough, type FlythroughRef } from 'flythrough/vue';
import 'flythrough/style.css';
// #endregion imports

const FULL = [
  { id: 'entrance', at: 0.0668, label: 'Entrance' },
  { id: 'lobby', at: 0.1669, label: 'Lobby' },
  { id: 'room', at: 0.4339, label: 'Room' },
  { id: 'terrace', at: 0.6843, label: 'Terrace' },
  { id: 'overview', at: 1, label: 'Overview' },
];
const SHORT = [FULL[0], FULL[4]];

const short = ref(false);
const stops = computed(() => (short.value ? SHORT : FULL));

// #region state
const player = ref<FlythroughRef | null>(null);
const ready = ref(false);
const at = ref<string | null>(null);
const bars = ref(true);

function onStop(e: HTMLElementEventMap['flythrough-stop']) {
  at.value = e.detail.active ? e.detail.id : null;
}
// #endregion state
function other() {
  short.value = !short.value;
  ready.value = false;
}
</script>

<template>
  <main>
    <!-- #region component -->
    <Flythrough ref="player" src="/tour/manifest.json" intro :bar="bars ? undefined : 'off'" @ready="ready = true" @stop="onStop">
      <h2 v-for="s in stops" :key="s.id" :data-stop="s.id" :data-at="s.at" :data-label="s.label">{{ s.label }}</h2>
    </Flythrough>
    <p class="tour-status">{{ ready ? (at ?? 'between stops') : 'loading' }}</p>
    <button type="button" @click="player?.element?.goToStop(0)">Back to the first stop</button>
    <!-- #endregion component -->

    <!-- A prop changed while the player runs is live: the same player. -->
    <button type="button" class="bars" @click="bars = !bars">{{ bars ? 'Hide the bar' : 'Show the bar' }}</button>

    <!-- Other cards are another tour: the component builds a new player. -->
    <button type="button" class="switch" @click="other">
      {{ short ? 'The whole tour' : 'The short tour' }}
    </button>

    <!-- #region scrub -->
    <!-- A plain scrub: no stops, one line passing by. -->
    <Flythrough src="/tour/manifest.json" :length="6">
      <p data-moment="line" data-from="0.1" data-to="0.4">One long shot</p>
    </Flythrough>
    <!-- #endregion scrub -->
  </main>
</template>
