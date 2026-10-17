# Radcars audio: licences (rev 3, real recordings; v54.7 sprite update; v54.8 DRIFT)

Every shipped file is built only from **CC0 1.0 (public domain dedication)** recordings. CC0 doesn't require credit. The credits below are a courtesy and an audit trail.

I checked each Freesound item on its own page. The only licence link on the page was `creativecommons.org/publicdomain/zero/1.0/`, and that check is logged in `_src/pipeline/sources.tsv` with status `CC0-OK`. I checked the Kenney packs against the `License.txt` inside each zip ("Creative Commons Zero, CC0").

**Caveat about the Freesound sources:** the originals need a logged-in download, so the pipeline used Freesound's public **HQ previews**. These are lossy Ogg/MP3 at about 100–190 kbps, which is still well above the 50–64 kbps the game ships. The licence is the same as the original's. If Callum wants the cleanest possible chain later, someone with a Freesound login can swap in the original WAV/FLAC and rerun `_src/pipeline/build_*.py`. The loop points will move, and the build prints the new ones.

## Shipped files → sources

**v54.7:** every one-shot below now ships as a clip inside **`sfx_sprite.{ogg,m4a}`** (clip names = the old file names; offsets in `sfx_sprite.json`; built by `_src/pipeline/build_sprite_v547.py` from the v54.7 masters of `_src/pipeline/build_v547.py`). The sources are unchanged except where marked v54.7. `ui_podium` / `ui_win` are replaced by the clips `podium_jingle` / `win_fanfare` (the same chip jingles without the slam; the game plays `ui_slam` with them). The loops (`eng_*`, `squeal`, `warn_loop`) and the music stay separate files.


