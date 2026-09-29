# Clone a voice from a video

Voice Clone accepts a talking-head clip, an interview, or another video with a
soundtrack. You can drop a file or, in the desktop app on this machine, paste a
page URL. The soundtrack is extracted locally. Nothing is uploaded.

## What you do

1. Open **Voice Clone**.
2. Drop a video (`MP4`, `MKV`, `MOV`, `WebM`, `AVI`) or an audio file, or paste
   a page URL and ingest it. URL ingest follows the same local-only rules as
   Dub: it runs on this computer, not from a remote API caller.
3. If more than one speaker is found, pick the one to clone. Play a short clip
   for each speaker, then use that speaker. A single speaker, or a clip that
   cannot be split, uses the extracted soundtrack and the usual long-reference
   window.
4. Save the profile and generate as before. The stored reference is a WAV (or
   the original audio file when no extract was needed).

Replacing the sample on a saved clone uses the same drop zone.

## What the app does on this machine

- A file with no audio track gets the same clear message used elsewhere — not
  an ffmpeg dump.
- If vocal isolation is already installed, vocals are separated before speakers
  are cut. If it is not, the mix is kept and the UI says so.
- If a speaker-splitting runtime is already installed, speakers are listed with
  duration and a short transcript. Missing weights never download; the mix is
  used instead.
- Saving a profile always uploads the chosen WAV. `POST /profiles` still
  refuses a raw video container.

Scratch files live under the app data folder and are deleted when you pick a
speaker or after about 30 minutes.

## MCP

`clone_voice` accepts a video under `OMNIVOICE_MCP_BASE_PATH`. One speaker
creates the profile. Several speakers return their ids and create no profile
until you retry with `speaker_id`. Path confinement is unchanged.
