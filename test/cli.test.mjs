// Tests for the `flythrough` command (bin/). The end-to-end case needs ffmpeg
// on PATH and is skipped without it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFramesArgs, prepareOut, passthroughFlag, padFor, findFfmpeg, frameRate, seconds, pickFrames, readStops, report, UsageError } from '../bin/frames.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(root, 'bin', 'flythrough.mjs');
const run = (args, opts = {}) => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', ...opts });
const hasFfmpeg = !spawnSync('ffmpeg', ['-version']).error;
const scratch = () => mkdtempSync(path.join(tmpdir(), 'flythrough-test-'));
// A one-second, 12-frame test video.
const testVideo = (dir) => {
  const video = path.join(dir, 'in.mp4');
  const mk = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=12:duration=1', '-pix_fmt', 'yuv420p', video]);
  assert.equal(mk.status, 0);
  return video;
};

test('no command prints help; an unknown one fails', () => {
  assert.match(run([]).stdout, /flythrough frames <video>/);
  const r = run(['nope']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /Unknown command "nope"/);
});

test('frames: arguments are checked before any work', () => {
  assert.throws(() => parseFramesArgs(['v.mp4']), /--out is required/);
  assert.throws(() => parseFramesArgs([]), UsageError);
  assert.throws(() => parseFramesArgs(['v.mp4', '--out', 'o', '--set', 'bad']), /bad --set/);
  assert.throws(() => parseFramesArgs(['v.mp4', '--out', 'o', '--set', 'p=608x1080']), /need --stops/);
  assert.throws(() => parseFramesArgs(['v.mp4', '--out', 'o', '--quality', 'x']), /positive number/);
  assert.throws(() => parseFramesArgs(['v.mp4', '--out', 'o', '--set', 'a=10', '--set', 'a=20']), /its own name/);
  const o = parseFramesArgs(['v.mp4', '--out', 'o', '--set', 'wide=1280@70', '--set', 'tall=406x720', '--stops', 's.json']);
  assert.deepEqual(o.sets, [
    { name: 'wide', width: 1280, height: null, quality: 70 },
    { name: 'tall', width: 406, height: 720, quality: 75 },
  ]);
  assert.deepEqual(parseFramesArgs(['v.mp4', '--out', 'o']).sets, [{ name: 'landscape', width: 1600, height: null, quality: 75 }]);
});

test('frames: format, frame count and trimming are checked too', () => {
  const plain = parseFramesArgs(['v.mp4', '--out', 'o']);
  assert.deepEqual([plain.format, plain.frames, plain.from, plain.to, plain.fps], ['webp', null, null, null, null]);
  const o = parseFramesArgs(['v.mp4', '--out', 'o', '--format', 'avif', '--frames', '300', '--from', '1:05', '--to', '90.5']);
  assert.deepEqual([o.format, o.frames, o.from, o.to], ['avif', 300, 65, 90.5]);
  // AVIF's scale is not WebP's: its default is 50, a given quality is kept.
  assert.equal(o.sets[0].quality, 50);
  assert.equal(parseFramesArgs(['v.mp4', '--out', 'o', '--format', 'avif', '--quality', '60']).sets[0].quality, 60);
  assert.equal(parseFramesArgs(['v.mp4', '--out', 'o', '--format', 'avif', '--set', 'a=800@40']).sets[0].quality, 40);
  assert.throws(() => parseFramesArgs(['v.mp4', '--out', 'o', '--format', 'png']), /webp or avif/);
  assert.throws(() => parseFramesArgs(['v.mp4', '--out', 'o', '--frames', '1']), /2 or more/);
  assert.throws(() => parseFramesArgs(['v.mp4', '--out', 'o', '--frames', '12.5']), /whole number/);
  assert.throws(() => parseFramesArgs(['v.mp4', '--out', 'o', '--frames', '100', '--fps', '12']), /not both/);
  assert.throws(() => parseFramesArgs(['v.mp4', '--out', 'o', '--from', 'soon']), /time in seconds/);
  assert.throws(() => parseFramesArgs(['v.mp4', '--out', 'o', '--from', '10', '--to', '5']), /later than --from/);
  assert.throws(() => parseFramesArgs(['v.mp4', '--out', 'o', '--to', '0']), /later than --from/);
});

