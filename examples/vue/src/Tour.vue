<script setup lang="ts">
import { onMounted, ref } from 'vue';
import type { Flythrough, Stop } from 'flythrough';
import 'flythrough/style.css';

defineProps<{ src: string; stops: Stop[] }>();
const player = ref<Flythrough | null>(null);
const ready = ref(false);
const at = ref<string | null>(null);

// Loaded in the browser, after Vue has matched the page: the player moves
// the cards into its own stage.
onMounted(() => import('flythrough'));

function onStop(e: HTMLElementEventMap['flythrough-stop']) {
  at.value = e.detail.active ? e.detail.id : null;
}
</script>

<template>
  <fly-through ref="player" :src="src" :stops="JSON.stringify(stops)" intro @flythrough-ready="ready = true" @flythrough-stop="onStop">
    <slot />
  </fly-through>
  <p class="tour-status">{{ ready ? (at ?? 'between stops') : 'loading' }}</p>
  <button type="button" @click="player?.goToStop(0)">Back to the first stop</button>
</template>
