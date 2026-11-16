# Demo footage

`grey-flight.mp4` is the grey hotel fly-through from the owner's letramy.com
project: 1920x1080, 24 fps, 720 frames (30 s). `flight.json` holds the demo's
stops and passing moments as frame numbers of those 720, plus the pacing.

## How it is made

The model and the camera path are built by `blender/build_hotel.py` in the
letramy.com repo. The video is not a Blender render: that repo's
`blender/preview/` draws the exported model with three.js in a browser, one
picture per camera frame (1105 of them), and ffmpeg squeezes the 1105 into
30 s. Re-making it at another size (here 1920 wide) gives the same pictures
at every frame, so `flight.json` stays valid.

Work on copies in a scratch folder; nothing is written into letramy.com:

1. Export the model and camera path (plain Python, no Blender):
   `python <letramy.com>/blender/build_hotel.py <scratch>/scene.json`
2. Copy `preview.html` and `shoot.js` from `<letramy.com>/blender/preview/`
   into `<scratch>`, and there `npm install three@0.160.0`.
3. In `<scratch>`: `python -m http.server 8765 --bind 127.0.0.1`, and in a
   second terminal `node shoot.js frames flight 1:1105 1920` (Playwright from
   this repo: `NODE_PATH=<this repo>/node_modules`). Splitting the range over
   a few processes is faster.
4. Squeeze into 30 s:
   `ffmpeg -framerate 1105/30 -i frames/flight_%04d.png -vf "fps=24,format=yuv420p" -c:v libx264 -preset slow -crf 16 demo/footage/grey-flight.mp4`
5. `npm run demo:frames`, then delete the scratch folder.