test('frames: times as seconds, m:ss or h:mm:ss', () => {
  assert.equal(seconds('12.5'), 12.5);
  assert.equal(seconds('1:05'), 65);
  assert.equal(seconds('1:02:03.5'), 3723.5);
  assert.equal(seconds('0'), 0);
  for (const bad of ['', 'x', '1:', ':5', '-3', '1:2:3:4', '1,5']) assert.ok(Number.isNaN(seconds(bad)), bad);
});

test('frames: --frames keeps n frames, evenly spread, first and last included', () => {
  assert.deepEqual(pickFrames(12, null), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  assert.deepEqual(pickFrames(12, 4), [0, 4, 7, 11]);
  assert.deepEqual(pickFrames(720, 2), [0, 719]);
  // Never more than there are, never one twice.
  assert.equal(pickFrames(12, 500).length, 12);
  const half = pickFrames(713, 356);
  assert.equal(half.length, 356);
  assert.equal(new Set(half).size, 356);
  assert.deepEqual([half[0], half.at(-1)], [0, 712]);
  for (let i = 1; i < half.length; i++) assert.ok(half[i] - half[i - 1] >= 2 && half[i] - half[i - 1] <= 3);
});

test("frames: the video's frame rate is read from ffmpeg's report", () => {
  const line = (rates) => `Input #0, mov,mp4, from 'in.mp4':\n  Duration: 00:00:30.00, start: 0.000000, bitrate: 4000 kb/s\n  Stream #0:0[0x1](und): Video: h264 (High) (avc1 / 0x31637661), yuv420p(progressive), 1920x1080 [SAR 1:1 DAR 16:9], 3990 kb/s, ${rates} (default)\n  Stream #0:1: Audio: aac, 48000 Hz, 30 fps`;
  assert.equal(frameRate(line('24 fps, 24 tbr, 12288 tbn')), 24);
  assert.equal(frameRate(line('12 fps, 12 tbr, 12288 tbn')), 12);
  // Broadcast rates come back exact; a variable-rate phone video goes by tbr.
  assert.equal(frameRate(line('23.98 fps, 23.98 tbr, 24k tbn')), 24000 / 1001);
  assert.equal(frameRate(line('29.97 fps, 29.97 tbr, 30k tbn')), 30000 / 1001);
  assert.equal(frameRate(line('29.83 fps, 30 tbr, 90k tbn')), 30);
  // No rate ffmpeg could name, or no video line at all.
  assert.equal(frameRate(line('25 fps, 1k tbn')), 25);
  assert.equal(frameRate(line('90k tbn')), null);
  assert.equal(frameRate('nothing here'), null);
});

test('frames: ffmpeg comes from FFMPEG_PATH, else the PATH, else ffmpeg-static', async () => {
  const runs = (names) => (program) => (names.includes(program) ? `ffmpeg version 7.1 (${program})` : null);
  const none = () => Promise.reject(new Error('not installed'));
  const bundled = () => Promise.resolve({ default: '/pkg/ffmpeg-static/ffmpeg' });
  assert.deepEqual(await findFfmpeg({ env: { FFMPEG_PATH: '/my/ffmpeg' }, run: runs(['/my/ffmpeg', 'ffmpeg']), load: bundled }), { program: '/my/ffmpeg', version: 'ffmpeg version 7.1 (/my/ffmpeg)', from: 'FFMPEG_PATH' });
  assert.equal((await findFfmpeg({ env: {}, run: runs(['ffmpeg', '/pkg/ffmpeg-static/ffmpeg']), load: bundled })).from, 'PATH');
  const viaPackage = await findFfmpeg({ env: {}, run: runs(['/pkg/ffmpeg-static/ffmpeg']), load: bundled });
  assert.deepEqual([viaPackage.program, viaPackage.from], ['/pkg/ffmpeg-static/ffmpeg', 'ffmpeg-static']);
  // Nowhere: the message says how to get one. A wrong FFMPEG_PATH says so.
  await assert.rejects(findFfmpeg({ env: {}, run: runs([]), load: none }), /npm install --save-dev ffmpeg-static/);
  await assert.rejects(findFfmpeg({ env: {}, run: runs([]), load: bundled }), /needs ffmpeg/);
  await assert.rejects(findFfmpeg({ env: {}, run: runs([]), load: () => Promise.resolve({ default: null }) }), /needs ffmpeg/);
  await assert.rejects(findFfmpeg({ env: { FFMPEG_PATH: '/nope' }, run: runs(['ffmpeg']), load: bundled }), /FFMPEG_PATH is \/nope/);
});

test('frames: the closing report says what each set weighs and names the poster', () => {
  const MB = 1048576;
  const lines = report({
    sets: [
      { name: 'landscape', width: 1920, height: 1080, format: 'webp', quality: 70, bytes: 24 * MB },
      { name: 'portrait', width: 608, height: 1080, format: 'webp', quality: 70, bytes: 7.2 * MB },
    ],
    frames: 720,
    fps: 24,
    manifestPath: 'public/tour/manifest.json',
    firstStop: 49,
  }).join('\n');
  assert.match(lines, /720 frames at 24 a second \(30 s of footage\)/);
  // One frame in eight and a second either side: 90 + 48 of 720 frames.
  assert.match(lines, /landscape {2}1920x1080 {2}webp q70 {3}24\.0 MB in all, 34\.1 kB a frame; the loading screen waits for about 4\.6 MB/);
  assert.match(lines, /portrait .* 7\.2 MB in all, 10\.2 kB a frame/);
  assert.match(lines, /A visitor downloads one set/);
  assert.match(lines, /Poster \(the frame the player opens on\): landscape\/0049\.webp, or landscape\/0001\.webp with intro/);
  assert.match(lines, /Manifest: public\/tour\/manifest\.json/);
  assert.doesNotMatch(lines, /heavy/);
  const heavy = report({ sets: [{ name: 'big', width: 3840, height: 2160, format: 'avif', quality: 50, bytes: 90 * MB }], frames: 12000, fps: 30, manifestPath: 'm', firstStop: null }).join('\n');
  assert.match(heavy, /heavy for a phone/);
  assert.match(heavy, /the first stop's frame, or big\/00001\.avif with intro/);
  assert.match(heavy, /A visitor downloads the set as they scroll/);
});

test('frames: without ffmpeg, says how to install it', () => {
  const nodeDir = path.dirname(process.execPath);
  const env = { ...process.env, PATH: nodeDir, Path: nodeDir };
  const dir = scratch();
  const r = run(['frames', path.join(root, 'package.json'), '--out', path.join(dir, 'o')], { env });
  rmSync(dir, { recursive: true, force: true });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /needs ffmpeg/);
  assert.match(r.stderr, /winget install Gyan\.FFmpeg/);
  assert.match(r.stderr, /brew install ffmpeg/);
});

test('frames: without sharp, says how to add it', { skip: !hasFfmpeg && 'ffmpeg not on PATH' }, () => {
  // A copy of bin/ outside the project cannot resolve sharp.
  const dir = scratch();
  cpSync(path.join(root, 'bin'), path.join(dir, 'bin'), { recursive: true });
  writeFileSync(path.join(dir, 'package.json'), '{"version":"0.0.0","type":"module"}');
  const r = spawnSync(process.execPath, [path.join(dir, 'bin', 'flythrough.mjs'), 'frames', path.join(dir, 'package.json'), '--out', path.join(dir, 'o')], { encoding: 'utf8', cwd: dir });
  rmSync(dir, { recursive: true, force: true });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /needs sharp/);
  assert.match(r.stderr, /npm install --save-dev sharp/);
});

