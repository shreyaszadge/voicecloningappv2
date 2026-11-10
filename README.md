# Jarvis: AI talking avatar

A 3D avatar you can talk to. Speak or type, Gemini answers, your **browser's own voice** speaks, and
[TalkingHead](https://github.com/met4citizen/TalkingHead) moves the face, mouth and hands.
No voice service, no extra keys: only a free Gemini key for real answers.

```
mic / text -> Express /api/chat (Gemini) -> reply + action -> browser voice + TalkingHead (lip-sync, gestures)
```

## 1. Run it

```bash
npm install
cp .env.example .env        # Windows: copy .env.example .env
npm start
```

Open http://localhost:3000 in **Chrome or Edge** with internet on (TalkingHead and the sample avatars load from the web).

No Gemini key yet? Set `MOCK_MODE=true` in `.env`: replies are pre-written, everything else works.
For real answers: get a key at https://aistudio.google.com/apikey, put it in `GEMINI_API_KEY`, set `MOCK_MODE=false`,
restart. Run `npm test` for the automatic tests.

## 2. What Jarvis does

- **Greets you** when the page opens ("Good evening! I'm Jarvis. How can I help you today?"). Browsers do not allow
  sound before your first click or key press, so the greeting text appears at once and is spoken as soon as you click anywhere.
- **Looks at you.** While speaking and listening the avatar keeps eye contact with the screen; when nobody is
  talking it moves on its own (idle pose changes, looking around). You cannot rotate the camera away from the face.
- **Acts while talking.** Gemini can start a reply with an action ([wave], [thumbsup], [shrug], [point], [ok], [smile],
  [think], [thumbsdown], [sad]); the tag is removed from the text and the avatar performs it. If the AI gave none, the
  reply's words decide (thanks -> thumbs up, "I'm not sure" -> shrug). Between sentences it makes small hand movements.
- **Action buttons** on the stage (wave, thumbs up, shrug, point, OK, smile, think). You can also type or say
  a short command such as "wave" or "thumbs up".
- **Idle behaviour:** when nobody is talking it moves now and then and, after about 100 seconds, speaks up (at most 3 times
  until you interact again). Change this in Settings > Behaviour (speak up / only move / stay still).
- **Jarvis-style chat:** shows who is typing and what it is doing ("You are typing", "Jarvis is thinking",
  "Jarvis is speaking"), a small Activity log, quick suggestion buttons, typed-out replies.
- **Chat window sizes:** Expand (bigger), Collapse (a small button with an unread badge), and it remembers your choice.

## 3. Avatars (Settings > Avatar)

The picker lists:

1. every `.glb` file in `public/avatars/` (name them in `public/avatars/avatars.json`, see the README.txt there),
2. a few sample avatars from the TalkingHead project (non-commercial licenses),
3. avatars you add in the browser with **+ Add my avatar (.glb)**. They are stored in your browser only.

**For a realistic face from a selfie (free):** create an avatar at https://avaturn.me, export it as **GLB**, then add it in
Settings. Avaturn avatars include the face shapes TalkingHead needs for lip-sync. Keep "Avaturn head angle and eyelid fix"
ticked for them. Ready Player Me, which TalkingHead's own README still mentions, closed in January 2026.
Any other GLB works only if it has ARKit + Oculus viseme blend shapes.

Also in Settings: body type (Female/Male, changes posture animations), camera (face close-up to full body), and a
tick-box for the Avaturn fix. Respect each avatar's license; models in `public/` can be downloaded by every visitor.

## 4. Voice (Settings > Voice)

Pick any voice your browser has (Edge has very natural ones marked "Natural"), speed, and a test button.
`SPEECH_LANG` in `.env` sets the microphone language and the default voice language (for example `en-IN`).

**Lip-sync is approximate.** A browser voice cannot tell us when each word is spoken, so the mouth follows an estimated
timing (longer words take longer, commas and full stops leave pauses). Each sentence is re-synced and the app learns
your voice's speed as you chat. If the mouth is late, move **Lip-sync timing** toward minus; if early, toward plus.
English mouth shapes are used for every language.

## 5. If it is slow

The page shows timings in the Activity log ("Reply ready in 1.2s"), and the terminal prints `POST /api/chat -> 200 in 1200 ms`.

- **Reply slow:** run `npm run model-test` to time Gemini models with your key, then put the fastest in `GEMINI_MODEL`.
  Smaller flash-lite models are quickest. `GEMINI_THINKING=auto` already asks for the lowest thinking setting.
- **Avatar choppy:** Settings > Camera > Close-up, close other tabs, use Chrome or Edge. The avatar runs at 24 fps without retina rendering.
- **Mic slow or failing:** speech recognition runs in Google's cloud and needs internet; allow the microphone in the address bar.

## Files

```
server.js         Express app: /api/chat, /api/config, /api/avatars
lib/handlers.js   chat logic (Gemini, thinking setting, action tags, demo mode)
lib/avatars.js    which avatars are offered
public/           index.html, style.css, app.js, actions.js, speech-helpers.js, store.js, avatars/
scripts/          model-speed.js (npm run model-test), get-avatar.js (npm run get-avatar, optional offline sample)
test/             node:test unit tests
```