| Shipped file(s) | Built from (author, title, URL) | Licence |
|---|---|---|
| `eng_idle.{ogg,m4a}` | Chippy569, "21_500_D6.wav" https://freesound.org/people/Chippy569/sounds/162515/ + "21_500_4062.wav" https://freesound.org/people/Chippy569/sounds/162516/ (pack "The Dyno Sessions: 190E", Mercedes-Benz 190E 16V 4-cylinder on a dyno, neutral idle, 2 mics) | CC0 1.0 |
| `eng_low.{ogg,m4a}` | Chippy569, "19_2500_D6.wav" https://freesound.org/people/Chippy569/sounds/162509/ + "19_2500_4062.wav" https://freesound.org/people/Chippy569/sounds/162510/ (full load, about 2560 rpm) | CC0 1.0 |
| `eng_high.{ogg,m4a}` | Chippy569, "20_6500_D6.wav" https://freesound.org/people/Chippy569/sounds/162512/ + "20_6500_4062.wav" https://freesound.org/people/Chippy569/sounds/162513/ (full load, about 6200 rpm) | CC0 1.0 |
| `eng_off_low.{ogg,m4a}` | Chippy569, "21_2500_D6.wav" https://freesound.org/people/Chippy569/sounds/162518/ + "21_2500_4062.wav" https://freesound.org/people/Chippy569/sounds/162519/ (no load, about 2430 rpm) | CC0 1.0 |
| `eng_off_high.{ogg,m4a}` | Chippy569, "21_6500_D6.wav" https://freesound.org/people/Chippy569/sounds/162521/ + "21_6500_4062.wav" https://freesound.org/people/Chippy569/sounds/162522/ (no load, about 6300 rpm) | CC0 1.0 |
| `squeal.{ogg,m4a}` | audible-edge, "Chrysler LHS tire squeal 04 (04-25-2009).wav" https://freesound.org/people/audible-edge/sounds/71739/ | CC0 1.0 |
| `wall_light_1.{ogg,m4a}` | Kenney "Impact Sounds" `impactPlate_light_001.ogg` https://kenney.nl/assets/impact-sounds + Pól, "S023_Metal_Rail_Scrape_Mono.wav" https://freesound.org/people/P%C3%B3l/sounds/385939/ | CC0 1.0 |
| `wall_light_2.{ogg,m4a}` | Kenney "Impact Sounds" `impactGeneric_light_002.ogg` + Pól 385939 (as above) | CC0 1.0 |
| `wall_light_3.{ogg,m4a}` | Kenney "Impact Sounds" `impactMetal_light_003.ogg` + Pól 385939 (as above) | CC0 1.0 |
| `wall_heavy_1.{ogg,m4a}` | qubodup, "Clank Car Crash Collision" https://freesound.org/people/qubodup/sounds/151624/ + Kenney "Impact Sounds" `impactPunch_heavy_001.ogg` | CC0 1.0 |
| `wall_heavy_2.{ogg,m4a}` | LPA134, "Hood Impact" https://freesound.org/people/LPA134/sounds/329516/ + Kenney "Impact Sounds" `impactMetal_heavy_002.ogg` | CC0 1.0 |
| `wall_heavy_3.{ogg,m4a}` | squareal, "Car Crash" https://freesound.org/people/squareal/sounds/237375/ + qubodup, "Fast Collision" https://freesound.org/people/qubodup/sounds/332056/ + Kenney "Impact Sounds" `impactPunch_heavy_003.ogg` | CC0 1.0 |
| `boost` (sprite clip) | ReadeOnly, "woosh.wav" https://freesound.org/people/ReadeOnly/sounds/186956/ + derplayer, "firework_rocket_ignition.ogg" https://freesound.org/people/derplayer/sounds/587173/ + **v54.7:** modusmogulus, "Car Antilag (No cleanup, 32float)" https://freesound.org/people/modusmogulus/sounds/797835/ (two anti-lag exhaust pops at 1.581 s and 1.779 s; page re-checked 7 Oct 2026: CC0) | CC0 1.0 |
| `boost_end.{ogg,m4a}` | EwanPenman11, "Turbo Spooling and Blow Off.WAV" https://freesound.org/people/EwanPenman11/sounds/659544/ | CC0 1.0 |
| `missile_launch.{ogg,m4a}` (v55) | qubodup, "Rocket Launch.flac" https://freesound.org/people/qubodup/sounds/182794/ | CC0 1.0 |
| `explosion.{ogg,m4a}` (v55) | misosound, "BOOMING PUNCHY EXPLOSION - close, big SCHOEPS MK41.wav" https://freesound.org/people/misosound/sounds/251759/ + Kenney "Sci-Fi Sounds" `explosionCrunch_002.ogg` https://kenney.nl/assets/sci-fi-sounds | CC0 1.0 |
| `pickup.{ogg,m4a}` (v55) | 5ro4, "bell ding 1.wav" https://freesound.org/people/5ro4/sounds/611113/ + Leszek_Szary, "coin object" https://freesound.org/people/Leszek_Szary/sounds/146723/ | CC0 1.0 |
| `barge_1.{ogg,m4a}`, `barge_2.{ogg,m4a}` (v55) | Chippy569, "58FrontDoorNTG2.wav" https://freesound.org/people/Chippy569/sounds/162531/ (door slams on the same 190E, at 36.27 s and 40.84 s) + Kenney "Impact Sounds" `impactPunch_medium_001.ogg` / `impactPunch_medium_002.ogg` | CC0 1.0 |
| `warn_loop.{ogg,m4a}` (v55) | C-V, "backing up beep.wav" https://freesound.org/people/C-V/sounds/523413/ (truck reversing alarm) | CC0 1.0 |
| ~~`handbrake`~~ (v54.4; **retired in v54.8**, the clip is no longer in the sprite; kept here as history) | mhtaylor67, "Hand Brake" https://freesound.org/people/mhtaylor67/sounds/126043/ + ninebilly, "Handbrake.wav" https://freesound.org/people/ninebilly/sounds/173007/ + audible-edge, "AE0090 Volvo 740 GLE handbrake turn 01.flac" https://freesound.org/people/audible-edge/sounds/76804/ | CC0 1.0 (each item page checked, `sources.tsv` CC0-OK) |
| `drift_scrub.{ogg,m4a}` (v54.8 loop: the gritty layer of the held power slide) | audible-edge, "Nissan Maxima burnout (04-25-2009).wav" https://freesound.org/people/audible-edge/sounds/71740/ (3.70–5.25 s; loop = 4.047–4.894 s, 7 tyre-chatter periods; built by `_src/pipeline/build_v548.py`) | CC0 1.0 (page checked 7 Oct 2026, `sources.tsv` CC0-OK) |
| `drift_start` (v54.8 sprite clip: the DRIFT press tyre bite) | elliottdj, "Skrrt.wav" https://freesound.org/people/elliottdj/sounds/685910/ (burst at 4.918 s) + audible-edge, "Nissan Maxima burnout (04-25-2009).wav" https://freesound.org/people/audible-edge/sounds/71740/ (grit 4.20–4.56 s, −6 dB) | CC0 1.0 (both pages checked 7 Oct 2026, `sources.tsv` CC0-OK) |
| `drift_end` (v54.8 sprite clip: the grip-catch chirp; clean / not clean is a runtime pitch + lowpass choice, one clip) | elliottdj, "Skrrt.wav" https://freesound.org/people/elliottdj/sounds/685910/ (short burst at 3.687 s with its natural stop) | CC0 1.0 (page checked 7 Oct 2026, `sources.tsv` CC0-OK) |
| Held power slide, smooth layer (v54.8) | Reuses the shipped `squeal` loop (audible-edge 71739, above); no new file | CC0 1.0 |
| `drift_boost.{ogg,m4a}` (v54.4) | florianreichelt, "quick woosh" https://freesound.org/people/florianreichelt/sounds/683101/ + chip arp (self-made, `_src/music/chip.py`) | CC0 1.0 + project-owned |
| `drift_sparkle.{ogg,m4a}` (v54.4) | newagesoup, "GLEAM-GLOW-SFX-CHIME.wav" https://freesound.org/people/newagesoup/sounds/351408/ + chip twinkle (self-made) | CC0 1.0 + project-owned |
| `boost_chain.{ogg,m4a}` (v54.6) | Paul368, "Very Big Whoosh" https://freesound.org/people/Paul368/sounds/237980/ + ReadeOnly, "woosh.wav" https://freesound.org/people/ReadeOnly/sounds/186956/ + qubodup, "Whoosh" https://freesound.org/people/qubodup/sounds/60013/ + derplayer, "firework_rocket_ignition.ogg" https://freesound.org/people/derplayer/sounds/587173/ + chip arp (self-made, `_src/music/chip.py`; built by `_src/pipeline/build_v546.py`) | CC0 1.0 (each item page checked, `sources.tsv` CC0-OK) + project-owned |
| `ui_slam` (v54.4; v54.7 phone pass), played under `podium_jingle` / `win_fanfare` at the finish | Kenney "Impact Sounds" `impactPunch_heavy_002.ogg` https://kenney.nl/assets/impact-sounds + chip synth (self-made) | CC0 1.0 + project-owned |
| `ui_click`, `ui_countdown`, `ui_go`, `ui_lap`, `ui_denied`, `sfx_miss`, `sfx_power`, `sfx_autopilot`, `sfx_power_end` (v54.4), `podium_jingle`, `win_fanfare` (v54.7: the v54.4 `ui_podium` / `ui_win` jingle layers) | Synthesised for Radcars with `_src/music/chip.py` (`_src/pipeline/build_v544.py`) | Project-owned |
| `music_race`, `music_menu`, `music_finish` (rev 4) | Composed and rendered for Radcars (`_src/music/`: chip.py, songs.py, build_music.py). No samples. | Project-owned |
| `sfx_sprite.{ogg,m4a,json}` (v54.7; v54.8: `handbrake` out, `drift_start` + `drift_end` in) | A container of the clips above (no new material); the Ogg Opus writer `_src/pipeline/oggopus.py` is project code on the system libopus | as its clips |
| `_src/*.mjs`, `_src/pipeline/*` | Written for Radcars (Audio Engineer) | Project-owned |
| `_src/superseded-synth/*` | The old oscillator recipes (superseded, not shipped) | Project-owned |