test('frames: old ffmpeg gets -vsync, 5.1 and later -fps_mode', () => {
  const fps = ['-fps_mode', 'passthrough'];
  const vsync = ['-vsync', 'passthrough'];
  assert.deepEqual(passthroughFlag('ffmpeg version 4.4.2-0ubuntu0.22.04.1 Copyright'), vsync);
  assert.deepEqual(passthroughFlag('ffmpeg version 5.0.1 Copyright'), vsync);
  assert.deepEqual(passthroughFlag('ffmpeg version n5.1.2 Copyright'), fps);
  assert.deepEqual(passthroughFlag('ffmpeg version 7.1-full_build-www.gyan.dev'), fps);
  assert.deepEqual(passthroughFlag('ffmpeg version N-112233-g0a1b2c3d4e Copyright'), fps);
});

test('frames: file names keep playing order past 9999 frames', () => {
  assert.equal(padFor(1), 4);
  assert.equal(padFor(9999), 4);
  assert.equal(padFor(10000), 5);
  const names = [9, 9999, 10000, 12345].map((n) => String(n).padStart(padFor(12345), '0'));
  assert.deepEqual([...names].sort(), names);
});

test('frames: never clears a folder it did not make', () => {
  const dir = scratch();
  writeFileSync(path.join(dir, 'index.html'), 'precious');
  assert.throws(() => prepareOut(dir, ['landscape']), /not made by this command/);
  assert.ok(existsSync(path.join(dir, 'index.html')));
  rmSync(dir, { recursive: true, force: true });
});

