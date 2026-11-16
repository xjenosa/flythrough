<script setup lang="ts">
// A node in <Flythrough>'s slot that comes or goes (a moment, the poster, a
// card) is another set of children: the component builds a new player, as
// it does for another set of cards. A page of its own (window.__way
// 'note'): test/examples-test.mjs presses both buttons.
import { ref } from 'vue';
import { Flythrough } from 'flythrough/vue';
import 'flythrough/style.css';

const note = ref(false);
const poster = ref(false);
</script>

<template>
  <main>
    <!-- #region note -->
    <Flythrough src="/tour/manifest.json">
      <img v-if="poster" data-poster src="/tour/landscape/0049.webp" alt="" />
      <h2 data-stop="entrance" data-frame="49">Entrance</h2>
      <!-- Shown or hidden, a node of the slot makes a new player: the tour
           starts over. -->
      <p v-if="note" data-moment="note" data-from="0.1" data-to="0.15">Up the stairs</p>
      <h2 data-stop="lobby" data-frame="121">Lobby</h2>
    </Flythrough>
    <!-- #endregion note -->
    <button type="button" class="note" @click="note = !note">{{ note ? 'Hide the note' : 'Show the note' }}</button>
    <button type="button" class="poster" @click="poster = !poster">{{ poster ? 'No poster' : 'A poster' }}</button>
  </main>
</template>