Kenney pack downloads: https://kenney.nl/assets/impact-sounds and https://kenney.nl/assets/sci-fi-sounds. Credit is optional: "Support us by crediting Kenney or www.kenney.nl (this is not mandatory)".

## Rules for adding sounds

- Use CC0 only: Freesound items whose page shows CC0, Kenney, or OpenGameArt items marked CC0. No CC-BY-NC and no unclear licences. Add a row here with the exact URL before committing.
- Not used: **Sonniss GDC bundles**. They're royalty-free but not CC0, and they're only offered as multi-GB torrent/zip downloads. qubodup's "Car Engine Loop 96kHz" on OpenGameArt is CC-BY/GPL, so it wasn't used.

## Rebuild

1. Sources: `_src/pipeline/fs_get.sh <freesound ids>` verifies CC0 on each page and downloads the HQ preview.
2. Build: `python3 _src/pipeline/build_engine.py` and `python3 _src/pipeline/build_sfx.py` (numpy + ffmpeg). Then encode, mono 48 kHz:
   - Opus `-c:a libopus -vbr on -application audio`, at 64k with `-frame_duration 20` for all files except these v55 one-shots (rev 3.1): `explosion` 54k / 40, `missile_launch` 56k / 40, `pickup` 52k / 20, `barge_1` and `barge_2` 50k / 40.
   - AAC `-c:a aac -b:a 80k -movflags +faststart` for every file.
   - The tail trims for `explosion`, `missile_launch` and `pickup` are in `build_sfx.py` (`TAIL`).
   - v54.4 / v54.6 cues: `python3 _src/pipeline/build_v544.py <out>` and `python3 _src/pipeline/build_v546.py <out>` (`boost_chain`: Opus 56k constrained VBR, 20 ms frames; AAC 80k).