test('frames: a folder it made is replaced, other files stay', () => {
  const dir = scratch();
  mkdirSync(path.join(dir, 'old'));
  writeFileSync(path.join(dir, 'old', '0001.webp'), '');
  writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ sets: { old: { pattern: 'old/{i}.webp' }, evil: { pattern: '../x/{i}.webp' } } }));
  writeFileSync(path.join(dir, 'notes.txt'), 'keep');
  prepareOut(dir, ['landscape']);
  assert.deepEqual(readdirSync(dir), ['notes.txt']);
  rmSync(dir, { recursive: true, force: true });
});

test('frames: makes the frames and manifest from a video', { skip: !hasFfmpeg && 'ffmpeg not on PATH' }, () => {
  const dir = scratch();
  const video = testVideo(dir);
  writeFileSync(path.join(dir, 'stops.json'), JSON.stringify({ frames: 12, stops: [{ frame: 3, focus: [0.2, 0.5] }, { frame: 12, focus: [0.8, 0.5] }] }));
  const out = path.join(dir, 'out');
  const r = run(['frames', video, '--out', out, '--set', 'wide=640', '--set', 'tall=90x180@60', '--stops', path.join(dir, 'stops.json')]);
  assert.equal(r.status, 0, r.stderr);
  const m = JSON.parse(readFileSync(path.join(out, 'manifest.json'), 'utf8'));
  assert.equal(m.version, 1);
  assert.equal(m.frames, 12);
  assert.equal(m.fps, 12);
  assert.equal(m.duration, 1);
  // The closing report: sizes, and the poster from the first stop's frame.
  assert.match(r.stdout, /12 frames at 12 a second \(1 s of footage\)/);
  assert.match(r.stdout, /wide {2}320x180 +webp q75 +\d+ kB in all, [\d.]+ kB a frame; the loading screen waits for about \d+ kB/);
  assert.match(r.stdout, /Poster \(the frame the player opens on\): wide\/0003\.webp, or wide\/0001\.webp with intro/);
  assert.deepEqual(m.sets.wide, { width: 320, height: 180, pattern: 'wide/{i}.webp', pad: 4 }); // never upscaled
  assert.deepEqual(m.sets.tall, { width: 90, height: 180, pattern: 'tall/{i}.webp', pad: 4, cropped: true });
  assert.equal(readdirSync(path.join(out, 'wide')).length, 12);
  assert.ok(existsSync(path.join(out, 'tall', '0012.webp')));
  // Running again into the same folder replaces it.
  assert.equal(run(['frames', video, '--out', out, '--set', 'wide=160']).status, 0);
  assert.deepEqual(readdirSync(out).sort(), ['manifest.json', 'wide']);
  rmSync(dir, { recursive: true, force: true });
});

