<!--
  The avatar maker, like skribbl.io's: Folio's emblem maker in the doodle theme (vendor/ewo;
  development/plans/emblems.md), arrows on either side of a big face, one pair per part, top to
  bottom as the parts sit (head, eyes, extra, mouth, colour), and a dice for all five. A tap names
  the part's new choice on a strip of tape. Dressed in the Sketchbook look through its parts.
-->
<script lang="ts">
  import type { Avatar as AvatarValue } from '../lib/avatar';

  let { avatar, onchange }: { avatar: AvatarValue; onchange: (next: AvatarValue) => void } = $props();
</script>

<ewo-emblem-maker class="maker" theme="doodle" value={avatar} onchange={(e) => onchange(e.detail.value as AvatarValue)}></ewo-emblem-maker>

<style>
  /* Its parent lays the three rows out 16px apart; the face sits 6% inside its 200px stage. */
  .maker {
    gap: 16px;
    --ewo-emblem-maker-inset: 6%;
    --ewo-emblem-ink: var(--ink);
  }
  .maker::part(arrow) {
    padding: 0;
    border: 2px solid var(--ink);
    border-radius: 12px 5px 10px 6px / 6px 10px 5px 12px;
    background: var(--card);
    color: var(--ink);
    -webkit-tap-highlight-color: transparent;
  }
  /* The right column's corners wobble the other way. */
  .maker::part(next) {
    border-radius: 6px 11px 5px 12px / 12px 5px 11px 6px;
  }
  @media (hover: hover) {
    .maker::part(arrow):hover {
      background: #f4ffd6;
    }
  }
  .maker::part(arrow):active {
    background: var(--hi);
  }
  .maker::part(arrow):focus-visible,
  .maker::part(dice):focus-visible {
    outline: 3px solid var(--tape-2);
    outline-offset: 2px;
  }
  .maker::part(stage) {
    border-radius: 4px;
    background: #ffffff;
    box-shadow: 0 0 0 2px var(--ink), 3px 4px 0 2px rgb(43 45 51 / 0.12);
  }
  /* The tag as a strip of washi tape (app.css .tape). */
  .maker::part(tag) {
    z-index: 2;
    padding: 6px 12px;
    border-radius: 0;
    background: repeating-linear-gradient(-45deg, rgb(255 143 112 / 0.95) 0 5px, rgb(255 143 112 / 0.8) 5px 10px);
    color: var(--tape-ink);
    font: 600 12px/1 var(--ewo-mono);
    letter-spacing: 0.12em;
    clip-path: polygon(0 10%, 4% 0, 8% 10%, 92% 0, 96% 10%, 100% 0, 100% 90%, 96% 100%, 92% 90%, 8% 100%, 4% 90%, 0 100%);
  }
  .maker::part(legend) {
    margin: 2px 0 0;
    font-size: 12px;
    color: var(--mute);
  }
  /* The dice as a small button (app.css .btn.small). */
  .maker::part(dice) {
    min-height: 36px;
    padding: 0 12px;
    border: 2px solid var(--ink);
    border-radius: 16px 6px 14px 7px / 7px 14px 6px 16px;
    background: var(--card);
    color: var(--ink);
    font: 700 14px / 1.2 var(--ewo-sans);
    -webkit-tap-highlight-color: transparent;
    transition: transform var(--ewo-dur-1) var(--ewo-ease);
  }
  @media (hover: hover) {
    .maker::part(dice):hover {
      background: #f4ffd6;
    }
  }
  .maker::part(dice):active {
    transform: scale(0.97);
  }
</style>