3. **v54.7** (the shipped set): `python3 _src/pipeline/build_v547.py <v54.6 masters> <v54.7 masters>` (new boost, wall_heavy_2 re-slice, phone pass, lead/tail trims, podium/win without the slam), then `python3 _src/pipeline/build_sprite_v547.py <v54.7 masters> <loop masters> <out>` (sprite .ogg/.m4a/.json with per-clip Opus settings from `sprite_v547_settings.json`, and the Opus loops). Candidate sources checked but not used: CeebFrack "BACKFIRE.ogg" (105351, clipped) and nsstudios "backfiring vehicle" (351738), both CC0, logged in `sources.tsv`.
4. **v54.8 DRIFT** (the shipped set now): `python3 _src/pipeline/build_v548.py <fs dir> <v54.8 masters>` (drift_scrub loop, drift_start, drift_end from Freesound 71740 + 685910), then `python3 _src/pipeline/build_sprite_v548.py <masters> <loop masters> <out>` (settings `sprite_v548_settings.json`: `handbrake` out, drift clips in, the budget re-encodes listed in `docs/AUDIO_V548_DRIFT.md` §7). Candidate sources checked (all CC0) but not used, logged in `sources.tsv`: monosfera "palenie_opon" (628044, crowd and engine under the tyres), loganzsound "tire_skid_02" (774265, a bike skid), shatterstars "Rubber Skid" (492071, a shoe squeak), audible-edge 71741 / 76805 / 76806 (handbrake turns, less grit than 71740), johnnydekk "screeching tyres" (614627).
5. Previews: run `npm i --no-save puppeteer-core`, then `node assets/audio/_src/render2.mjs --assets assets/audio --previews /tmp/radcars-previews --decoded /tmp/radcars-decoded`.

The pipeline scripts still contain the absolute paths of the audio workbench (`/workspace/radcars-audio/real`), so edit `alib.find()` and the Kenney paths before running them elsewhere.