test('frames: the stops file is checked, and may be the list the player takes', () => {
  const dir = scratch();
  const file = (name, text) => {
    writeFileSync(path.join(dir, name), text);
    return path.join(dir, name);
  };
  assert.throws(() => readStops(file('a.json', '{ not json')), /a\.json is not JSON/);
  assert.throws(() => readStops(file('b.json', '{"frames": 12}')), /holds no stops/);
  assert.throws(() => readStops(file('c.json', '[]')), /holds no stops/);
  assert.throws(() => readStops(file('d.json', '[{"frame":1},{"id":"door","focus":[0.5,0.5]}]')), /stop 2 \("door"\) has no place/);
  assert.throws(() => readStops(file('e.json', '{"frames":"many","stops":[{"frame":1}]}')), /"frames" must be a whole number/);
  for (const bad of ['a.json', 'd.json']) assert.throws(() => readStops(path.join(dir, bad)), UsageError);
  assert.deepEqual(readStops(file('f.json', '[{"frame":3},{"time":0.5},{"at":1}]')), { frames: null, stops: [{ frame: 3 }, { time: 0.5 }, { at: 1 }] });
  assert.deepEqual(readStops(file('g.json', '{"frames":12,"stops":[{"frame":3}]}')), { frames: 12, stops: [{ frame: 3 }] });
  rmSync(dir, { recursive: true, force: true });
});

test('frames: stops by frame, by seconds and by share crop the same', { skip: !hasFfmpeg && 'ffmpeg not on PATH' }, () => {
  const dir = scratch();
  const video = testVideo(dir);
  // Frame 4 of 12 at 12 a second is 0.25 s in, and 3/11 of the way.
  const ways = {
    counted: { frames: 12, stops: [{ frame: 4, focus: [0.2, 0.5] }, { frame: 12, focus: [0.8, 0.5] }] },
    frame: [{ frame: 4, focus: [0.2, 0.5] }, { frame: 12, focus: [0.8, 0.5] }],
    time: [{ time: 0.25, focus: [0.2, 0.5] }, { at: 1, focus: [0.8, 0.5] }],
    at: [{ at: 3 / 11, focus: [0.2, 0.5] }, { at: 1, focus: [0.8, 0.5] }],
  };
  const tall = {};
  for (const [name, stops] of Object.entries(ways)) {
    writeFileSync(path.join(dir, `${name}.json`), JSON.stringify(stops));
    const out = path.join(dir, name);
    const r = run(['frames', video, '--out', out, '--set', 'tall=90x180@60', '--stops', path.join(dir, `${name}.json`)]);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /Poster \(the frame the player opens on\): tall\/0004\.webp/, name);
    tall[name] = readdirSync(path.join(out, 'tall')).map((f) => readFileSync(path.join(out, 'tall', f)));
  }
  for (const name of ['frame', 'time', 'at']) assert.deepEqual(tall[name], tall.counted, `stops by ${name}`);
  assert.equal(tall.counted.length, 12);
  // A file that is not usable stops the run before any work, by name.
  writeFileSync(path.join(dir, 'bare.json'), '{"stops":[{"focus":[0.5,0.5]}]}');
  const bad = run(['frames', video, '--out', path.join(dir, 'bad'), '--set', 'tall=90x180', '--stops', path.join(dir, 'bare.json')]);
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /bare\.json: stop 1 has no place/);
  assert.ok(!existsSync(path.join(dir, 'bad')));
  rmSync(dir, { recursive: true, force: true });
});

test('frames: trims, thins to a frame count and writes AVIF', { skip: !hasFfmpeg && 'ffmpeg not on PATH' }, () => {
  const dir = scratch();
  const video = testVideo(dir);
  const manifest = (out) => JSON.parse(readFileSync(path.join(out, 'manifest.json'), 'utf8'));
  // The middle half second of a 12-frame second: 6 frames.
  const cut = path.join(dir, 'cut');
  let r = run(['frames', video, '--out', cut, '--set', 'a=160', '--from', '0.25', '--to', '0.75']);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual([manifest(cut).frames, manifest(cut).fps, manifest(cut).duration], [6, 12, 0.5]);
  assert.equal(readdirSync(path.join(cut, 'a')).length, 6);
  // --frames 4 of the 12: the rate drops with them, the length stays.
  const thin = path.join(dir, 'thin');
  r = run(['frames', video, '--out', thin, '--set', 'a=160', '--frames', '4']);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual([manifest(thin).frames, manifest(thin).fps, manifest(thin).duration], [4, 4, 1]);
  assert.deepEqual(readdirSync(path.join(thin, 'a')).sort(), ['0001.webp', '0002.webp', '0003.webp', '0004.webp']);
  assert.match(r.stdout, /12 frames, keeping 4/);
  // More than the video has: all are kept, and it says so.
  r = run(['frames', video, '--out', thin, '--set', 'a=160', '--frames', '500']);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(manifest(thin).frames, 12);
  assert.match(r.stdout, /the video has 12 frames, so all are kept/);
  // AVIF: the files, and the manifest's pattern, carry the name.
  const avif = path.join(dir, 'avif');
  r = run(['frames', video, '--out', avif, '--set', 'a=160', '--format', 'avif', '--frames', '3']);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(manifest(avif).sets.a.pattern, 'a/{i}.avif');
  assert.deepEqual(readdirSync(path.join(avif, 'a')).sort(), ['0001.avif', '0002.avif', '0003.avif']);
  // ftyp box with the avif brand: a real AVIF file.
  assert.equal(readFileSync(path.join(avif, 'a', '0001.avif')).subarray(4, 12).toString('latin1'), 'ftypavif');
  assert.match(r.stdout, /avif q50/);
  // A folder made as WebP is replaced when made again as AVIF.
  assert.equal(run(['frames', video, '--out', thin, '--set', 'a=160', '--format', 'avif', '--frames', '2']).status, 0);
  assert.deepEqual(readdirSync(path.join(thin, 'a')).sort(), ['0001.avif', '0002.avif']);
  rmSync(dir, { recursive: true, force: true });
});

test('frames: FFMPEG_PATH names the ffmpeg to use when none is on the PATH', { skip: !hasFfmpeg && 'ffmpeg not on PATH' }, () => {
  const exe = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
  const real = (process.env.PATH ?? process.env.Path ?? '').split(path.delimiter).map((d) => path.join(d, exe)).find((f) => existsSync(f));
  assert.ok(real, 'ffmpeg found on the PATH');
  const dir = scratch();
  const video = testVideo(dir);
  const nodeDir = path.dirname(process.execPath);
  const env = { ...process.env, PATH: nodeDir, Path: nodeDir, FFMPEG_PATH: real };
  const r = run(['frames', video, '--out', path.join(dir, 'out'), '--set', 'a=160'], { env });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /ffmpeg from FFMPEG_PATH/);
  assert.equal(readdirSync(path.join(dir, 'out', 'a')).length, 12);
  const wrong = run(['frames', video, '--out', path.join(dir, 'out2')], { env: { ...env, FFMPEG_PATH: path.join(dir, 'nope') } });
  assert.equal(wrong.status, 1);
  assert.match(wrong.stderr, /no ffmpeg runs from there/);
  rmSync(dir, { recursive: true, force: true });
});
